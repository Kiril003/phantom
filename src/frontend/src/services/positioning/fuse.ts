import {
  SOURCE_LABEL,
  type Finding,
  type FusedPosition,
  type PositionCandidate,
  type PositionSourceKind,
} from './types';

/** Відстань по поверхні, метри. */
export function distanceM(aLat: number, aLon: number, bLat: number, bLon: number): number {
  const R = 6371000;
  const p = Math.PI / 180;
  const h =
    Math.sin(((bLat - aLat) * p) / 2) ** 2 +
    Math.cos(aLat * p) * Math.cos(bLat * p) * Math.sin(((bLon - aLon) * p) / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Скільки метрів тому. Стале джерело гірше за грубе, але свіже. */
const AGE_FRESH_MS = 30_000;
const AGE_STALE_MS = 5 * 60_000;

/**
 * Наскільки джерело варте довіри саме по собі, до порівняння з іншими.
 * Це не «яке краще взагалі», а «яке краще за цих обставин»: приймач з
 * похибкою в кілометр програє мережі з похибкою в сто метрів.
 */
function baseWeight(c: PositionCandidate, now: number): number {
  const kindTrust: Record<PositionSourceKind, number> = {
    manual: 1,
    gnss: 0.95,
    phone: 0.9,
    wifi: 0.7,
    browser: 0.5,
    ip: 0.2,
  };
  const age = Math.max(0, now - c.at);
  const freshness =
    age <= AGE_FRESH_MS ? 1 : age >= AGE_STALE_MS ? 0.25 : 1 - (age - AGE_FRESH_MS) / (AGE_STALE_MS - AGE_FRESH_MS) * 0.75;
  // Похибка входить логарифмічно: 10 м проти 100 м важить більше, ніж
  // 1000 м проти 1090 м.
  const acc = 1 / (1 + Math.log10(1 + Math.max(1, c.accuracyM) / 10));
  return kindTrust[c.kind] * freshness * acc;
}

const HUMAN_MAX_KMH = 1100;

/**
 * Ворота узгодженості.
 *
 * Одна ознака нічого не доводить: похибка стрибає в тунелі, телефон
 * лишається вдома, мережа відповідає з іншого міста. Тривогу піднімаємо
 * лише коли ознаки збігаються — так само, як це робить `ConsistencyGate`
 * на телефоні, і так само, як це спрацювало на живому записі 21.07.2026,
 * коли приймач заявив Ліму, а вежі далі бачили Київ.
 */
export function consistencyGate(
  candidates: PositionCandidate[],
  now: number,
  previous?: FusedPosition | null,
): { findings: Finding[]; spoofSuspected: boolean; distrust: Set<PositionSourceKind> } {
  const findings: Finding[] = [];
  const distrust = new Set<PositionSourceKind>();
  if (candidates.length === 0) return { findings, spoofSuspected: false, distrust };

  // 1. Похибка, яка сама зізнається, що нічого не знає.
  for (const c of candidates) {
    if (c.accuracyM >= 10_000) {
      distrust.add(c.kind);
      findings.push({
        level: 'warn',
        text: `${SOURCE_LABEL[c.kind]}: заявлена похибка ±${formatDistance(c.accuracyM)}`,
        hint: 'Такою точкою не можна користуватись — вона нічого не звужує.',
      });
    }
  }

  // 2. Розбіжність між джерелами. Мережеві джерела — якір: підмінити
  //    супутниковий сигнал набагато простіше, ніж вежі й точки доступу.
  const anchor = candidates.find((c) => c.kind === 'wifi')
    ?? candidates.find((c) => c.kind === 'browser')
    ?? candidates.find((c) => c.kind === 'ip');
  const claimed = candidates.filter((c) => c.kind === 'gnss' || c.kind === 'phone');
  let diverged = false;
  let divergedWithBlownAccuracy = false;
  if (anchor) {
    for (const c of claimed) {
      const d = distanceM(anchor.lat, anchor.lon, c.lat, c.lon);
      // Розбіжність рахується лише понад суму власних невизначеностей:
      // два джерела з похибкою по кілометру не сперечаються, коли стоять
      // за кілометр одне від одного.
      const slack = (anchor.accuracyM + c.accuracyM) * 2 + 300;
      if (d <= slack) continue;
      diverged = true;

      // Хто кого відкидає, вирішує заявлена похибка, а не тип джерела.
      // Інакше браузер із розкидом 2.3 км дискредитує телефон із 12 м —
      // рівно те, що тут і сталося на живій машині.
      const blown = c.accuracyM >= 10_000;
      const staleC = now - c.at > AGE_STALE_MS;
      const staleAnchor = now - anchor.at > AGE_STALE_MS;
      // Порядок доказів: спершу похибка, що сама себе спростовує, потім
      // застарілість (стара точка описує стару дійсність, а не бреше),
      // і лише тоді — груба похибка.
      const suspect = blown
        ? c
        : staleC !== staleAnchor
          ? (staleC ? c : anchor)
          : c.accuracyM > anchor.accuracyM ? c : anchor;
      if (blown) divergedWithBlownAccuracy = true;
      distrust.add(suspect.kind);

      if (staleC !== staleAnchor && !blown) {
        findings.push({
          level: 'info',
          text: `${SOURCE_LABEL[suspect.kind]}: дані застаріли, місце розійшлось на ${formatDistance(d)}`,
          hint: 'Беремо свіже джерело, навіть якщо воно грубіше.',
        });
      } else if (suspect === c) {
        findings.push({
          level: d > 100_000 ? 'alarm' : 'warn',
          text: `${SOURCE_LABEL[c.kind]} показує на ${formatDistance(d)} далі, ніж ${SOURCE_LABEL[anchor.kind]}`,
          hint: 'Мережу підмінити важче за супутники — тримаємось її.',
        });
      } else {
        // Класичний випадок: телефон поїхав, ПК лишився. Це не напад.
        findings.push({
          level: 'info',
          text: `${SOURCE_LABEL[c.kind]} за ${formatDistance(d)} від того, що показує ${SOURCE_LABEL[anchor.kind]}`,
          hint: `${SOURCE_LABEL[anchor.kind]} знає місце з точністю ±${formatDistance(anchor.accuracyM)} — беремо точніше джерело.`,
        });
      }
    }
  }

  // 3. Стрибок, якого не буває. Порівнюємо з попереднім злитим місцем.
  if (previous) {
    for (const c of candidates) {
      const dt = Math.max(1, (c.at - previous.at) / 1000);
      const d = distanceM(previous.lat, previous.lon, c.lat, c.lon);
      const kmh = (d / dt) * 3.6;
      if (kmh > HUMAN_MAX_KMH && d > 2000) {
        distrust.add(c.kind);
        findings.push({
          level: 'alarm',
          text: `${SOURCE_LABEL[c.kind]}: ${formatDistance(d)} за ${Math.round(dt)} с — це ${Math.round(kmh)} км/год`,
          hint: 'Ніхто так не рухається. Точку відкинуто.',
        });
      }
    }
  }

  // 4. Застарілість. Сама по собі не тривога, але поруч із розбіжністю —
  //    вагомий доказ, що джерело вже не описує дійсність.
  for (const c of candidates) {
    const age = now - c.at;
    if (age > AGE_STALE_MS) {
      findings.push({
        level: diverged ? 'warn' : 'info',
        text: `${SOURCE_LABEL[c.kind]}: дані ${Math.round(age / 60000)} хв тому`,
      });
    }
  }

  const alarms = findings.filter((f) => f.level === 'alarm').length;
  // Підміна — це збіг ознак, а не одна з них. Телефон, який просто
  // поїхав в інше місце, тривоги не варт.
  const spoofSuspected = alarms > 0 || (diverged && divergedWithBlownAccuracy);
  return { findings, spoofSuspected, distrust };
}

export function formatDistance(m: number): string {
  if (m < 1000) return `${Math.round(m)} м`;
  if (m < 100_000) return `${(m / 1000).toFixed(1)} км`;
  return `${Math.round(m / 1000)} км`;
}

/**
 * Зводить усі джерела в одну точку, якій можна дивитись в очі.
 *
 * Ми не усереднюємо все підряд: середнє між правдою і підміною — це не
 * половина правди, це просто нове неправильне місце. Спершу відкидаємо
 * те, що не пройшло ворота, і лише потім зважуємо решту.
 */
export function fuse(
  candidates: PositionCandidate[],
  now: number = Date.now(),
  previous?: FusedPosition | null,
): FusedPosition | null {
  const usable = candidates.filter(
    (c) => Number.isFinite(c.lat) && Number.isFinite(c.lon) && Math.abs(c.lat) <= 90 && Math.abs(c.lon) <= 180,
  );
  if (usable.length === 0) return null;

  const { findings, spoofSuspected, distrust } = consistencyGate(usable, now, previous);
  const trusted = usable.filter((c) => !distrust.has(c.kind));
  const pool = trusted.length > 0 ? trusted : usable;

  const weighted = pool
    .map((c) => ({ c, w: baseWeight(c, now) }))
    .sort((a, b) => b.w - a.w);
  const best = weighted[0];

  // Друге джерело підтягує перше лише коли воно теж вагоме й поруч —
  // інакше зсув до нього просто розмиває добру точку.
  let lat = best.c.lat;
  let lon = best.c.lon;
  const second = weighted[1];
  if (second && second.w > best.w * 0.6) {
    const d = distanceM(best.c.lat, best.c.lon, second.c.lat, second.c.lon);
    if (d < Math.max(best.c.accuracyM, second.c.accuracyM) * 1.5) {
      const total = best.w + second.w;
      lat = (best.c.lat * best.w + second.c.lat * second.w) / total;
      lon = (best.c.lon * best.w + second.c.lon * second.w) / total;
    }
  }

  const agreeing = pool.filter(
    (c) => c !== best.c && distanceM(lat, lon, c.lat, c.lon) < Math.max(c.accuracyM, best.c.accuracyM) * 2,
  ).length;
  const confidence = Math.max(
    0.05,
    Math.min(1, best.w * (1 + agreeing * 0.15) * (spoofSuspected ? 0.35 : 1)),
  );

  return {
    lat,
    lon,
    accuracyM: best.c.accuracyM,
    at: best.c.at,
    kind: best.c.kind,
    label: best.c.label ?? SOURCE_LABEL[best.c.kind],
    confidence,
    candidates: usable,
    findings,
    spoofSuspected,
  };
}

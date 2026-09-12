const STATUS_EL = document.getElementById('status');
// Адресу бекенда більше не знаємо самі — беремо з єдиного джерела
// (`backend-origin.js`, підключений у splash.html перед цим файлом).
// Доти тут був зашитий `http://127.0.0.1:8000`, і саме тому заставка була
// єдиною справною частиною запакованого застосунку: решта будувала адреси
// від `window.location`, який в asset-протоколі вказує не туди.
const READYZ = window.__PHANTOM_BACKEND__.absolute('/readyz');
// Resolved against the asset-protocol root the splash itself is served from.
const TARGET = 'index.html';
const POLL_MS = 250;
// Скільки чекати, перш ніж СКАЗАТИ, що довго. Не «перш ніж здатися».
//
// Тут стояло 30 000 — і це був перший екран, який бачив користувач
// запакованого застосунку: англійський вирок про те, що ядро не встигло.
// Заміряно 29.08.2026 на зібраному AppImage, чотири запуски поспіль: 37, 40,
// 45 і 47 секунд до першої відповіді /health. Тобто заставка оголошувала
// провал ЗАВЖДИ, на цілком справному бекенді.
//
// Опитування НЕ спиняється ніколи: після порога міняється лише текст. Станів
// три, і третій каже правду — 29.08 заставка з одним лише порогом терпіння
// тридцять три хвилини запевняла «ядро ще піднімається», коли sidecar не
// стартував узагалі.
const PATIENCE_MS = 90000;
const GIVEN_UP_MS = 300000;
const t0 = performance.now();

async function pollOnce() {
  try {
    const r = await fetch(READYZ, { cache: 'no-store' });
    if (r.ok) {
      // Було 'online' — єдине англійське слово на найпершому екрані, який
      // бачить людина. Видно його мить, до переходу, але мить теж на склі.
      STATUS_EL.textContent = 'ядро відповіло';
      window.location.replace(TARGET);
      return true;
    }
  } catch {
    /* sidecar still booting; ignore */
  }
  return false;
}

// ЕТАПИ, А НЕ ЖУРНАЛ. 12.09.2026 власник побачив на склі
//
//     ядро: lifespan_warmup: Chroma janitor: SQL deleted=0 kept=0; FS deleted=0
//
// і сказав: «от що то за написи? кому воно треба?». Він має рацію, і це той
// самий урок, що й з лічильником «гріюсь 204s», лише на крок далі: правдивий
// рядок для інженера — для людини той самий нуль. Прилад мусить говорити
// мовою того, хто дивиться.
//
// Тому рядок бекенда більше НЕ показується наскрізь. Він лише ВПІЗНАЄТЬСЯ:
// відомі віхи перекладаються людськими словами, а все інше — шум, якого на
// склі не буде ніколи. Заразом сам собою зникає рядок «зробив нуль роботи»:
// якщо смуга нічого не зробила, вона не подія.
const STAGES = [
  // «запускаюсь», а не «розпаковую пакунок»: розпаковка є лише в onefile, а
  // з 12.09.2026 пакунок збирається onedir і не розпаковує нічого. Текст,
  // правдивий для однієї розкладки, на іншій стає вигадкою — дрібною, але
  // рівно того роду, який ми тут і лікуємо.
  { match: null, text: 'запускаюсь' },
  { match: /PHANTOM OS starting/i, text: 'піднімаю ядро' },
  { match: /Database initialized|alembic\.runtime/i, text: 'готую сховище' },
  { match: /layer registry loaded/i, text: 'вмикаю мапу' },
  { match: /Application startup complete|Uvicorn running/i, text: 'майже готово' },
];

// Найдальший упізнаний етап. Саме найдальший, а не останній: рядки приходять
// уперемішку (смуги йдуть паралельно), і крок, що стрибає назад, читається
// як поломка.
let reached = 0;

function noteBackendLine(line) {
  if (!line) return;
  for (let i = STAGES.length - 1; i > reached; i -= 1) {
    if (STAGES[i].match && STAGES[i].match.test(line)) {
      reached = i;
      return;
    }
  }
}

// Рядок логу бекенда, як він є: «2026-09-12 19:09:11,833 [phantom] [INFO]
// main: …». У причині смерті потрібен зміст, а не мітка часу й рівень.
function tidy(line) {
  return String(line)
    .replace(/^\d{4}-\d\d-\d\d[ T]\d\d:\d\d:\d\d[,.]\d+\s*/, '')
    .replace(/^\[phantom\]\s*/, '')
    .replace(/^\[(DEBUG|INFO|WARNING|ERROR|CRITICAL)\]\s*/, '')
    .replace(/^(INFO|WARNING|ERROR):\s+/, '')
    .trim()
    .slice(0, 120);
}

// Оболонка кладе сюди `{code, signal, last}`, щойно сайдкар помер
// (`tell_the_splash_the_backend_died` у `src-tauri/src/main.rs`). Доти
// змінної немає — і саме тому перевірка робиться щоразу, а не один раз на
// старті: смерть приходить пізніше за перший кадр.
function deathLine(died) {
  const how = died.signal != null ? `сигнал ${died.signal}` : `код ${died.code ?? '?'}`;
  // Зайнятий порт — не поломка, а другий примірник, і сказати це треба
  // словами людини. Виміряно 12.09.2026: власник запустив пакунок кілька
  // разів поспіль, другий уперся в зайнятий 8000 і вийшов кодом 1, а
  // заставка тим часом обіцяла прогрів.
  if (/address already in use|Errno 98/i.test(died.last || '')) {
    return 'PHANTOM уже запущено — закрий той примірник або відкрий його вікно';
  }
  // Тут рядок ядра лишається: це вже не прогрес, а причина смерті, і саме
  // вона потрібна тому, хто питатиме «чому не відкрилось». Але мітка часу й
  // рівень логу не несуть людині нічого — їх знімаємо, зміст лишаємо.
  const tail = died.last ? ` · ${tidy(died.last)}` : '';
  return `ядро зупинилось (${how})${tail}`;
}

// Що показати, поки ядро встає: КРОК, а не рядок логу й не голий лічильник.
// Лічильник сам по собі читається як поломка (заміряно: ядро піднімалось
// 2,5 хв, і весь той час на склі стояло «гріюсь 204s»), а рядок логу нічого
// не каже людині. Разом вони дають те, чого бракувало: що робиться, котрий
// це крок і скільки вже триває.
function waitingLine(waitedMs) {
  noteBackendLine(window.__PHANTOM_BACKEND_LINE__);
  const step = `крок ${reached + 1} з ${STAGES.length}`;
  if (waitedMs < PATIENCE_MS) {
    return `${STAGES[reached].text} · ${step}`;
  }
  const s = Math.floor(waitedMs / 1000);
  if (waitedMs < GIVEN_UP_MS) {
    return `${STAGES[reached].text} · ${step} · ${s}s, довше, ніж звично`;
  }
  return `не піднялося за ${s}s на кроці «${STAGES[reached].text}» — закрий вікно й відкрий ще раз`;
}

async function loop() {
  for (;;) {
    if (await pollOnce()) return;
    // Смерть має пріоритет над таймером: поки її не видно, лічильник
    // «гріюсь» описує очікування, якого вже немає.
    const died = window.__PHANTOM_BACKEND_DIED__;
    STATUS_EL.textContent = died
      ? deathLine(died)
      : waitingLine(performance.now() - t0);
    await new Promise((res) => setTimeout(res, POLL_MS));
  }
}

loop();

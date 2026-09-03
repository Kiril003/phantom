import { useCallback, useEffect, useMemo, useState } from 'react';
import { Battery, Cpu, MapPin, Radio, Send, Smartphone, Wifi } from 'lucide-react';
import { request } from '../../services/api';
import { wsClient, type WSMessage } from '../../services/websocket';

interface Body {
  body_id: string;
  kind: string;
  name: string;
  online: boolean;
  fresh: boolean;
  age_s: number;
  battery_pct: number | null;
  charging: boolean | null;
  network: string;
  foreground: string;
  lat: number | null;
  lon: number | null;
  accuracy_m: number | null;
  motion: string;
  capabilities: string[];
}

interface Verb {
  verb: string;
  body_kind: string;
  requires: string;
  title: string;
}

interface SymbioteState {
  bodies: Body[];
  alive: number;
  total: number;
  position: {
    lat: number;
    lon: number;
    accuracy_m: number | null;
    from_name: string;
    motion: string;
  } | null;
  verbs: Verb[];
}

interface Exchange {
  id: number;
  verb: string;
  ok: boolean;
  detail: string;
  ms: number;
}

const MOTION_UA: Record<string, string> = {
  still: 'нерухомо',
  walking: 'йде',
  running: 'біжить',
  driving: 'їде',
  cycling: 'на велосипеді',
};

const NEEDS_WORDS: Record<string, string> = {
  'phone.notify': 'text',
  'phone.speak': 'text',
  'pc.type': 'text',
  'pc.clipboard': 'text',
  'pc.notify': 'text',
  'pc.open': 'target',
};

export function SymbiotePanel(): JSX.Element {
  const [state, setState] = useState<SymbioteState | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [log, setLog] = useState<Exchange[]>([]);
  const [phoneWords, setPhoneWords] = useState('');
  const [pcWords, setPcWords] = useState('');

  const pull = useCallback(async () => {
    try {
      setState(await request<SymbioteState>('GET', '/symbiote/state'));
    } catch { /* панель не критична */ }
  }, []);

  useEffect(() => {
    void pull();
    const t = window.setInterval(pull, 10_000);
    const off = wsClient.on<WSMessage>('symbiote', () => void pull());
    return () => { window.clearInterval(t); off(); };
  }, [pull]);

  const ask = useCallback(
    async (verb: string, words: string) => {
      const key = NEEDS_WORDS[verb];
      setBusy(verb);
      const started = performance.now();
      try {
        const res = await request<{ result: { ok: boolean; detail: string } | null }>(
          'POST', '/symbiote/command',
          { verb, wait_s: 25, args: key ? { [key]: words } : {} },
        );
        setLog((prev) => [{
          id: started,
          verb,
          ok: res.result?.ok ?? false,
          detail: res.result
            ? res.result.detail || (res.result.ok ? 'зроблено' : 'відмовлено')
            : 'передав — тіло відповість, щойно прокинеться',
          ms: Math.round(performance.now() - started),
        }, ...prev].slice(0, 5));
      } catch (err) {
        setLog((prev) => [{
          id: started,
          verb,
          ok: false,
          detail: err instanceof Error ? err.message : 'не вдалося передати',
          ms: Math.round(performance.now() - started),
        }, ...prev].slice(0, 5));
      } finally {
        setBusy(null);
        void pull();
      }
    },
    [pull],
  );

  const phone = state?.bodies.find((b) => b.kind === 'phone');
  const verbs = useMemo(() => state?.verbs ?? [], [state]);

  if (!state) {
    return (
      <div className="glass" style={{ padding: 12, fontSize: 11, color: 'var(--ink-muted)' }}>
        Збираю стан організму…
      </div>
    );
  }

  const section = (
    kicker: string,
    kind: 'phone' | 'desktop',
    words: string,
    setWords: (v: string) => void,
    granted: (requires: string) => boolean,
    denied: string,
  ): JSX.Element | null => {
    const mine = verbs.filter((v) => v.body_kind === kind);
    if (mine.length === 0) return null;
    return (
      <div style={{ marginTop: 12 }}>
        <div style={S.kicker}>{kicker}</div>
        <input
          value={words}
          onChange={(e) => setWords(e.target.value)}
          placeholder={kind === 'phone' ? 'слова для сповіщення чи голосу' : 'текст, посилання чи шлях'}
          style={S.input}
        />
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 7 }}>
          {mine.map((v) => {
            const needs = NEEDS_WORDS[v.verb];
            const allowed = granted(v.requires);
            const wordless = Boolean(needs) && words.trim() === '';
            const off = !allowed || wordless || busy !== null;
            return (
              <button
                key={v.verb}
                type="button"
                disabled={off}
                onClick={() => void ask(v.verb, words.trim())}
                title={!allowed ? denied.replace('{}', v.requires)
                  : wordless ? 'Спершу напиши, що саме' : v.title}
                style={{
                  ...S.chip,
                  background: off ? 'transparent' : 'rgba(255,255,255,0.5)',
                  color: off ? 'var(--ink-muted)' : 'var(--ink-primary)',
                  cursor: off ? 'not-allowed' : 'pointer',
                  opacity: busy && busy !== v.verb ? 0.5 : 1,
                }}
              >
                <Send size={10} />
                {v.title}
              </button>
            );
          })}
        </div>
      </div>
    );
  };

  return (
    <div className="glass" style={{ padding: 14 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 10 }}>
        <div style={S.kicker}>СИМБІОТ</div>
        <div style={{ fontSize: 11, color: 'var(--ink-secondary)' }}>
          {state.alive} з {state.total} тіл на зв'язку
        </div>
      </div>

      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
        {state.bodies.map((b) => (
          <div
            key={b.body_id}
            style={{
              flex: '1 1 220px',
              minWidth: 200,
              padding: 11,
              borderRadius: 12,
              border: b.online && b.fresh
                ? '1px solid rgba(22,163,74,0.35)'
                : '1px solid var(--glass-border)',
              background: b.online && b.fresh
                ? 'rgba(22,163,74,0.06)'
                : 'rgba(0,0,0,0.02)',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
              {b.kind === 'phone' ? <Smartphone size={13} /> : <Cpu size={13} />}
              <span style={{ fontSize: 12, fontWeight: 600 }}>{b.name || b.kind}</span>
              <span style={{ flex: 1 }} />
              <span
                style={{
                  fontSize: 9,
                  fontWeight: 700,
                  color: b.online && b.fresh ? '#16a34a' : 'var(--ink-muted)',
                }}
              >
                {b.online && b.fresh ? 'живе' : 'мовчить'}
              </span>
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginTop: 8, fontSize: 10, color: 'var(--ink-secondary)' }}>
              {b.battery_pct != null && (
                <span style={S.stat}>
                  <Battery size={11} /> {b.battery_pct}%{b.charging ? ' ⚡' : ''}
                </span>
              )}
              {b.network && (
                <span style={S.stat}><Wifi size={11} /> {b.network}</span>
              )}
              {b.motion && (
                <span style={S.stat}>
                  <Radio size={11} /> {MOTION_UA[b.motion] ?? b.motion}
                </span>
              )}
              {b.lat != null && (
                <span style={S.stat}>
                  <MapPin size={11} /> ±{Math.round(b.accuracy_m ?? 0)} м
                </span>
              )}
            </div>
            {b.foreground && (
              <div style={{ fontSize: 10, color: 'var(--ink-muted)', marginTop: 6 }}>
                зараз на екрані: {b.foreground}
              </div>
            )}
            <div style={{ fontSize: 9.5, color: 'var(--ink-muted)', marginTop: 6 }}>
              {b.capabilities.length ? b.capabilities.join(' · ') : 'без дозволів'}
            </div>
          </div>
        ))}
      </div>

      <div
        style={{
          marginTop: 12,
          padding: '9px 11px',
          borderRadius: 10,
          background: 'rgba(244,175,37,0.08)',
          border: '1px solid rgba(244,175,37,0.25)',
          fontSize: 11,
        }}
      >
        {state.position ? (
          <>
            Організм знає своє місце з точністю{' '}
            <strong>±{Math.round(state.position.accuracy_m ?? 0)} м</strong> —
            очима тіла «{state.position.from_name}»
            {state.position.motion ? `, ${MOTION_UA[state.position.motion] ?? state.position.motion}` : ''}.
          </>
        ) : (
          <>Жодне тіло не віддає місце. Мапа лишається на здогадках.</>
        )}
      </div>

      {phone && section(
        'ПОПРОСИТИ ТЕЛЕФОН',
        'phone',
        phoneWords,
        setPhoneWords,
        (requires) => phone.capabilities.includes(requires),
        'Телефону не надано дозвіл «{}» — увімкни його нижче, у списку пристроїв.',
      )}

      {section(
        'ПОПРОСИТИ ЦЕЙ КОМП’ЮТЕР',
        'desktop',
        pcWords,
        setPcWords,
        () => true,
        '',
      )}

      {log.length > 0 && (
        <div style={{ marginTop: 12 }}>
          <div style={S.kicker}>ОСТАННІ ОБМІНИ</div>
          {log.map((e) => (
            <div key={e.id} style={S.logRow}>
              <span
                style={{
                  width: 5,
                  height: 5,
                  borderRadius: 999,
                  background: e.ok ? '#16a34a' : '#dc2626',
                  flexShrink: 0,
                }}
              />
              <span style={{ color: 'var(--ink-secondary)' }}>{e.verb}</span>
              <span style={{ color: 'var(--ink-muted)', flex: 1 }}>{e.detail}</span>
              <span style={{ color: 'var(--ink-muted)' }}>
                {e.ms < 1000 ? `${e.ms} мс` : `${(e.ms / 1000).toFixed(1)} с`}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

const S: Record<string, React.CSSProperties> = {
  kicker: {
    fontSize: 9,
    fontWeight: 700,
    letterSpacing: '0.1em',
    color: 'var(--ink-muted)',
    marginBottom: 6,
  },
  stat: { display: 'inline-flex', alignItems: 'center', gap: 3 },
  chip: {
    minHeight: 32,
    padding: '6px 11px',
    borderRadius: 999,
    border: '1px solid var(--glass-border)',
    fontSize: 10.5,
    fontWeight: 600,
    display: 'inline-flex',
    alignItems: 'center',
    gap: 5,
  },
  input: {
    width: '100%',
    minHeight: 32,
    padding: '6px 10px',
    borderRadius: 9,
    border: '1px solid var(--glass-border)',
    background: 'rgba(255,255,255,0.35)',
    color: 'var(--ink-primary)',
    fontSize: 11,
  },
  logRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 7,
    fontSize: 10,
    padding: '3px 0',
  },
};

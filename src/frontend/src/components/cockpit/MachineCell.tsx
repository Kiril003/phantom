import React from 'react';
import { AreaChart, Area, ResponsiveContainer, YAxis } from 'recharts';
import { fetchMachine, type MachinePulse } from '../../services/cockpitApi';
import { CockpitCell, CellWord, gib, uptimeWord } from './CockpitCell';

/**
 * «Машина» — живі системні метрики цього вузла.
 *
 * Джерело: GET /api/v1/cockpit/machine (CPU — 1 Гц сампер бекенда;
 * RAM/диск/аптайм — psutil; слухачі — справжній стан TLS-слухача і
 * mDNS, не конфіг-побажання). Полінг кожні 2 с, поки чарунка відкрита.
 *
 * Стрічка історії CPU накопичується ЧЕСНО з моменту відкриття чарунки
 * і так підписана — це не «історія машини», якої бекенд не зберігає.
 * Вимкнене ядро → відмова словом; останні відомі числа не малюються
 * як живі (live-крапка гасне, числа зникають — нуль був би брехнею).
 */

const POLL_MS = 2000;
/** 30 хв історії при кроці 2 с. */
const HISTORY_CAP = 900;

type Load =
  | { s: 'reading' }
  | { s: 'ok'; data: MachinePulse; at: Date }
  | { s: 'unreachable'; lastOkAt: Date | null }
  | { s: 'unauthorized' };

interface HistoryPoint {
  t: number;
  cpu: number;
}

export function MachineCell() {
  const [load, setLoad] = React.useState<Load>({ s: 'reading' });
  const historyRef = React.useRef<HistoryPoint[]>([]);
  const openedAtRef = React.useRef<Date>(new Date());
  const lastOkAtRef = React.useRef<Date | null>(null);

  React.useEffect(() => {
    let alive = true;

    const poll = async () => {
      const pulse = await fetchMachine();
      if (!alive) return;
      if (pulse.ok) {
        const at = new Date();
        lastOkAtRef.current = at;
        if (pulse.data.cpu.pct !== null) {
          historyRef.current.push({ t: at.getTime(), cpu: pulse.data.cpu.pct });
          if (historyRef.current.length > HISTORY_CAP) {
            historyRef.current.splice(0, historyRef.current.length - HISTORY_CAP);
          }
        }
        setLoad({ s: 'ok', data: pulse.data, at });
      } else if (pulse.reason === 'unauthorized') {
        setLoad({ s: 'unauthorized' });
      } else {
        setLoad({ s: 'unreachable', lastOkAt: lastOkAtRef.current });
      }
    };

    void poll();
    const timer = setInterval(() => void poll(), POLL_MS);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, []);

  const live = load.s === 'ok';
  const asOf = load.s === 'ok' ? load.at : null;

  return (
    <CockpitCell title="Машина" source="cockpit/machine · 2 с" asOf={asOf} live={live}>
      {load.s === 'reading' && <CellWord>читаю метрики машини…</CellWord>}
      {load.s === 'unauthorized' && (
        <CellWord>джерело не відповідає цьому користувачу — потрібні operator-права</CellWord>
      )}
      {load.s === 'unreachable' && (
        <CellWord>
          ядро недоступне — числа не малюю, нулі були б брехнею
          {load.lastOkAt !== null && (
            <>
              <br />
              <span style={{ color: 'var(--ink-muted)' }}>
                останній живий зріз був о{' '}
                {load.lastOkAt.toLocaleTimeString('uk-UA', {
                  hour: '2-digit',
                  minute: '2-digit',
                  second: '2-digit',
                })}
              </span>
            </>
          )}
        </CellWord>
      )}
      {load.s === 'ok' && (
        <MachineBody data={load.data} history={historyRef.current} openedAt={openedAtRef.current} />
      )}
    </CockpitCell>
  );
}

function MachineBody({
  data,
  history,
  openedAt,
}: {
  data: MachinePulse;
  history: HistoryPoint[];
  openedAt: Date;
}) {
  const minutesOpen = Math.max(1, Math.round((Date.now() - openedAt.getTime()) / 60000));
  return (
    <div className="p-3 grid grid-cols-2 gap-3">
      {/* CPU + стрічка історії */}
      <div className="col-span-2">
        <div className="flex items-end justify-between mb-1">
          <span className="text-[11px] uppercase" style={{ color: 'var(--ink-muted)', letterSpacing: '0.1em' }}>
            CPU
          </span>
          <span className="font-mono text-lg font-semibold" style={{ color: 'var(--ink-primary)' }}>
            {data.cpu.pct !== null ? `${data.cpu.pct.toFixed(1)}%` : 'сампер ще не запущений'}
          </span>
        </div>
        {history.length >= 2 ? (
          <>
            <div className="h-12 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={history} margin={{ top: 2, right: 0, left: 0, bottom: 0 }}>
                  <YAxis domain={[0, 100]} hide />
                  <Area
                    type="monotone"
                    dataKey="cpu"
                    stroke="var(--accent)"
                    strokeWidth={1.5}
                    fill="var(--accent)"
                    fillOpacity={0.15}
                    isAnimationActive={false}
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
            <div className="text-[10px] mt-0.5" style={{ color: 'var(--ink-muted)' }}>
              історія з відкриття чарунки · ~{minutesOpen} хв · ядро історії не зберігає
            </div>
          </>
        ) : (
          <div className="text-[11px]" style={{ color: 'var(--ink-muted)' }}>
            стрічка з’явиться з другого зрізу — накопичується з відкриття чарунки
          </div>
        )}
      </div>

      <Meter label="RAM" pct={data.ram.pct} caption={`${gib(data.ram.used)} з ${gib(data.ram.total)}`} />
      <Meter label="Диск /" pct={data.disk.pct} caption={`${gib(data.disk.used)} з ${gib(data.disk.total)}`} />

      <KV label="Аптайм хоста" value={uptimeWord(data.uptime.host_s)} />
      <KV label="Аптайм ядра" value={uptimeWord(data.uptime.backend_s)} />

      {/* Слухачі вузла */}
      <div className="col-span-2 rounded-xl border p-2.5" style={{ borderColor: 'var(--glass-border)' }}>
        <div
          className="text-[10px] uppercase mb-1.5"
          style={{ color: 'var(--ink-muted)', letterSpacing: '0.1em' }}
        >
          Слухачі вузла
        </div>
        <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
          <ListenerRow name="HTTP" word={`${data.listeners.http.host}:${data.listeners.http.port}`} />
          <ListenerRow
            name="TLS"
            word={
              data.listeners.tls.state === 'слухає'
                ? `:${data.listeners.tls.port} · ${data.listeners.tls.bound.length > 0 ? data.listeners.tls.bound.join(', ') : 'слухає'}`
                : `не піднявся (порт ${data.listeners.tls.port})`
            }
            dead={data.listeners.tls.state !== 'слухає'}
          />
          <ListenerRow
            name="mDNS"
            word={data.listeners.mdns.state}
            dead={data.listeners.mdns.state !== 'оголошено'}
          />
          <ListenerRow name="WS-клієнтів" word={String(data.listeners.ws_clients)} />
        </div>
      </div>
    </div>
  );
}

function Meter({ label, pct, caption }: { label: string; pct: number; caption: string }) {
  return (
    <div>
      <div className="flex items-baseline justify-between">
        <span className="text-[11px] uppercase" style={{ color: 'var(--ink-muted)', letterSpacing: '0.1em' }}>
          {label}
        </span>
        <span className="font-mono text-sm" style={{ color: 'var(--ink-primary)' }}>
          {pct.toFixed(1)}%
        </span>
      </div>
      <div
        className="h-1.5 rounded-full mt-1 overflow-hidden"
        style={{ background: 'var(--line-subtle)' }}
        role="progressbar"
        aria-valuenow={pct}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        <div
          className="h-full rounded-full"
          style={{ width: `${Math.min(100, Math.max(0, pct))}%`, background: 'var(--accent)' }}
        />
      </div>
      <div className="text-[10px] mt-0.5" style={{ color: 'var(--ink-muted)' }}>
        {caption}
      </div>
    </div>
  );
}

function KV({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[11px] uppercase" style={{ color: 'var(--ink-muted)', letterSpacing: '0.1em' }}>
        {label}
      </div>
      <div className="font-mono text-sm mt-0.5" style={{ color: 'var(--ink-primary)' }}>
        {value}
      </div>
    </div>
  );
}

function ListenerRow({ name, word, dead = false }: { name: string; word: string; dead?: boolean }) {
  return (
    <>
      <span style={{ color: 'var(--ink-muted)' }}>{name}</span>
      <span
        className="font-mono truncate text-right"
        style={{ color: dead ? 'var(--ink-muted)' : 'var(--ink-primary)' }}
        title={word}
      >
        {word}
      </span>
    </>
  );
}

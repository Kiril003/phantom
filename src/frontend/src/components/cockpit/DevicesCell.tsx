import React from 'react';
import { Smartphone } from 'lucide-react';
import { wsClient } from '../../services/websocket';
import { fetchPairedDevices, type PairedDeviceRow } from '../../services/cockpitApi';
import { CockpitCell, CellWord, ageWord } from './CockpitCell';

/**
 * «Пристрої» — парні пристрої цього вузла з реального API.
 *
 * Джерело: GET /api/v1/pair/devices (routes_pair.list_devices,
 * ROOT-only — оператор без root-прав чує чесну відмову словом).
 * Оновлення: полінг раз на 30 с + живий канал `pair` (claimed /
 * revoked / capabilities) — той самий, яким живиться панель
 * «Мобільний компаньйон» у налаштуваннях.
 *
 * «Канал» кожного рядка — чесний: online=true означає «тримає WS
 * просто зараз» (це буквально поле бекенда), інакше — вік останнього
 * зв’язку з last_seen_at.
 */

const POLL_MS = 30_000;

type Load =
  | { s: 'reading' }
  | { s: 'ok'; rows: PairedDeviceRow[]; at: Date }
  | { s: 'unreachable' }
  | { s: 'unauthorized' };

export function DevicesCell() {
  const [load, setLoad] = React.useState<Load>({ s: 'reading' });

  React.useEffect(() => {
    let alive = true;

    const poll = async () => {
      const pulse = await fetchPairedDevices();
      if (!alive) return;
      if (pulse.ok) setLoad({ s: 'ok', rows: pulse.data, at: new Date() });
      else if (pulse.reason === 'unauthorized') setLoad({ s: 'unauthorized' });
      else setLoad({ s: 'unreachable' });
    };

    void poll();
    const timer = setInterval(() => void poll(), POLL_MS);
    // Живі події парування — оновлюємо список одразу, без чекання полінгу.
    const offPair = wsClient.on('pair', () => void poll());
    return () => {
      alive = false;
      clearInterval(timer);
      offPair();
    };
  }, []);

  return (
    <CockpitCell
      title="Пристрої"
      source="pair/devices · 30 с + WS pair"
      asOf={load.s === 'ok' ? load.at : null}
    >
      {load.s === 'reading' && <CellWord>читаю список пристроїв…</CellWord>}
      {load.s === 'unauthorized' && (
        <CellWord>список пристроїв відповідає лише ROOT — цьому користувачу джерело мовчить</CellWord>
      )}
      {load.s === 'unreachable' && (
        <CellWord>ядро недоступне — список пристроїв не прочитати</CellWord>
      )}
      {load.s === 'ok' &&
        (load.rows.length === 0 ? (
          <CellWord>
            жодного спареного пристрою
            <br />
            <span style={{ color: 'var(--ink-muted)' }}>
              спарувати: Налаштування → Мобільний компаньйон — QR-код або mDNS-пошук з телефона
            </span>
          </CellWord>
        ) : (
          <ul className="px-3 py-2 space-y-1.5">
            {load.rows.map((d) => (
              <li
                key={d.id}
                className="flex items-center gap-2.5 rounded-xl border px-2.5 py-2"
                style={{ borderColor: 'var(--glass-border)', background: 'var(--line-subtle)' }}
              >
                <Smartphone size={16} style={{ color: 'var(--ink-muted)' }} className="shrink-0" />
                <div className="min-w-0 flex-1">
                  <div className="text-sm truncate" style={{ color: 'var(--ink-primary)' }}>
                    {d.device_name}
                  </div>
                  <div className="text-[11px] truncate" style={{ color: 'var(--ink-muted)' }}>
                    {d.platform}
                    {d.platform_version ? ` ${d.platform_version}` : ''} · {d.device_model}
                  </div>
                </div>
                <div className="text-right shrink-0">
                  {d.online ? (
                    <span className="inline-flex items-center gap-1.5 text-[11px] text-emerald-400">
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                      тримає WS зараз
                    </span>
                  ) : (
                    <span className="text-[11px]" style={{ color: 'var(--ink-muted)' }}>
                      останній зв’язок: {ageWord(d.last_seen_at)}
                    </span>
                  )}
                </div>
              </li>
            ))}
          </ul>
        ))}
    </CockpitCell>
  );
}

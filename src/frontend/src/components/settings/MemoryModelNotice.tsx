import { useEffect, useState } from 'react';
import { Brain } from 'lucide-react';
import { fetchHealth } from '../../services/organismApi';

/**
 * «Памʼять нічого не запамʼятає» — сказане там, де людина її шукає.
 *
 * Довготривала памʼять вузла тримається на моделі вкладень. Коли її на
 * машині немає, підсистема не падає й не скаржиться: вона просто нічого
 * не запамʼятовує. Тобто людина відкриває «ШІ та памʼять», бачить
 * налаштування памʼяті — і вважає, що памʼять є.
 *
 * Текст НЕ складаємо тут: `GET /health` віддає `memory_model.reason` —
 * готове речення від ядра (Сесія 5, 604bef9). Ядро знає, яку модель
 * шукали, де і чи дозволено її тягнути; фронт цього не знає, і будь-яке
 * власне формулювання тут було б здогадом. Коли `present` істинний —
 * не показуємо нічого: справний стан не потребує напису.
 *
 * Це НЕ «помилка»: жовтим кажемо про стан, а не про поломку (словник
 * ATLAS — амбер сигналить стан, теракота лишається лінійкою дії).
 */
export function MemoryModelNotice(): JSX.Element | null {
  const [state, setState] = useState<{
    reason: string;
    model: string;
    path: string | null;
  } | null>(null);

  useEffect(() => {
    let alive = true;
    void (async () => {
      const pulse = await fetchHealth();
      if (!alive || !pulse.ok) return;
      const mm = pulse.data.memory_model;
      // Немає поля — старе ядро: мовчимо, бо не знаємо стану.
      if (!mm || mm.present || !mm.reason) return;
      setState({ reason: mm.reason, model: mm.model, path: mm.path });
    })();
    return () => {
      alive = false;
    };
  }, []);

  if (!state) return null;

  return (
    <div
      data-testid="memory-model-notice"
      style={{
        display: 'flex',
        gap: 10,
        alignItems: 'flex-start',
        padding: '10px 12px',
        marginBottom: 12,
        borderRadius: 12,
        border: '1px solid rgba(244,175,37,0.30)',
        background: 'rgba(244,175,37,0.08)',
      }}
    >
      <Brain
        size={14}
        strokeWidth={1.75}
        style={{ color: '#b07a10', flexShrink: 0, marginTop: 1 }}
        aria-hidden
      />
      <div style={{ minWidth: 0 }}>
        <div
          className="micro-label"
          style={{ fontSize: 9, color: '#b07a10', marginBottom: 3 }}
        >
          ПАМʼЯТЬ
        </div>
        <div
          style={{
            fontSize: 11,
            lineHeight: 1.45,
            color: 'var(--ink-primary)',
          }}
        >
          {state.reason}
        </div>
        <div
          className="tabular"
          style={{
            fontSize: 9.5,
            marginTop: 4,
            color: 'var(--ink-muted)',
            wordBreak: 'break-all',
          }}
        >
          {state.model}
          {state.path ? ` · шукали в ${state.path}` : ''}
        </div>
      </div>
    </div>
  );
}

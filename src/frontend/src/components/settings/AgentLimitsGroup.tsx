import { Infinity as InfinityIcon } from 'lucide-react';

const UNBOUND_KEYS = [
  'agent_max_actions_per_task',
  'agent_max_llm_calls_per_task',
  'agent_max_llm_calls_per_background_task',
] as const;

interface Props {
  values: Record<string, unknown>;
  onChange: (key: string, value: unknown) => void;
}

interface CapField {
  key: string;
  label: string;
  min: number;
  unboundable: boolean;
}

const FIELDS: CapField[] = [
  { key: 'agent_max_actions_per_task',            label: 'Макс. дій на задачу',      min: 0, unboundable: true },
  { key: 'agent_max_elapsed_s_per_task',          label: 'Бюджет часу на задачу (с)', min: 0, unboundable: false },
  { key: 'agent_max_llm_calls_per_task',          label: 'LLM-виклики / задача',      min: 0, unboundable: true },
  { key: 'agent_max_llm_calls_per_background_task', label: 'LLM-виклики / фон',       min: 0, unboundable: true },
  { key: 'agent_bash_timeout_s',                  label: 'Bash timeout (с)',           min: 1, unboundable: false },
  { key: 'agent_bash_output_cap_bytes',           label: 'Bash output cap (байт)',     min: 0, unboundable: false },
];

export function AgentLimitsGroup({ values, onChange }: Props) {
  const unbound = !!values['agent_unbound_default'];

  function handleUnboundToggle() {
    const next = !unbound;
    if (next) {
      for (const key of UNBOUND_KEYS) onChange(key, 0);
    }
    onChange('agent_unbound_default', next);
  }

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
        padding: '10px 12px',
        borderRadius: 12,
        background: 'rgba(255,255,255,0.45)',
        border: '1px solid rgba(255,255,255,0.55)',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          marginBottom: 4,
        }}
      >
        <InfinityIcon size={14} strokeWidth={1.75} style={{ color: '#b07a10' }} />
        <span
          style={{
            fontSize: 12,
            fontWeight: 700,
            letterSpacing: '0.06em',
            textTransform: 'uppercase',
            color: 'var(--ink-primary)',
          }}
        >
          Агент / Межі
        </span>
        <span style={{ flex: 1 }} />
        <label
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
            cursor: 'pointer',
          }}
        >
          <span
            style={{
              fontSize: 11,
              fontWeight: 600,
              color: unbound ? '#8a5e0a' : 'var(--ink-secondary)',
            }}
          >
            Безмежний режим
          </span>
          <button
            type="button"
            aria-label="Безмежний режим"
            aria-pressed={unbound}
            onClick={handleUnboundToggle}
            style={{
              minHeight: 44,
              minWidth: 44,
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              background: 'transparent',
              border: 'none',
              cursor: 'pointer',
              padding: 0,
            }}
          >
            <span
              aria-hidden
              style={{
                position: 'relative',
                display: 'inline-block',
                width: 40,
                height: 22,
                borderRadius: 999,
                background: unbound
                  ? 'linear-gradient(135deg,#f4af25,#fb923c)'
                  : 'rgba(0,0,0,0.12)',
                transition: 'background 200ms ease',
              }}
            >
              <span
                style={{
                  position: 'absolute',
                  top: 3,
                  left: unbound ? 21 : 3,
                  width: 16,
                  height: 16,
                  borderRadius: 999,
                  background: 'white',
                  boxShadow: '0 1px 4px rgba(0,0,0,0.20)',
                  transition: 'left 200ms ease',
                }}
              />
            </span>
          </button>
        </label>
      </div>

      {unbound && (
        <div
          style={{
            fontSize: 11,
            color: '#8a5e0a',
            background: 'rgba(244,175,37,0.10)',
            border: '1px dashed rgba(244,175,37,0.35)',
            borderRadius: 8,
            padding: '5px 10px',
          }}
        >
          Ліміти дій та LLM-викликів вимкнено (≤0 = необмежено)
        </div>
      )}

      {FIELDS.map((f) => {
        const disabled = unbound && f.unboundable;
        const raw = values[f.key];
        const num = Number.isFinite(raw as number) ? (raw as number) : 0;
        return (
          <div
            key={f.key}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              minHeight: 36,
              padding: '3px 0',
              opacity: disabled ? 0.45 : 1,
              transition: 'opacity 200ms ease',
            }}
          >
            <label
              htmlFor={`agent-limit-${f.key}`}
              style={{
                flex: 1,
                fontSize: 12,
                fontWeight: 500,
                color: 'var(--ink-primary)',
                cursor: disabled ? 'default' : 'pointer',
              }}
            >
              {f.label}
            </label>
            <input
              id={`agent-limit-${f.key}`}
              aria-label={f.label}
              type="number"
              min={f.min}
              disabled={disabled}
              value={num}
              onChange={(e) => {
                const n = e.target.value === '' ? 0 : Number(e.target.value);
                onChange(f.key, Number.isFinite(n) ? n : 0);
              }}
              className="tabular"
              style={{
                minHeight: 36,
                width: 110,
                padding: '0 10px',
                borderRadius: 8,
                color: 'var(--ink-primary)',
                background: disabled ? 'rgba(0,0,0,0.04)' : 'rgba(255,255,255,0.70)',
                border: '1px solid rgba(0,0,0,0.08)',
                fontFamily: 'var(--font-mono)',
                fontSize: 12,
                outline: 'none',
              }}
            />
          </div>
        );
      })}
    </div>
  );
}

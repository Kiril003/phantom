import { LayoutPanelTop } from 'lucide-react';

interface Props {
  values: Record<string, unknown>;
  onChange: (key: string, value: unknown) => void;
}

type LayoutMode = 'conversation' | 'telemetry';

export function AgentLayoutGroup({ values, onChange }: Props) {
  const current = (values['ui_agent_layout'] as LayoutMode | undefined) ?? 'conversation';

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
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
        <LayoutPanelTop size={14} strokeWidth={1.75} style={{ color: '#b07a10' }} />
        <span
          style={{
            fontSize: 12,
            fontWeight: 700,
            letterSpacing: '0.06em',
            textTransform: 'uppercase',
            color: 'var(--ink-primary)',
          }}
        >
          Агент / Екран оператора
        </span>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        {(['conversation', 'telemetry'] as LayoutMode[]).map((mode) => {
          const active = current === mode;
          const label = mode === 'conversation' ? 'Розмовний (чат — головне)' : 'Телеметрія (щільне розташування)';
          return (
            <button
              key={mode}
              type="button"
              aria-pressed={active}
              data-testid={`agent-layout-${mode}`}
              onClick={() => onChange('ui_agent_layout', mode)}
              style={{
                minHeight: 44,
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                padding: '6px 12px',
                borderRadius: 10,
                background: active ? 'rgba(244,175,37,0.18)' : 'rgba(255,255,255,0.55)',
                border: active ? '1px solid rgba(244,175,37,0.45)' : '1px solid rgba(0,0,0,0.07)',
                color: active ? '#8a5e0a' : 'var(--ink-primary)',
                cursor: 'pointer',
                fontSize: 12,
                fontWeight: active ? 700 : 500,
                textAlign: 'left',
                transition: 'all 150ms ease',
              }}
            >
              <span
                style={{
                  width: 10,
                  height: 10,
                  borderRadius: 999,
                  background: active ? '#f4af25' : 'rgba(0,0,0,0.15)',
                  flexShrink: 0,
                  transition: 'background 150ms ease',
                }}
              />
              {label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

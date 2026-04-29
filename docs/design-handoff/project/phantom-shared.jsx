// PHANTOM OS — shared components

const Icon = ({ name, size = 18, fill = 0, weight = 400, style = {}, className = '' }) => (
  <span
    className={`msym ${className}`}
    style={{
      fontSize: size,
      fontVariationSettings: `'FILL' ${fill}, 'wght' ${weight}, 'GRAD' 0, 'opsz' 24`,
      ...style,
    }}
  >
    {name}
  </span>
);

const StatusPill = ({ children, tone = 'amber', dot = true }) => (
  <span className={`status-pill ${tone === 'coral' ? 'coral' : tone === 'green' ? 'green' : ''}`}>
    {dot && <span className="dot" />}
    {children}
  </span>
);

const SensorChip = ({ icon, value, unit, tone }) => (
  <span style={{
    display: 'inline-flex', alignItems: 'center', gap: 6,
    padding: '0 8px', height: 28,
    borderRadius: 8,
    background: 'rgba(255,255,255,0.45)',
    border: '1px solid rgba(255,255,255,0.5)',
    fontSize: 12, color: 'var(--ink-secondary)'
  }}>
    <Icon name={icon} size={14} style={{ color: tone || '#b07a10' }} />
    <span className="tabular" style={{ fontWeight: 600, color: 'var(--ink)' }}>{value}</span>
    {unit && <span style={{ color: 'var(--ink-muted)', fontSize: 10 }}>{unit}</span>}
  </span>
);

const Divider = () => (
  <span style={{ width: 1, height: 16, background: 'rgba(0,0,0,0.08)', margin: '0 4px' }} />
);

const StatusBar = ({ state = 'SHADOW', stateTone = 'amber', operator = 'phantom · ROOT', clock = '07:14:22', sensors = true, provider = true }) => (
  <div className="glass" style={{
    position: 'absolute', top: 12, left: 12, right: 12,
    height: 44, padding: '0 14px',
    display: 'flex', alignItems: 'center', gap: 10,
    borderRadius: 14, zIndex: 5
  }}>
    <StatusPill tone={stateTone}>{state}</StatusPill>
    <Divider />
    <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <span style={{
        width: 22, height: 22, borderRadius: 999,
        background: 'linear-gradient(135deg,#f4af25,#fb923c)',
        boxShadow: 'inset 0 0 0 1px rgba(255,255,255,0.5)'
      }} />
      <span style={{ fontSize: 12, fontWeight: 600 }}>{operator}</span>
    </span>
    {sensors && (<>
      <Divider />
      <SensorChip icon="favorite" value="64" unit="bpm" />
      <SensorChip icon="device_thermostat" value="22.4" unit="°C" />
      <SensorChip icon="memory" value="33" unit="%" />
      <SensorChip icon="developer_board" value="58" unit="%" />
      <SensorChip icon="storage" value="37" unit="%" />
    </>)}
    {provider && (<>
      <Divider />
      <span style={{
        display: 'inline-flex', alignItems: 'center', gap: 6,
        fontSize: 12, color: 'var(--ink-secondary)'
      }}>
        <span style={{ width: 6, height: 6, borderRadius: 999, background: '#22c55e' }} />
        Gemini · ready
      </span>
    </>)}
    <span style={{ flex: 1 }} />
    <span className="tabular" style={{ fontSize: 18, fontWeight: 600, letterSpacing: '0.02em' }}>{clock}</span>
  </div>
);

const FloatingToolbar = ({ active = 'home' }) => {
  const items = [
    { id: 'home', icon: 'wb_sunny' },
    { id: 'chat', icon: 'forum' },
    { id: 'apps', icon: 'apps' },
    { id: 'terminal', icon: 'terminal' },
    { id: 'map', icon: 'map' },
    { id: 'settings', icon: 'tune' },
    { id: 'more', icon: 'more_horiz' },
  ];
  return (
    <div className="glass-strong toolbar-pill" style={{
      position: 'absolute', bottom: 16, left: '50%', transform: 'translateX(-50%)',
      zIndex: 6
    }}>
      {items.map(it => (
        <button key={it.id} className={`toolbar-btn ${active === it.id ? 'active' : ''}`}>
          <Icon name={it.icon} size={20} fill={active === it.id ? 1 : 0} weight={active === it.id ? 500 : 400} />
        </button>
      ))}
    </div>
  );
};

const MicroLabel = ({ children, style = {} }) => (
  <div className="micro-label" style={style}>{children}</div>
);

// expose
Object.assign(window, { Icon, StatusPill, SensorChip, Divider, StatusBar, FloatingToolbar, MicroLabel });

// Screen 4 — Settings — distinctive
// Unique: progress indicator showing how many groups configured, key-value preview canvas,
// a "diff" panel showing pending changes, and visualised toggles.

const settingsGroups = [
  { id: 'general', icon: 'tune', label: 'Загальні', count: 12, done: 12 },
  { id: 'theme', icon: 'palette', label: 'Тема', count: 6, done: 6 },
  { id: 'auth', icon: 'lock', label: 'Автентифікація', count: 8, done: 5, active: true },
  { id: 'chat', icon: 'forum', label: 'Чат', count: 9, done: 9 },
  { id: 'sensors', icon: 'sensors', label: 'Сенсори', count: 14, done: 11 },
  { id: 'ai', icon: 'auto_awesome', label: 'AI', count: 11, done: 8 },
  { id: 'voice', icon: 'mic', label: 'Голос', count: 7, done: 7 },
  { id: 'vision', icon: 'face_retouching_natural', label: 'Зір · Обличчя', count: 6, done: 4 },
  { id: 'agent', icon: 'smart_toy', label: 'Агент', count: 10, done: 6 },
  { id: 'map', icon: 'map', label: 'Карта', count: 5, done: 5 },
];

const Toggle = ({ on, label }) => (
  <span style={{
    width: 38, height: 22, borderRadius: 999,
    background: on ? 'linear-gradient(135deg,#f4af25,#fb923c)' : 'rgba(0,0,0,0.12)',
    position: 'relative', display: 'inline-block',
    boxShadow: on ? '0 0 0 1px rgba(244,175,37,0.5), inset 0 0 8px rgba(255,255,255,0.3)' : 'inset 0 0 0 1px rgba(0,0,0,0.06)',
    flexShrink: 0
  }}>
    <span style={{
      position: 'absolute', top: 2, left: on ? 18 : 2,
      width: 18, height: 18, borderRadius: 999,
      background: 'white', boxShadow: '0 1px 4px rgba(0,0,0,0.2)'
    }} />
  </span>
);

const ScreenSettings = () => (
  <div className="phantom-frame">
    <StatusBar state="FOCUS · SETTINGS" stateTone="amber" clock="07:21:48" sensors={false} />

    {/* === SIDEBAR === */}
    <div className="glass" style={{
      position: 'absolute', left: 12, top: 68, bottom: 76, width: 260,
      padding: 14, zIndex: 3,
      display: 'flex', flexDirection: 'column'
    }}>
      <div className="eyebrow">НАЛАШТУВАННЯ</div>
      <div className="playfair" style={{ fontSize: 17, color: 'var(--ink-secondary)', lineHeight: 1.15, marginTop: 2, marginBottom: 8 }}>
        Usage shaped<br/>to taste.
      </div>

      {/* progress overall */}
      <div style={{ marginBottom: 10, padding: '8px 10px', borderRadius: 10, background: 'rgba(244,175,37,0.10)', border: '1px solid rgba(244,175,37,0.20)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span className="micro-label" style={{ color: '#b07a10' }}>CONFIGURED</span>
          <span className="tabular" style={{ fontSize: 11, fontWeight: 700, color: '#b07a10' }}>83 / 88</span>
        </div>
        <div style={{ marginTop: 5, height: 3, background: 'rgba(244,175,37,0.18)', borderRadius: 2, overflow: 'hidden' }}>
          <div style={{ width: '94%', height: '100%', background: 'linear-gradient(90deg,#f4af25,#fb923c)' }} />
        </div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 2, flex: 1, overflow: 'hidden' }}>
        {settingsGroups.map(g => (
          <div key={g.id} style={{
            display: 'flex', alignItems: 'center', gap: 10,
            padding: '8px 10px',
            borderRadius: 10,
            background: g.active ? 'rgba(244,175,37,0.18)' : 'transparent',
            borderLeft: g.active ? '3px solid #f4af25' : '3px solid transparent',
            color: g.active ? '#8a5e0a' : 'var(--ink-secondary)',
            cursor: 'pointer',
            fontSize: 12, fontWeight: g.active ? 600 : 500
          }}>
            <Icon name={g.icon} size={14} fill={g.active ? 1 : 0} />
            <span style={{ flex: 1 }}>{g.label}</span>
            <span style={{
              fontSize: 9, fontWeight: 700,
              padding: '1px 6px', borderRadius: 999,
              background: g.done < g.count ? 'rgba(244,175,37,0.2)' : 'rgba(34,197,94,0.18)',
              color: g.done < g.count ? '#b07a10' : '#16a34a'
            }}>{g.done}/{g.count}</span>
          </div>
        ))}
      </div>

      <button style={{
        marginTop: 8, padding: '8px 12px', borderRadius: 999,
        background: 'rgba(255,255,255,0.6)',
        border: '1px solid rgba(255,255,255,0.6)',
        cursor: 'pointer', fontSize: 11, fontWeight: 600,
        display: 'inline-flex', alignItems: 'center', gap: 6, justifyContent: 'center',
        color: 'var(--ink-secondary)'
      }}>
        <Icon name="arrow_back" size={12} />
        Назад до Shadow
      </button>
    </div>

    {/* === MAIN PANE === */}
    <div style={{
      position: 'absolute', left: 284, right: 12, top: 68, bottom: 76,
      display: 'flex', flexDirection: 'column', zIndex: 2, gap: 10
    }}>
      {/* breadcrumb header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '4px 4px 0' }}>
        <span style={{ fontSize: 10, color: 'var(--ink-muted)' }}>Налаштування</span>
        <Icon name="chevron_right" size={12} style={{ color: 'var(--ink-muted)' }} />
        <span style={{ fontSize: 10, color: '#b07a10', fontWeight: 600 }}>Автентифікація</span>
        <Icon name="chevron_right" size={12} style={{ color: 'var(--ink-muted)' }} />
        <span style={{ fontSize: 10, color: 'var(--ink-muted)' }}>Sign-in</span>
        <span style={{ flex: 1 }} />
        <button style={{
          padding: '6px 12px', borderRadius: 999,
          background: 'transparent',
          border: '1.5px solid rgba(0,0,0,0.12)',
          fontSize: 11, fontWeight: 600, cursor: 'pointer',
          color: 'var(--ink-secondary)',
          display: 'inline-flex', alignItems: 'center', gap: 6
        }}>
          <Icon name="restart_alt" size={12} />
          Reset
        </button>
        <button style={{
          padding: '6px 14px', borderRadius: 999,
          background: 'linear-gradient(135deg,#f4af25,#fb923c)',
          border: 'none', cursor: 'pointer',
          color: 'white', fontSize: 11, fontWeight: 700,
          display: 'inline-flex', alignItems: 'center', gap: 6,
          boxShadow: '0 4px 14px rgba(244,175,37,0.4)'
        }}>
          SAVE
          <span style={{ background: 'rgba(255,255,255,0.3)', padding: '1px 6px', borderRadius: 999, fontSize: 9 }}>3</span>
        </button>
      </div>

      {/* hero header */}
      <div className="glass" style={{ padding: '14px 16px', display: 'flex', alignItems: 'center', gap: 14 }}>
        <div style={{
          width: 44, height: 44, borderRadius: 12,
          background: 'linear-gradient(135deg,#f4af25,#fb923c)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          color: 'white',
          boxShadow: '0 4px 14px rgba(244,175,37,0.35)'
        }}>
          <Icon name="lock" size={22} fill={1} />
        </div>
        <div style={{ flex: 1 }}>
          <div className="micro-label">СЕКЦІЯ · 03/10</div>
          <div style={{ fontSize: 22, fontWeight: 600, letterSpacing: '-0.01em' }}>Автентифікація</div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{ textAlign: 'right' }}>
            <div className="micro-label">SECURITY SCORE</div>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
              <span className="tabular" style={{ fontSize: 24, fontWeight: 700, color: '#16a34a' }}>A+</span>
              <span style={{ fontSize: 11, color: 'var(--ink-muted)' }}>strong</span>
            </div>
          </div>
          <div style={{ position: 'relative', width: 44, height: 44 }}>
            <svg viewBox="0 0 44 44" style={{ position: 'absolute', inset: 0 }}>
              <circle cx="22" cy="22" r="18" fill="none" stroke="rgba(0,0,0,0.06)" strokeWidth="3" />
              <circle cx="22" cy="22" r="18" fill="none"
                stroke="#16a34a" strokeWidth="3" strokeLinecap="round"
                strokeDasharray={`${2 * Math.PI * 18 * 0.92} ${2 * Math.PI * 18}`}
                transform="rotate(-90 22 22)" />
            </svg>
            <div style={{
              position: 'absolute', inset: 0,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 10, fontWeight: 700, color: '#16a34a'
            }}>92</div>
          </div>
        </div>
      </div>

      {/* settings grid - sign-in methods */}
      <div className="glass" style={{ padding: 14, flex: 1, display: 'flex', flexDirection: 'column', gap: 8, overflow: 'hidden' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Icon name="vpn_key" size={14} style={{ color: '#b07a10' }} fill={1} />
          <span className="eyebrow-amber">SIGN-IN METHODS</span>
          <span style={{ fontSize: 9, padding: '1px 7px', borderRadius: 999, background: 'rgba(244,175,37,0.18)', color: '#8a5e0a', fontWeight: 700 }}>2 active</span>
        </div>

        {[
          { i: 'mic', label: 'Voice biometric', key: 'auth.voice.enabled', desc: '"Phantom, this is Alex" — wake-phrase + voiceprint match', on: true, edited: true },
          { i: 'face_retouching_natural', label: 'Face recognition', key: 'auth.face.enabled', desc: 'Front camera · IR depth · 1.2s avg', on: true, edited: false },
          { i: 'fingerprint', label: 'Fingerprint', key: 'auth.fp.enabled', desc: 'No reader detected on this device', on: false, edited: false, disabled: true },
          { i: 'pin', label: 'Passcode fallback', key: 'auth.passcode', desc: '4-digit · used after 3 voice failures', on: true, edited: true, control: 'value' },
        ].map((s, i) => (
          <div key={i} style={{
            padding: '10px 12px', borderRadius: 10,
            background: s.disabled ? 'rgba(0,0,0,0.03)' : 'rgba(255,255,255,0.5)',
            border: s.edited ? '1px solid rgba(244,175,37,0.4)' : '1px solid rgba(255,255,255,0.5)',
            display: 'flex', alignItems: 'center', gap: 12,
            opacity: s.disabled ? 0.55 : 1,
            position: 'relative'
          }}>
            {s.edited && <span style={{ position: 'absolute', left: -3, top: '50%', transform: 'translateY(-50%)', width: 6, height: 6, borderRadius: 999, background: '#f4af25', boxShadow: '0 0 6px rgba(244,175,37,0.6)' }} />}
            <Icon name={s.i} size={16} style={{ color: '#b07a10' }} />
            <div style={{ flex: 1 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontSize: 13, fontWeight: 600 }}>{s.label}</span>
                {s.edited && <span style={{ fontSize: 8, padding: '1px 5px', borderRadius: 4, background: 'rgba(244,175,37,0.22)', color: '#8a5e0a', fontWeight: 700, letterSpacing: '0.1em' }}>EDITED</span>}
              </div>
              <div className="mono" style={{ fontSize: 9, color: 'var(--ink-muted)', marginTop: 1 }}>{s.key}</div>
              <div style={{ fontSize: 11, color: 'var(--ink-muted)', marginTop: 2 }}>{s.desc}</div>
            </div>
            {s.control === 'value' ? (
              <span className="mono" style={{
                padding: '4px 10px', borderRadius: 8,
                background: 'rgba(255,255,255,0.6)',
                border: '1px solid rgba(0,0,0,0.06)',
                fontSize: 11
              }}>•••• 4d</span>
            ) : (
              <Toggle on={s.on} />
            )}
          </div>
        ))}

        {/* changes preview row */}
        <div style={{ marginTop: 'auto', display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px', borderRadius: 10, background: 'rgba(244,175,37,0.08)', border: '1px dashed rgba(244,175,37,0.32)' }}>
          <Icon name="diff" size={14} style={{ color: '#b07a10' }} />
          <span className="micro-label" style={{ color: '#b07a10' }}>3 PENDING CHANGES</span>
          <span style={{ flex: 1 }} />
          <span className="mono" style={{ fontSize: 10, color: 'var(--ink-secondary)' }}>auth.voice.threshold · 0.7→0.85 · +2 more</span>
        </div>
      </div>
    </div>

    <FloatingToolbar active="settings" />
  </div>
);

window.ScreenSettings = ScreenSettings;

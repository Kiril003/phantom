// Screen 6 — Sentinel — distinctive
// Unique: animated radar with dual sweeps, threat trajectory trail, action panel,
// real-time biometric coral spike, decibel/motion graphs

const ScreenSentinel = () => (
  <div className="phantom-frame coral-tint">
    {/* coral flash overlay */}
    <div style={{
      position: 'absolute', inset: 0, zIndex: 1,
      background: 'rgba(239,68,68,0.5)', pointerEvents: 'none',
      animation: 'flash-coral 1.2s ease-in-out infinite'
    }} />

    <StatusBar state="● SENTINEL" stateTone="coral" clock="03:42:17" sensors={false} />

    {/* === LEFT — RADAR === */}
    <div style={{
      position: 'absolute', left: 0, top: 68, bottom: 76, width: 640,
      display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 3
    }}>
      <div style={{ position: 'relative', width: 480, height: 480 }}>
        <svg viewBox="0 0 480 480" style={{ position: 'absolute', inset: 0 }}>
          <defs>
            <radialGradient id="radarBg" cx="50%" cy="50%">
              <stop offset="0%" stopColor="rgba(239,68,68,0.06)" />
              <stop offset="100%" stopColor="rgba(239,68,68,0)" />
            </radialGradient>
            <linearGradient id="sweepGrad" x1="0" y1="0" x2="1" y2="0">
              <stop offset="0%" stopColor="rgba(239,68,68,0.7)" />
              <stop offset="100%" stopColor="rgba(239,68,68,0)" />
            </linearGradient>
          </defs>

          <circle cx="240" cy="240" r="220" fill="url(#radarBg)" />

          {/* concentric rings + distance labels */}
          {[60, 120, 180, 220].map((r, i) => (
            <g key={i}>
              <circle cx="240" cy="240" r={r}
                fill="none" stroke="rgba(239,68,68,0.32)" strokeWidth="1"
                strokeDasharray={i === 1 ? '4 6' : ''} />
              <text x="240" y={240 - r - 4} fontSize="9" fill="rgba(185,32,31,0.7)"
                textAnchor="middle" fontWeight="600" letterSpacing="1">{(i+1)*50}m</text>
            </g>
          ))}

          {/* crosshair + degree marks */}
          <line x1="20" y1="240" x2="460" y2="240" stroke="rgba(239,68,68,0.18)" strokeWidth="0.6" />
          <line x1="240" y1="20" x2="240" y2="460" stroke="rgba(239,68,68,0.18)" strokeWidth="0.6" />
          <line x1="69" y1="69" x2="411" y2="411" stroke="rgba(239,68,68,0.10)" strokeWidth="0.5" />
          <line x1="411" y1="69" x2="69" y2="411" stroke="rgba(239,68,68,0.10)" strokeWidth="0.5" />

          {/* angle labels */}
          {['0°','45°','90°','135°','180°','225°','270°','315°'].map((a, i) => {
            const rad = (i * 45 - 90) * Math.PI / 180;
            const x = 240 + Math.cos(rad) * 232;
            const y = 240 + Math.sin(rad) * 232;
            return <text key={i} x={x} y={y+3} fontSize="8" fill="rgba(185,32,31,0.5)" textAnchor="middle" fontWeight="600">{a}</text>;
          })}

          {/* sweeping radar beam */}
          <g style={{ transformOrigin: '240px 240px', animation: 'radar-sweep 4s linear infinite' }}>
            <path d="M 240 240 L 240 20 A 220 220 0 0 1 380 80 Z" fill="rgba(239,68,68,0.16)" />
            <line x1="240" y1="240" x2="240" y2="20" stroke="rgba(239,68,68,0.7)" strokeWidth="2" />
          </g>

          {/* second slower sweep */}
          <g style={{ transformOrigin: '240px 240px', animation: 'radar-sweep 9s linear infinite reverse', opacity: 0.5 }}>
            <line x1="240" y1="240" x2="240" y2="20" stroke="rgba(239,68,68,0.4)" strokeWidth="1" />
          </g>

          {/* trajectory trail of intruder approaching */}
          <path d="M 380 100 L 360 130 L 345 160 L 335 185 L 332 200"
            fill="none" stroke="rgba(239,68,68,0.55)" strokeWidth="1.5" strokeDasharray="3 4" />
          {[100,130,160,185].map((y, i) => (
            <circle key={i} cx={380 - i*16} cy={y + (i*8)} r="2.5" fill="#ef4444" opacity={0.3 + i*0.15} />
          ))}

          {/* trace history dots */}
          {Array.from({length: 8}).map((_, i) => (
            <circle key={i}
              cx={240 + Math.cos((30+i*15)*Math.PI/180) * (60 + i*10)}
              cy={240 + Math.sin((30+i*15)*Math.PI/180) * (60 + i*10)}
              r="1.5" fill="rgba(239,68,68,0.4)" />
          ))}

          {/* center red orb */}
          <circle cx="240" cy="240" r="22" fill="url(#centerOrb)" />
          <defs>
            <radialGradient id="centerOrb" cx="35%" cy="30%">
              <stop offset="0%" stopColor="#fda4af" />
              <stop offset="60%" stopColor="#ef4444" />
              <stop offset="100%" stopColor="#7f1d1d" />
            </radialGradient>
          </defs>
          <circle cx="240" cy="240" r="22" fill="none" stroke="rgba(255,255,255,0.4)" strokeWidth="1" />
          <text x="240" y="244" fontSize="9" fontWeight="700" fill="white" textAnchor="middle" letterSpacing="1">YOU</text>

          {/* detected presence at 45deg, 170cm = ~75% */}
          <g style={{ transformOrigin: '332px 200px', animation: 'phantom-pulse 0.9s ease-in-out infinite' }}>
            <circle cx="332" cy="200" r="22" fill="rgba(239,68,68,0.2)" />
            <circle cx="332" cy="200" r="14" fill="rgba(239,68,68,0.4)" />
            <circle cx="332" cy="200" r="8" fill="#ef4444" stroke="white" strokeWidth="2" />
          </g>
        </svg>

        {/* annotation label */}
        <div style={{
          position: 'absolute', top: 178, left: 354,
          padding: '6px 10px', borderRadius: 8,
          background: 'rgba(239,68,68,0.92)', color: 'white',
          fontSize: 10, fontWeight: 700, letterSpacing: '0.1em',
          boxShadow: '0 4px 14px rgba(239,68,68,0.4)'
        }}>
          UNKNOWN · 170 cm · 45°
          <div style={{ position: 'absolute', left: -5, top: 12, width: 0, height: 0, borderTop: '4px solid transparent', borderBottom: '4px solid transparent', borderRight: '5px solid rgba(239,68,68,0.92)' }} />
        </div>
      </div>

      {/* loc chip */}
      <div className="sub-glass" style={{ position: 'absolute', bottom: 20, left: 20, padding: '8px 12px', display: 'inline-flex', alignItems: 'center', gap: 8, border: '1px solid rgba(239,68,68,0.25)' }}>
        <Icon name="location_on" size={14} style={{ color: '#b9201f' }} fill={1} />
        <span className="playfair" style={{ fontSize: 13, color: 'var(--ink-secondary)' }}>
          Невідома локація · 17 травня · 03:42 нічний режим
        </span>
      </div>
    </div>

    {/* === RIGHT — ALERT PANEL === */}
    <div className="glass" style={{
      position: 'absolute', right: 12, top: 68, bottom: 76, width: 356, padding: 16,
      borderRadius: 18,
      borderColor: 'rgba(239,68,68,0.4)',
      background: 'rgba(255,255,255,0.78)',
      display: 'flex', flexDirection: 'column', gap: 10,
      zIndex: 4,
      boxShadow: '0 0 0 1px rgba(239,68,68,0.2), 0 12px 40px rgba(239,68,68,0.18)'
    }}>
      {/* header */}
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
        <div style={{
          width: 48, height: 48, borderRadius: 14,
          background: 'rgba(239,68,68,0.15)',
          border: '1px solid rgba(239,68,68,0.3)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          color: '#b9201f',
          animation: 'phantom-pulse 1.4s ease-in-out infinite'
        }}>
          <Icon name="gpp_maybe" size={28} fill={1} />
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: '0.22em', color: '#b9201f' }}>ЗАГРОЗА ВИЯВЛЕНА</div>
          <div className="playfair" style={{ fontSize: 14, color: 'var(--ink-secondary)', marginTop: 1 }}>
            Радар + IR + аудіо · конфіденс 0.91
          </div>
        </div>
      </div>

      {/* live stats row */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
        <div style={{ padding: '10px 12px', borderRadius: 10, background: 'rgba(239,68,68,0.10)', border: '1px solid rgba(239,68,68,0.25)' }}>
          <div className="micro-label">DISTANCE</div>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 4 }}>
            <span className="tabular" style={{ fontSize: 22, fontWeight: 700, color: '#b9201f' }}>170</span>
            <span style={{ fontSize: 10, color: '#b9201f' }}>cm</span>
            <Icon name="trending_down" size={11} style={{ color: '#b9201f', marginLeft: 'auto' }} />
          </div>
          {/* mini line graph */}
          <svg viewBox="0 0 80 14" style={{ width: '100%', height: 14, marginTop: 2 }}>
            <polyline points="0,2 12,4 24,3 36,5 48,7 60,9 72,11 80,12" fill="none" stroke="#ef4444" strokeWidth="1" />
          </svg>
        </div>
        <div style={{ padding: '10px 12px', borderRadius: 10, background: 'rgba(239,68,68,0.10)', border: '1px solid rgba(239,68,68,0.25)' }}>
          <div className="micro-label">MOTION</div>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 4 }}>
            <span className="tabular" style={{ fontSize: 22, fontWeight: 700, color: '#b9201f' }}>84</span>
            <Icon name="directions_run" size={11} style={{ color: '#b9201f', marginLeft: 'auto' }} fill={1} />
          </div>
          <div style={{ display: 'flex', gap: 1, marginTop: 2, height: 14, alignItems: 'flex-end' }}>
            {[3,6,8,5,9,12,10,8,11,13,12,10].map((h,i) => (
              <span key={i} style={{ width: 4, height: h, background: '#ef4444', opacity: 0.5 + i*0.04, borderRadius: 1 }} />
            ))}
          </div>
        </div>
      </div>

      {/* threat detail rows */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {[
          { i: 'visibility', l: 'PRESENCE', v: 'Detected · human-shape', tone: 'coral' },
          { i: 'volume_up', l: 'AUDIO', v: '52 dB · footsteps', tone: 'coral' },
          { i: 'thermostat', l: 'IR', v: '36.4° body temp', tone: 'coral' },
          { i: 'tune', l: 'STATIC NOISE', v: '12 (low)', tone: 'neutral' },
        ].map((s, i) => {
          const isCoral = s.tone === 'coral';
          return (
            <div key={i} style={{
              padding: '8px 12px', borderRadius: 10,
              background: isCoral ? 'rgba(239,68,68,0.06)' : 'rgba(255,255,255,0.5)',
              border: `1px solid ${isCoral ? 'rgba(239,68,68,0.18)' : 'rgba(255,255,255,0.5)'}`,
              display: 'flex', alignItems: 'center', gap: 10
            }}>
              <Icon name={s.i} size={14} style={{ color: isCoral ? '#b9201f' : '#b07a10' }} />
              <span className="micro-label" style={{ flex: '0 0 100px', color: isCoral ? '#b9201f' : 'var(--ink-muted)' }}>{s.l}</span>
              <span style={{ fontSize: 12, fontWeight: 600, color: isCoral ? '#b9201f' : 'var(--ink)' }}>{s.v}</span>
            </div>
          );
        })}
      </div>

      {/* warnings */}
      <div style={{ padding: '8px 12px', borderRadius: 10, background: 'rgba(239,68,68,0.06)', border: '1px dashed rgba(239,68,68,0.25)' }}>
        <div className="micro-label" style={{ color: '#b9201f', marginBottom: 4 }}>ANOMALIES</div>
        {[
          'First visit to this location',
          'Night time · 03:42 local',
          'No registered device nearby',
        ].map((w, i) => (
          <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: '#b9201f', opacity: 0.85, marginTop: 2 }}>
            <Icon name="warning" size={11} fill={1} />
            <span>{w}</span>
          </div>
        ))}
      </div>

      <span style={{ flex: 1 }} />

      {/* actions */}
      <div style={{ display: 'flex', gap: 6 }}>
        <button style={{
          flex: 1, padding: '10px', borderRadius: 12,
          background: 'linear-gradient(135deg,#ef4444,#b9201f)',
          border: 'none', color: 'white', fontSize: 11, fontWeight: 700, cursor: 'pointer',
          boxShadow: '0 4px 14px rgba(239,68,68,0.45)',
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 4,
          letterSpacing: '0.05em'
        }}>
          <Icon name="campaign" size={14} fill={1} />
          ALARM
        </button>
        <button style={{
          flex: 1, padding: '10px', borderRadius: 12,
          background: 'rgba(255,255,255,0.6)',
          border: '1px solid rgba(0,0,0,0.08)',
          color: 'var(--ink-secondary)', fontSize: 11, fontWeight: 700, cursor: 'pointer',
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 4,
          letterSpacing: '0.05em'
        }}>
          <Icon name="videocam" size={14} />
          RECORD
        </button>
        <button style={{
          flex: 1, padding: '10px', borderRadius: 12,
          background: 'rgba(255,255,255,0.6)',
          border: '1px solid rgba(0,0,0,0.08)',
          color: 'var(--ink-secondary)', fontSize: 11, fontWeight: 700, cursor: 'pointer',
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 4,
          letterSpacing: '0.05em'
        }}>
          <Icon name="check" size={14} />
          DISMISS
        </button>
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 9, color: 'var(--ink-muted)' }}>
        <span>LAST SCAN · 03:42:14</span>
        <span className="mono">sentinel.v0.4</span>
      </div>
    </div>

    <FloatingToolbar active="more" />
  </div>
);

window.ScreenSentinel = ScreenSentinel;

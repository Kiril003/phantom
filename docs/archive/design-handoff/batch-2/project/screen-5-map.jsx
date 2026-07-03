// Screen 5 — Map / Tactical — distinctive
// Unique: warm cartographic map with hand-drawn road network, contour park,
// active route preview with ETA, signal heat overlay, telemetry rail with mini-graphs

const ScreenMap = () => (
  <div className="phantom-frame">
    {/* === MAP BASE === */}
    <div style={{ position: 'absolute', inset: 0, zIndex: 0,
      background: `
        radial-gradient(ellipse 50% 40% at 30% 60%, rgba(244,175,37,0.16) 0%, rgba(244,175,37,0) 70%),
        radial-gradient(ellipse 70% 50% at 80% 30%, rgba(251,146,60,0.10) 0%, rgba(251,146,60,0) 70%),
        linear-gradient(180deg, #fef6e6 0%, #f6ead4 100%)`
    }}>
      <svg viewBox="0 0 1024 600" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }}>
        <defs>
          <pattern id="grid" width="60" height="60" patternUnits="userSpaceOnUse">
            <path d="M 60 0 L 0 0 0 60" fill="none" stroke="rgba(176,122,16,0.06)" strokeWidth="0.6" />
          </pattern>
          <pattern id="contour" width="40" height="40" patternUnits="userSpaceOnUse">
            <circle cx="20" cy="20" r="6" fill="none" stroke="rgba(132,180,90,0.18)" strokeWidth="0.6" />
            <circle cx="20" cy="20" r="12" fill="none" stroke="rgba(132,180,90,0.12)" strokeWidth="0.6" />
          </pattern>
          <radialGradient id="signalHeat" cx="50%" cy="50%">
            <stop offset="0%" stopColor="#ef4444" stopOpacity="0.18" />
            <stop offset="100%" stopColor="#ef4444" stopOpacity="0" />
          </radialGradient>
          <linearGradient id="route" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="#f4af25" />
            <stop offset="100%" stopColor="#fb923c" />
          </linearGradient>
        </defs>

        <rect width="1024" height="600" fill="url(#grid)" />

        {/* river */}
        <path d="M 0 350 Q 200 360 400 340 T 800 360 L 1024 350"
          fill="none" stroke="#a8c8d8" strokeWidth="22" strokeOpacity="0.4" />
        <path d="M 0 350 Q 200 360 400 340 T 800 360 L 1024 350"
          fill="none" stroke="#7eaaba" strokeWidth="1" strokeOpacity="0.4" />
        <text x="700" y="346" fontSize="9" fill="#5b8497" fontStyle="italic" letterSpacing="2">D N I P R O</text>

        {/* parks - contour pattern */}
        <ellipse cx="200" cy="450" rx="130" ry="62" fill="rgba(132,180,90,0.14)" />
        <ellipse cx="200" cy="450" rx="130" ry="62" fill="url(#contour)" />
        <text x="200" y="455" fontSize="9" fill="#5b7a3d" textAnchor="middle" fontStyle="italic" letterSpacing="2">Парк Шевченка</text>

        <ellipse cx="850" cy="180" rx="90" ry="55" fill="rgba(132,180,90,0.12)" />
        <ellipse cx="850" cy="180" rx="90" ry="55" fill="url(#contour)" />

        {/* district blocks */}
        {[
          [60, 220, 80, 60], [180, 220, 100, 50], [300, 240, 60, 40],
          [400, 260, 70, 40], [500, 230, 80, 60], [620, 240, 80, 50],
          [740, 220, 60, 50], [820, 260, 70, 40], [900, 220, 80, 60],
          [80, 440, 70, 50], [380, 440, 80, 50], [500, 460, 70, 40],
          [600, 440, 80, 50], [720, 460, 70, 40], [820, 440, 90, 60],
        ].map((b, i) => (
          <rect key={i} x={b[0]} y={b[1]} width={b[2]} height={b[3]}
            fill="rgba(255,255,255,0.55)"
            stroke="rgba(176,122,16,0.18)"
            strokeWidth="0.5"
            rx="3" />
        ))}

        {/* major arterials */}
        <path d="M 0 280 Q 250 260 480 320 T 1024 280" fill="none" stroke="#f4af25" strokeWidth="4" strokeOpacity="0.55" strokeLinecap="round" />
        <path d="M 0 280 Q 250 260 480 320 T 1024 280" fill="none" stroke="#fff" strokeWidth="1" strokeOpacity="0.6" strokeDasharray="2 6" />
        <path d="M 0 410 L 1024 380" fill="none" stroke="#f4af25" strokeWidth="3" strokeOpacity="0.5" strokeLinecap="round" />
        <path d="M 380 0 Q 420 200 500 380 T 580 600" fill="none" stroke="#fb923c" strokeWidth="3" strokeOpacity="0.5" strokeLinecap="round" />
        <path d="M 700 0 L 720 600" fill="none" stroke="#f4af25" strokeWidth="2.5" strokeOpacity="0.45" strokeLinecap="round" />

        {/* minor */}
        {[160, 500, 850].map((x, i) => (
          <path key={i} d={`M ${x} 0 L ${x+20} 600`} fill="none" stroke="rgba(176,122,16,0.18)" strokeWidth="0.8" strokeDasharray="3 5" />
        ))}

        {/* signal heat */}
        <circle cx="280" cy="330" r="100" fill="url(#signalHeat)" />
        <circle cx="660" cy="280" r="120" fill="url(#signalHeat)" />

        {/* active route from user → Office */}
        <path d="M 460 320 Q 510 290 560 310 T 660 365 L 700 380"
          fill="none" stroke="url(#route)" strokeWidth="4" strokeLinecap="round"
          style={{ filter: 'drop-shadow(0 2px 8px rgba(244,175,37,0.5))' }} />
        <path d="M 460 320 Q 510 290 560 310 T 660 365 L 700 380"
          fill="none" stroke="#fff" strokeWidth="1.2" strokeLinecap="round" strokeDasharray="3 5" />

        {/* compass */}
        <g transform="translate(80, 130)" opacity="0.55">
          <circle r="22" fill="rgba(255,255,255,0.5)" stroke="rgba(176,122,16,0.3)" strokeWidth="0.6" />
          <path d="M 0 -18 L 4 0 L 0 18 L -4 0 Z" fill="#b07a10" />
          <text y="-26" fontSize="8" fontWeight="700" fill="#b07a10" textAnchor="middle">N</text>
        </g>
      </svg>

      {/* POIs as HTML for crisp text */}
      {[
        { x: 320, y: 290, label: 'Дім', icon: 'home', primary: true },
        { x: 700, y: 380, label: 'Офіс', icon: 'apartment', primary: false, eta: '11 хв' },
        { x: 800, y: 240, label: 'Кафе Foundry', icon: 'local_cafe', primary: false },
        { x: 220, y: 440, label: 'Парк', icon: 'park', primary: false },
      ].map((p, i) => (
        <div key={i} style={{ position: 'absolute', left: p.x, top: p.y, transform: 'translate(-50%, -100%)', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2, zIndex: 2 }}>
          <div style={{
            background: 'rgba(255,255,255,0.92)', padding: '3px 9px', borderRadius: 999,
            fontSize: 10, fontWeight: 700, color: 'var(--ink)',
            boxShadow: '0 2px 8px rgba(120,70,10,0.15)',
            display: 'inline-flex', alignItems: 'center', gap: 5,
            border: p.primary ? '1px solid rgba(244,175,37,0.5)' : '1px solid rgba(0,0,0,0.05)'
          }}>
            <Icon name={p.icon} size={11} style={{ color: '#b07a10' }} fill={p.primary ? 1 : 0} />
            {p.label}
            {p.eta && <span style={{ color: '#b07a10', fontSize: 9, fontWeight: 600, marginLeft: 4 }}>· {p.eta}</span>}
          </div>
          <div style={{
            width: 0, height: 0,
            borderLeft: '5px solid transparent', borderRight: '5px solid transparent',
            borderTop: `5px solid ${p.primary ? '#f4af25' : 'rgba(255,255,255,0.92)'}`
          }} />
        </div>
      ))}

      {/* user pulsing marker */}
      <div style={{ position: 'absolute', left: 460, top: 320, transform: 'translate(-50%, -50%)', zIndex: 3 }}>
        <div style={{ position: 'absolute', inset: -28, borderRadius: 999, background: 'rgba(244,175,37,0.15)', animation: 'orb-breathe 2.4s ease-in-out infinite' }} />
        <div style={{ position: 'absolute', inset: -16, borderRadius: 999, background: 'rgba(244,175,37,0.3)', animation: 'orb-breathe 2s ease-in-out infinite' }} />
        <div style={{ width: 18, height: 18, borderRadius: 999, background: 'linear-gradient(135deg,#f4af25,#fb923c)', border: '3px solid white', boxShadow: '0 2px 10px rgba(244,175,37,0.6)', position: 'relative' }} />
      </div>
    </div>

    {/* === TOP BANNER === */}
    <div className="glass" style={{
      position: 'absolute', top: 12, left: 12, right: 12,
      height: 44, padding: '0 14px',
      display: 'flex', alignItems: 'center', gap: 10,
      borderRadius: 14, zIndex: 4
    }}>
      <StatusPill tone="amber">FOCUS · MAP</StatusPill>
      <Divider />
      <span style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, fontWeight: 600 }}>
        <span style={{ width: 18, height: 18, borderRadius: 999, background: 'linear-gradient(135deg,#f4af25,#fb923c)' }} />
        phantom · ROOT
      </span>
      <Divider />
      <span style={{ fontSize: 11, color: 'var(--ink-secondary)', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
        <Icon name="my_location" size={13} style={{ color: '#b07a10' }} fill={1} />
        Київ · 50.45, 30.52
        <span style={{ fontSize: 9, fontWeight: 700, padding: '1px 6px', background: 'rgba(244,175,37,0.18)', color: '#8a5e0a', borderRadius: 999, marginLeft: 4 }}>IP · 30%</span>
        <Icon name="refresh" size={12} style={{ color: 'var(--ink-muted)', cursor: 'pointer' }} />
      </span>
      <span style={{ flex: 1 }} />
      <div style={{
        display: 'flex', alignItems: 'center', gap: 8,
        background: 'rgba(255,255,255,0.55)',
        border: '1px solid rgba(255,255,255,0.6)',
        padding: '5px 12px', borderRadius: 999, minWidth: 280
      }}>
        <Icon name="search" size={14} style={{ color: 'var(--ink-muted)' }} />
        <span className="playfair" style={{ flex: 1, fontSize: 12, color: 'var(--ink-muted)' }}>
          Знайти місце / мережу / точку…
        </span>
        <span style={{ display: 'flex', gap: 1.5, alignItems: 'center', height: 12 }}>
          {[3,5,7,5,3].map((h,i) => <span key={i} style={{ width: 1.5, height: h, background: '#b07a10', borderRadius: 1, opacity: 0.7 }} />)}
        </span>
      </div>
    </div>

    {/* === LEFT LAYER RAIL === */}
    <div className="glass" style={{
      position: 'absolute', left: 12, top: 68, bottom: 76, width: 60,
      padding: '8px 0',
      display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4,
      borderRadius: 14, zIndex: 4
    }}>
      {[
        { i: 'layers', a: true, label: 'Layers' },
        { i: 'navigation', label: 'Nav' },
        { i: 'wifi', label: 'WiFi' },
        { i: 'local_fire_department', label: 'Heat' },
        { i: 'push_pin', a: true, label: 'POIs' },
        { i: 'alt_route', label: 'Routes' },
        { i: 'auto_awesome', label: 'AI' },
        { i: 'water_drop', label: 'Geo' },
        { i: 'explore', label: 'Compass' },
      ].map((it, idx) => (
        <button key={idx} title={it.label} style={{
          width: 44, height: 44, borderRadius: 12,
          background: it.a ? 'rgba(244,175,37,0.18)' : 'transparent',
          border: it.a ? '1px solid rgba(244,175,37,0.4)' : '1px solid transparent',
          color: it.a ? '#8a5e0a' : 'var(--ink-secondary)', cursor: 'pointer',
          display: 'flex', alignItems: 'center', justifyContent: 'center'
        }}>
          <Icon name={it.i} size={18} fill={it.a ? 1 : 0} />
        </button>
      ))}
      <span style={{ flex: 1 }} />
      <div style={{ width: 30, height: 1, background: 'rgba(0,0,0,0.06)', margin: '4px auto' }} />
      <button style={{ width: 36, height: 36, borderRadius: 10, background: 'rgba(255,255,255,0.5)', border: '1px solid rgba(255,255,255,0.6)', color: 'var(--ink-secondary)', cursor: 'pointer' }}>
        <Icon name="add" size={14} />
      </button>
      <button style={{ width: 36, height: 36, borderRadius: 10, background: 'rgba(255,255,255,0.5)', border: '1px solid rgba(255,255,255,0.6)', color: 'var(--ink-secondary)', cursor: 'pointer' }}>
        <Icon name="remove" size={14} />
      </button>
    </div>

    {/* === RIGHT TELEMETRY RAIL === */}
    <div style={{
      position: 'absolute', right: 12, top: 68, bottom: 76, width: 220,
      display: 'flex', flexDirection: 'column', gap: 10, zIndex: 4
    }}>
      {/* active route card */}
      <div className="glass" style={{ padding: 12, borderColor: 'rgba(244,175,37,0.4)' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span className="micro-label" style={{ color: '#b07a10' }}>● ACTIVE ROUTE</span>
          <Icon name="alt_route" size={12} style={{ color: '#b07a10' }} />
        </div>
        <div className="playfair" style={{ fontSize: 14, color: 'var(--ink)', marginTop: 4 }}>“Дім → Офіс”</div>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, marginTop: 4 }}>
          <span className="tabular" style={{ fontSize: 22, fontWeight: 700, color: '#b07a10' }}>11</span>
          <span style={{ fontSize: 11, color: 'var(--ink-muted)' }}>хв · 4.2 км</span>
        </div>
        <div style={{ height: 4, marginTop: 6, borderRadius: 2, background: 'rgba(244,175,37,0.15)', overflow: 'hidden' }}>
          <div style={{ width: '38%', height: '100%', background: 'linear-gradient(90deg,#f4af25,#fb923c)' }} />
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 4, fontSize: 9, color: 'var(--ink-muted)' }}>
          <span>почато 07:15</span><span>arr 07:26</span>
        </div>
      </div>

      {/* nearby */}
      <div className="glass" style={{ padding: 12 }}>
        <div className="micro-label" style={{ marginBottom: 8 }}>NEARBY · 2</div>
        {[
          { name: 'Дім', type: 'РЕЗИДЕНЦІЯ', dist: '120 м', i: 'home' },
          { name: 'Кафе Foundry', type: 'POI · ☕', dist: '380 м', i: 'local_cafe' },
        ].map((n, i) => (
          <div key={i} style={{
            padding: '7px 0',
            borderBottom: i === 0 ? '1px solid rgba(0,0,0,0.06)' : 'none',
            display: 'flex', alignItems: 'center', gap: 8
          }}>
            <Icon name={n.i} size={14} style={{ color: '#b07a10' }} />
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 11, fontWeight: 600 }}>{n.name}</div>
              <div className="micro-label" style={{ fontSize: 8 }}>{n.type}</div>
            </div>
            <span className="tabular" style={{ fontSize: 10, fontWeight: 700, color: '#b07a10' }}>{n.dist}</span>
          </div>
        ))}
      </div>

      {/* speed/heading dial */}
      <div className="glass" style={{ padding: 10, textAlign: 'center' }}>
        <div className="micro-label" style={{ marginBottom: 4 }}>HEADING · NE 38°</div>
        <div style={{ position: 'relative', width: 90, height: 90, margin: '0 auto' }}>
          <svg viewBox="0 0 90 90" style={{ position: 'absolute', inset: 0 }}>
            <circle cx="45" cy="45" r="40" fill="none" stroke="rgba(176,122,16,0.18)" strokeWidth="1" />
            <circle cx="45" cy="45" r="32" fill="none" stroke="rgba(176,122,16,0.12)" strokeWidth="0.6" strokeDasharray="2 4" />
            {/* tick marks */}
            {Array.from({ length: 24 }).map((_, i) => {
              const a = (i / 24) * Math.PI * 2;
              const r1 = 40, r2 = i % 6 === 0 ? 32 : 36;
              return <line key={i}
                x1={45 + Math.cos(a) * r1} y1={45 + Math.sin(a) * r1}
                x2={45 + Math.cos(a) * r2} y2={45 + Math.sin(a) * r2}
                stroke={i % 6 === 0 ? '#b07a10' : 'rgba(176,122,16,0.3)'} strokeWidth="0.8" />;
            })}
            {/* needle pointing NE */}
            <path d="M 45 45 L 67 23 L 45 30 Z" fill="url(#needleGrad)" />
            <defs>
              <linearGradient id="needleGrad" x1="0" y1="0" x2="1" y2="1">
                <stop offset="0%" stopColor="#f4af25" /><stop offset="100%" stopColor="#fb923c" />
              </linearGradient>
            </defs>
            <circle cx="45" cy="45" r="3" fill="#fff" stroke="#f4af25" strokeWidth="1.5" />
            <text x="45" y="14" fontSize="8" fontWeight="700" fill="#b07a10" textAnchor="middle">N</text>
            <text x="45" y="84" fontSize="8" fontWeight="700" fill="rgba(176,122,16,0.4)" textAnchor="middle">S</text>
          </svg>
        </div>
        <div style={{ marginTop: 4 }}>
          <span className="tabular" style={{ fontSize: 22, fontWeight: 600 }}>00.0</span>
          <span style={{ fontSize: 10, color: 'var(--ink-muted)', marginLeft: 4 }}>км/год</span>
        </div>
      </div>

      <div className="sub-glass" style={{ padding: '6px 12px', textAlign: 'center', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span className="micro-label">ZOOM</span>
        <span className="tabular" style={{ fontSize: 11, fontWeight: 700 }}>z15 · LIVE</span>
      </div>
    </div>

    <FloatingToolbar active="map" />
  </div>
);

window.ScreenMap = ScreenMap;

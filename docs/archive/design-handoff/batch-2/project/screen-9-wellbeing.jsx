// Screen 9 — Neural Wellbeing — PHANTOM OS sunrise translation
// Same IA as user's reference (top bar + state hero + suggestions + bio-graph + focus score),
// but mapped to our amber/glass DNA. Ukrainian copy.

const ScreenWellbeing = () => (
  <div className="phantom-frame">
    {/* === TOP APP BAR === */}
    <div className="glass" style={{
      position: 'absolute', top: 12, left: 12, right: 12,
      height: 44, padding: '0 14px',
      display: 'flex', alignItems: 'center', gap: 10,
      borderRadius: 14, zIndex: 4
    }}>
      <button style={{
        width: 30, height: 30, borderRadius: 8,
        background: 'rgba(255,255,255,0.55)', border: '1px solid rgba(255,255,255,0.6)',
        color: 'var(--ink-secondary)', cursor: 'pointer',
        display: 'flex', alignItems: 'center', justifyContent: 'center'
      }}>
        <Icon name="arrow_back" size={14} />
      </button>
      <span style={{ fontSize: 14, fontWeight: 700, letterSpacing: '-0.01em' }}>Добробут</span>
      <span className="playfair" style={{ fontSize: 13, color: 'var(--ink-muted)' }}>· neural wellbeing</span>

      <span style={{ flex: 1 }} />

      <span style={{
        display: 'inline-flex', alignItems: 'center', gap: 6,
        padding: '4px 10px', borderRadius: 999,
        background: 'rgba(244,175,37,0.15)',
        border: '1px solid rgba(244,175,37,0.35)',
        fontSize: 10, fontWeight: 700, letterSpacing: '0.12em', color: '#8a5e0a'
      }}>
        <span style={{ width: 6, height: 6, borderRadius: 999, background: '#22c55e', animation: 'phantom-pulse 1.2s ease-in-out infinite' }} />
        АНАЛІЗ АКТИВНИЙ
      </span>

      <button style={{
        width: 30, height: 30, borderRadius: 8,
        background: 'transparent', border: 'none',
        color: 'var(--ink-secondary)', cursor: 'pointer'
      }}>
        <Icon name="tune" size={16} />
      </button>
    </div>

    {/* === LEFT COLUMN === */}
    <div style={{
      position: 'absolute', top: 68, left: 12, bottom: 12, width: 410,
      display: 'flex', flexDirection: 'column', gap: 10, zIndex: 3
    }}>
      {/* Title */}
      <div>
        <div className="eyebrow-amber">CURRENT USER STATE</div>
        <div style={{ fontSize: 22, fontWeight: 300, color: 'var(--ink)', lineHeight: 1.1, marginTop: 2 }}>
          Настрій <span className="playfair" style={{ fontStyle: 'italic', fontWeight: 600 }}>і добробут</span>
        </div>
      </div>

      {/* HERO state card */}
      <div className="glass" style={{ padding: 16, position: 'relative', overflow: 'hidden', flexShrink: 0 }}>
        <div style={{
          position: 'absolute', inset: 0, pointerEvents: 'none',
          background: 'radial-gradient(circle at 80% 20%, rgba(244,175,37,0.18), transparent 60%)'
        }} />
        <div style={{ position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ fontSize: 30, fontWeight: 300, color: 'var(--ink)', lineHeight: 1 }}>Зосереджений</span>
              <Icon name="psychology" size={22} style={{ color: '#b07a10' }} fill={1} />
            </div>
            <span className="playfair" style={{ fontSize: 12, fontStyle: 'italic', color: 'var(--ink-muted)' }}>
              "Тиха концентрація. Триває вже 47 хвилин."
            </span>
          </div>
          <div style={{
            width: 60, height: 60, borderRadius: 999,
            background: 'rgba(255,255,255,0.55)',
            border: '1px solid rgba(244,175,37,0.3)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            boxShadow: 'inset 0 2px 6px rgba(255,255,255,0.5)'
          }}>
            <div style={{
              width: 42, height: 42, borderRadius: 999,
              background: 'radial-gradient(circle at 35% 30%,#fff,#fde9b8,#f4af25,#fb923c)',
              animation: 'orb-breathe 3s ease-in-out infinite',
              boxShadow: '0 0 14px rgba(244,175,37,0.6)'
            }} />
          </div>
        </div>

        {/* AI insight */}
        <div className="sub-glass" style={{ padding: 11, marginTop: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
            <Icon name="auto_awesome" size={11} style={{ color: '#b07a10' }} fill={1} />
            <span className="micro-label" style={{ color: '#8a5e0a', fontSize: 9 }}>NEXUS INSIGHT</span>
          </div>
          <p className="playfair" style={{ fontSize: 13, fontStyle: 'italic', color: 'var(--ink-secondary)', lineHeight: 1.35, margin: 0 }}>
            "Аналіз мікроекспресій обличчя — глибока концентрація. Голос рівний, низького тембру."
          </p>
        </div>

        {/* Suggested adjustments */}
        <div style={{ marginTop: 10 }}>
          <div className="micro-label" style={{ marginBottom: 6 }}>ПРОПОНОВАНІ ЗМІНИ</div>
          {[
            { i: 'lightbulb', l: 'Освітлення → теплий бурштин 2700K', tone: 'amber' },
            { i: 'music_note', l: 'Програти Lo-Fi Focus Mix', tone: 'amber' },
            { i: 'do_not_disturb_on', l: 'Сповіщення на тишу до 12:00', tone: 'neutral' },
          ].map((s, i) => (
            <div key={i} style={{
              display: 'flex', alignItems: 'center', gap: 10,
              padding: '8px 10px', borderRadius: 9,
              background: 'rgba(255,255,255,0.45)',
              border: '1px solid rgba(255,255,255,0.5)',
              marginTop: i === 0 ? 0 : 4, cursor: 'pointer'
            }}>
              <Icon name={s.i} size={14} style={{ color: s.tone === 'amber' ? '#b07a10' : 'var(--ink-secondary)' }} fill={1} />
              <span style={{ flex: 1, fontSize: 12, fontWeight: 500, color: 'var(--ink)' }}>{s.l}</span>
              <Icon name="arrow_forward" size={12} style={{ color: 'var(--ink-muted)' }} />
            </div>
          ))}
        </div>

        <button style={{
          width: '100%', marginTop: 10, padding: '11px',
          borderRadius: 11,
          background: 'linear-gradient(135deg,#f4af25,#fb923c)',
          border: 'none', cursor: 'pointer',
          color: 'white', fontSize: 12, fontWeight: 700, letterSpacing: '0.05em',
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6,
          boxShadow: '0 6px 16px rgba(244,175,37,0.35)'
        }}>
          <Icon name="check_circle" size={14} fill={1} />
          ЗАСТОСУВАТИ ВСЕ
        </button>
      </div>

      {/* Quick stats */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
        <div className="glass" style={{ padding: 12 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
            <span className="micro-label">СТРЕС</span>
            <Icon name="spa" size={13} style={{ color: '#3d5b1c' }} fill={1} />
          </div>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
            <span style={{ fontSize: 22, fontWeight: 600, color: 'var(--ink)' }}>Низький</span>
            <span style={{ fontSize: 10, fontWeight: 700, color: '#3d5b1c' }}>−5%</span>
          </div>
          <div style={{ display: 'flex', gap: 1.5, marginTop: 4, height: 8, alignItems: 'flex-end' }}>
            {[3,4,3,5,4,6,4,3,5,4,3,3].map((h,i) => (
              <span key={i} style={{ flex: 1, height: h, background: '#3d5b1c', opacity: 0.4 + i*0.04, borderRadius: 1 }} />
            ))}
          </div>
        </div>
        <div className="glass" style={{ padding: 12 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
            <span className="micro-label">ЕНЕРГІЯ</span>
            <Icon name="bolt" size={13} style={{ color: '#b07a10' }} fill={1} />
          </div>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
            <span style={{ fontSize: 22, fontWeight: 600, color: 'var(--ink)' }}>Стабільна</span>
            <span style={{ fontSize: 10, fontWeight: 700, color: '#b07a10' }}>~</span>
          </div>
          <div style={{ display: 'flex', gap: 1.5, marginTop: 4, height: 8, alignItems: 'flex-end' }}>
            {[6,7,6,7,8,7,7,8,7,8,7,7].map((h,i) => (
              <span key={i} style={{ flex: 1, height: h, background: '#b07a10', opacity: 0.4 + i*0.04, borderRadius: 1 }} />
            ))}
          </div>
        </div>
      </div>
    </div>

    {/* === RIGHT COLUMN === */}
    <div style={{
      position: 'absolute', top: 68, left: 434, right: 12, bottom: 12,
      display: 'flex', flexDirection: 'column', gap: 10, zIndex: 3
    }}>
      {/* BIO-FEEDBACK GRAPH */}
      <div className="glass" style={{ padding: 16, flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 10 }}>
          <div>
            <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--ink)' }}>Біозворотній зв'язок</div>
            <div className="playfair" style={{ fontSize: 12, fontStyle: 'italic', color: 'var(--ink-muted)' }}>
              Стабільність настрою · останні 24 год
            </div>
          </div>
          <div style={{ display: 'flex', gap: 4 }}>
            {['1Г','24Г','7Д'].map((t, i) => (
              <button key={i} style={{
                padding: '4px 11px', borderRadius: 999, fontSize: 10, fontWeight: 700, letterSpacing: '0.08em',
                background: i === 1 ? 'linear-gradient(135deg,#f4af25,#fb923c)' : 'rgba(255,255,255,0.5)',
                color: i === 1 ? 'white' : 'var(--ink-secondary)',
                border: i === 1 ? 'none' : '1px solid rgba(255,255,255,0.6)',
                boxShadow: i === 1 ? '0 4px 10px rgba(244,175,37,0.35)' : 'none',
                cursor: 'pointer'
              }}>{t}</button>
            ))}
          </div>
        </div>

        {/* graph */}
        <div style={{ position: 'relative', flex: 1, minHeight: 0 }}>
          <svg viewBox="0 0 800 260" preserveAspectRatio="none" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', overflow: 'visible' }}>
            <defs>
              <linearGradient id="wbArea" x1="0" x2="0" y1="0" y2="1">
                <stop offset="0%" stopColor="#f4af25" stopOpacity="0.45" />
                <stop offset="100%" stopColor="#f4af25" stopOpacity="0" />
              </linearGradient>
              <linearGradient id="wbStroke" x1="0" x2="1" y1="0" y2="0">
                <stop offset="0%" stopColor="#fb923c" />
                <stop offset="50%" stopColor="#f4af25" />
                <stop offset="100%" stopColor="#fb923c" />
              </linearGradient>
              <filter id="wbGlow" x="-20%" y="-20%" width="140%" height="140%">
                <feGaussianBlur stdDeviation="3" result="cb" />
                <feMerge><feMergeNode in="cb" /><feMergeNode in="SourceGraphic" /></feMerge>
              </filter>
            </defs>

            {/* horizontal grid */}
            {[0, 65, 130, 195, 260].map((y, i) => (
              <line key={i} x1="0" y1={y} x2="800" y2={y} stroke="rgba(176,122,16,0.12)" strokeWidth="0.6" strokeDasharray={i === 2 ? '0' : '3 5'} />
            ))}
            {/* vertical grid */}
            {[0, 160, 320, 480, 640, 800].map((x, i) => (
              <line key={i} x1={x} y1="0" x2={x} y2="260" stroke="rgba(176,122,16,0.07)" strokeWidth="0.5" />
            ))}

            {/* mood band (calm zone) */}
            <rect x="0" y="80" width="800" height="60" fill="rgba(132,180,90,0.06)" />
            <text x="14" y="98" fontSize="9" fill="#3d5b1c" letterSpacing="2" fontWeight="600">CALM ZONE</text>

            {/* Area path */}
            <path d="M0,180 C100,180 150,80 250,70 C350,60 400,150 500,140 C600,130 650,100 750,95 L800,100 L800,260 L0,260 Z"
              fill="url(#wbArea)" />

            {/* Stroke path */}
            <path d="M0,180 C100,180 150,80 250,70 C350,60 400,150 500,140 C600,130 650,100 750,95 L800,100"
              fill="none" stroke="url(#wbStroke)" strokeWidth="3" strokeLinecap="round" filter="url(#wbGlow)" />

            {/* secondary HRV line */}
            <path d="M0,200 L60,190 L100,205 L140,185 L200,195 L260,170 L320,180 L380,160 L440,175 L500,165 L560,155 L620,150 L680,140 L740,135 L800,130"
              fill="none" stroke="#fb923c" strokeWidth="1.2" strokeOpacity="0.5" strokeDasharray="4 4" />

            {/* annotated peak */}
            <circle cx="250" cy="70" r="4" fill="white" stroke="#f4af25" strokeWidth="2" />
            <circle cx="250" cy="70" r="11" fill="rgba(244,175,37,0.3)" style={{ animation: 'phantom-pulse 1.6s ease-in-out infinite' }} />

            {/* current point marker */}
            <circle cx="800" cy="100" r="6" fill="white" stroke="#fb923c" strokeWidth="3" filter="url(#wbGlow)" />
            <circle cx="800" cy="100" r="14" fill="rgba(251,146,60,0.3)" style={{ animation: 'phantom-pulse 1.4s ease-in-out infinite' }} />

            {/* event ticks bottom */}
            {[120, 320, 540, 700].map((x, i) => (
              <g key={i}>
                <line x1={x} y1="240" x2={x} y2="252" stroke="#b07a10" strokeWidth="1" strokeOpacity="0.5" />
              </g>
            ))}
          </svg>

          {/* peak insight bubble */}
          <div className="sub-glass" style={{
            position: 'absolute', top: '12%', left: '24%',
            padding: 9, maxWidth: 180, zIndex: 5,
            border: '1px solid rgba(244,175,37,0.35)'
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginBottom: 2 }}>
              <span style={{ width: 6, height: 6, borderRadius: 999, background: '#f4af25' }} />
              <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--ink)' }}>Пік креативу</span>
              <span className="tabular" style={{ fontSize: 9, color: 'var(--ink-muted)', marginLeft: 'auto' }}>10:24</span>
            </div>
            <p className="playfair" style={{ fontSize: 10, fontStyle: 'italic', color: 'var(--ink-muted)', lineHeight: 1.3, margin: 0 }}>
              "Висока кореляція тета-хвиль під час брейнштормінгу."
            </p>
          </div>

          {/* now indicator label */}
          <div style={{
            position: 'absolute', right: -2, top: '36%', transform: 'translate(100%, -50%)',
            padding: '2px 7px', borderRadius: 999,
            background: 'linear-gradient(135deg,#f4af25,#fb923c)',
            color: 'white', fontSize: 9, fontWeight: 700, letterSpacing: '0.12em',
            boxShadow: '0 4px 10px rgba(251,146,60,0.4)'
          }}>ЗАРАЗ</div>
        </div>

        {/* time labels */}
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 9, fontWeight: 600, color: 'var(--ink-muted)', letterSpacing: '0.08em', marginTop: 6, paddingRight: 28 }}>
          <span>08:00</span><span>12:00</span><span>16:00</span><span>20:00</span><span>00:00</span><span>04:00</span><span style={{ color: '#b07a10' }}>NOW</span>
        </div>

        {/* legend */}
        <div style={{ display: 'flex', gap: 14, marginTop: 8, fontSize: 10, color: 'var(--ink-muted)' }}>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
            <span style={{ width: 12, height: 2, background: 'linear-gradient(90deg,#fb923c,#f4af25)', borderRadius: 1 }} />
            Настрій
          </span>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
            <span style={{ width: 12, height: 2, background: '#fb923c', opacity: 0.5, borderRadius: 1 }} />
            HRV
          </span>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
            <span style={{ width: 10, height: 10, background: 'rgba(132,180,90,0.2)', borderRadius: 2, border: '1px solid rgba(132,180,90,0.4)' }} />
            Зона спокою
          </span>
          <span style={{ flex: 1 }} />
          <span className="mono">sample · 1 Hz</span>
        </div>
      </div>

      {/* Focus Score */}
      <div className="glass" style={{ padding: 14, display: 'flex', alignItems: 'center', gap: 14 }}>
        {/* circular gauge */}
        <div style={{ position: 'relative', width: 70, height: 70, flexShrink: 0 }}>
          <svg viewBox="0 0 70 70" style={{ position: 'absolute', inset: 0 }}>
            <defs>
              <linearGradient id="focusG" x1="0" y1="0" x2="1" y2="1">
                <stop offset="0%" stopColor="#f4af25" /><stop offset="100%" stopColor="#fb923c" />
              </linearGradient>
            </defs>
            <circle cx="35" cy="35" r="28" fill="none" stroke="rgba(244,175,37,0.15)" strokeWidth="5" />
            <circle cx="35" cy="35" r="28" fill="none"
              stroke="url(#focusG)" strokeWidth="5" strokeLinecap="round"
              strokeDasharray={`${2 * Math.PI * 28 * 0.85} ${2 * Math.PI * 28}`}
              transform="rotate(-90 35 35)" />
          </svg>
          <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <Icon name="donut_large" size={20} style={{ color: '#b07a10' }} fill={1} />
          </div>
        </div>

        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--ink)' }}>Фокус-скор</div>
          <div className="playfair" style={{ fontSize: 11, fontStyle: 'italic', color: 'var(--ink-muted)' }}>
            Топ-10% твого тижневого середнього
          </div>
          {/* mini bars */}
          <div style={{ display: 'flex', gap: 2, marginTop: 5, height: 6, alignItems: 'flex-end' }}>
            {[3,4,5,6,5,7,8].map((h,i) => (
              <span key={i} style={{
                width: 16, height: h,
                background: i === 6 ? 'linear-gradient(180deg,#f4af25,#fb923c)' : 'rgba(176,122,16,0.25)',
                borderRadius: 1
              }} />
            ))}
          </div>
        </div>

        <div style={{ textAlign: 'right' }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 2, justifyContent: 'flex-end' }}>
            <span className="tabular" style={{ fontSize: 32, fontWeight: 200, color: 'var(--ink)', lineHeight: 1 }}>85</span>
            <span className="tabular" style={{ fontSize: 14, color: 'var(--ink-muted)' }}>/100</span>
          </div>
          <div style={{ fontSize: 10, fontWeight: 700, color: '#3d5b1c', display: 'inline-flex', alignItems: 'center', gap: 3, marginTop: 2 }}>
            <Icon name="trending_up" size={11} />
            +12% vs учора
          </div>
        </div>
      </div>
    </div>

    <FloatingToolbar active="more" />
  </div>
);

window.ScreenWellbeing = ScreenWellbeing;

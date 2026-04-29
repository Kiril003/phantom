// Screen 10 — Neural Wellbeing · NEBULA THEME
// Dark slate + blue/pink/cyan palette translation of the wellbeing screen,
// with built-in theme toggle (Sunrise ↔ Nebula).

const ScreenWellbeingNebula = () => {
  const [theme, setTheme] = React.useState('nebula'); // 'nebula' | 'sunrise'

  // theme tokens
  const T = theme === 'nebula' ? {
    bg: `radial-gradient(ellipse 70% 60% at 20% 0%, rgba(59,130,246,0.28) 0%, rgba(59,130,246,0) 60%),
         radial-gradient(ellipse 60% 50% at 95% 30%, rgba(236,72,153,0.20) 0%, rgba(236,72,153,0) 60%),
         radial-gradient(ellipse 80% 60% at 50% 110%, rgba(6,182,212,0.18) 0%, rgba(6,182,212,0) 50%),
         linear-gradient(180deg, #0f172a 0%, #0b1224 100%)`,
    glassBg: 'rgba(30,41,59,0.55)',
    glassBgStrong: 'rgba(30,41,59,0.78)',
    subGlass: 'rgba(255,255,255,0.04)',
    glassBorder: 'rgba(255,255,255,0.08)',
    glassBorderStrong: 'rgba(255,255,255,0.12)',
    ink: '#f1f5f9',
    inkSec: '#cbd5e1',
    inkMuted: '#64748b',
    primary: '#3b82f6',
    primarySoft: '#60a5fa',
    pink: '#ec4899',
    cyan: '#06b6d4',
    green: '#22c55e',
    amber: '#f59e0b',
    rule: 'rgba(255,255,255,0.06)',
    accent: '#3b82f6',
    eyebrow: '#60a5fa',
    serifInk: '#cbd5e1',
    shadow: '0 8px 30px rgba(0,0,0,0.4), 0 2px 8px rgba(0,0,0,0.2)',
    glow: '0 0 18px rgba(59,130,246,0.6)',
    orbGrad: 'radial-gradient(circle at 35% 30%,#dbeafe,#93c5fd,#3b82f6,#1e40af)',
    btnGrad: 'linear-gradient(135deg,#3b82f6,#ec4899)',
    btnShadow: '0 6px 16px rgba(59,130,246,0.4)',
    chipBg: 'rgba(255,255,255,0.06)',
    chipBorder: 'rgba(255,255,255,0.10)',
    nowChipShadow: '0 4px 10px rgba(6,182,212,0.5)',
  } : {
    bg: `radial-gradient(ellipse 90% 70% at 50% -10%, #f4af25 0%, rgba(244,175,37,0) 70%),
         linear-gradient(180deg, #fdf6e9 0%, #f8f7f5 60%, #f5f1ea 100%)`,
    glassBg: 'rgba(255,255,255,0.6)',
    glassBgStrong: 'rgba(255,255,255,0.78)',
    subGlass: 'rgba(255,255,255,0.4)',
    glassBorder: 'rgba(255,255,255,0.55)',
    glassBorderStrong: 'rgba(255,255,255,0.6)',
    ink: '#1a1612',
    inkSec: '#5b5147',
    inkMuted: '#8a7f72',
    primary: '#f4af25',
    primarySoft: '#fbc66a',
    pink: '#fb923c',
    cyan: '#f4af25',
    green: '#3d5b1c',
    amber: '#b07a10',
    rule: 'rgba(0,0,0,0.06)',
    accent: '#f4af25',
    eyebrow: '#b07a10',
    serifInk: '#5b5147',
    shadow: '0 8px 30px rgba(120, 70, 10, 0.08), 0 2px 8px rgba(120, 70, 10, 0.04)',
    glow: '0 0 14px rgba(244,175,37,0.6)',
    orbGrad: 'radial-gradient(circle at 35% 30%,#fff,#fde9b8,#f4af25,#fb923c)',
    btnGrad: 'linear-gradient(135deg,#f4af25,#fb923c)',
    btnShadow: '0 6px 16px rgba(244,175,37,0.35)',
    chipBg: 'rgba(255,255,255,0.5)',
    chipBorder: 'rgba(255,255,255,0.6)',
    nowChipShadow: '0 4px 10px rgba(251,146,60,0.4)',
  };

  const glass = {
    background: T.glassBg,
    backdropFilter: 'blur(14px)',
    WebkitBackdropFilter: 'blur(14px)',
    border: `1px solid ${T.glassBorder}`,
    borderRadius: 16,
    boxShadow: T.shadow,
  };
  const subGlass = {
    background: T.subGlass,
    backdropFilter: 'blur(8px)',
    WebkitBackdropFilter: 'blur(8px)',
    border: `1px solid ${T.glassBorder}`,
    borderRadius: 12,
  };

  return (
    <div style={{
      width: 1024, height: 600, borderRadius: 16, overflow: 'hidden',
      position: 'relative',
      fontFamily: "'Manrope', -apple-system, sans-serif",
      color: T.ink, background: T.bg,
      isolation: 'isolate'
    }}>
      {/* === TOP APP BAR === */}
      <div style={{
        ...glass, position: 'absolute', top: 12, left: 12, right: 12,
        height: 44, padding: '0 14px',
        display: 'flex', alignItems: 'center', gap: 10, zIndex: 4
      }}>
        <button style={{
          width: 30, height: 30, borderRadius: 8,
          background: T.chipBg, border: `1px solid ${T.chipBorder}`,
          color: T.inkSec, cursor: 'pointer',
          display: 'flex', alignItems: 'center', justifyContent: 'center'
        }}>
          <Icon name="arrow_back" size={14} />
        </button>
        <span style={{ fontSize: 14, fontWeight: 700, letterSpacing: '-0.01em' }}>Добробут</span>
        <span style={{ fontFamily: 'Playfair Display, serif', fontStyle: 'italic', fontWeight: 600, fontSize: 13, color: T.inkMuted }}>· neural wellbeing</span>

        <span style={{ flex: 1 }} />

        {/* THEME TOGGLE */}
        <div style={{
          display: 'inline-flex', padding: 3, borderRadius: 999,
          background: T.chipBg, border: `1px solid ${T.chipBorder}`
        }}>
          {[
            { id: 'sunrise', i: 'wb_sunny', label: 'SUNRISE' },
            { id: 'nebula', i: 'nights_stay', label: 'NEBULA' },
          ].map(opt => (
            <button key={opt.id} onClick={() => setTheme(opt.id)} style={{
              padding: '4px 11px', borderRadius: 999, border: 'none', cursor: 'pointer',
              fontSize: 9, fontWeight: 700, letterSpacing: '0.12em',
              background: theme === opt.id ? T.btnGrad : 'transparent',
              color: theme === opt.id ? 'white' : T.inkMuted,
              boxShadow: theme === opt.id ? T.btnShadow : 'none',
              display: 'inline-flex', alignItems: 'center', gap: 4,
              transition: 'all .25s ease'
            }}>
              <Icon name={opt.i} size={11} fill={theme === opt.id ? 1 : 0} />
              {opt.label}
            </button>
          ))}
        </div>

        <span style={{
          display: 'inline-flex', alignItems: 'center', gap: 6,
          padding: '4px 10px', borderRadius: 999,
          background: theme === 'nebula' ? 'rgba(34,197,94,0.12)' : 'rgba(244,175,37,0.15)',
          border: `1px solid ${theme === 'nebula' ? 'rgba(34,197,94,0.3)' : 'rgba(244,175,37,0.35)'}`,
          fontSize: 10, fontWeight: 700, letterSpacing: '0.12em',
          color: theme === 'nebula' ? '#4ade80' : '#8a5e0a'
        }}>
          <span style={{ width: 6, height: 6, borderRadius: 999, background: T.green, animation: 'phantom-pulse 1.2s ease-in-out infinite' }} />
          АНАЛІЗ АКТИВНИЙ
        </span>

        <button style={{ width: 30, height: 30, borderRadius: 8, background: 'transparent', border: 'none', color: T.inkSec, cursor: 'pointer' }}>
          <Icon name="tune" size={16} />
        </button>
      </div>

      {/* === LEFT COLUMN === */}
      <div style={{ position: 'absolute', top: 68, left: 12, bottom: 12, width: 410, display: 'flex', flexDirection: 'column', gap: 10, zIndex: 3 }}>
        <div>
          <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.18em', textTransform: 'uppercase', color: T.eyebrow }}>CURRENT USER STATE</div>
          <div style={{ fontSize: 22, fontWeight: 300, color: T.ink, lineHeight: 1.1, marginTop: 2 }}>
            Настрій <span style={{ fontFamily: 'Playfair Display, serif', fontStyle: 'italic', fontWeight: 600 }}>і добробут</span>
          </div>
        </div>

        {/* HERO state card */}
        <div style={{ ...glass, padding: 16, position: 'relative', overflow: 'hidden', flexShrink: 0 }}>
          <div style={{
            position: 'absolute', inset: 0, pointerEvents: 'none',
            background: theme === 'nebula'
              ? 'radial-gradient(circle at 80% 20%, rgba(236,72,153,0.18), transparent 60%)'
              : 'radial-gradient(circle at 80% 20%, rgba(244,175,37,0.18), transparent 60%)'
          }} />
          <div style={{ position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span style={{ fontSize: 30, fontWeight: 300, color: T.ink, lineHeight: 1 }}>Зосереджений</span>
                <Icon name="psychology" size={22} style={{ color: T.primary }} fill={1} />
              </div>
              <span style={{ fontFamily: 'Playfair Display, serif', fontStyle: 'italic', fontSize: 12, color: T.inkMuted }}>
                "Тиха концентрація. Триває вже 47 хвилин."
              </span>
            </div>
            <div style={{
              width: 60, height: 60, borderRadius: 999,
              background: T.chipBg,
              border: `1px solid ${T.glassBorder}`,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              boxShadow: 'inset 0 2px 6px rgba(255,255,255,0.08)'
            }}>
              <div style={{
                width: 42, height: 42, borderRadius: 999,
                background: T.orbGrad,
                animation: 'orb-breathe 3s ease-in-out infinite',
                boxShadow: T.glow
              }} />
            </div>
          </div>

          {/* AI insight */}
          <div style={{ ...subGlass, padding: 11, marginTop: 12 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
              <Icon name="auto_awesome" size={11} style={{ color: T.cyan }} fill={1} />
              <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.18em', textTransform: 'uppercase', color: T.cyan }}>
                {theme === 'nebula' ? 'AI INSIGHT' : 'NEXUS INSIGHT'}
              </span>
            </div>
            <p style={{ fontFamily: 'Playfair Display, serif', fontStyle: 'italic', fontSize: 13, color: T.serifInk, lineHeight: 1.35, margin: 0 }}>
              "Аналіз мікроекспресій обличчя — глибока концентрація. Голос рівний, низького тембру."
            </p>
          </div>

          {/* Suggested adjustments */}
          <div style={{ marginTop: 10 }}>
            <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.22em', textTransform: 'uppercase', color: T.inkMuted, marginBottom: 6 }}>ПРОПОНОВАНІ ЗМІНИ</div>
            {[
              { i: 'lightbulb', l: 'Освітлення → глибокий синій', tone: theme === 'nebula' ? T.primarySoft : T.primary },
              { i: 'music_note', l: 'Програти Lo-Fi Focus Mix', tone: theme === 'nebula' ? T.pink : T.primary },
              { i: 'do_not_disturb_on', l: 'Сповіщення на тишу до 12:00', tone: T.inkSec },
            ].map((s, i) => (
              <div key={i} style={{
                display: 'flex', alignItems: 'center', gap: 10,
                padding: '8px 10px', borderRadius: 9,
                background: T.chipBg,
                border: `1px solid ${T.chipBorder}`,
                marginTop: i === 0 ? 0 : 4, cursor: 'pointer'
              }}>
                <Icon name={s.i} size={14} style={{ color: s.tone }} fill={1} />
                <span style={{ flex: 1, fontSize: 12, fontWeight: 500, color: T.ink }}>{s.l}</span>
                <Icon name="arrow_forward" size={12} style={{ color: T.inkMuted }} />
              </div>
            ))}
          </div>

          <button style={{
            width: '100%', marginTop: 10, padding: '11px',
            borderRadius: 11,
            background: T.btnGrad,
            border: 'none', cursor: 'pointer',
            color: 'white', fontSize: 12, fontWeight: 700, letterSpacing: '0.05em',
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6,
            boxShadow: T.btnShadow
          }}>
            <Icon name="check_circle" size={14} fill={1} />
            ЗАСТОСУВАТИ ВСЕ
          </button>
        </div>

        {/* Quick stats */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
          <div style={{ ...glass, padding: 12 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
              <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.22em', textTransform: 'uppercase', color: T.inkMuted }}>СТРЕС</span>
              <Icon name="spa" size={13} style={{ color: T.green }} fill={1} />
            </div>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
              <span style={{ fontSize: 22, fontWeight: 600, color: T.ink }}>Низький</span>
              <span style={{ fontSize: 10, fontWeight: 700, color: T.green }}>−5%</span>
            </div>
            <div style={{ display: 'flex', gap: 1.5, marginTop: 4, height: 8, alignItems: 'flex-end' }}>
              {[3,4,3,5,4,6,4,3,5,4,3,3].map((h,i) => (
                <span key={i} style={{ flex: 1, height: h, background: T.green, opacity: 0.4 + i*0.04, borderRadius: 1 }} />
              ))}
            </div>
          </div>
          <div style={{ ...glass, padding: 12 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
              <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.22em', textTransform: 'uppercase', color: T.inkMuted }}>ЕНЕРГІЯ</span>
              <Icon name="bolt" size={13} style={{ color: T.amber }} fill={1} />
            </div>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
              <span style={{ fontSize: 22, fontWeight: 600, color: T.ink }}>Стабільна</span>
              <span style={{ fontSize: 10, fontWeight: 700, color: T.amber }}>~</span>
            </div>
            <div style={{ display: 'flex', gap: 1.5, marginTop: 4, height: 8, alignItems: 'flex-end' }}>
              {[6,7,6,7,8,7,7,8,7,8,7,7].map((h,i) => (
                <span key={i} style={{ flex: 1, height: h, background: T.amber, opacity: 0.4 + i*0.04, borderRadius: 1 }} />
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* === RIGHT COLUMN === */}
      <div style={{ position: 'absolute', top: 68, left: 434, right: 12, bottom: 12, display: 'flex', flexDirection: 'column', gap: 10, zIndex: 3 }}>
        {/* BIO-FEEDBACK GRAPH */}
        <div style={{ ...glass, padding: 16, flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 10 }}>
            <div>
              <div style={{ fontSize: 14, fontWeight: 700, color: T.ink }}>Біозворотній зв'язок</div>
              <div style={{ fontFamily: 'Playfair Display, serif', fontStyle: 'italic', fontSize: 12, color: T.inkMuted }}>
                Стабільність настрою · останні 24 год
              </div>
            </div>
            <div style={{ display: 'flex', gap: 4 }}>
              {['1Г','24Г','7Д'].map((t, i) => (
                <button key={i} style={{
                  padding: '4px 11px', borderRadius: 999, fontSize: 10, fontWeight: 700, letterSpacing: '0.08em',
                  background: i === 1 ? T.btnGrad : T.chipBg,
                  color: i === 1 ? 'white' : T.inkSec,
                  border: i === 1 ? 'none' : `1px solid ${T.chipBorder}`,
                  boxShadow: i === 1 ? T.btnShadow : 'none',
                  cursor: 'pointer'
                }}>{t}</button>
              ))}
            </div>
          </div>

          <div style={{ position: 'relative', flex: 1, minHeight: 0 }}>
            <svg viewBox="0 0 800 260" preserveAspectRatio="none" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', overflow: 'visible' }}>
              <defs>
                <linearGradient id="nbArea" x1="0" x2="0" y1="0" y2="1">
                  <stop offset="0%" stopColor={T.pink} stopOpacity="0.45" />
                  <stop offset="100%" stopColor={T.primary} stopOpacity="0" />
                </linearGradient>
                <linearGradient id="nbStroke" x1="0" x2="1" y1="0" y2="0">
                  <stop offset="0%" stopColor={T.primary} />
                  <stop offset="50%" stopColor={T.pink} />
                  <stop offset="100%" stopColor={T.cyan} />
                </linearGradient>
                <filter id="nbGlow" x="-20%" y="-20%" width="140%" height="140%">
                  <feGaussianBlur stdDeviation="3" result="cb" />
                  <feMerge><feMergeNode in="cb" /><feMergeNode in="SourceGraphic" /></feMerge>
                </filter>
              </defs>

              {[0, 65, 130, 195, 260].map((y, i) => (
                <line key={i} x1="0" y1={y} x2="800" y2={y} stroke={T.rule} strokeWidth="0.6" strokeDasharray={i === 2 ? '0' : '3 5'} />
              ))}
              {[0, 160, 320, 480, 640, 800].map((x, i) => (
                <line key={i} x1={x} y1="0" x2={x} y2="260" stroke={T.rule} strokeWidth="0.5" />
              ))}

              {/* calm zone band */}
              <rect x="0" y="80" width="800" height="60" fill={theme === 'nebula' ? 'rgba(34,197,94,0.06)' : 'rgba(132,180,90,0.06)'} />
              <text x="14" y="98" fontSize="9" fill={T.green} letterSpacing="2" fontWeight="600" opacity="0.7">CALM ZONE</text>

              <path d="M0,180 C100,180 150,80 250,70 C350,60 400,150 500,140 C600,130 650,100 750,95 L800,100 L800,260 L0,260 Z"
                fill="url(#nbArea)" />
              <path d="M0,180 C100,180 150,80 250,70 C350,60 400,150 500,140 C600,130 650,100 750,95 L800,100"
                fill="none" stroke="url(#nbStroke)" strokeWidth="3" strokeLinecap="round" filter="url(#nbGlow)" />

              {/* HRV pulsing line */}
              <path d="M0,200 L60,190 L100,205 L140,185 L200,195 L260,170 L320,180 L380,160 L440,175 L500,165 L560,155 L620,150 L680,140 L740,135 L800,130"
                fill="none" stroke={T.cyan} strokeWidth="1.2" strokeOpacity="0.55" strokeDasharray="4 4" />

              {/* peak marker */}
              <circle cx="250" cy="70" r="4" fill={theme === 'nebula' ? '#0f172a' : '#fff'} stroke={T.pink} strokeWidth="2" />
              <circle cx="250" cy="70" r="11" fill={T.pink} fillOpacity="0.3" style={{ animation: 'phantom-pulse 1.6s ease-in-out infinite' }} />

              {/* current point */}
              <circle cx="800" cy="100" r="6" fill={theme === 'nebula' ? '#0f172a' : '#fff'} stroke={T.cyan} strokeWidth="3" filter="url(#nbGlow)" />
              <circle cx="800" cy="100" r="14" fill={T.cyan} fillOpacity="0.3" style={{ animation: 'phantom-pulse 1.4s ease-in-out infinite' }} />

              {[120, 320, 540, 700].map((x, i) => (
                <line key={i} x1={x} y1="240" x2={x} y2="252" stroke={T.amber} strokeWidth="1" strokeOpacity="0.5" />
              ))}
            </svg>

            {/* Peak insight bubble */}
            <div style={{
              ...subGlass,
              position: 'absolute', top: '12%', left: '24%',
              padding: 9, maxWidth: 180, zIndex: 5,
              border: `1px solid ${theme === 'nebula' ? 'rgba(236,72,153,0.35)' : 'rgba(244,175,37,0.35)'}`,
              background: theme === 'nebula' ? 'rgba(15,23,42,0.85)' : 'rgba(255,255,255,0.55)'
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginBottom: 2 }}>
                <span style={{ width: 6, height: 6, borderRadius: 999, background: T.pink }} />
                <span style={{ fontSize: 10, fontWeight: 700, color: T.ink }}>Пік креативу</span>
                <span style={{ fontVariantNumeric: 'tabular-nums', fontSize: 9, color: T.inkMuted, marginLeft: 'auto' }}>10:24</span>
              </div>
              <p style={{ fontFamily: 'Playfair Display, serif', fontStyle: 'italic', fontSize: 10, color: T.inkMuted, lineHeight: 1.3, margin: 0 }}>
                "Висока кореляція тета-хвиль під час брейнштормінгу."
              </p>
            </div>

            <div style={{
              position: 'absolute', right: -2, top: '36%', transform: 'translate(100%, -50%)',
              padding: '2px 7px', borderRadius: 999,
              background: theme === 'nebula' ? `linear-gradient(135deg,${T.cyan},${T.primary})` : T.btnGrad,
              color: 'white', fontSize: 9, fontWeight: 700, letterSpacing: '0.12em',
              boxShadow: T.nowChipShadow
            }}>ЗАРАЗ</div>
          </div>

          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 9, fontWeight: 600, color: T.inkMuted, letterSpacing: '0.08em', marginTop: 6, paddingRight: 28 }}>
            <span>08:00</span><span>12:00</span><span>16:00</span><span>20:00</span><span>00:00</span><span>04:00</span><span style={{ color: T.cyan }}>NOW</span>
          </div>

          <div style={{ display: 'flex', gap: 14, marginTop: 8, fontSize: 10, color: T.inkMuted }}>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
              <span style={{ width: 12, height: 2, background: `linear-gradient(90deg,${T.primary},${T.pink})`, borderRadius: 1 }} />
              Настрій
            </span>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
              <span style={{ width: 12, height: 2, background: T.cyan, opacity: 0.6, borderRadius: 1 }} />
              HRV
            </span>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
              <span style={{ width: 10, height: 10, background: 'rgba(34,197,94,0.15)', borderRadius: 2, border: '1px solid rgba(34,197,94,0.4)' }} />
              Зона спокою
            </span>
            <span style={{ flex: 1 }} />
            <span style={{ fontFamily: 'JetBrains Mono, monospace' }}>sample · 1 Hz</span>
          </div>
        </div>

        {/* Focus Score */}
        <div style={{ ...glass, padding: 14, display: 'flex', alignItems: 'center', gap: 14 }}>
          <div style={{ position: 'relative', width: 70, height: 70, flexShrink: 0 }}>
            <svg viewBox="0 0 70 70" style={{ position: 'absolute', inset: 0 }}>
              <defs>
                <linearGradient id="nbFocus" x1="0" y1="0" x2="1" y2="1">
                  <stop offset="0%" stopColor={T.primary} /><stop offset="100%" stopColor={T.pink} />
                </linearGradient>
              </defs>
              <circle cx="35" cy="35" r="28" fill="none" stroke={theme === 'nebula' ? 'rgba(59,130,246,0.18)' : 'rgba(244,175,37,0.15)'} strokeWidth="5" />
              <circle cx="35" cy="35" r="28" fill="none"
                stroke="url(#nbFocus)" strokeWidth="5" strokeLinecap="round"
                strokeDasharray={`${2 * Math.PI * 28 * 0.85} ${2 * Math.PI * 28}`}
                transform="rotate(-90 35 35)" />
            </svg>
            <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <Icon name="donut_large" size={20} style={{ color: T.primary }} fill={1} />
            </div>
          </div>

          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: T.ink }}>Фокус-скор</div>
            <div style={{ fontFamily: 'Playfair Display, serif', fontStyle: 'italic', fontSize: 11, color: T.inkMuted }}>
              Топ-10% твого тижневого середнього
            </div>
            <div style={{ display: 'flex', gap: 2, marginTop: 5, height: 6, alignItems: 'flex-end' }}>
              {[3,4,5,6,5,7,8].map((h,i) => (
                <span key={i} style={{
                  width: 16, height: h,
                  background: i === 6 ? `linear-gradient(180deg,${T.primary},${T.pink})` : (theme === 'nebula' ? 'rgba(255,255,255,0.15)' : 'rgba(176,122,16,0.25)'),
                  borderRadius: 1
                }} />
              ))}
            </div>
          </div>

          <div style={{ textAlign: 'right' }}>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 2, justifyContent: 'flex-end' }}>
              <span style={{ fontVariantNumeric: 'tabular-nums', fontSize: 32, fontWeight: 200, color: T.ink, lineHeight: 1 }}>85</span>
              <span style={{ fontVariantNumeric: 'tabular-nums', fontSize: 14, color: T.inkMuted }}>/100</span>
            </div>
            <div style={{ fontSize: 10, fontWeight: 700, color: T.green, display: 'inline-flex', alignItems: 'center', gap: 3, marginTop: 2 }}>
              <Icon name="trending_up" size={11} />
              +12% vs учора
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

window.ScreenWellbeingNebula = ScreenWellbeingNebula;

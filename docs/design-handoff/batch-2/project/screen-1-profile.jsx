// Screen 1 — ProfileSelector — distinctive: animated sunrise sky + parallax operator gallery
// Unique: Each operator avatar is a generative gradient mandala, background is a sunrise horizon
// with rolling animated clouds, and selection creates a real "halo" of light beams.

const operators = [
  { id: 'phantom', name: 'phantom', role: 'ROOT',     g: ['#f4af25','#fb923c','#d97706'], glyph: '◉', sigil: 'PH', stamp: '01', last: 'now' },
  { id: 'alex',    name: 'alex',    role: 'OPERATOR', g: ['#fbcfb1','#f59e7c','#e2723f'], glyph: '◐', sigil: 'AX', stamp: '02', last: '14h ago' },
  { id: 'lena',    name: 'lena',    role: 'OPERATOR', g: ['#f4d35e','#e2a13b','#a86b1c'], glyph: '✦', sigil: 'LN', stamp: '03', last: '2d ago' },
  { id: 'mira',    name: 'mira',    role: 'OPERATOR', g: ['#ecd9b6','#c79760','#8a5d2f'], glyph: '❋', sigil: 'MR', stamp: '04', last: '3d ago' },
  { id: 'kai',     name: 'kai',     role: 'GUEST',    g: ['#fef3d6','#dba94e','#b07a10'], glyph: '◇', sigil: 'KI', stamp: '05', last: '1w ago' },
  { id: 'theo',    name: 'theo',    role: 'GUEST',    g: ['#fda985','#f4af25','#c2410c'], glyph: '⌖', sigil: 'TH', stamp: '06', last: 'never' },
];

// generative mandala avatar
const Mandala = ({ g, glyph, active }) => (
  <svg viewBox="0 0 100 100" style={{ width: '100%', height: '100%', display: 'block' }}>
    <defs>
      <radialGradient id={`mg-${g.join('')}`} cx="35%" cy="30%">
        <stop offset="0%" stopColor="#fff" stopOpacity="0.9" />
        <stop offset="40%" stopColor={g[0]} />
        <stop offset="80%" stopColor={g[1]} />
        <stop offset="100%" stopColor={g[2]} />
      </radialGradient>
      <linearGradient id={`mr-${g.join('')}`} x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stopColor={g[1]} />
        <stop offset="100%" stopColor={g[2]} />
      </linearGradient>
    </defs>
    <rect width="100" height="100" fill={`url(#mg-${g.join('')})`} />
    {/* concentric rings */}
    {[44, 36, 28, 20].map((r, i) => (
      <circle key={i} cx="50" cy="50" r={r}
        fill="none"
        stroke="rgba(255,255,255,0.18)"
        strokeWidth="0.5"
        strokeDasharray={i % 2 ? '2 3' : ''} />
    ))}
    {/* petals */}
    {[0,1,2,3,4,5,6,7].map(i => (
      <ellipse key={i}
        cx="50" cy="22"
        rx="3" ry="14"
        fill="rgba(255,255,255,0.18)"
        transform={`rotate(${i*45} 50 50)`} />
    ))}
    {/* glyph */}
    <text x="50" y="58" textAnchor="middle"
      fill="rgba(255,255,255,0.85)"
      fontSize="22"
      fontFamily="serif"
      fontStyle="italic">{glyph}</text>
    {active && (
      <circle cx="50" cy="50" r="48" fill="none" stroke="rgba(255,255,255,0.5)" strokeWidth="1" />
    )}
  </svg>
);

const OperatorCard = ({ op, idx }) => (
  <div
    className="lift"
    style={{
      width: 152, height: 224,
      borderRadius: 20,
      overflow: 'hidden',
      position: 'relative',
      cursor: 'pointer',
      background: op.active ? 'rgba(255,255,255,0.7)' : 'rgba(255,255,255,0.5)',
      backdropFilter: 'blur(14px)',
      border: op.id === 'phantom' ? '1.5px solid rgba(244,175,37,0.7)' : '1px solid rgba(255,255,255,0.55)',
      boxShadow: op.id === 'phantom'
        ? '0 0 0 5px rgba(244,175,37,0.15), 0 0 30px 6px rgba(244,175,37,0.32), 0 14px 38px rgba(120,70,10,0.14)'
        : '0 8px 24px rgba(120,70,10,0.08)',
      display: 'flex', flexDirection: 'column'
    }}
  >
    {/* mandala */}
    <div style={{ height: 160, position: 'relative' }}>
      <Mandala g={op.g} glyph={op.glyph} active={op.id === 'phantom'} />
      {/* sigil badge */}
      <div className="mono" style={{
        position: 'absolute', top: 10, left: 10,
        fontSize: 9, fontWeight: 600,
        padding: '3px 7px', borderRadius: 6,
        background: 'rgba(0,0,0,0.18)',
        color: 'rgba(255,255,255,0.95)',
        backdropFilter: 'blur(6px)',
        letterSpacing: '0.1em'
      }}>{op.sigil}·{op.stamp}</div>
      {op.id === 'phantom' && (
        <div style={{
          position: 'absolute', top: 10, right: 10,
          fontSize: 9, fontWeight: 700,
          padding: '3px 8px', borderRadius: 999,
          background: 'rgba(255,255,255,0.85)',
          color: '#b07a10', letterSpacing: '0.14em'
        }}>● ACTIVE</div>
      )}
    </div>
    {/* meta */}
    <div style={{ padding: '8px 12px 10px', textAlign: 'left' }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
        <div style={{ fontSize: 16, fontWeight: 500, letterSpacing: '-0.01em' }}>{op.name}</div>
        <div style={{ fontSize: 9, color: 'var(--ink-muted)' }}>{op.last}</div>
      </div>
      <div style={{
        fontSize: 9, fontWeight: 700, letterSpacing: '0.18em',
        color: op.id === 'phantom' ? '#b07a10' : 'var(--ink-muted)',
        marginTop: 2
      }}>{op.role}</div>
    </div>
  </div>
);

const ScreenProfileSelector = () => (
  <div className="phantom-frame" style={{ padding: 0 }}>
    {/* === ANIMATED SUNRISE HORIZON === */}
    <svg viewBox="0 0 1024 600" preserveAspectRatio="none" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', zIndex: 0 }}>
      <defs>
        <radialGradient id="sunRise" cx="50%" cy="48%" r="40%">
          <stop offset="0%" stopColor="#fff8e0" />
          <stop offset="40%" stopColor="#f4af25" />
          <stop offset="70%" stopColor="#fb923c" stopOpacity="0.6" />
          <stop offset="100%" stopColor="#fb923c" stopOpacity="0" />
        </radialGradient>
        <linearGradient id="skyFade" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor="#fde9b8" />
          <stop offset="60%" stopColor="#f8f7f5" />
        </linearGradient>
      </defs>
      {/* sky */}
      <rect width="1024" height="600" fill="url(#skyFade)" />
      {/* sun */}
      <circle cx="512" cy="280" r="220" fill="url(#sunRise)" style={{ animation: 'orb-breathe 7s ease-in-out infinite' }} />
      {/* light rays */}
      <g opacity="0.18" style={{ animation: 'orb-breathe 9s ease-in-out infinite' }}>
        {Array.from({ length: 16 }).map((_, i) => (
          <line key={i}
            x1="512" y1="280"
            x2={512 + Math.cos(i * Math.PI / 8) * 600}
            y2={280 + Math.sin(i * Math.PI / 8) * 600}
            stroke="#f4af25" strokeWidth="1.2" />
        ))}
      </g>
      {/* horizon line */}
      <line x1="0" y1="380" x2="1024" y2="380" stroke="rgba(176,122,16,0.25)" strokeDasharray="3 6" />
      {/* cloud silhouettes */}
      <g opacity="0.55" fill="rgba(255,255,255,0.7)">
        <ellipse cx="160" cy="200" rx="80" ry="10" />
        <ellipse cx="780" cy="180" rx="100" ry="8" />
        <ellipse cx="900" cy="250" rx="60" ry="6" />
        <ellipse cx="120" cy="260" rx="40" ry="5" />
      </g>
    </svg>

    {/* === HEADER ROW === */}
    <div style={{ position: 'absolute', top: 22, left: 28, right: 28, zIndex: 3, display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
      <div>
        <div className="eyebrow">PHANTOM OS · 06 OPERATORS KNOWN</div>
        <h1 style={{ margin: '6px 0 0', fontSize: 38, fontWeight: 200, letterSpacing: '-0.025em', color: 'var(--ink)' }}>
          Оберіть оператора
        </h1>
        <div className="playfair" style={{ fontSize: 14, color: 'var(--ink-secondary)', marginTop: 2 }}>
          The day begins when you do.
        </div>
      </div>
      <div style={{ textAlign: 'right' }}>
        <div className="tabular" style={{ fontSize: 36, fontWeight: 200, letterSpacing: '-0.03em', lineHeight: 1 }}>07:14</div>
        <div className="micro-label" style={{ marginTop: 4 }}>пт · 17 травня · схід 05:42</div>
        <div className="sub-glass" style={{ marginTop: 6, padding: '4px 10px', display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12 }}>
          <Icon name="wb_sunny" size={14} style={{ color: '#b07a10' }} fill={1} />
          <span className="tabular">18°C</span>
          <span style={{ color: 'var(--ink-muted)', fontSize: 10 }}>· clear</span>
        </div>
      </div>
    </div>

    {/* === HORIZON DECK / OPERATOR GALLERY === */}
    <div style={{
      position: 'absolute', top: 178, left: '50%', transform: 'translateX(-50%)',
      display: 'flex', gap: 14, zIndex: 3
    }}>
      {operators.map((op, i) => <OperatorCard key={op.id} op={op} idx={i} />)}
    </div>

    {/* glow under selected card */}
    <div style={{
      position: 'absolute', top: 384, left: 'calc(50% - 415px)',
      width: 152, height: 30,
      background: 'radial-gradient(ellipse, rgba(244,175,37,0.4), transparent 70%)',
      filter: 'blur(8px)',
      zIndex: 2
    }} />

    {/* === FOOTER ROW === */}
    <div style={{
      position: 'absolute', bottom: 56, left: 28, right: 28, zIndex: 3,
      display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12
    }}>
      <button style={{
        display: 'inline-flex', alignItems: 'center', gap: 8,
        padding: '10px 16px', borderRadius: 999,
        background: 'rgba(255,255,255,0.4)',
        border: '1.5px dashed rgba(244,175,37,0.55)',
        color: '#8a5e0a', fontSize: 12, fontWeight: 600,
        letterSpacing: '0.04em', cursor: 'pointer',
        backdropFilter: 'blur(10px)'
      }}>
        <Icon name="add" size={14} />
        Add operator
      </button>

      {/* voice command pill — wide */}
      <div className="glass-strong" style={{
        padding: '8px 8px 8px 16px',
        display: 'flex', alignItems: 'center', gap: 12,
        borderRadius: 999, minWidth: 360
      }}>
        {/* voice waveform */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 2, height: 22 }}>
          {[6,12,18,10,16,8,14,20,12,8].map((h,i) => (
            <span key={i} style={{
              width: 2, height: h, borderRadius: 1,
              background: 'linear-gradient(180deg,#f4af25,#fb923c)',
              opacity: 0.4 + (i % 3) * 0.2,
              animation: `orb-breathe ${1.2 + i*0.1}s ease-in-out infinite`
            }} />
          ))}
        </div>
        <span className="playfair" style={{ flex: 1, fontSize: 13, color: 'var(--ink-secondary)' }}>
          Тапніть, або скажіть «Я Алекс»
        </span>
        <button style={{
          width: 38, height: 38, borderRadius: 999,
          background: 'linear-gradient(135deg,#f4af25,#fb923c)',
          border: 'none', cursor: 'pointer', color: 'white',
          boxShadow: '0 4px 14px rgba(244,175,37,0.5)'
        }}>
          <Icon name="mic" size={16} fill={1} />
        </button>
      </div>
    </div>

    {/* footer micro */}
    <div style={{ position: 'absolute', bottom: 18, left: 0, right: 0, textAlign: 'center', zIndex: 3 }}>
      <div className="micro-label">PHANTOM OS · v0.4.1 · sunrise build · trust-circle private</div>
    </div>
  </div>
);

window.ScreenProfileSelector = ScreenProfileSelector;

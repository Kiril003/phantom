// PHANTOM bundle

;(function(){
// PHANTOM theme tokens — sunrise-warm + amber-night
// State accents apply on top via LocalStateAccent equivalent

const PHANTOM_THEMES = {
  sunrise: {
    id: 'sunrise-warm',
    primary:     '#F4AF25',
    primarySoft: '#FBC66A',
    primaryDeep: '#B07A10',
    coral:       '#EF4444',
    coralDeep:   '#B9201F',
    surfaceBase: '#F8F7F5',
    surfaceDeep: '#F5F1EA',
    surfaceTint: '#EFE6D4',
    glassPanel:  'rgba(255,255,255,0.60)',
    glassCard:   'rgba(255,255,255,0.72)',
    glassElevated: 'rgba(255,255,255,0.82)',
    glassBorder: 'rgba(176, 122, 16, 0.18)',
    glassHL:     'rgba(255,255,255,0.9)',
    glowPrimary: 'rgba(244,175,37,0.30)',
    ink:         '#2A1F10',
    ink2:        '#6A5A44',
    ink3:        '#9A8A6F',
    bgGradient: `radial-gradient(120% 80% at 30% 0%, #FFE7B0 0%, #F8E9CD 35%, #F5F1EA 70%, #ECE2CB 100%)`,
    isDark: false,
  },
  amber: {
    id: 'amber-night',
    primary:     '#F4AF25',
    primarySoft: '#FBC66A',
    primaryDeep: '#FFC34A',
    coral:       '#E35858',
    coralDeep:   '#7F1D1D',
    surfaceBase: '#0E0A05',
    surfaceDeep: '#080502',
    surfaceTint: '#1A1208',
    glassPanel:  'rgba(20,15,8,0.65)',
    glassCard:   'rgba(28,21,11,0.72)',
    glassElevated: 'rgba(36,27,14,0.82)',
    glassBorder: 'rgba(244,175,37,0.22)',
    glassHL:     'rgba(255,210,120,0.18)',
    glowPrimary: 'rgba(244,175,37,0.45)',
    ink:         '#F6E8C8',
    ink2:        '#B8A47C',
    ink3:        '#7A6B4D',
    bgGradient: `radial-gradient(110% 70% at 50% -10%, #2A1A06 0%, #160E04 45%, #0A0602 100%)`,
    isDark: true,
  },
};

// SystemState → state accent + motion + opacity
const PHANTOM_STATES = {
  SHADOW:   { label: 'SHADOW',   accentLight: '#8A7F72', accentDark: '#9C8E78', motionScale: 0.6, uiOpacity: 0.92, glyph: '◐' },
  FOCUS:    { label: 'FOCUS',    accentLight: '#B07A10', accentDark: '#F4AF25', motionScale: 1.0, uiOpacity: 1.00, glyph: '◉' },
  DIALOGUE: { label: 'DIALOGUE', accentLight: '#B07A10', accentDark: '#F4AF25', motionScale: 1.1, uiOpacity: 1.00, glyph: '◉' },
  SENTINEL: { label: 'SENTINEL', accentLight: '#B9201F', accentDark: '#E35858', motionScale: 1.3, uiOpacity: 1.00, glyph: '⚠' },
  GHOST:    { label: 'GHOST',    accentLight: '#16A34A', accentDark: '#16A34A', motionScale: 0.8, uiOpacity: 0.90, glyph: '◇' },
  DREAM:    { label: 'DREAM',    accentLight: '#B07A10', accentDark: '#F4AF25', motionScale: 0.4, uiOpacity: 0.75, glyph: '☾' },
};

function getStateAccent(stateKey, theme) {
  const s = PHANTOM_STATES[stateKey] || PHANTOM_STATES.FOCUS;
  return {
    ...s,
    accent: theme.isDark ? s.accentDark : s.accentLight,
  };
}

window.PHANTOM_THEMES = PHANTOM_THEMES;
window.PHANTOM_STATES = PHANTOM_STATES;
window.getStateAccent = getStateAccent;

})();

;(function(){
// PHANTOM core components: GlassCard, OrbView, FamiliarCanvas, PttButton, StatePill, VitalsRow

const { useState, useEffect, useRef, useMemo } = React;

// ─── GlassCard ──────────────────────────────────────────────
function GlassCard({ level = 'panel', accentBorder = false, accent, theme, style = {}, children, onClick }) {
  const t = theme;
  const bg = {
    subtle:   t.glassPanel,
    panel:    t.glassPanel,
    card:     t.glassCard,
    elevated: t.glassElevated,
  }[level];
  const blur = {
    subtle: 12, panel: 12, card: 24, elevated: 32,
  }[level];
  return (
    <div
      onClick={onClick}
      style={{
        position: 'relative',
        background: bg,
        backdropFilter: `blur(${blur}px) saturate(1.1)`,
        WebkitBackdropFilter: `blur(${blur}px) saturate(1.1)`,
        border: `1px solid ${t.glassBorder}`,
        borderRadius: 20,
        overflow: 'hidden',
        boxShadow: t.isDark
          ? `0 8px 24px rgba(0,0,0,0.45), inset 0 1px 0 ${t.glassHL}`
          : `0 8px 24px rgba(120,80,10,0.08), inset 0 1px 0 ${t.glassHL}`,
        ...style,
      }}
    >
      {accentBorder && (
        <div style={{
          position: 'absolute', top: 0, left: 12, right: 12, height: 1,
          background: `linear-gradient(90deg, transparent, ${accent || t.primary}, transparent)`,
        }} />
      )}
      {children}
    </div>
  );
}

// ─── OrbView ─────────────────────────────────────────────────
function OrbView({ accent, theme, motionScale = 1, audioLevel = 0, size = 240, ringCount = 1, intensity = 1 }) {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let raf;
    const start = performance.now();
    const loop = (t) => {
      setTick((t - start) / 1000);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);
  const period = 2 / motionScale;
  const breath = 1 + 0.05 * Math.sin((tick / period) * Math.PI * 2);
  const audioPulse = 1 + audioLevel * 0.18;

  // hex to rgb for radial-gradient stops
  const hexToRgb = (hex) => {
    const h = hex.replace('#', '');
    const n = parseInt(h.length === 3 ? h.split('').map(c=>c+c).join('') : h, 16);
    return [n >> 16 & 255, n >> 8 & 255, n & 255];
  };
  const [r,g,b] = hexToRgb(accent);

  const orbStyle = {
    width: size, height: size, borderRadius: '50%',
    transform: `scale(${breath * audioPulse})`,
    transition: 'transform 50ms linear',
    background: `
      radial-gradient(circle at 35% 30%, rgba(255,255,255,${theme.isDark ? 0.35 : 0.65}) 0%, rgba(255,255,255,0) 35%),
      radial-gradient(circle at 50% 55%, rgba(${r},${g},${b},0.95) 0%, rgba(${r},${g},${b},0.55) 35%, rgba(${r},${g},${b},0.18) 65%, rgba(${r},${g},${b},0.0) 80%)
    `,
    filter: `drop-shadow(0 0 ${30 * intensity}px rgba(${r},${g},${b},${theme.isDark ? 0.6 : 0.45}))`,
    position: 'relative',
  };
  const innerCore = {
    position: 'absolute', inset: '20%',
    borderRadius: '50%',
    background: `radial-gradient(circle at 40% 35%, rgba(255,255,255,${theme.isDark ? 0.5 : 0.85}) 0%, rgba(${r},${g},${b},0.4) 40%, rgba(${r},${g},${b},0.0) 75%)`,
    mixBlendMode: theme.isDark ? 'screen' : 'normal',
  };
  return (
    <div style={{ position: 'relative', width: size, height: size, display:'flex', alignItems:'center', justifyContent:'center' }}>
      {Array.from({length: ringCount}).map((_,i) => {
        const phase = (tick / (1.2 / motionScale)) * Math.PI * 2 - i * 0.8;
        const ringScale = 1 + 0.15 * (0.5 + 0.5 * Math.sin(phase)) + audioLevel * 0.1;
        return (
          <div key={i} style={{
            position: 'absolute',
            width: size * 0.95, height: size * 0.95, borderRadius: '50%',
            border: `1px solid rgba(${r},${g},${b},${0.35 - i*0.1})`,
            transform: `scale(${ringScale})`,
            opacity: 1 - i * 0.3,
          }} />
        );
      })}
      <div style={orbStyle}>
        <div style={innerCore} />
      </div>
    </div>
  );
}

// ─── FamiliarCanvas (placeholder companion glyph) ────────────
function FamiliarCanvas({ pose = 'Idle', mood = 'Neutral', accent, theme, size = 96 }) {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let raf;
    const start = performance.now();
    const loop = (t) => { setTick((t - start) / 1000); raf = requestAnimationFrame(loop); };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);

  const float = Math.sin(tick * 1.0) * 4;
  const tilt = pose === 'Pointing' ? 12 : pose === 'Waving' ? -8 : Math.sin(tick * 0.7) * 3;
  const scale = (pose === 'Pointing' || pose === 'Waving') ? 1.3 : 1;
  const sleeping = pose === 'Sleeping';
  const opacity = pose === 'Vanishing' ? 0.4 : sleeping ? 0.7 : 1;

  // hex → rgb
  const h = accent.replace('#','');
  const n = parseInt(h.length===3?h.split('').map(c=>c+c).join(''):h,16);
  const r = n>>16&255, g=n>>8&255, b=n&255;
  const w = size, ht = size * 1.375; // 96 × 132 ratio

  return (
    <div style={{
      width: w * scale, height: ht * scale,
      transform: `translateY(${float}px) rotate(${tilt}deg)`,
      transition: 'transform 80ms linear',
      opacity,
      position: 'relative',
    }}>
      <svg width={w*scale} height={ht*scale} viewBox="0 0 96 132" style={{ overflow: 'visible' }}>
        <defs>
          <radialGradient id={`fbody-${accent}`} cx="40%" cy="35%">
            <stop offset="0%" stopColor={`rgba(255,255,255,${theme.isDark?0.4:0.85})`} />
            <stop offset="40%" stopColor={`rgba(${r},${g},${b},0.8)`} />
            <stop offset="100%" stopColor={`rgba(${r},${g},${b},0.15)`} />
          </radialGradient>
          <filter id={`fglow-${accent}`} x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="3" />
          </filter>
        </defs>
        {/* tail/wisp */}
        <path
          d={`M 48 96 Q ${48 + Math.sin(tick*2)*10} 108 ${48 + Math.sin(tick*2.3)*16} 124`}
          stroke={`rgba(${r},${g},${b},0.5)`} strokeWidth="6" fill="none" strokeLinecap="round"
          filter={`url(#fglow-${accent})`}
        />
        {/* body — teardrop */}
        <ellipse cx="48" cy="56" rx="32" ry="38" fill={`url(#fbody-${accent})`} filter={`url(#fglow-${accent})`} />
        {/* core */}
        <ellipse cx="48" cy="52" rx="20" ry="24" fill={`rgba(255,255,255,${theme.isDark?0.18:0.55})`} />
        {/* eyes */}
        {sleeping ? (
          <>
            <path d="M 38 54 Q 42 51 46 54" stroke={theme.ink} strokeWidth="1.6" fill="none" strokeLinecap="round" />
            <path d="M 50 54 Q 54 51 58 54" stroke={theme.ink} strokeWidth="1.6" fill="none" strokeLinecap="round" />
          </>
        ) : (
          <>
            <ellipse cx="42" cy="52" rx="2.2" ry={pose==='Peeking'?1:2.6} fill={theme.ink} />
            <ellipse cx="54" cy="52" rx="2.2" ry={pose==='Peeking'?1:2.6} fill={theme.ink} />
          </>
        )}
        {/* mouth — varies */}
        {mood === 'Alert' && <path d="M 42 64 Q 48 58 54 64" stroke={theme.ink} strokeWidth="1.6" fill="none" strokeLinecap="round" />}
        {mood === 'Neutral' && <line x1="44" y1="62" x2="52" y2="62" stroke={theme.ink} strokeWidth="1.6" strokeLinecap="round" />}
        {mood === 'Happy' && <path d="M 42 60 Q 48 66 54 60" stroke={theme.ink} strokeWidth="1.6" fill="none" strokeLinecap="round" />}
        {/* pointing arm */}
        {pose === 'Pointing' && (
          <g transform="translate(70,60) rotate(20)">
            <rect x="0" y="-3" width="22" height="6" rx="3" fill={`rgba(${r},${g},${b},0.85)`} />
            <circle cx="22" cy="0" r="4" fill={`rgba(${r},${g},${b},0.95)`} />
          </g>
        )}
        {/* waving arm */}
        {pose === 'Waving' && (
          <g transform={`translate(72,48) rotate(${-20 + Math.sin(tick*4)*30})`}>
            <rect x="0" y="-3" width="20" height="6" rx="3" fill={`rgba(${r},${g},${b},0.85)`} />
            <circle cx="20" cy="0" r="5" fill={`rgba(${r},${g},${b},0.95)`} />
          </g>
        )}
      </svg>
    </div>
  );
}

// ─── PttButton ───────────────────────────────────────────────
function PttButton({ state = 'Idle', audioLevel = 0, accent, theme }) {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let raf;
    const start = performance.now();
    const loop = (t) => { setTick((t - start) / 1000); raf = requestAnimationFrame(loop); };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);
  const h = accent.replace('#','');
  const n = parseInt(h.length===3?h.split('').map(c=>c+c).join(''):h,16);
  const r = n>>16&255, g=n>>8&255, b=n&255;
  const ringScale = state === 'Capturing' ? 1 + audioLevel * 0.4 : 1;
  const pulseAlpha = state === 'AwaitingFinal' ? 0.4 + 0.6 * (0.5 + 0.5*Math.sin(tick * (Math.PI*2/0.6))) : 1;
  const rotation = state === 'Speaking' ? (tick / 4) * 360 : 0;
  return (
    <div style={{ position: 'relative', width: 96, height: 96 }}>
      {/* outer ring(s) */}
      <div style={{
        position: 'absolute', inset: -8, borderRadius: '50%',
        border: `2px solid rgba(${r},${g},${b},0.35)`,
        transform: `scale(${ringScale})`,
        transition: 'transform 60ms linear',
      }} />
      <div style={{
        position: 'absolute', inset: -16, borderRadius: '50%',
        border: `1px dashed rgba(${r},${g},${b},0.25)`,
        transform: `rotate(${rotation}deg)`,
      }} />
      {/* main */}
      <div style={{
        position: 'absolute', inset: 0, borderRadius: '50%',
        background: `radial-gradient(circle at 35% 30%, rgba(255,255,255,${theme.isDark?0.4:0.7}), rgba(${r},${g},${b},0.95) 60%, rgba(${r},${g},${b},0.7))`,
        boxShadow: `0 0 28px rgba(${r},${g},${b},0.55), inset 0 -8px 18px rgba(0,0,0,0.18)`,
        opacity: pulseAlpha,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
        <div style={{
          width: 18, height: 18, borderRadius: 4,
          background: theme.isDark ? '#1c1408' : 'rgba(255,255,255,0.92)',
          boxShadow: `inset 0 0 4px rgba(0,0,0,0.2)`,
        }} />
      </div>
    </div>
  );
}

// ─── StatePill ──────────────────────────────────────────────
function StatePill({ stateKey, accent, theme, sub, expanded = false, style = {} }) {
  const s = window.PHANTOM_STATES[stateKey];
  return (
    <div style={{
      display: 'inline-flex', alignItems: 'center', gap: 10,
      padding: expanded ? '12px 16px' : '6px 12px',
      borderRadius: 999,
      background: theme.isDark ? 'rgba(244,175,37,0.08)' : 'rgba(176,122,16,0.06)',
      border: `1px solid ${accent}33`,
      ...style,
    }}>
      <span style={{
        width: 8, height: 8, borderRadius: '50%',
        background: accent,
        boxShadow: `0 0 8px ${accent}`,
      }} />
      <span style={{
        fontFamily: 'var(--mono)', fontSize: 11, fontWeight: 600,
        letterSpacing: '0.18em', color: accent,
      }}>{s.label}</span>
      {sub && (
        <>
          <span style={{ color: theme.ink3, fontSize: 11 }}>·</span>
          <span style={{ fontSize: 12, color: theme.ink2, fontWeight: 500 }}>{sub}</span>
        </>
      )}
      {expanded && (
        <span style={{ marginLeft: 'auto', color: theme.ink2, fontSize: 12 }}>▾</span>
      )}
    </div>
  );
}

// ─── VitalsRow ──────────────────────────────────────────────
function Sparkline({ data, color, w = 56, h = 18 }) {
  const pts = data.map((v, i) => `${(i/(data.length-1))*w},${h - v*h}`).join(' ');
  return (
    <svg width={w} height={h} style={{ display: 'block' }}>
      <polyline points={pts} fill="none" stroke={color} strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" opacity="0.85" />
    </svg>
  );
}

function VitalsRow({ theme, accent }) {
  const bpmData = [0.4, 0.5, 0.42, 0.6, 0.55, 0.7, 0.65, 0.58, 0.62];
  const brData = [0.3, 0.35, 0.32, 0.38, 0.4, 0.36, 0.42];
  const stData = [0.5, 0.45, 0.4, 0.42, 0.38, 0.35, 0.32];
  const cellStyle = {
    flex: 1,
    padding: '10px 12px',
    display: 'flex', flexDirection: 'column', gap: 4,
  };
  const labelStyle = {
    fontFamily: 'var(--mono)', fontSize: 9.5, letterSpacing: '0.2em',
    textTransform: 'uppercase', color: theme.ink3, fontWeight: 600,
  };
  const valStyle = (size = 22) => ({
    fontFamily: 'var(--mono)', fontSize: size, fontWeight: 600,
    color: theme.ink, lineHeight: 1, letterSpacing: '-0.02em',
  });
  return (
    <div style={{ display: 'flex', gap: 8 }}>
      <GlassCard level="subtle" theme={theme} style={cellStyle}>
        <div style={labelStyle}>BPM</div>
        <div style={{ display:'flex', alignItems:'baseline', gap: 6 }}>
          <span style={valStyle(24)}>72</span>
          <span style={{fontFamily:'var(--mono)', fontSize: 10, color: theme.ink3}}>↓ 4</span>
        </div>
        <Sparkline data={bpmData} color={accent} />
      </GlassCard>
      <GlassCard level="subtle" theme={theme} style={cellStyle}>
        <div style={labelStyle}>BREATH</div>
        <div style={{ display:'flex', alignItems:'baseline', gap: 6 }}>
          <span style={valStyle(24)}>14</span>
          <span style={{fontFamily:'var(--mono)', fontSize: 10, color: theme.ink3}}>/min</span>
        </div>
        <Sparkline data={brData} color={accent} />
      </GlassCard>
      <GlassCard level="subtle" theme={theme} style={cellStyle}>
        <div style={labelStyle}>STRESS</div>
        <div style={{ display:'flex', alignItems:'baseline', gap: 6 }}>
          <span style={valStyle(24)}>.32</span>
          <span style={{fontFamily:'var(--mono)', fontSize: 10, color: '#16A34A'}}>calm</span>
        </div>
        <Sparkline data={stData} color={accent} />
      </GlassCard>
    </div>
  );
}

// ─── BottomNav ──────────────────────────────────────────────
function BottomNav({ active, theme, accent }) {
  const tabs = [
    { id: 'pulse', label: 'Pulse', icon: '◉' },
    { id: 'voice', label: 'Voice', icon: '◐' },
    { id: 'map',   label: 'Map',   icon: '◇' },
    { id: 'comms', label: 'Comms', icon: '◔' },
    { id: 'vault', label: 'Vault', icon: '◈' },
  ];
  return (
    <div style={{ padding: '8px 12px 14px' }}>
      <GlassCard level="card" theme={theme} style={{
        display: 'flex', borderRadius: 28,
        padding: '8px 6px',
      }}>
        {tabs.map(t => {
          const isActive = t.id === active;
          return (
            <div key={t.id} style={{
              flex: 1, display: 'flex', flexDirection: 'column',
              alignItems: 'center', gap: 3,
              padding: '6px 0',
              position: 'relative',
            }}>
              {isActive && (
                <div style={{
                  position: 'absolute', top: 0, left: '20%', right: '20%', height: 2,
                  background: accent, borderRadius: 2,
                  boxShadow: `0 0 8px ${accent}`,
                }} />
              )}
              <div style={{
                fontSize: 16,
                color: isActive ? accent : theme.ink3,
                lineHeight: 1,
              }}>{t.icon}</div>
              <div style={{
                fontFamily: 'var(--mono)', fontSize: 9, letterSpacing: '0.15em',
                textTransform: 'uppercase', fontWeight: 600,
                color: isActive ? theme.ink : theme.ink3,
              }}>{t.label}</div>
            </div>
          );
        })}
      </GlassCard>
    </div>
  );
}

// ─── Phone shell — replaces android frame's Material chrome ─
function PhoneShell({ theme, children, statusOverlay }) {
  return (
    <div style={{
      width: 360, height: 740, borderRadius: 44,
      background: theme.isDark ? '#000' : '#1a1410',
      padding: 4,
      boxShadow: theme.isDark
        ? '0 30px 80px rgba(0,0,0,0.7), 0 0 0 1px rgba(244,175,37,0.15), inset 0 0 0 2px #2a1f10'
        : '0 30px 80px rgba(120,80,10,0.25), 0 0 0 1px rgba(0,0,0,0.1), inset 0 0 0 2px #0a0604',
      position: 'relative',
    }}>
      <div style={{
        width: '100%', height: '100%',
        borderRadius: 40, overflow: 'hidden',
        background: theme.bgGradient,
        position: 'relative',
        display: 'flex', flexDirection: 'column',
      }}>
        {/* status bar */}
        <div style={{
          height: 36, padding: '10px 22px 0',
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          fontFamily: 'var(--mono)', fontSize: 12, fontWeight: 600,
          color: theme.ink, flexShrink: 0,
          position: 'relative', zIndex: 2,
        }}>
          <span>9:41</span>
          {/* notch */}
          <div style={{
            position: 'absolute', top: 8, left: '50%', transform: 'translateX(-50%)',
            width: 92, height: 26, borderRadius: 16,
            background: theme.isDark ? '#000' : '#1a1410',
          }} />
          <div style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 11 }}>
            <span style={{ opacity: 0.8 }}>5G</span>
            <span style={{ opacity: 0.8 }}>▮▮▮</span>
            <span style={{ opacity: 0.8 }}>87%</span>
          </div>
        </div>
        {statusOverlay}
        <div className="ph-scroll" style={{ flex: 1, overflow: 'auto', position: 'relative', display: 'flex', flexDirection: 'column' }}>
          {children}
        </div>
      </div>
    </div>
  );
}

Object.assign(window, {
  GlassCard, OrbView, FamiliarCanvas, PttButton, StatePill, VitalsRow, Sparkline, BottomNav, PhoneShell,
});

})();

;(function(){
// PHANTOM screens — Pulse, Voice, Map, Comms, Vault, InCall

const { useState, useEffect, useRef, useMemo } = React;
const { GlassCard, OrbView, FamiliarCanvas, PttButton, StatePill, VitalsRow, BottomNav, PhoneShell, Sparkline } = window;

// ── 1. PULSE ────────────────────────────────────────────────
function PulseScreen({ theme, accent, stateKey, motionScale }) {
  return (
    <PhoneShell theme={theme}>
      <div style={{ flex: 1, padding: '12px 16px 0', display: 'flex', flexDirection: 'column', gap: 14 }}>
        <VitalsRow theme={theme} accent={accent} />

        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', position: 'relative', minHeight: 220 }}>
          <OrbView accent={accent} theme={theme} motionScale={motionScale} size={220} ringCount={2} />
          <div style={{
            position: 'absolute', bottom: -4, fontFamily: 'var(--mono)', fontSize: 10,
            letterSpacing: '0.2em', color: theme.ink3, textTransform: 'uppercase',
          }}>breathing · {stateKey.toLowerCase()}</div>
        </div>

        <GlassCard level="panel" theme={theme} accentBorder accent={accent} style={{ padding: '14px 16px' }}>
          <StatePill stateKey={stateKey} accent={accent} theme={theme} sub="2 standing orders" expanded
            style={{ width: '100%', borderRadius: 14, background: 'transparent', border: 'none', padding: 0 }} />
        </GlassCard>

        <GlassCard level="card" theme={theme} style={{ padding: '14px 16px' }}>
          <div style={{
            fontFamily: 'var(--mono)', fontSize: 10, letterSpacing: '0.22em',
            textTransform: 'uppercase', color: accent, fontWeight: 600, marginBottom: 8,
          }}>NEXT 1H</div>
          <div style={{
            fontFamily: 'var(--serif)', fontStyle: 'italic', fontSize: 16,
            lineHeight: 1.45, color: theme.ink, fontWeight: 500,
          }}>«Кнопка кави о 09:14 — BPM падає 12% за 18 хв, спіймати ранкове вікно.»</div>
          <div style={{ display:'flex', gap: 6, marginTop: 12 }}>
            {['snooze 30m', 'lock in', 'why?'].map((b,i) => (
              <div key={i} style={{
                padding: '6px 10px', borderRadius: 999,
                fontFamily: 'var(--mono)', fontSize: 10, fontWeight: 600,
                letterSpacing: '0.1em', textTransform: 'uppercase',
                background: i===1 ? accent : 'transparent',
                color: i===1 ? (theme.isDark?'#1a1208':'#fff') : theme.ink2,
                border: `1px solid ${i===1 ? accent : theme.glassBorder}`,
              }}>{b}</div>
            ))}
          </div>
        </GlassCard>
      </div>

      <div style={{ position: 'absolute', right: 14, bottom: 96, pointerEvents: 'none' }}>
        <FamiliarCanvas pose="Peeking" mood="Neutral" accent={accent} theme={theme} size={68} />
      </div>

      <BottomNav active="pulse" theme={theme} accent={accent} />
    </PhoneShell>
  );
}

// ── 2. VOICE ────────────────────────────────────────────────
function VoiceScreen({ theme, accent, stateKey, motionScale }) {
  const transcript = [
    { who: 'me',  txt: 'привіт фантом', t: '09:41:02' },
    { who: 'me',  txt: 'готова до запуску wardriving сесії?', t: '09:41:04' },
    { who: 'ai',  txt: 'Так. Радіус 800м, очікую 14 хв.', t: '09:41:05' },
    { who: 'me',  txt: 'добре, починаємо за 30 секунд', t: '09:41:08', latest: true },
  ];
  return (
    <PhoneShell theme={theme}>
      <div style={{ flex: 1, padding: '12px 18px 0', display: 'flex', flexDirection: 'column' }}>
        <div style={{ flex: '0 0 auto', minHeight: 130, display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', gap: 6 }}>
          {transcript.map((l, i) => (
            <div key={i} style={{
              fontFamily: l.who === 'ai' ? 'var(--serif)' : 'var(--mono)',
              fontStyle: l.who === 'ai' ? 'italic' : 'normal',
              fontSize: l.latest ? 15 : 13,
              fontWeight: l.latest ? 600 : 400,
              color: l.latest ? accent : (l.who === 'ai' ? theme.ink2 : theme.ink2),
              opacity: l.latest ? 1 : 0.55 + i*0.1,
              lineHeight: 1.35,
            }}>
              <span style={{ fontFamily: 'var(--mono)', fontSize: 9, opacity: 0.5, marginRight: 8 }}>{l.t}</span>
              {l.txt}
            </div>
          ))}
        </div>

        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', position: 'relative' }}>
          <OrbView accent={accent} theme={theme} motionScale={motionScale*1.1} size={200} ringCount={2} audioLevel={0.4} />
          <div style={{ position: 'absolute', bottom: 6, right: 30 }}>
            <FamiliarCanvas pose="Pointing" mood="Alert" accent={accent} theme={theme} size={70} />
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10, paddingBottom: 14 }}>
          <PttButton state="Capturing" audioLevel={0.5} accent={accent} theme={theme} />
          <div style={{
            fontFamily: 'var(--mono)', fontSize: 10, letterSpacing: '0.28em',
            textTransform: 'uppercase', color: theme.ink2, fontWeight: 600,
          }}>HOLD TO SPEAK · ↑ for chat</div>
        </div>
      </div>

      <BottomNav active="voice" theme={theme} accent={accent} />
    </PhoneShell>
  );
}

// ── 3. MAP ──────────────────────────────────────────────────
function MapScreen({ theme, accent, stateKey, motionScale }) {
  // tiled map illusion: layered radial blobs + grid + markers
  const isSentinel = stateKey === 'SENTINEL';
  const threats = [
    { t: 'PROXIMITY', d: '5m',   tag: 'unknown rider, NW', sev: 'high' },
    { t: 'UNKNOWN BSSID', d: '32m', tag: 'pineapple-like AP', sev: 'med' },
    { t: 'GEOFENCE EXIT', d: '12m', tag: 'left workshop zone', sev: 'low' },
  ];
  return (
    <PhoneShell theme={theme}>
      <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>
        {/* fake map */}
        <div style={{
          position: 'absolute', inset: 0,
          background: theme.isDark
            ? `linear-gradient(120deg, #0a0805 0%, #1a1308 100%)`
            : `linear-gradient(120deg, #ede5d2 0%, #d8cdb0 100%)`,
        }} />
        {/* grid */}
        <svg width="100%" height="100%" style={{ position: 'absolute', inset: 0, opacity: theme.isDark ? 0.18 : 0.25 }}>
          <defs>
            <pattern id="mapgrid" width="40" height="40" patternUnits="userSpaceOnUse">
              <path d="M 40 0 L 0 0 0 40" fill="none" stroke={theme.isDark ? '#3d2c14' : '#a89876'} strokeWidth="0.5" />
            </pattern>
          </defs>
          <rect width="100%" height="100%" fill="url(#mapgrid)" />
        </svg>
        {/* roads */}
        <svg width="100%" height="100%" style={{ position: 'absolute', inset: 0 }}>
          <path d="M -10 200 Q 80 180 180 220 T 380 250" stroke={theme.isDark?'#3d2c14':'#b8a987'} strokeWidth="6" fill="none" strokeLinecap="round" opacity="0.6"/>
          <path d="M 60 0 Q 80 180 140 320 T 200 740" stroke={theme.isDark?'#3d2c14':'#b8a987'} strokeWidth="4" fill="none" strokeLinecap="round" opacity="0.5"/>
          <path d="M 240 0 L 260 740" stroke={theme.isDark?'#3d2c14':'#b8a987'} strokeWidth="3" fill="none" opacity="0.4"/>
        </svg>
        {/* heatmap blobs */}
        <div style={{
          position: 'absolute', left: 80, top: 220, width: 120, height: 120, borderRadius: '50%',
          background: `radial-gradient(circle, ${accent}66 0%, ${accent}22 40%, transparent 70%)`,
          filter: 'blur(8px)',
        }} />
        <div style={{
          position: 'absolute', left: 200, top: 320, width: 80, height: 80, borderRadius: '50%',
          background: `radial-gradient(circle, ${accent}88 0%, ${accent}33 40%, transparent 70%)`,
          filter: 'blur(6px)',
        }} />
        {/* user pulse marker */}
        <div style={{ position: 'absolute', left: '46%', top: '42%' }}>
          <div style={{ position: 'absolute', width: 60, height: 60, borderRadius: '50%', border: `2px solid ${accent}`, opacity: 0.4, transform: 'translate(-50%,-50%)', animation: 'none' }} />
          <div style={{ width: 14, height: 14, borderRadius: '50%', background: accent, boxShadow: `0 0 16px ${accent}`, transform: 'translate(-50%,-50%)' }} />
        </div>
        {/* threat pins (sentinel) */}
        {isSentinel && (
          <>
            <ThreatPin x="36%" y="33%" accent={theme.coral} />
            <ThreatPin x="60%" y="48%" accent={theme.coral} />
            <ThreatPin x="42%" y="55%" accent={theme.coral} />
          </>
        )}
      </div>

      <div style={{ flex: 1, padding: '8px 12px', display: 'flex', flexDirection: 'column', position: 'relative', zIndex: 1 }}>
        {/* Layer pills */}
        <GlassCard level="subtle" theme={theme} style={{ padding: 4, display: 'flex', borderRadius: 999 }}>
          {['Wardrive','POIs','Heatmap','GPS'].map((l, i) => (
            <div key={l} style={{
              flex: 1, padding: '8px 0', textAlign: 'center',
              fontFamily: 'var(--mono)', fontSize: 10, letterSpacing: '0.14em',
              fontWeight: 600, textTransform: 'uppercase',
              borderRadius: 999,
              background: i===0 ? accent : 'transparent',
              color: i===0 ? (theme.isDark?'#1a1208':'#fff') : theme.ink2,
            }}>{l}</div>
          ))}
        </GlassCard>

        <div style={{ flex: 1 }} />

        {/* AR FAB */}
        <div style={{ position: 'absolute', right: 16, bottom: 240 }}>
          <GlassCard level="elevated" theme={theme} style={{
            width: 52, height: 52, borderRadius: 18,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <div style={{ fontFamily: 'var(--mono)', fontSize: 11, fontWeight: 700, color: accent, letterSpacing: '0.1em' }}>AR</div>
          </GlassCard>
        </div>

        {/* threats sheet */}
        <GlassCard level="elevated" theme={theme} accentBorder accent={isSentinel ? theme.coral : accent} style={{ padding: '14px 14px 8px', borderRadius: 28 }}>
          <div style={{ width: 36, height: 4, borderRadius: 2, background: theme.ink3, margin: '0 auto 12px', opacity: 0.4 }} />
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 8 }}>
            <div style={{ fontFamily: 'var(--mono)', fontSize: 10, fontWeight: 700, letterSpacing: '0.22em', color: isSentinel ? theme.coral : theme.ink, textTransform: 'uppercase' }}>
              Threats
            </div>
            <div style={{ fontFamily: 'var(--mono)', fontSize: 10, color: theme.ink3 }}>· {threats.length}</div>
            <div style={{ marginLeft: 'auto', fontFamily: 'var(--mono)', fontSize: 10, color: theme.ink3 }}>radius 800m</div>
          </div>
          {threats.map((th, i) => (
            <div key={i} style={{
              display: 'flex', alignItems: 'center', gap: 10,
              padding: '10px 0',
              borderTop: i>0 ? `1px solid ${theme.glassBorder}` : 'none',
            }}>
              <div style={{
                width: 3, alignSelf: 'stretch', borderRadius: 2,
                background: isSentinel ? theme.coral : accent,
              }} />
              <div style={{ flex: 1 }}>
                <div style={{ fontFamily: 'var(--mono)', fontSize: 11, fontWeight: 700, color: theme.ink, letterSpacing: '0.1em' }}>
                  {th.t} <span style={{ color: theme.ink3, fontWeight: 500 }}>· {th.d}</span>
                </div>
                <div style={{ fontSize: 12, color: theme.ink2, marginTop: 2 }}>{th.tag}</div>
              </div>
              <div style={{ color: theme.ink3, fontSize: 14 }}>›</div>
            </div>
          ))}
        </GlassCard>
      </div>

      <BottomNav active="map" theme={theme} accent={accent} />
    </PhoneShell>
  );
}

function ThreatPin({ x, y, accent }) {
  return (
    <div style={{ position: 'absolute', left: x, top: y, transform: 'translate(-50%,-100%)' }}>
      <div style={{
        width: 24, height: 24, borderRadius: '50% 50% 50% 0',
        transform: 'rotate(-45deg)',
        background: accent,
        boxShadow: `0 4px 10px ${accent}66`,
      }} />
    </div>
  );
}

// ── 4. COMMS ────────────────────────────────────────────────
function CommsScreen({ theme, accent, stateKey, motionScale }) {
  const tabs = ['CALL','SMS','PHANTOM','TG/SIG/WA'];
  const [activeTab, setTab] = useState(0);
  const rows = [
    { kind:'call', name:'Олег К.', time:'10:42', dur:'4:18', last:'«поговорили…»', ai:'узгодили зустріч у п\'ятницю', tone:'calm' },
    { kind:'voicemail', name:'+380 …', time:'08:11', dur:'voicemail · 18s', last:'unknown caller, screened', ai:'хоче продати solar panels', tone:'spam', hot:true },
    { kind:'phantom', name:'PHANTOM', time:'now', dur:'thread · 14 msg', last:'«next 1h: BPM падає, кава?»', ai:null, tone:'phantom' },
    { kind:'sms', name:'Іра ☾', time:'yest', dur:'sms · 6 msg', last:'«у п\'ятницю все ок»', ai:'плани на вихідні', tone:'calm' },
    { kind:'tg', name:'Workshop · Telegram', time:'mon', dur:'12 unread', last:'matrix bridge · read-only', ai:'2 messages need reply', tone:'calm' },
  ];
  return (
    <PhoneShell theme={theme}>
      <div style={{ padding: '14px 16px 8px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
          <span style={{ fontFamily: 'var(--mono)', fontSize: 18, color: theme.ink, fontWeight: 700, letterSpacing: '-0.02em' }}>Comms</span>
          <span style={{ fontFamily: 'var(--mono)', fontSize: 10, color: theme.ink3, letterSpacing: '0.18em' }}>· 5 ACTIVE</span>
        </div>
        <span style={{ color: theme.ink2, fontSize: 18 }}>⋮</span>
      </div>

      <div style={{ padding: '0 12px 8px' }}>
        <GlassCard level="subtle" theme={theme} style={{ padding: 4, display: 'flex', borderRadius: 999 }}>
          {tabs.map((t, i) => (
            <div key={t} onClick={() => setTab(i)} style={{
              flex: 1, padding: '8px 0', textAlign: 'center',
              fontFamily: 'var(--mono)', fontSize: 9.5, letterSpacing: '0.14em',
              fontWeight: 700, textTransform: 'uppercase',
              borderRadius: 999, cursor: 'pointer',
              background: i===activeTab ? accent : 'transparent',
              color: i===activeTab ? (theme.isDark?'#1a1208':'#fff') : theme.ink2,
            }}>{t}</div>
          ))}
        </GlassCard>
      </div>

      <div style={{ flex: 1, padding: '4px 12px 12px', display: 'flex', flexDirection: 'column', gap: 8, position: 'relative' }}>
        {rows.map((r, i) => (
          <CommsRow key={i} r={r} theme={theme} accent={accent} />
        ))}
        <div style={{ position: 'absolute', right: 14, bottom: 14 }}>
          <div style={{
            width: 52, height: 52, borderRadius: 18,
            background: `radial-gradient(circle at 30% 25%, ${accent}, ${accent}cc)`,
            boxShadow: `0 8px 22px ${accent}66`,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            color: theme.isDark ? '#1a1208' : '#fff',
            fontSize: 26, fontWeight: 300, lineHeight: 1,
          }}>+</div>
        </div>
      </div>

      <BottomNav active="comms" theme={theme} accent={accent} />
    </PhoneShell>
  );
}

function CommsRow({ r, theme, accent }) {
  const isHot = r.hot;
  const isPhantom = r.kind === 'phantom';
  const left = isHot ? theme.coral : (isPhantom ? accent : 'transparent');
  const icons = { call: '↗', voicemail: '⊘', phantom: '◉', sms: '✉', tg: '⋈' };
  return (
    <GlassCard level="card" theme={theme} accentBorder={isPhantom} accent={accent} style={{ padding: '12px 14px', position: 'relative' }}>
      {left !== 'transparent' && (
        <div style={{ position: 'absolute', left: 0, top: 12, bottom: 12, width: 3, background: left, borderRadius: 2 }} />
      )}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <div style={{
          width: 30, height: 30, borderRadius: 10,
          background: isPhantom ? `${accent}22` : `${theme.ink3}22`,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          color: isPhantom ? accent : (isHot ? theme.coral : theme.ink2),
          fontSize: 14,
        }}>{icons[r.kind]}</div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
            <span style={{ fontWeight: 700, fontSize: 14, color: theme.ink, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.name}</span>
            <span style={{ marginLeft: 'auto', fontFamily: 'var(--mono)', fontSize: 10, color: theme.ink3 }}>{r.time}</span>
          </div>
          <div style={{ fontFamily: 'var(--mono)', fontSize: 10, color: theme.ink3, marginTop: 2, letterSpacing: '0.04em' }}>
            {r.dur} {isHot && <span style={{ color: theme.coral, fontWeight: 700 }}>· ✱HOT✱</span>}
          </div>
          <div style={{ fontSize: 12.5, color: theme.ink2, marginTop: 4, lineHeight: 1.35 }}>{r.last}</div>
          {r.ai && (
            <div style={{
              fontFamily: 'var(--serif)', fontStyle: 'italic', fontSize: 12.5,
              color: accent, marginTop: 4, lineHeight: 1.35,
            }}>AI · {r.ai}</div>
          )}
        </div>
      </div>
    </GlassCard>
  );
}

// ── 5. VAULT ────────────────────────────────────────────────
function VaultScreen({ theme, accent }) {
  const ghost = '#16A34A';
  const items = [
    { t: 'NOTE', when: 'yesterday 23:14', body: '«Координати схрону —\u00a050.4501°, 30.5234°. Перевірити по середах.»', size: null, kind: 'note' },
    { t: 'PHOTO', when: 'today 03:11', body: null, size: '2.4 MB · IMG_4421.HEIC', kind: 'photo' },
    { t: 'AUDIO MEMO', when: 'today 10:42', body: null, size: '0:32 · m4a', kind: 'audio' },
    { t: 'NOTE', when: 'apr 28 19:02', body: '«passphrase rotation due — see locker.»', size: null, kind: 'note' },
  ];
  return (
    <PhoneShell theme={theme}>
      <div style={{ padding: '14px 16px 6px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{ width: 8, height: 8, borderRadius: '50%', background: ghost, boxShadow: `0 0 8px ${ghost}` }} />
          <span style={{ fontFamily: 'var(--mono)', fontSize: 11, letterSpacing: '0.22em', fontWeight: 700, color: ghost }}>GHOST · LOCAL ONLY</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginTop: 8 }}>
          <span style={{ fontSize: 28, fontWeight: 700, color: theme.ink, letterSpacing: '-0.02em' }}>Vault</span>
          <span style={{ fontFamily: 'var(--mono)', fontSize: 11, color: theme.ink3 }}>4 records · 0 synced</span>
        </div>
      </div>

      <div style={{ flex: 1, padding: '8px 12px 14px', display: 'flex', flexDirection: 'column', gap: 10, position: 'relative' }}>
        {items.map((it, i) => (
          <GlassCard key={i} level="card" theme={theme} style={{ padding: '12px 14px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontFamily: 'var(--mono)', fontSize: 10, fontWeight: 700, letterSpacing: '0.22em', color: ghost }}>{it.t}</span>
              <span style={{ fontFamily: 'var(--mono)', fontSize: 10, color: theme.ink3 }}>· {it.when}</span>
              <span style={{ marginLeft: 'auto', fontSize: 14, color: theme.ink3 }}>🔒</span>
            </div>
            {it.body && (
              <div style={{
                fontFamily: 'var(--serif)', fontStyle: 'italic', fontSize: 14,
                color: theme.ink, marginTop: 8, lineHeight: 1.4,
                filter: 'blur(2.4px)',
                userSelect: 'none',
              }}>{it.body}</div>
            )}
            {it.kind === 'photo' && (
              <div style={{
                marginTop: 10, height: 90, borderRadius: 12,
                background: `linear-gradient(135deg, ${ghost}33, ${theme.ink3}22)`,
                filter: 'blur(8px)',
                position: 'relative',
              }} />
            )}
            {it.kind === 'audio' && (
              <div style={{ marginTop: 10, display: 'flex', alignItems: 'center', gap: 8 }}>
                <div style={{ width: 28, height: 28, borderRadius: '50%', background: ghost, color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11 }}>▶</div>
                <svg width="180" height="22">
                  {Array.from({length:30}).map((_,j) => (
                    <rect key={j} x={j*6} y={11 - 3 - Math.abs(Math.sin(j*0.7))*7} width="3" height={6 + Math.abs(Math.sin(j*0.7))*14} rx="1.5" fill={ghost} opacity={0.5 + Math.abs(Math.sin(j*0.4))*0.5} />
                  ))}
                </svg>
              </div>
            )}
            {it.size && (
              <div style={{ fontFamily: 'var(--mono)', fontSize: 10, color: theme.ink3, marginTop: 8 }}>{it.size}</div>
            )}
            {it.kind === 'note' && (
              <div style={{ display: 'flex', gap: 6, marginTop: 10 }}>
                <span style={{ padding: '4px 8px', borderRadius: 999, fontFamily: 'var(--mono)', fontSize: 9.5, letterSpacing: '0.14em', textTransform: 'uppercase', fontWeight: 700, background: `${ghost}22`, color: ghost }}>↳ promote to memory fact</span>
              </div>
            )}
          </GlassCard>
        ))}
        <div style={{ position: 'absolute', right: 14, bottom: 14 }}>
          <div style={{
            width: 52, height: 52, borderRadius: 18,
            background: `radial-gradient(circle at 30% 25%, ${ghost}, #0e7a36)`,
            boxShadow: `0 8px 22px ${ghost}66`,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            color: '#fff', fontSize: 26, fontWeight: 300, lineHeight: 1,
          }}>+</div>
        </div>
      </div>

      {/* no bottom-nav glow on Vault active — show it normally */}
      <BottomNav active="vault" theme={theme} accent={ghost} />
    </PhoneShell>
  );
}

// ── 6. INCALL ──────────────────────────────────────────────
function InCallScreen({ theme, accent, motionScale }) {
  return (
    <PhoneShell theme={theme}>
      <div style={{
        flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center',
        padding: '20px 18px 18px', gap: 12,
      }}>
        {/* Avatar */}
        <div style={{ position: 'relative', marginTop: 6 }}>
          <div style={{
            position: 'absolute', inset: -10, borderRadius: '50%',
            border: `4px solid ${accent}`, opacity: 0.4,
          }} />
          <div style={{
            width: 88, height: 88, borderRadius: '50%',
            background: `linear-gradient(135deg, ${accent}55, ${accent}22)`,
            border: `2px solid ${accent}`,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontFamily: 'var(--serif)', fontStyle: 'italic', fontSize: 32, fontWeight: 600,
            color: accent,
          }}>ОК</div>
        </div>

        <div style={{ textAlign: 'center', marginTop: 4 }}>
          <div style={{ fontSize: 22, fontWeight: 700, color: theme.ink, letterSpacing: '-0.01em' }}>Олег Кравченко</div>
          <div style={{ fontFamily: 'var(--mono)', fontSize: 12, color: theme.ink2, marginTop: 4 }}>+380 67 ___ __ __</div>
        </div>

        <StatePill stateKey="DIALOGUE" accent={accent} theme={theme} sub="incoming · 0:08" />

        {/* AI context card */}
        <GlassCard level="elevated" theme={theme} accentBorder accent={accent} style={{ width: '100%', padding: '14px 16px' }}>
          <div style={{
            fontFamily: 'var(--mono)', fontSize: 9.5, letterSpacing: '0.22em',
            fontWeight: 700, color: accent, textTransform: 'uppercase', marginBottom: 10,
          }}>PHANTOM · context</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, fontFamily: 'var(--mono)', fontSize: 11.5, color: theme.ink2, lineHeight: 1.4 }}>
            <div>· last call <b style={{color:theme.ink}}>2 days ago</b>, 4:18</div>
            <div>· last sms «ok, чекаю»</div>
            <div>· тон останніх 3 розмов <b style={{color:theme.ink}}>спокій</b></div>
          </div>
          <div style={{
            fontFamily: 'var(--serif)', fontStyle: 'italic', fontSize: 14,
            color: theme.ink, marginTop: 12, lineHeight: 1.4,
            paddingTop: 10, borderTop: `1px solid ${theme.glassBorder}`,
          }}>«імовірно про зустріч у п'ятницю — згадував у вівторок.»</div>
        </GlassCard>

        <div style={{ flex: 1 }} />
        <FamiliarCanvas pose="Pointing" mood="Neutral" accent={accent} theme={theme} size={70} />
        <div style={{ flex: 1 }} />

        {/* action row */}
        <div style={{ display: 'flex', gap: 24, alignItems: 'center', marginBottom: 16 }}>
          <CallAction color={theme.coral} icon="✕" label="decline" theme={theme} />
          <CallAction color={accent} icon="⚙" label="AI screen" theme={theme} ai />
          <CallAction color="#16A34A" icon="✓" label="answer" theme={theme} />
        </div>
      </div>
    </PhoneShell>
  );
}

function CallAction({ color, icon, label, theme, ai }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
      <div style={{
        width: 64, height: 64, borderRadius: '50%',
        background: `radial-gradient(circle at 30% 25%, ${color}, ${color}cc)`,
        boxShadow: `0 10px 24px ${color}55`,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        color: '#fff', fontSize: 24, fontWeight: 600,
        border: ai ? `2px dashed ${color}aa` : 'none',
      }}>{icon}</div>
      <div style={{
        fontFamily: 'var(--mono)', fontSize: 9.5, letterSpacing: '0.18em',
        textTransform: 'uppercase', fontWeight: 700, color: theme.ink2,
      }}>{label}</div>
    </div>
  );
}

Object.assign(window, { PulseScreen, VoiceScreen, MapScreen, CommsScreen, VaultScreen, InCallScreen });

})();

;(function(){
// PHANTOM app — design canvas with both themes + tweaks
const { DesignCanvas, DCSection, DCArtboard, TweaksPanel, useTweaks, TweakSection, TweakRadio, TweakSelect, TweakSlider, TweakToggle } = window;
const { PulseScreen, VoiceScreen, MapScreen, CommsScreen, VaultScreen, InCallScreen, PHANTOM_THEMES, PHANTOM_STATES, getStateAccent } = window;

const TWEAK_DEFAULTS = /*EDITMODE-BEGIN*/{
  "themeId": "sunrise",
  "stateKey": "FOCUS",
  "motionMul": 1.0,
  "showFamiliar": true
}/*EDITMODE-END*/;

function App() {
  const [tweaks, setTweak] = useTweaks(TWEAK_DEFAULTS);

  const themeS = PHANTOM_THEMES.sunrise;
  const themeA = PHANTOM_THEMES.amber;

  const themeMap = { sunrise: themeS, amber: themeA };
  const activeTheme = themeMap[tweaks.themeId] || themeS;
  const stateKey = tweaks.stateKey;
  const motionScale = (PHANTOM_STATES[stateKey]?.motionScale || 1) * (tweaks.motionMul || 1);
  const accentS = getStateAccent(stateKey, themeS).accent;
  const accentA = getStateAccent(stateKey, themeA).accent;
  const sentinelS = getStateAccent('SENTINEL', themeS).accent;
  const sentinelA = getStateAccent('SENTINEL', themeA).accent;

  // Per-screen recommended states (when "Auto" — but here we apply the tweak override globally)
  const screenStateFor = (key) => {
    // Each screen has a natural state; if user picks Auto via stateKey === 'AUTO', use natural.
    // Currently stateKey is always picked → use it for non-fixed screens.
    if (stateKey !== 'AUTO') return stateKey;
    return ({pulse:'FOCUS', voice:'DIALOGUE', map:'SENTINEL', comms:'FOCUS', vault:'GHOST', incall:'DIALOGUE'})[key];
  };

  const renderScreen = (Comp, theme, key, fixedState) => {
    const sk = fixedState || screenStateFor(key);
    const acc = getStateAccent(sk, theme).accent;
    const ms = (PHANTOM_STATES[sk]?.motionScale || 1) * (tweaks.motionMul || 1);
    return <Comp theme={theme} accent={acc} stateKey={sk} motionScale={ms} />;
  };

  return (
    <>
      <DesignCanvas>
        <DCSection id="sunrise" title="Sunrise · Warm" subtitle="default theme · light surfaces, amber primary, glass-warm chrome">
          <DCArtboard id="s-pulse" label="Pulse · home" width={360} height={740}>
            {renderScreen(PulseScreen, themeS, 'pulse')}
          </DCArtboard>
          <DCArtboard id="s-voice" label="Voice · PTT dialogue" width={360} height={740}>
            {renderScreen(VoiceScreen, themeS, 'voice', 'DIALOGUE')}
          </DCArtboard>
          <DCArtboard id="s-map" label="Map · sentinel" width={360} height={740}>
            {renderScreen(MapScreen, themeS, 'map', 'SENTINEL')}
          </DCArtboard>
          <DCArtboard id="s-comms" label="Comms · unified inbox" width={360} height={740}>
            {renderScreen(CommsScreen, themeS, 'comms')}
          </DCArtboard>
          <DCArtboard id="s-vault" label="Vault · ghost" width={360} height={740}>
            {renderScreen(VaultScreen, themeS, 'vault', 'GHOST')}
          </DCArtboard>
          <DCArtboard id="s-incall" label="InCall · overlay" width={360} height={740}>
            {renderScreen(InCallScreen, themeS, 'incall', 'DIALOGUE')}
          </DCArtboard>
        </DCSection>

        <DCSection id="amber" title="Amber · Night" subtitle="dark surfaces, amber-glow primary, low-light wardrive sessions">
          <DCArtboard id="a-pulse" label="Pulse · home" width={360} height={740}>
            {renderScreen(PulseScreen, themeA, 'pulse')}
          </DCArtboard>
          <DCArtboard id="a-voice" label="Voice · PTT dialogue" width={360} height={740}>
            {renderScreen(VoiceScreen, themeA, 'voice', 'DIALOGUE')}
          </DCArtboard>
          <DCArtboard id="a-map" label="Map · sentinel" width={360} height={740}>
            {renderScreen(MapScreen, themeA, 'map', 'SENTINEL')}
          </DCArtboard>
          <DCArtboard id="a-comms" label="Comms · unified inbox" width={360} height={740}>
            {renderScreen(CommsScreen, themeA, 'comms')}
          </DCArtboard>
          <DCArtboard id="a-vault" label="Vault · ghost" width={360} height={740}>
            {renderScreen(VaultScreen, themeA, 'vault', 'GHOST')}
          </DCArtboard>
          <DCArtboard id="a-incall" label="InCall · overlay" width={360} height={740}>
            {renderScreen(InCallScreen, themeA, 'incall', 'DIALOGUE')}
          </DCArtboard>
        </DCSection>

        <DCSection id="states" title="State accents · live" subtitle={`Pulse home, sunrise theme, cycling SystemState — drives accent + motion + opacity. Currently: ${stateKey}`}>
          {['SHADOW','FOCUS','DIALOGUE','SENTINEL','GHOST','DREAM'].map(s => (
            <DCArtboard key={s} id={`st-${s}`} label={`${s} · motion ×${PHANTOM_STATES[s].motionScale}`} width={360} height={740}>
              {renderScreen(PulseScreen, themeS, 'pulse', s)}
            </DCArtboard>
          ))}
        </DCSection>
      </DesignCanvas>

      <TweaksPanel title="Tweaks">
        <TweakSection label="Theme">
          <TweakRadio
            label="Variant"
            value={tweaks.themeId}
            onChange={(v) => setTweak('themeId', v)}
            options={[
              { value: 'sunrise', label: 'Sunrise' },
              { value: 'amber',   label: 'Amber Night' },
            ]}
          />
        </TweakSection>
        <TweakSection label="System State">
          <TweakSelect
            label="State accent"
            value={tweaks.stateKey}
            onChange={(v) => setTweak('stateKey', v)}
            options={[
              { value: 'SHADOW',   label: 'SHADOW · low-power' },
              { value: 'FOCUS',    label: 'FOCUS · default' },
              { value: 'DIALOGUE', label: 'DIALOGUE · talking' },
              { value: 'SENTINEL', label: 'SENTINEL · threat' },
              { value: 'GHOST',    label: 'GHOST · private' },
              { value: 'DREAM',    label: 'DREAM · sleep' },
            ]}
          />
          <div style={{ fontFamily: 'var(--mono)', fontSize: 10, color: '#9a8a6f', marginTop: 6, lineHeight: 1.4 }}>
            State only retints the third row (state-accents). The first two rows show each screen's natural state.
          </div>
        </TweakSection>
        <TweakSection label="Motion">
          <TweakSlider
            label="Motion multiplier"
            unit="×"
            value={tweaks.motionMul} min={0.2} max={2.0} step={0.05}
            onChange={(v) => setTweak('motionMul', v)}
          />
        </TweakSection>
      </TweaksPanel>
    </>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(<App />);

})();
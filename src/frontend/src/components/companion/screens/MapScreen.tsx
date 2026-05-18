import { ScreenProps } from './PulseScreen';
import { PhoneShell, GlassCard, BottomNav } from '../CompanionComponents';

export function MapScreen({ theme, accent, stateKey }: ScreenProps) {
  const isSentinel = stateKey === 'SENTINEL';
  const threats = [
    { t: 'PROXIMITY', d: '5m',   tag: 'unknown rider, NW', sev: 'high' },
    { t: 'UNKNOWN BSSID', d: '32m', tag: 'pineapple-like AP', sev: 'med' },
    { t: 'GEOFENCE EXIT', d: '12m', tag: 'left workshop zone', sev: 'low' },
  ];
  return (
    <PhoneShell theme={theme}>
      <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>
        <div style={{
          position: 'absolute', inset: 0,
          background: theme.isDark
            ? `linear-gradient(120deg, #0a0805 0%, #1a1308 100%)`
            : `linear-gradient(120deg, #ede5d2 0%, #d8cdb0 100%)`,
        }} />
        <svg width="100%" height="100%" style={{ position: 'absolute', inset: 0, opacity: theme.isDark ? 0.18 : 0.25 }}>
          <defs>
            <pattern id="mapgrid" width="40" height="40" patternUnits="userSpaceOnUse">
              <path d="M 40 0 L 0 0 0 40" fill="none" stroke={theme.isDark ? '#3d2c14' : '#a89876'} strokeWidth="0.5" />
            </pattern>
          </defs>
          <rect width="100%" height="100%" fill="url(#mapgrid)" />
        </svg>
        <svg width="100%" height="100%" style={{ position: 'absolute', inset: 0 }}>
          <path d="M -10 200 Q 80 180 180 220 T 380 250" stroke={theme.isDark?'#3d2c14':'#b8a987'} strokeWidth="6" fill="none" strokeLinecap="round" opacity="0.6"/>
          <path d="M 60 0 Q 80 180 140 320 T 200 740" stroke={theme.isDark?'#3d2c14':'#b8a987'} strokeWidth="4" fill="none" strokeLinecap="round" opacity="0.5"/>
          <path d="M 240 0 L 260 740" stroke={theme.isDark?'#3d2c14':'#b8a987'} strokeWidth="3" fill="none" opacity="0.4"/>
        </svg>
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
        <div style={{ position: 'absolute', left: '46%', top: '42%' }}>
          <div style={{ position: 'absolute', width: 60, height: 60, borderRadius: '50%', border: `2px solid ${accent}`, opacity: 0.4, transform: 'translate(-50%,-50%)' }} />
          <div style={{ width: 14, height: 14, borderRadius: '50%', background: accent, boxShadow: `0 0 16px ${accent}`, transform: 'translate(-50%,-50%)' }} />
        </div>
        {isSentinel && (
          <>
            <ThreatPin x="36%" y="33%" accent={theme.coral} />
            <ThreatPin x="60%" y="48%" accent={theme.coral} />
            <ThreatPin x="42%" y="55%" accent={theme.coral} />
          </>
        )}
      </div>

      <div style={{ flex: 1, padding: '8px 12px', display: 'flex', flexDirection: 'column', position: 'relative', zIndex: 1 }}>
        <GlassCard level="subtle" theme={theme} style={{ padding: 4, display: 'flex', borderRadius: 999 }}>
          {['Wardrive','POIs','Heatmap','GPS'].map((l, i) => (
            <div key={l} style={{
              flex: 1, padding: '8px 0', textAlign: 'center',
              fontFamily: 'JetBrains Mono', fontSize: 10, letterSpacing: '0.14em',
              fontWeight: 600, textTransform: 'uppercase',
              borderRadius: 999,
              background: i===0 ? accent : 'transparent',
              color: i===0 ? (theme.isDark?'#1a1208':'#fff') : theme.ink2,
            }}>{l}</div>
          ))}
        </GlassCard>

        <div style={{ flex: 1 }} />

        <div style={{ position: 'absolute', right: 16, bottom: 240 }}>
          <GlassCard level="elevated" theme={theme} style={{
            width: 52, height: 52, borderRadius: 18,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <div style={{ fontFamily: 'JetBrains Mono', fontSize: 11, fontWeight: 700, color: accent, letterSpacing: '0.1em' }}>AR</div>
          </GlassCard>
        </div>

        <GlassCard level="elevated" theme={theme} accentBorder accent={isSentinel ? theme.coral : accent} style={{ padding: '14px 14px 8px', borderRadius: 28 }}>
          <div style={{ width: 36, height: 4, borderRadius: 2, background: theme.ink3, margin: '0 auto 12px', opacity: 0.4 }} />
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 8 }}>
            <div style={{ fontFamily: 'JetBrains Mono', fontSize: 10, fontWeight: 700, letterSpacing: '0.22em', color: isSentinel ? theme.coral : theme.ink, textTransform: 'uppercase' }}>
              Threats
            </div>
            <div style={{ fontFamily: 'JetBrains Mono', fontSize: 10, color: theme.ink3 }}>· {threats.length}</div>
            <div style={{ marginLeft: 'auto', fontFamily: 'JetBrains Mono', fontSize: 10, color: theme.ink3 }}>radius 800m</div>
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
                <div style={{ fontFamily: 'JetBrains Mono', fontSize: 11, fontWeight: 700, color: theme.ink, letterSpacing: '0.1em' }}>
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

function ThreatPin({ x, y, accent }: { x: string, y: string, accent: string }) {
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

import { PhantomTheme } from '../CompanionTheme';
import { PhoneShell, VitalsRow, OrbView, GlassCard, StatePill, FamiliarCanvas, BottomNav } from '../CompanionComponents';

export interface ScreenProps {
  theme: PhantomTheme;
  accent: string;
  stateKey: string;
  motionScale: number;
}

export function PulseScreen({ theme, accent, stateKey, motionScale }: ScreenProps) {
  return (
    <PhoneShell theme={theme}>
      <div style={{ flex: 1, padding: '12px 16px 0', display: 'flex', flexDirection: 'column', gap: 14 }}>
        <VitalsRow theme={theme} accent={accent} />

        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', position: 'relative', minHeight: 220 }}>
          <OrbView accent={accent} theme={theme} motionScale={motionScale} size={220} ringCount={2} />
          <div style={{
            position: 'absolute', bottom: -4, fontFamily: 'JetBrains Mono', fontSize: 10,
            letterSpacing: '0.2em', color: theme.ink3, textTransform: 'uppercase',
          }}>breathing · {stateKey.toLowerCase()}</div>
        </div>

        <GlassCard level="panel" theme={theme} accentBorder accent={accent} style={{ padding: '14px 16px' }}>
          <StatePill stateKey={stateKey} accent={accent} theme={theme} sub="2 standing orders" expanded
            style={{ width: '100%', borderRadius: 14, background: 'transparent', border: 'none', padding: 0 }} />
        </GlassCard>

        <GlassCard level="card" theme={theme} style={{ padding: '14px 16px' }}>
          <div style={{
            fontFamily: 'JetBrains Mono', fontSize: 10, letterSpacing: '0.22em',
            textTransform: 'uppercase', color: accent, fontWeight: 600, marginBottom: 8,
          }}>NEXT 1H</div>
          <div style={{
            fontFamily: 'Playfair Display', fontStyle: 'italic', fontSize: 16,
            lineHeight: 1.45, color: theme.ink, fontWeight: 500,
          }}>«Кнопка кави о 09:14 — BPM падає 12% за 18 хв, спіймати ранкове вікно.»</div>
          <div style={{ display:'flex', gap: 6, marginTop: 12 }}>
            {['snooze 30m', 'lock in', 'why?'].map((b,i) => (
              <div key={i} style={{
                padding: '6px 10px', borderRadius: 999,
                fontFamily: 'JetBrains Mono', fontSize: 10, fontWeight: 600,
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

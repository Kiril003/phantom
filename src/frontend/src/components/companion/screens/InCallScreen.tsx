import { ScreenProps } from './PulseScreen';
import { PhoneShell, StatePill, GlassCard, FamiliarCanvas } from '../CompanionComponents';
import { PhantomTheme } from '../CompanionTheme';

export function InCallScreen({ theme, accent }: ScreenProps) {
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
            fontFamily: 'Playfair Display', fontStyle: 'italic', fontSize: 32, fontWeight: 600,
            color: accent,
          }}>ОК</div>
        </div>

        <div style={{ textAlign: 'center', marginTop: 4 }}>
          <div style={{ fontSize: 22, fontWeight: 700, color: theme.ink, letterSpacing: '-0.01em' }}>Олег Кравченко</div>
          <div style={{ fontFamily: 'JetBrains Mono', fontSize: 12, color: theme.ink2, marginTop: 4 }}>+380 67 ___ __ __</div>
        </div>

        <StatePill stateKey="DIALOGUE" accent={accent} theme={theme} sub="incoming · 0:08" />

        {/* AI context card */}
        <GlassCard level="elevated" theme={theme} accentBorder accent={accent} style={{ width: '100%', padding: '14px 16px' }}>
          <div style={{
            fontFamily: 'JetBrains Mono', fontSize: 9.5, letterSpacing: '0.22em',
            fontWeight: 700, color: accent, textTransform: 'uppercase', marginBottom: 10,
          }}>PHANTOM · context</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, fontFamily: 'JetBrains Mono', fontSize: 11.5, color: theme.ink2, lineHeight: 1.4 }}>
            <div>· last call <b style={{color:theme.ink}}>2 days ago</b>, 4:18</div>
            <div>· last sms «ok, чекаю»</div>
            <div>· тон останніх 3 розмов <b style={{color:theme.ink}}>спокій</b></div>
          </div>
          <div style={{
            fontFamily: 'Playfair Display', fontStyle: 'italic', fontSize: 14,
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

function CallAction({ color, icon, label, theme, ai }: { color: string, icon: string, label: string, theme: PhantomTheme, ai?: boolean }) {
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
        fontFamily: 'JetBrains Mono', fontSize: 9.5, letterSpacing: '0.18em',
        textTransform: 'uppercase', fontWeight: 700, color: theme.ink2,
      }}>{label}</div>
    </div>
  );
}

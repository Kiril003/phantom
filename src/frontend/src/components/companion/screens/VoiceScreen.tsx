import { ScreenProps } from './PulseScreen';
import { PhoneShell, OrbView, FamiliarCanvas, PttButton, BottomNav } from '../CompanionComponents';

export function VoiceScreen({ theme, accent, motionScale }: ScreenProps) {
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
              fontFamily: l.who === 'ai' ? 'Playfair Display' : 'JetBrains Mono',
              fontStyle: l.who === 'ai' ? 'italic' : 'normal',
              fontSize: l.latest ? 15 : 13,
              fontWeight: l.latest ? 600 : 400,
              color: l.latest ? accent : (l.who === 'ai' ? theme.ink2 : theme.ink2),
              opacity: l.latest ? 1 : 0.55 + i*0.1,
              lineHeight: 1.35,
            }}>
              <span style={{ fontFamily: 'JetBrains Mono', fontSize: 9, opacity: 0.5, marginRight: 8 }}>{l.t}</span>
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
            fontFamily: 'JetBrains Mono', fontSize: 10, letterSpacing: '0.28em',
            textTransform: 'uppercase', color: theme.ink2, fontWeight: 600,
          }}>HOLD TO SPEAK · ↑ for chat</div>
        </div>
      </div>

      <BottomNav active="voice" theme={theme} accent={accent} />
    </PhoneShell>
  );
}

import { ScreenProps } from './PulseScreen';
import { PhoneShell, GlassCard, BottomNav } from '../CompanionComponents';

export function VaultScreen({ theme }: ScreenProps) {
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
          <span style={{ fontFamily: 'JetBrains Mono', fontSize: 11, letterSpacing: '0.22em', fontWeight: 700, color: ghost }}>GHOST · LOCAL ONLY</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginTop: 8 }}>
          <span style={{ fontSize: 28, fontWeight: 700, color: theme.ink, letterSpacing: '-0.02em' }}>Vault</span>
          <span style={{ fontFamily: 'JetBrains Mono', fontSize: 11, color: theme.ink3 }}>4 records · 0 synced</span>
        </div>
      </div>

      <div style={{ flex: 1, padding: '8px 12px 14px', display: 'flex', flexDirection: 'column', gap: 10, position: 'relative' }}>
        {items.map((it, i) => (
          <GlassCard key={i} level="card" theme={theme} style={{ padding: '12px 14px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontFamily: 'JetBrains Mono', fontSize: 10, fontWeight: 700, letterSpacing: '0.22em', color: ghost }}>{it.t}</span>
              <span style={{ fontFamily: 'JetBrains Mono', fontSize: 10, color: theme.ink3 }}>· {it.when}</span>
              <span style={{ marginLeft: 'auto', fontSize: 14, color: theme.ink3 }}>🔒</span>
            </div>
            {it.body && (
              <div style={{
                fontFamily: 'Playfair Display', fontStyle: 'italic', fontSize: 14,
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
              <div style={{ fontFamily: 'JetBrains Mono', fontSize: 10, color: theme.ink3, marginTop: 8 }}>{it.size}</div>
            )}
            {it.kind === 'note' && (
              <div style={{ display: 'flex', gap: 6, marginTop: 10 }}>
                <span style={{ padding: '4px 8px', borderRadius: 999, fontFamily: 'JetBrains Mono', fontSize: 9.5, letterSpacing: '0.14em', textTransform: 'uppercase', fontWeight: 700, background: `${ghost}22`, color: ghost }}>↳ promote to memory fact</span>
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

      <BottomNav active="vault" theme={theme} accent={ghost} />
    </PhoneShell>
  );
}

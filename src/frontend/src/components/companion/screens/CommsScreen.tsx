import { useState } from 'react';
import { ScreenProps } from './PulseScreen';
import { PhoneShell, GlassCard, BottomNav } from '../CompanionComponents';
import { PhantomTheme } from '../CompanionTheme';

export function CommsScreen({ theme, accent }: ScreenProps) {
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
          <span style={{ fontFamily: 'JetBrains Mono', fontSize: 18, color: theme.ink, fontWeight: 700, letterSpacing: '-0.02em' }}>Comms</span>
          <span style={{ fontFamily: 'JetBrains Mono', fontSize: 10, color: theme.ink3, letterSpacing: '0.18em' }}>· 5 ACTIVE</span>
        </div>
        <span style={{ color: theme.ink2, fontSize: 18 }}>⋮</span>
      </div>

      <div style={{ padding: '0 12px 8px' }}>
        <GlassCard level="subtle" theme={theme} style={{ padding: 4, display: 'flex', borderRadius: 999 }}>
          {tabs.map((t, i) => (
            <div key={t} onClick={() => setTab(i)} style={{
              flex: 1, padding: '8px 0', textAlign: 'center',
              fontFamily: 'JetBrains Mono', fontSize: 9.5, letterSpacing: '0.14em',
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

function CommsRow({ r, theme, accent }: { r: any, theme: PhantomTheme, accent: string }) {
  const isHot = r.hot;
  const isPhantom = r.kind === 'phantom';
  const left = isHot ? theme.coral : (isPhantom ? accent : 'transparent');
  const icons: Record<string, string> = { call: '↗', voicemail: '⊘', phantom: '◉', sms: '✉', tg: '⋈' };
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
            <span style={{ marginLeft: 'auto', fontFamily: 'JetBrains Mono', fontSize: 10, color: theme.ink3 }}>{r.time}</span>
          </div>
          <div style={{ fontFamily: 'JetBrains Mono', fontSize: 10, color: theme.ink3, marginTop: 2, letterSpacing: '0.04em' }}>
            {r.dur} {isHot && <span style={{ color: theme.coral, fontWeight: 700 }}>· ✱HOT✱</span>}
          </div>
          <div style={{ fontSize: 12.5, color: theme.ink2, marginTop: 4, lineHeight: 1.35 }}>{r.last}</div>
          {r.ai && (
            <div style={{
              fontFamily: 'Playfair Display', fontStyle: 'italic', fontSize: 12.5,
              color: accent, marginTop: 4, lineHeight: 1.35,
            }}>AI · {r.ai}</div>
          )}
        </div>
      </div>
    </GlassCard>
  );
}

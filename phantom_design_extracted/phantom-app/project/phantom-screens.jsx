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

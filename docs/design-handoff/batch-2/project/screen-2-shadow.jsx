// Screen 2 — Shadow / Ambient Idle — distinctive
// Unique: large central living "Aurora" orb with particle field,
// orbiting moments around it, live heart EKG waveform, breath rhythm visualizer

const ScreenShadow = () => (
  <div className="phantom-frame">
    <StatusBar state="SHADOW" stateTone="amber" clock="07:14:22" />

    {/* === AURORA ORB CENTERPIECE === */}
    <svg viewBox="0 0 1024 524" preserveAspectRatio="xMidYMid slice"
      style={{ position: 'absolute', top: 56, left: 0, width: '100%', height: 524, zIndex: 1 }}>
      <defs>
        <radialGradient id="auroraCore" cx="50%" cy="50%">
          <stop offset="0%" stopColor="#fff8dc" stopOpacity="1" />
          <stop offset="20%" stopColor="#fde9b8" stopOpacity="0.95" />
          <stop offset="55%" stopColor="#f4af25" stopOpacity="0.85" />
          <stop offset="85%" stopColor="#fb923c" stopOpacity="0.4" />
          <stop offset="100%" stopColor="#fb923c" stopOpacity="0" />
        </radialGradient>
        <filter id="softBlur"><feGaussianBlur stdDeviation="2" /></filter>
      </defs>

      {/* outer halo rings */}
      {[280, 220, 170].map((r, i) => (
        <circle key={i} cx="512" cy="240" r={r}
          fill="none" stroke={`rgba(244,175,37,${0.08 + i*0.04})`} strokeWidth="0.8"
          strokeDasharray={i === 1 ? '4 8' : ''}
          style={{ animation: `orb-breathe ${5 + i}s ease-in-out infinite` }} />
      ))}

      {/* particle constellation */}
      {Array.from({ length: 28 }).map((_, i) => {
        const angle = (i / 28) * Math.PI * 2;
        const r = 130 + (i % 3) * 30;
        const x = 512 + Math.cos(angle) * r;
        const y = 240 + Math.sin(angle) * r * 0.6;
        return <circle key={i} cx={x} cy={y} r={1.2 + (i % 3) * 0.4}
          fill="#f4af25" opacity={0.5 + (i % 3) * 0.15}
          style={{ animation: `phantom-pulse ${2 + (i % 5) * 0.5}s ease-in-out infinite` }} />;
      })}

      {/* aurora orb */}
      <circle cx="512" cy="240" r="160" fill="url(#auroraCore)"
        style={{ animation: 'orb-breathe 6s ease-in-out infinite' }} />
      {/* inner solid bead */}
      <circle cx="500" cy="225" r="48"
        fill="#fff" opacity="0.85" filter="url(#softBlur)" />
      <circle cx="512" cy="240" r="36"
        fill="url(#auroraCore)" />
    </svg>

    {/* attending label above orb */}
    <div style={{
      position: 'absolute', top: 92, left: '50%', transform: 'translateX(-50%)',
      textAlign: 'center', zIndex: 4
    }}>
      <div className="micro-label" style={{ color: '#b07a10' }}>ATTENDING</div>
      <div style={{
        marginTop: 6, height: 1.5, width: 60,
        background: 'linear-gradient(90deg, transparent, #f4af25, transparent)',
        margin: '6px auto'
      }} />
    </div>

    {/* poetry below orb */}
    <div style={{
      position: 'absolute', top: 350, left: '50%', transform: 'translateX(-50%)',
      textAlign: 'center', zIndex: 4
    }}>
      <div className="playfair" style={{
        fontSize: 26, color: 'var(--ink-secondary)', letterSpacing: '-0.01em',
        textShadow: '0 1px 0 rgba(255,255,255,0.5)'
      }}>
        Quiet. Watching. Yours.
      </div>
      <div style={{ marginTop: 8, fontSize: 11, color: 'var(--ink-muted)', letterSpacing: '0.18em', textTransform: 'uppercase' }}>
        listening for "Phantom" · whisper mode
      </div>
    </div>

    {/* === LEFT BIOMETRIC PANEL === */}
    <div className="glass" style={{
      position: 'absolute', left: 12, top: 68, width: 220, padding: 14, zIndex: 4
    }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div className="micro-label">VITALS</div>
        <span style={{ width: 5, height: 5, borderRadius: 999, background: '#22c55e', animation: 'phantom-pulse 1.4s ease-in-out infinite' }} />
      </div>
      {/* EKG */}
      <svg viewBox="0 0 200 50" style={{ width: '100%', height: 44, marginTop: 8 }}>
        <path d="M0 25 L40 25 L48 25 L52 10 L58 38 L66 25 L100 25 L108 25 L112 12 L118 36 L126 25 L160 25 L168 25 L172 12 L178 38 L186 25 L200 25"
          stroke="#ef4444" strokeWidth="1.6" fill="none" strokeLinejoin="round" strokeLinecap="round" />
      </svg>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
        <span className="tabular" style={{ fontSize: 28, fontWeight: 600, color: 'var(--ink)' }}>64</span>
        <span style={{ fontSize: 11, color: 'var(--ink-muted)' }}>bpm · resting</span>
      </div>

      <div style={{ marginTop: 10, height: 1, background: 'rgba(0,0,0,0.06)' }} />

      {/* breath */}
      <div style={{ marginTop: 10 }}>
        <div className="micro-label">BREATH · 14/MIN</div>
        <div style={{ display: 'flex', gap: 2, alignItems: 'flex-end', height: 24, marginTop: 6 }}>
          {[8,12,16,20,18,12,8,4,8,12,16,20,18,12,8,4,8,12,16,22].map((h,i) => (
            <span key={i} style={{
              flex: 1, height: h, borderRadius: 1,
              background: '#f4af25', opacity: 0.3 + (i / 30)
            }} />
          ))}
        </div>
      </div>

      <div style={{ marginTop: 10, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
        <div className="sub-glass" style={{ padding: '6px 8px' }}>
          <div className="micro-label" style={{ fontSize: 8 }}>HRV</div>
          <div className="tabular" style={{ fontSize: 14, fontWeight: 600 }}>52<span style={{ fontSize: 10, color: 'var(--ink-muted)', fontWeight: 400 }}>ms</span></div>
        </div>
        <div className="sub-glass" style={{ padding: '6px 8px' }}>
          <div className="micro-label" style={{ fontSize: 8 }}>STRESS</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginTop: 2 }}>
            <span style={{ width: 6, height: 6, borderRadius: 999, background: '#22c55e' }} />
            <span style={{ fontSize: 12, fontWeight: 600 }}>low</span>
          </div>
        </div>
      </div>
    </div>

    {/* === LEFT — RECENT ACTIVITY === */}
    <div className="glass" style={{
      position: 'absolute', left: 12, top: 348, width: 220, bottom: 76, padding: 14, zIndex: 4
    }}>
      <div className="micro-label">TODAY · 3 MOMENTS</div>
      {[
        { t: '06:42', i: 'lock', l: 'doors armed', sub: 'all 7 sensors green' },
        { t: '06:30', i: 'coffee', l: 'kettle off', sub: 'auto · 2m boil' },
        { t: '06:18', i: 'wb_twilight', l: 'wake routine', sub: 'lights · curtains · brief' },
      ].map((it, i) => (
        <div key={i} style={{
          marginTop: i ? 8 : 10,
          display: 'flex', gap: 10
        }}>
          <span className="tabular" style={{
            fontSize: 10, fontWeight: 600, color: 'var(--ink-muted)',
            paddingTop: 2
          }}>{it.t}</span>
          <Icon name={it.i} size={14} style={{ color: '#b07a10', marginTop: 2 }} fill={1} />
          <div>
            <div style={{ fontSize: 12, fontWeight: 600 }}>{it.l}</div>
            <div style={{ fontSize: 10, color: 'var(--ink-muted)' }}>{it.sub}</div>
          </div>
        </div>
      ))}
    </div>

    {/* === RIGHT AMBIENT STACK === */}
    <div style={{
      position: 'absolute', right: 12, top: 68, bottom: 76, width: 240,
      display: 'flex', flexDirection: 'column', gap: 10, zIndex: 4
    }}>
      {/* weather card */}
      <div className="glass" style={{ padding: 14 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div className="micro-label">WEATHER · KYIV</div>
          <Icon name="wb_sunny" size={14} style={{ color: '#b07a10' }} fill={1} />
        </div>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, marginTop: 6 }}>
          <span className="tabular" style={{ fontSize: 32, fontWeight: 300 }}>18°</span>
          <span style={{ fontSize: 11, color: 'var(--ink-muted)' }}>feels 19° · clear</span>
        </div>
        {/* mini hourly forecast */}
        <div style={{ display: 'flex', gap: 4, marginTop: 8, height: 30, alignItems: 'flex-end' }}>
          {[12,14,16,18,20,22,21,18,15].map((t,i) => (
            <div key={i} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
              <div style={{ height: t - 8, width: '70%', background: 'linear-gradient(180deg,#f4af25,#fb923c)', opacity: 0.5, borderRadius: '2px 2px 0 0' }} />
              <div style={{ fontSize: 7, color: 'var(--ink-muted)' }}>{8+i*2}</div>
            </div>
          ))}
        </div>
      </div>

      {/* upcoming */}
      <div className="glass" style={{ padding: 14 }}>
        <div className="micro-label">NEXT</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 6 }}>
          <span className="tabular" style={{ fontSize: 18, fontWeight: 600, color: '#b07a10' }}>09:30</span>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 12, fontWeight: 600 }}>Strategy Sync</div>
            <div style={{ fontSize: 10, color: 'var(--ink-muted)' }}>з Лена · 45 хв · zoom</div>
          </div>
        </div>
        <div style={{
          marginTop: 8, height: 4, borderRadius: 2,
          background: 'rgba(0,0,0,0.06)', position: 'relative', overflow: 'hidden'
        }}>
          <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: '32%', background: 'linear-gradient(90deg,#f4af25,#fb923c)', borderRadius: 2 }} />
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 4, fontSize: 9, color: 'var(--ink-muted)' }}>
          <span>now</span><span>2h 16m</span>
        </div>
      </div>

      {/* nexus suggestion */}
      <div className="sub-glass" style={{
        padding: 14,
        background: 'linear-gradient(135deg, rgba(244,175,37,0.18), rgba(251,146,60,0.08))',
        border: '1px solid rgba(244,175,37,0.32)'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
          <Icon name="auto_awesome" size={12} style={{ color: '#b07a10' }} fill={1} />
          <span className="micro-label" style={{ color: '#b07a10' }}>NEXUS SUGGESTS</span>
        </div>
        <div className="playfair" style={{ fontSize: 14, color: 'var(--ink-secondary)', lineHeight: 1.4 }}>
          “Sun's up. Want me to start the kettle and queue your morning brief?”
        </div>
        <div style={{ display: 'flex', gap: 6, marginTop: 10 }}>
          <button style={{
            flex: 1, padding: '6px', borderRadius: 8,
            background: 'linear-gradient(135deg,#f4af25,#fb923c)',
            border: 'none', color: 'white', fontSize: 11, fontWeight: 600, cursor: 'pointer'
          }}>Так</button>
          <button style={{
            flex: 1, padding: '6px', borderRadius: 8,
            background: 'rgba(255,255,255,0.5)',
            border: '1px solid rgba(255,255,255,0.6)',
            color: 'var(--ink-secondary)', fontSize: 11, fontWeight: 600, cursor: 'pointer'
          }}>Пізніше</button>
        </div>
      </div>
    </div>

    <FloatingToolbar active="home" />
  </div>
);

window.ScreenShadow = ScreenShadow;

// Screen 3 — Dialogue — distinctive
// Unique: voice-waveform orb with rotating phoneme rings, message transcript with
// inline rich cards, "thinking" indicator with token stream, smart suggestion stack

const ScreenDialogue = () => (
  <div className="phantom-frame">
    <StatusBar state="DIALOGUE · WHISPER" stateTone="amber" clock="07:18:04" sensors={false} />

    {/* === LEFT — VOICE PRESENCE PANEL === */}
    <div style={{
      position: 'absolute', left: 12, top: 68, bottom: 76, width: 296,
      zIndex: 3, display: 'flex', flexDirection: 'column'
    }}>
      {/* big animated voice orb */}
      <div style={{ position: 'relative', height: 240, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <svg viewBox="0 0 240 240" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }}>
          <defs>
            <radialGradient id="voiceCore" cx="35%" cy="30%">
              <stop offset="0%" stopColor="#fff" />
              <stop offset="40%" stopColor="#fde9b8" />
              <stop offset="100%" stopColor="#f4af25" />
            </radialGradient>
          </defs>
          {/* outer rings - voice lock */}
          {[110, 92, 76].map((r, i) => (
            <circle key={i} cx="120" cy="120" r={r}
              fill="none"
              stroke={`rgba(244,175,37,${0.18 - i*0.04})`}
              strokeWidth="0.8"
              strokeDasharray={i === 1 ? '2 4' : ''}
              style={{ animation: `orb-breathe ${3 + i}s ease-in-out infinite` }} />
          ))}
          {/* phoneme bars around the orb */}
          {Array.from({ length: 36 }).map((_, i) => {
            const angle = (i / 36) * Math.PI * 2;
            const baseR = 60;
            const len = 8 + Math.abs(Math.sin(i * 0.7) * 14) + (i % 5 === 0 ? 6 : 0);
            const x1 = 120 + Math.cos(angle) * baseR;
            const y1 = 120 + Math.sin(angle) * baseR;
            const x2 = 120 + Math.cos(angle) * (baseR + len);
            const y2 = 120 + Math.sin(angle) * (baseR + len);
            return <line key={i} x1={x1} y1={y1} x2={x2} y2={y2}
              stroke="#f4af25" strokeWidth="2" strokeLinecap="round"
              opacity={0.5 + (i % 4) * 0.15}
              style={{ animation: `phantom-pulse ${1 + (i % 6) * 0.2}s ease-in-out infinite` }} />;
          })}
          {/* solid core */}
          <circle cx="120" cy="120" r="46" fill="url(#voiceCore)"
            style={{ animation: 'orb-breathe 4s ease-in-out infinite', filter: 'drop-shadow(0 0 20px rgba(244,175,37,0.5))' }} />
          <circle cx="108" cy="108" r="14" fill="rgba(255,255,255,0.7)" />
        </svg>
      </div>

      <div style={{ textAlign: 'center', padding: '0 8px' }}>
        <div className="playfair" style={{ fontSize: 20, color: 'var(--ink-secondary)' }}>Listening…</div>
        <div className="micro-label" style={{ marginTop: 4 }}>TAP ORB TO INTERRUPT</div>
      </div>

      {/* bio chips */}
      <div className="glass" style={{ marginTop: 14, padding: 12 }}>
        <div className="micro-label" style={{ marginBottom: 8 }}>YOU · NOW</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11 }}>
            <Icon name="air" size={12} style={{ color: '#b07a10' }} />
            <span style={{ flex: 1, color: 'var(--ink-muted)' }}>BREATHING</span>
            <span style={{ display: 'flex', gap: 1 }}>
              {[4,7,4,7,4,7,4].map((h,i) => <span key={i} style={{ width: 2, height: h, background: '#f4af25', borderRadius: 1 }} />)}
            </span>
            <span className="tabular" style={{ fontWeight: 600, fontSize: 11 }}>16/min</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11 }}>
            <Icon name="trending_down" size={12} style={{ color: '#22c55e' }} />
            <span style={{ flex: 1, color: 'var(--ink-muted)' }}>STRESS</span>
            <div style={{ width: 60, height: 4, borderRadius: 2, background: 'rgba(0,0,0,0.06)', position: 'relative' }}>
              <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: '20%', background: '#22c55e', borderRadius: 2 }} />
            </div>
            <span style={{ fontSize: 10, fontWeight: 600, color: '#16a34a' }}>low</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11 }}>
            <Icon name="psychology" size={12} style={{ color: '#b07a10' }} />
            <span style={{ flex: 1, color: 'var(--ink-muted)' }}>STATE</span>
            <span className="playfair" style={{ fontSize: 12, color: 'var(--ink-secondary)' }}>focused</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11 }}>
            <Icon name="route" size={12} style={{ color: '#b07a10' }} />
            <span style={{ flex: 1, color: 'var(--ink-muted)' }}>ROUTE</span>
            <span style={{ fontSize: 11, fontWeight: 600 }}>Gemini</span>
            <span style={{ fontSize: 9, color: '#b07a10', padding: '1px 5px', borderRadius: 999, background: 'rgba(244,175,37,0.15)' }}>whisper</span>
          </div>
        </div>
      </div>
    </div>

    {/* === RIGHT — TRANSCRIPT === */}
    <div style={{
      position: 'absolute', left: 320, right: 12, top: 68, bottom: 76,
      display: 'flex', flexDirection: 'column'
    }}>
      {/* date marker */}
      <div style={{ textAlign: 'center', padding: '4px 0 8px' }}>
        <span style={{
          fontSize: 9, fontWeight: 700, letterSpacing: '0.2em',
          padding: '3px 12px', borderRadius: 999,
          background: 'rgba(255,255,255,0.4)',
          color: 'var(--ink-muted)'
        }}>СЬОГОДНІ · 07:17</span>
      </div>

      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 8, overflow: 'hidden' }}>
        {/* AI greeting */}
        <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
          <div style={{
            width: 28, height: 28, borderRadius: 999, flexShrink: 0,
            background: 'radial-gradient(circle at 30% 25%,#fff 0%,#f4af25 60%,#fb923c 100%)',
            boxShadow: '0 0 12px rgba(244,175,37,0.5)'
          }} />
          <div style={{ flex: 1 }}>
            <div className="glass" style={{ padding: '10px 14px', borderRadius: '4px 14px 14px 14px' }}>
              <div className="playfair" style={{ fontSize: 17, color: 'var(--ink)', lineHeight: 1.3 }}>
                «Доброго ранку, Алекс. Що сьогодні?»
              </div>
            </div>
            <div className="micro-label" style={{ marginTop: 3, fontSize: 8 }}>PHANTOM · 07:17:42</div>
          </div>
        </div>

        {/* user voice */}
        <div style={{ alignSelf: 'flex-end', maxWidth: '72%' }}>
          <div style={{
            padding: '10px 14px', borderRadius: '14px 4px 14px 14px',
            background: 'linear-gradient(135deg, rgba(244,175,37,0.22), rgba(251,146,60,0.16))',
            border: '1px solid rgba(244,175,37,0.32)'
          }}>
            <div style={{ fontSize: 13, color: 'var(--ink)' }}>Яка погода і збуди мене завтра о 7.</div>
            {/* user voice waveform */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 1.5, marginTop: 6, height: 14 }}>
              {[3,6,8,10,7,5,8,11,9,6,4,7,9,11,8,5,3,6,4,2].map((h,i) => (
                <span key={i} style={{ width: 2, height: h, background: '#b07a10', borderRadius: 1, opacity: 0.6 }} />
              ))}
              <span className="tabular" style={{ fontSize: 9, color: 'var(--ink-muted)', marginLeft: 6 }}>0:03</span>
            </div>
          </div>
          <div className="micro-label" style={{ marginTop: 3, textAlign: 'right', fontSize: 8 }}>VOICE · WHISPER · 07:18:01</div>
        </div>

        {/* AI thinking indicator briefly seen */}
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginLeft: 38 }}>
          <span style={{
            display: 'inline-flex', alignItems: 'center', gap: 6,
            padding: '4px 10px', borderRadius: 999,
            background: 'rgba(244,175,37,0.12)',
            border: '1px solid rgba(244,175,37,0.25)',
            fontSize: 10, color: '#8a5e0a', fontWeight: 600,
            letterSpacing: '0.1em'
          }}>
            <Icon name="auto_awesome" size={11} fill={1} />
            THINKING · weather + alarm tools
            <span style={{ display: 'flex', gap: 2 }}>
              {[0,1,2].map(i => <span key={i} style={{ width: 3, height: 3, borderRadius: 999, background: '#b07a10', animation: `phantom-pulse ${1 + i*0.2}s ease-in-out infinite` }} />)}
            </span>
          </span>
        </div>

        {/* inline weather card */}
        <div className="sub-glass" style={{
          padding: 14, borderRadius: 14, marginLeft: 38,
          maxWidth: '80%',
          background: 'linear-gradient(135deg, rgba(255,255,255,0.55), rgba(244,175,37,0.10))'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
            <div className="micro-label">КИЇВ · СЬОГОДНІ</div>
            <span className="mono" style={{ fontSize: 9, color: 'var(--ink-muted)' }}>weather.now()</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
            <div style={{ position: 'relative', width: 56, height: 56 }}>
              <div style={{
                position: 'absolute', inset: 0, borderRadius: 999,
                background: 'radial-gradient(circle at 35% 30%,#fff 0%,#fde9b8 50%,#f4af25 100%)',
                boxShadow: '0 0 18px rgba(244,175,37,0.5)'
              }} />
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
                <span className="tabular" style={{ fontSize: 30, fontWeight: 300 }}>18°</span>
                <span style={{ fontSize: 11, color: 'var(--ink-secondary)' }}>sunny · max 24° · low 11°</span>
              </div>
              <div style={{ fontSize: 11, color: 'var(--ink-muted)', marginTop: 2 }}>Ясний ранок, легкий вітер на обід.</div>
            </div>
            {/* hourly */}
            <div style={{ display: 'flex', gap: 3, alignItems: 'flex-end', height: 38 }}>
              {[14,16,18,21,23,24,22,19,15].map((t,i) => (
                <div key={i} style={{ width: 6, height: t-10, background: 'linear-gradient(180deg,#f4af25,#fb923c)', opacity: 0.55, borderRadius: '2px 2px 0 0' }} />
              ))}
            </div>
          </div>
        </div>

        {/* AI confirms */}
        <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
          <div style={{ width: 28, height: 28, borderRadius: 999, flexShrink: 0,
            background: 'radial-gradient(circle at 30% 25%,#fff,#f4af25,#fb923c)' }} />
          <div className="glass" style={{ padding: '10px 14px', borderRadius: '4px 14px 14px 14px' }}>
            <div className="playfair" style={{ fontSize: 15, color: 'var(--ink)' }}>
              «Готово. Розбудити завтра о 7?»
            </div>
          </div>
        </div>

        {/* alarm card */}
        <div className="sub-glass" style={{
          padding: '12px 14px', borderRadius: 14,
          marginLeft: 38, maxWidth: '80%',
          display: 'flex', alignItems: 'center', gap: 12,
          border: '1px solid rgba(244,175,37,0.32)'
        }}>
          <div style={{
            width: 42, height: 42, borderRadius: 12,
            background: 'rgba(244,175,37,0.18)',
            border: '1px solid rgba(244,175,37,0.4)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            color: '#8a5e0a'
          }}>
            <Icon name="alarm" size={20} fill={1} />
          </div>
          <div style={{ flex: 1 }}>
            <div className="micro-label">БУДИЛЬНИК · ОДНОРАЗОВО</div>
            <div className="tabular" style={{ fontSize: 18, fontWeight: 600, marginTop: 2 }}>07:00 · сб 18 травня</div>
            <div style={{ fontSize: 10, color: 'var(--ink-muted)' }}>через 23г 42хв · вибране звучання «Sunrise»</div>
          </div>
          <div style={{ display: 'flex', gap: 4 }}>
            <button style={{ width: 30, height: 30, borderRadius: 8, background: 'rgba(255,255,255,0.5)', border: '1px solid rgba(255,255,255,0.6)', cursor: 'pointer', color: 'var(--ink-secondary)' }}>
              <Icon name="edit" size={14} />
            </button>
            <button style={{ width: 30, height: 30, borderRadius: 8, background: 'rgba(255,255,255,0.5)', border: '1px solid rgba(255,255,255,0.6)', cursor: 'pointer', color: 'var(--ink-muted)' }}>
              <Icon name="close" size={14} />
            </button>
          </div>
        </div>
      </div>

      {/* suggestion chips */}
      <div style={{ display: 'flex', gap: 6, padding: '8px 0', flexWrap: 'wrap' }}>
        {[
          { i: 'event', t: 'що в календарі' },
          { i: 'home', t: 'статус будинку' },
          { i: 'event_busy', t: 'змісти 09:30' },
          { i: 'mail', t: 'підсумуй пошту' },
        ].map((c, i) => (
          <button key={i} className="sub-glass" style={{
            padding: '6px 12px', borderRadius: 999,
            fontSize: 11, color: 'var(--ink-secondary)',
            border: '1px solid rgba(255,255,255,0.55)',
            cursor: 'pointer', fontStyle: 'italic',
            display: 'inline-flex', alignItems: 'center', gap: 5
          }}>
            <Icon name={c.i} size={11} style={{ color: '#b07a10' }} />
            {c.t}
          </button>
        ))}
      </div>
    </div>

    {/* === INPUT BAR === */}
    <div className="glass-strong" style={{
      position: 'absolute', bottom: 16, left: 320, right: 12,
      height: 56, borderRadius: 999,
      display: 'flex', alignItems: 'center', gap: 8,
      padding: '0 8px',
      zIndex: 5
    }}>
      <button style={{
        width: 40, height: 40, borderRadius: 999,
        background: 'transparent', border: 'none',
        color: 'var(--ink-secondary)', cursor: 'pointer'
      }}>
        <Icon name="add" size={18} />
      </button>
      <button style={{
        width: 40, height: 40, borderRadius: 999,
        background: 'rgba(244,175,37,0.18)',
        border: '1.5px solid rgba(244,175,37,0.5)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        cursor: 'pointer', color: '#8a5e0a',
        boxShadow: 'inset 0 0 12px rgba(244,175,37,0.2)'
      }}>
        <Icon name="mic" size={18} fill={1} />
      </button>
      <span className="playfair" style={{ flex: 1, fontSize: 15, color: 'var(--ink-muted)' }}>
        Message PHANTOM…
      </span>
      <span className="mono" style={{ fontSize: 9, color: 'var(--ink-muted)', marginRight: 4 }}>UK</span>
      <button style={{
        width: 40, height: 40, borderRadius: 999,
        background: 'linear-gradient(135deg,#f4af25,#fb923c)',
        border: 'none', cursor: 'pointer', color: 'white',
        boxShadow: '0 4px 12px rgba(244,175,37,0.4)'
      }}>
        <Icon name="arrow_upward" size={18} weight={500} />
      </button>
    </div>
  </div>
);

window.ScreenDialogue = ScreenDialogue;

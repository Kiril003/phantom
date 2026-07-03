// Section 08 — Tools-as-Skills inline scenes (4 cards, 2×2 grid)

const ScreenInlineScenesBatch2 = () => (
  <div className="phantom-frame">
    <div style={{
      position: 'absolute', inset: 0,
      padding: '32px 36px',
      display: 'grid', gridTemplateColumns: '1fr 1fr', gridTemplateRows: '1fr 1fr',
      gap: 16
    }}>
      <SceneAlarm />
      <SceneWardriving />
      <SceneLocationHistory />
      <SceneCheckpoint />
    </div>

    <div className="micro-label" style={{
      position: 'absolute', left: 0, right: 0, bottom: 8, textAlign: 'center'
    }}>
      INLINE SCENES · TOOL-CALL RESULTS · 2×2 GRID @ 480×260
    </div>
  </div>
);

const SceneCard = ({ children, accent = 'amber' }) => (
  <div className="glass" style={{
    position: 'relative', padding: '14px 16px', borderRadius: 14,
    overflow: 'hidden',
    display: 'flex', flexDirection: 'column', gap: 10
  }}>
    <div style={{
      position: 'absolute', left: 0, top: 0, bottom: 0, width: 2,
      background: accent === 'coral'
        ? 'linear-gradient(180deg,#ef4444,#b9201f)'
        : 'linear-gradient(180deg,#f4af25,#fb923c)'
    }} />
    {children}
  </div>
);

// 8A — Alarm
const SceneAlarm = () => (
  <SceneCard>
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <Icon name="alarm" size={16} fill={1} style={{ color: '#b07a10' }} />
      <span className="eyebrow-amber" style={{ fontSize: 10 }}>БУДИЛЬНИК · ОДНОРАЗОВО</span>
      <span style={{ flex: 1 }} />
      <span className="micro-label">SAT</span>
    </div>

    <div style={{ display: 'flex', alignItems: 'baseline', gap: 14 }}>
      <span className="tabular" style={{ fontSize: 52, fontWeight: 200, letterSpacing: '-0.02em', lineHeight: 1, color: 'var(--ink)' }}>
        07:00
      </span>
      <div style={{ display: 'flex', flexDirection: 'column' }}>
        <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--ink-secondary)' }}>сб</span>
        <span style={{ fontSize: 11, color: 'var(--ink-muted)', fontVariantNumeric: 'tabular-nums' }}>18 травня</span>
      </div>
    </div>

    {/* sound chip */}
    <div className="sub-glass" style={{
      padding: '6px 10px', display: 'flex', alignItems: 'center', gap: 8,
      borderRadius: 999, alignSelf: 'flex-start'
    }}>
      <Icon name="music_note" size={12} style={{ color: '#b07a10' }} />
      <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--ink)' }}>Sunrise</span>
      {/* mini waveform */}
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 1.5, height: 12 }}>
        {[3,6,4,8,5,9,5,7,4,6,3].map((h, i) => (
          <span key={i} style={{ width: 1.5, height: h, background: '#f4af25', borderRadius: 1 }} />
        ))}
      </span>
      <button style={{
        width: 18, height: 18, borderRadius: 999, marginLeft: 4,
        background: 'rgba(244,175,37,0.2)', border: 'none', cursor: 'pointer',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        color: '#b07a10'
      }}>
        <Icon name="play_arrow" size={10} fill={1} />
      </button>
    </div>

    {/* toggle */}
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <span style={{ fontSize: 11, color: 'var(--ink-secondary)' }}>повторювати щодня</span>
      <span style={{ flex: 1 }} />
      <span style={{
        width: 30, height: 16, borderRadius: 999,
        background: 'rgba(0,0,0,0.10)', position: 'relative'
      }}>
        <span style={{
          position: 'absolute', left: 2, top: 2, width: 12, height: 12, borderRadius: 999,
          background: '#fff', boxShadow: '0 1px 3px rgba(0,0,0,0.15)'
        }} />
      </span>
    </div>

    <span style={{ flex: 1 }} />

    {/* actions */}
    <div style={{ display: 'flex', gap: 6 }}>
      <button style={{
        flex: 1, height: 30, borderRadius: 8, border: 'none', cursor: 'pointer',
        background: 'linear-gradient(135deg,#f4af25,#fb923c)', color: '#fff',
        fontSize: 11, fontWeight: 700, letterSpacing: '0.08em'
      }}>ЗБЕРЕГТИ</button>
      <button className="sub-glass" style={{ height: 30, padding: '0 10px', borderRadius: 8, cursor: 'pointer', fontSize: 11, color: 'var(--ink-secondary)' }}>Edit</button>
      <button style={{ height: 30, padding: '0 10px', borderRadius: 8, cursor: 'pointer', background: 'transparent', border: 'none', fontSize: 11, color: 'var(--ink-muted)' }}>Cancel</button>
    </div>

    <div className="playfair" style={{ fontSize: 11, fontStyle: 'italic', color: 'var(--ink-muted)', lineHeight: 1.4 }}>
      "Через 23г 42хв. Сонце сходить о 5:42 — будильник раніше світла на годину."
    </div>
  </SceneCard>
);

// 8B — Wardriving heatmap
const SceneWardriving = () => {
  const grid = [
    [0.05, 0.12, 0.30, 0.55, 0.42, 0.18],
    [0.08, 0.45, 0.78, 0.92, 0.58, 0.22],
    [0.20, 0.65, 0.88, 0.72, 0.48, 0.40],
    [0.10, 0.35, 0.50, 0.58, 0.85, 0.62],
  ];
  return (
    <SceneCard>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <Icon name="cell_tower" size={16} fill={1} style={{ color: '#b07a10' }} />
        <span className="eyebrow-amber" style={{ fontSize: 10 }}>WARDRIVING · 24H · ~12 KM²</span>
      </div>

      <div style={{ display: 'flex', gap: 12, flex: 1, minHeight: 0 }}>
        {/* heatmap */}
        <div style={{ flex: 1, position: 'relative', display: 'flex', flexDirection: 'column', gap: 2 }}>
          {grid.map((row, ri) => (
            <div key={ri} style={{ display: 'flex', gap: 2, flex: 1 }}>
              {row.map((v, ci) => (
                <div key={ci} style={{
                  flex: 1, borderRadius: 3,
                  background: `linear-gradient(135deg,
                    rgba(244,175,37,${0.2 * v}) 0%,
                    rgba(251,146,60,${0.6 * v}) 60%,
                    rgba(239,68,68,${0.9 * v}) 100%)`,
                  border: '1px solid rgba(255,255,255,0.4)'
                }} />
              ))}
            </div>
          ))}
          {/* pins */}
          <span style={{ position: 'absolute', left: '8%', top: '12%', fontSize: 9, fontWeight: 700, color: '#1a1612', background: 'rgba(255,255,255,0.85)', padding: '1px 5px', borderRadius: 3 }}>● Дім</span>
          <span style={{ position: 'absolute', right: '8%', bottom: '14%', fontSize: 9, fontWeight: 700, color: '#1a1612', background: 'rgba(255,255,255,0.85)', padding: '1px 5px', borderRadius: 3 }}>● Офіс</span>
          <span style={{ position: 'absolute', left: '40%', top: '46%', fontSize: 9, fontWeight: 700, color: '#1a1612', background: 'rgba(255,255,255,0.85)', padding: '1px 5px', borderRadius: 3 }}>● Foundry</span>
        </div>

        {/* top-3 list */}
        <div style={{ width: 138, display: 'flex', flexDirection: 'column', gap: 4 }}>
          <div className="micro-label">TOP RSSI</div>
          {[
            { b: 'a4:f7:db', r: -45, c: 18 },
            { b: '8c:a1:e2', r: -54, c: 12 },
            { b: 'b8:ee:0e', r: -62, c: 9 },
          ].map((n, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span className="mono" style={{ fontSize: 9, color: 'var(--ink-secondary)' }}>{n.b}</span>
              <span style={{ flex: 1 }} />
              <span className="tabular" style={{ fontSize: 10, fontWeight: 700, color: '#b07a10' }}>{n.r}</span>
              <span style={{ fontSize: 9, color: 'var(--ink-muted)' }}>×{n.c}</span>
            </div>
          ))}
        </div>
      </div>

      <div style={{ display: 'flex', gap: 6 }}>
        {[
          { l: '🔓 open', n: 17, c: '#ef4444' },
          { l: '🔒 wpa2', n: 156, c: '#fb923c' },
          { l: '🛡 wpa3', n: 30, c: '#f4af25' },
        ].map((c, i) => (
          <span key={i} className="sub-glass" style={{
            padding: '3px 8px', borderRadius: 999, fontSize: 10, fontWeight: 600,
            color: 'var(--ink-secondary)',
            display: 'inline-flex', alignItems: 'center', gap: 4
          }}>
            {c.l} <span className="tabular" style={{ color: c.c, fontWeight: 700 }}>{c.n}</span>
          </span>
        ))}
      </div>

      <div className="playfair" style={{ fontSize: 11, fontStyle: 'italic', color: 'var(--ink-muted)', lineHeight: 1.4 }}>
        "Найслабша зона — район парку. Можна писати mesh-relay якщо часто там."
      </div>
    </SceneCard>
  );
};

// 8C — Location history
const SceneLocationHistory = () => {
  const stops = [
    { x: 12,  y: 70, t: '06:42', n: 'Дім' },
    { x: 32,  y: 38, t: '09:30', n: 'Офіс' },
    { x: 52,  y: 60, t: '12:14', n: 'Кафе' },
    { x: 60,  y: 30, t: '14:00', n: 'Офіс' },
    { x: 80,  y: 65, t: '18:30', n: 'Парк' },
    { x: 94,  y: 78, t: '21:00', n: 'Дім' },
  ];
  return (
    <SceneCard>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <Icon name="route" size={16} fill={1} style={{ color: '#b07a10' }} />
        <span className="eyebrow-amber" style={{ fontSize: 10 }}>LOCATION · LAST 24H</span>
        <span style={{ flex: 1 }} />
        <span className="tabular micro-label">6 STOPS · 18.4 KM</span>
      </div>

      {/* mini map */}
      <div style={{
        position: 'relative', flex: 1, minHeight: 0, borderRadius: 10,
        overflow: 'hidden',
        background: `
          radial-gradient(ellipse 60% 80% at 30% 50%, rgba(244,175,37,0.18), transparent 60%),
          radial-gradient(ellipse 40% 60% at 70% 70%, rgba(251,146,60,0.12), transparent 70%),
          rgba(255,255,255,0.4)
        `,
        border: '1px solid rgba(244,175,37,0.25)'
      }}>
        {/* terrain contours */}
        <svg viewBox="0 0 100 100" preserveAspectRatio="none" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }}>
          <path d="M 0 60 Q 20 45 40 55 T 80 50 L 100 55" fill="none" stroke="rgba(176,122,16,0.15)" strokeWidth="0.4" />
          <path d="M 0 75 Q 25 65 50 70 T 100 68" fill="none" stroke="rgba(176,122,16,0.12)" strokeWidth="0.4" />
          <path d="M 0 40 Q 30 25 55 32 T 100 30" fill="none" stroke="rgba(176,122,16,0.10)" strokeWidth="0.4" />

          {/* polyline path */}
          <path
            d={`M ${stops.map(s => `${s.x} ${s.y}`).join(' L ')}`}
            fill="none"
            stroke="#f4af25" strokeWidth="0.8"
            strokeDasharray="2,1.5"
            opacity="0.85"
          />

          {/* pins */}
          {stops.map((s, i) => (
            <g key={i}>
              <circle cx={s.x} cy={s.y} r="1.6" fill="#fb923c" />
              <circle cx={s.x} cy={s.y} r="2.6" fill="none" stroke="#f4af25" strokeWidth="0.4" opacity="0.5" />
            </g>
          ))}
        </svg>

        {/* labels */}
        {stops.filter((_, i) => i === 0 || i === 4).map((s, i) => (
          <span key={i} style={{
            position: 'absolute',
            left: `${s.x}%`, top: `${s.y}%`,
            transform: 'translate(8px, -50%)',
            fontSize: 9, fontWeight: 700, color: 'var(--ink)',
            background: 'rgba(255,255,255,0.85)',
            padding: '1px 5px', borderRadius: 3
          }}>{s.t} · {s.n}</span>
        ))}
      </div>

      <div style={{ display: 'flex', gap: 12, fontSize: 10, color: 'var(--ink-secondary)', fontVariantNumeric: 'tabular-nums' }}>
        <span><span style={{ color: 'var(--ink-muted)' }}>walking </span><strong style={{ color: 'var(--ink)' }}>2h</strong></span>
        <span><span style={{ color: 'var(--ink-muted)' }}>stops </span><strong style={{ color: 'var(--ink)' }}>4</strong></span>
        <span><span style={{ color: 'var(--ink-muted)' }}>unknowns </span><strong style={{ color: '#22c55e' }}>0</strong></span>
      </div>

      <div className="playfair" style={{ fontSize: 11, fontStyle: 'italic', color: 'var(--ink-muted)', lineHeight: 1.4 }}>
        "Сьогодні ти тричі проходив повз Foundry — варто зробити там пресет?"
      </div>
    </SceneCard>
  );
};

// 8D — Checkpoint
const SceneCheckpoint = () => (
  <SceneCard>
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <Icon name="save" size={16} fill={1} style={{ color: '#b07a10' }} />
      <span className="eyebrow-amber" style={{ fontSize: 10 }}>CHECKPOINT</span>
      <span style={{ flex: 1 }} />
      <span className="mono" style={{ fontSize: 9, color: 'var(--ink-secondary)' }}>phantom-2026-04-29-1937</span>
    </div>

    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
      <div className="tabular" style={{ fontSize: 22, fontWeight: 700, color: 'var(--ink)' }}>47.3<span style={{ fontSize: 11, color: 'var(--ink-muted)', marginLeft: 3 }}>MB</span></div>
      <div className="micro-label" style={{ lineHeight: 1.4 }}>
        ChromaDB + SQLite<br/>
        + state-snapshot
      </div>
    </div>

    {/* included rows */}
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4px 12px' }}>
      {[
        'ChromaDB', 'SQLite users', 'ChatMessage', 'AgentMemory', 'settings',
      ].map((r, i) => (
        <span key={i} style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11, color: 'var(--ink-secondary)' }}>
          <Icon name="check_circle" size={12} fill={1} style={{ color: '#22c55e' }} />
          {r}
        </span>
      ))}
      {/* excluded */}
      <span style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11, color: '#b9201f', fontWeight: 600, gridColumn: '1 / 3' }}>
        <Icon name="cancel" size={12} fill={1} style={{ color: '#ef4444' }} />
        private notes (sealed)
      </span>
    </div>

    <span style={{ flex: 1 }} />

    <div style={{ display: 'flex', gap: 6 }}>
      <button style={{
        flex: 1, height: 30, borderRadius: 8, border: 'none', cursor: 'pointer',
        background: 'linear-gradient(135deg,#f4af25,#fb923c)', color: '#fff',
        fontSize: 10, fontWeight: 700, letterSpacing: '0.08em'
      }}>RESTORE ON BOOT</button>
      <button className="sub-glass" style={{ height: 30, padding: '0 10px', borderRadius: 8, cursor: 'pointer', fontSize: 10, color: 'var(--ink-secondary)', display: 'flex', alignItems: 'center', gap: 4 }}>
        <Icon name="download" size={12} />
        .tar.zst
      </button>
      <button style={{ height: 30, padding: '0 10px', borderRadius: 8, cursor: 'pointer', background: 'rgba(239,68,68,0.10)', border: '1px solid rgba(239,68,68,0.25)', color: '#b9201f', fontSize: 10, fontWeight: 600 }}>
        Delete
      </button>
    </div>

    <div className="playfair" style={{ fontSize: 11, fontStyle: 'italic', color: 'var(--ink-muted)', lineHeight: 1.4 }}>
      "Це 12-й чекпойнт цього тижня. Старіші 7 дозрілі — почистити?"
    </div>
  </SceneCard>
);

window.ScreenInlineScenesBatch2 = ScreenInlineScenesBatch2;

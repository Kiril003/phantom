// Screen 8 — Inline AI Result Scenes (4 mini-cards in 2x2)
// Each card is a real, distinctive composition that would live inside chat

const ScreenInlineScenes = () => (
  <div className="phantom-frame">
    {/* === HEADER === */}
    <div style={{
      position: 'absolute', top: 22, left: 24, right: 24, zIndex: 3,
      display: 'flex', alignItems: 'baseline', gap: 12
    }}>
      <span className="eyebrow-amber">SCENE COMPOSITIONS</span>
      <span className="playfair" style={{ fontSize: 16, color: 'var(--ink-secondary)' }}>
        used inline in chat — 4 of 38
      </span>
      <span style={{ flex: 1 }} />
      <span style={{ fontSize: 10, color: 'var(--ink-muted)', display: 'inline-flex', alignItems: 'center', gap: 5 }}>
        <Icon name="grid_view" size={12} /> 2 × 2 sheet · 1024 × 600
      </span>
    </div>

    {/* === GRID === */}
    <div style={{
      position: 'absolute', top: 64, left: 24, right: 24, bottom: 24,
      display: 'grid', gridTemplateColumns: '1fr 1fr', gridTemplateRows: '1fr 1fr',
      gap: 16, zIndex: 2
    }}>
      <SceneTimer />
      <SceneCalendar />
      <SceneFiles />
      <SceneAudit />
    </div>
  </div>
);

// ─── Card 1: TIMER ────────────────────────────────────────────
const SceneTimer = () => {
  const total = 25 * 60;
  const remaining = 12 * 60 + 47;
  const progress = 1 - remaining / total; // 0.49
  const r = 56;
  const C = 2 * Math.PI * r;
  return (
    <div className="glass" style={{ padding: 16, position: 'relative', overflow: 'hidden' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Icon name="timer" size={14} style={{ color: '#b07a10' }} fill={1} />
          <span className="eyebrow-amber">TIMER · PASTA</span>
        </div>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '2px 8px', borderRadius: 999, background: 'rgba(244,175,37,0.18)', border: '1px solid rgba(244,175,37,0.4)', fontSize: 9, fontWeight: 700, color: '#8a5e0a', letterSpacing: '0.12em' }}>
          <span style={{ width: 5, height: 5, borderRadius: 999, background: '#f4af25', animation: 'phantom-pulse 1s ease-in-out infinite' }} />
          ACTIVE
        </span>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 18, marginTop: 12 }}>
        <div style={{ position: 'relative', width: 134, height: 134, flexShrink: 0 }}>
          <svg viewBox="0 0 140 140" style={{ position: 'absolute', inset: 0 }}>
            <defs>
              <linearGradient id="ringT" x1="0" y1="0" x2="1" y2="1">
                <stop offset="0%" stopColor="#f4af25" /><stop offset="100%" stopColor="#fb923c" />
              </linearGradient>
            </defs>
            <circle cx="70" cy="70" r={r} fill="none" stroke="rgba(244,175,37,0.16)" strokeWidth="8" />
            <circle cx="70" cy="70" r={r} fill="none"
              stroke="url(#ringT)" strokeWidth="8" strokeLinecap="round"
              strokeDasharray={`${C * progress} ${C}`}
              transform="rotate(-90 70 70)"
              style={{ filter: 'drop-shadow(0 2px 6px rgba(244,175,37,0.4))' }} />
            {/* tick marks every minute */}
            {Array.from({length: 25}).map((_, i) => {
              const a = (i / 25) * Math.PI * 2 - Math.PI / 2;
              return <line key={i}
                x1={70 + Math.cos(a) * 64} y1={70 + Math.sin(a) * 64}
                x2={70 + Math.cos(a) * 67} y2={70 + Math.sin(a) * 67}
                stroke="rgba(176,122,16,0.35)" strokeWidth="0.8" />;
            })}
          </svg>
          <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
            <span className="tabular" style={{ fontSize: 32, fontWeight: 200, color: 'var(--ink)', lineHeight: 1 }}>12:47</span>
            <span className="playfair" style={{ fontSize: 11, color: 'var(--ink-muted)', marginTop: 3 }}>remaining</span>
          </div>
        </div>

        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 5 }}>
          <div style={{ fontSize: 10, color: 'var(--ink-muted)', display: 'flex', justifyContent: 'space-between' }}>
            <span>started</span><span className="tabular">19:23</span>
          </div>
          <div style={{ fontSize: 10, color: 'var(--ink-muted)', display: 'flex', justifyContent: 'space-between' }}>
            <span>ends</span><span className="tabular">19:48</span>
          </div>
          <div style={{ fontSize: 10, color: 'var(--ink-muted)', display: 'flex', justifyContent: 'space-between' }}>
            <span>preset</span><span style={{ color: 'var(--ink-secondary)' }}>al dente · 25m</span>
          </div>
          <div style={{ marginTop: 4, padding: '7px 10px', borderRadius: 8, background: 'rgba(244,175,37,0.06)', border: '1px solid rgba(244,175,37,0.18)' }}>
            <div className="micro-label" style={{ fontSize: 8, marginBottom: 2 }}>NEXUS NOTE</div>
            <div className="playfair" style={{ fontSize: 11, color: 'var(--ink-secondary)', fontStyle: 'italic', lineHeight: 1.3 }}>
              "Воду я почав о 19:21. Готова."
            </div>
          </div>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 6, marginTop: 12 }}>
        <button style={{ flex: 1, padding: '8px', borderRadius: 10, background: 'rgba(255,255,255,0.6)', border: '1px solid rgba(0,0,0,0.06)', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 5, fontSize: 11, fontWeight: 600, color: 'var(--ink-secondary)' }}>
          <Icon name="pause" size={12} fill={1} /> Pause
        </button>
        <button style={{ flex: 1, padding: '8px', borderRadius: 10, background: 'rgba(255,255,255,0.6)', border: '1px solid rgba(0,0,0,0.06)', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 5, fontSize: 11, fontWeight: 600, color: 'var(--ink-secondary)' }}>
          <Icon name="add" size={12} /> +1m
        </button>
        <button style={{ flex: 1, padding: '8px', borderRadius: 10, background: 'rgba(0,0,0,0.04)', border: '1px solid rgba(0,0,0,0.06)', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 5, fontSize: 11, fontWeight: 600, color: 'var(--ink-muted)' }}>
          <Icon name="close" size={12} /> Cancel
        </button>
      </div>
    </div>
  );
};

// ─── Card 2: CALENDAR-WEEK ────────────────────────────────────
const SceneCalendar = () => {
  const days = ['ПН','ВТ','СР','ЧТ','ПТ','СБ','НД'];
  const dates = [21,22,23,24,25,26,27];
  const events = [
    [{ y: 18, h: 18, c: 'amber', l: 'Standup' }, { y: 50, h: 22, c: 'work', l: 'Review' }],
    [{ y: 12, h: 28, c: 'work', l: 'Design' }, { y: 60, h: 16, c: 'personal', l: 'Lunch' }],
    [{ y: 24, h: 14, c: 'amber', l: 'Sync' }],
    [{ y: 8, h: 22, c: 'coral', l: 'Strategy' }, { y: 38, h: 18, c: 'coral', l: 'Reviews' }, { y: 64, h: 18, c: 'coral', l: '1:1 Mira' }, { y: 88, h: 8, c: 'amber', l: 'EOD' }],
    [{ y: 16, h: 16, c: 'work', l: 'Build' }, { y: 56, h: 20, c: 'amber', l: 'Demo' }],
    [{ y: 30, h: 14, c: 'personal', l: 'Run' }],
    [{ y: 20, h: 18, c: 'personal', l: 'Family' }],
  ];
  const colorMap = {
    amber: { bg: 'rgba(244,175,37,0.45)', border: 'rgba(244,175,37,0.7)', text: '#7a4f08' },
    work: { bg: 'rgba(176,122,16,0.18)', border: 'rgba(176,122,16,0.35)', text: 'var(--ink)' },
    personal: { bg: 'rgba(132,180,90,0.25)', border: 'rgba(132,180,90,0.5)', text: '#3d5b1c' },
    coral: { bg: 'rgba(239,68,68,0.18)', border: 'rgba(239,68,68,0.4)', text: '#9b1a1a' },
  };

  return (
    <div className="glass" style={{ padding: 16, position: 'relative', overflow: 'hidden' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Icon name="calendar_view_week" size={14} style={{ color: '#b07a10' }} fill={1} />
          <span className="eyebrow-amber">WEEK · 21–27 ЖОВТ</span>
        </div>
        <span style={{ fontSize: 9, color: 'var(--ink-muted)' }}>11 events</span>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 4, marginTop: 10, height: 144 }}>
        {days.map((d, i) => (
          <div key={i} style={{ display: 'flex', flexDirection: 'column' }}>
            <div style={{ textAlign: 'center', marginBottom: 4 }}>
              <div className="micro-label" style={{ fontSize: 8, color: i === 3 ? '#b9201f' : 'var(--ink-muted)' }}>{d}</div>
              <div className="tabular" style={{ fontSize: 12, fontWeight: i === 3 ? 700 : 500, color: i === 3 ? '#b9201f' : 'var(--ink-secondary)' }}>{dates[i]}</div>
            </div>
            <div style={{
              flex: 1, position: 'relative',
              background: i === 3 ? 'rgba(239,68,68,0.04)' : 'rgba(255,255,255,0.35)',
              borderRadius: 6,
              border: i === 3 ? '1px dashed rgba(239,68,68,0.3)' : '1px solid rgba(255,255,255,0.4)'
            }}>
              {events[i].map((ev, j) => {
                const c = colorMap[ev.c];
                return (
                  <div key={j} style={{
                    position: 'absolute', left: 2, right: 2, top: ev.y, height: ev.h,
                    background: c.bg, border: `1px solid ${c.border}`, borderRadius: 4,
                    fontSize: 8, fontWeight: 600, color: c.text,
                    padding: '1px 3px', overflow: 'hidden', whiteSpace: 'nowrap',
                    textOverflow: 'ellipsis', lineHeight: 1
                  }}>{ev.l}</div>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      <div style={{ marginTop: 10, padding: '8px 10px', borderRadius: 8, background: 'rgba(244,175,37,0.06)', border: '1px solid rgba(244,175,37,0.2)', display: 'flex', alignItems: 'center', gap: 8 }}>
        <Icon name="auto_awesome" size={12} style={{ color: '#b07a10' }} fill={1} />
        <div style={{ flex: 1 }}>
          <div className="micro-label" style={{ fontSize: 8, marginBottom: 1 }}>NEXUS SUGGESTS</div>
          <div className="playfair" style={{ fontSize: 12, fontStyle: 'italic', color: 'var(--ink-secondary)', lineHeight: 1.25 }}>
            "Найважче — четвер. 4 події підряд."
          </div>
        </div>
        <button style={{
          padding: '5px 10px', borderRadius: 999,
          background: 'linear-gradient(135deg,#f4af25,#fb923c)', border: 'none', cursor: 'pointer',
          color: 'white', fontSize: 10, fontWeight: 700, display: 'inline-flex', alignItems: 'center', gap: 3
        }}>
          <Icon name="add" size={11} /> Add
        </button>
      </div>
    </div>
  );
};

// ─── Card 3: FILE-GRID ─────────────────────────────────────────
const SceneFiles = () => {
  const files = [
    { i: 'image', tone: 'amber', n: 'DCIM_2024-09-15.heic', s: '4.2 MB', d: '15 Sep', highlight: true },
    { i: 'image', tone: 'amber', n: 'DCIM_2024-09-12.heic', s: '3.8 MB', d: '12 Sep' },
    { i: 'description', tone: 'neutral', n: 'q3-deck-v4.pptx', s: '12 MB', d: '23 Sep' },
    { i: 'image', tone: 'amber', n: 'sunset_terrace.jpg', s: '6.1 MB', d: '08 Sep' },
    { i: 'movie', tone: 'coral', n: 'demo_run.mp4', s: '88 MB', d: '04 Sep' },
    { i: 'audiotrack', tone: 'green', n: 'voice-note-447.m4a', s: '720 KB', d: '02 Sep' },
  ];
  const tones = {
    amber: { bg: 'rgba(244,175,37,0.18)', icon: '#b07a10' },
    neutral: { bg: 'rgba(176,122,16,0.10)', icon: '#876b2a' },
    coral: { bg: 'rgba(239,68,68,0.15)', icon: '#b9201f' },
    green: { bg: 'rgba(132,180,90,0.18)', icon: '#3d5b1c' },
  };

  return (
    <div className="glass" style={{ padding: 16, position: 'relative', overflow: 'hidden' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Icon name="folder_open" size={14} style={{ color: '#b07a10' }} fill={1} />
          <span className="eyebrow-amber">FILES · ~/PICTURES · 12 MATCHES</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '4px 10px', borderRadius: 999, background: 'rgba(255,255,255,0.55)', border: '1px solid rgba(255,255,255,0.55)' }}>
          <Icon name="search" size={11} style={{ color: 'var(--ink-muted)' }} />
          <span className="playfair" style={{ fontSize: 10, fontStyle: 'italic', color: 'var(--ink-muted)' }}>filter…</span>
          <Icon name="mic" size={10} style={{ color: '#b07a10' }} fill={1} />
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 6, marginTop: 10 }}>
        {files.map((f, i) => {
          const t = tones[f.tone];
          return (
            <div key={i} style={{
              padding: 8, borderRadius: 9,
              background: f.highlight ? 'rgba(244,175,37,0.14)' : 'rgba(255,255,255,0.5)',
              border: f.highlight ? '1px solid rgba(244,175,37,0.5)' : '1px solid rgba(255,255,255,0.55)',
              boxShadow: f.highlight ? '0 0 0 2px rgba(244,175,37,0.15)' : 'none',
              position: 'relative'
            }}>
              <div style={{
                width: '100%', aspectRatio: '4/3', borderRadius: 6,
                background: t.bg,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                marginBottom: 5,
                border: '1px solid rgba(255,255,255,0.4)'
              }}>
                <Icon name={f.i} size={20} style={{ color: t.icon }} fill={1} />
              </div>
              <div style={{ fontSize: 9.5, fontWeight: 600, color: 'var(--ink)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{f.n}</div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 8, color: 'var(--ink-muted)', marginTop: 1 }}>
                <span className="tabular">{f.s}</span><span>{f.d}</span>
              </div>
              {f.highlight && (
                <div style={{ position: 'absolute', top: -4, right: -4, padding: '2px 6px', background: 'linear-gradient(135deg,#f4af25,#fb923c)', color: 'white', fontSize: 7, fontWeight: 800, letterSpacing: '0.1em', borderRadius: 999, boxShadow: '0 2px 6px rgba(244,175,37,0.4)' }}>BEST</div>
              )}
            </div>
          );
        })}
      </div>

      <div style={{ marginTop: 8, padding: '7px 10px', borderRadius: 8, background: 'rgba(244,175,37,0.06)', border: '1px solid rgba(244,175,37,0.2)', display: 'flex', alignItems: 'center', gap: 8 }}>
        <Icon name="auto_awesome" size={11} style={{ color: '#b07a10' }} fill={1} />
        <span className="playfair" style={{ flex: 1, fontSize: 11, fontStyle: 'italic', color: 'var(--ink-secondary)' }}>
          "Топ — DCIM_2024-09-15. Ймовірно те, що шукав."
        </span>
        <Icon name="check_circle" size={13} style={{ color: '#b07a10' }} fill={1} />
      </div>
    </div>
  );
};

// ─── Card 4: AUDIT-TIMELINE ────────────────────────────────────
const SceneAudit = () => {
  const events = [
    { t: '03:22', tool: 'web_search', s: 'ok', txt: '"Q3 sales benchmarks 2024"', dur: '1.4s' },
    { t: '03:23', tool: 'memory_recall', s: 'ok', txt: 'context: previous deck params', dur: '0.2s' },
    { t: '03:31', tool: 'mail.search', s: 'retry', txt: 'IMAP timeout · retried × 2', dur: '4.1s' },
    { t: '03:33', tool: 'mail.search', s: 'ok', txt: '14 messages · attachments=3', dur: '0.9s' },
    { t: '03:38', tool: 'pptx.write', s: 'fail', txt: 'permission denied · ~/Documents', dur: '0.1s' },
    { t: '03:40', tool: 'reflect', s: 'ok', txt: '"Спробую дублікат у ~/Desktop."', dur: '0.4s' },
  ];
  const colors = {
    ok: { dot: '#22c55e', ring: 'rgba(34,197,94,0.3)', text: 'var(--ink-secondary)' },
    retry: { dot: '#f4af25', ring: 'rgba(244,175,37,0.3)', text: '#8a5e0a' },
    fail: { dot: '#ef4444', ring: 'rgba(239,68,68,0.3)', text: '#b9201f' },
  };

  return (
    <div className="glass" style={{ padding: 16, position: 'relative', overflow: 'hidden' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Icon name="schedule" size={14} style={{ color: '#b07a10' }} fill={1} />
          <span className="eyebrow-amber">AUDIT · LAST 20m · 12 ACTIONS</span>
        </div>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <span style={{ fontSize: 9, color: 'var(--ink-muted)', display: 'inline-flex', alignItems: 'center', gap: 3 }}>
            <span style={{ width: 5, height: 5, borderRadius: 999, background: '#22c55e' }} /> 9
          </span>
          <span style={{ fontSize: 9, color: 'var(--ink-muted)', display: 'inline-flex', alignItems: 'center', gap: 3 }}>
            <span style={{ width: 5, height: 5, borderRadius: 999, background: '#f4af25' }} /> 2
          </span>
          <span style={{ fontSize: 9, color: 'var(--ink-muted)', display: 'inline-flex', alignItems: 'center', gap: 3 }}>
            <span style={{ width: 5, height: 5, borderRadius: 999, background: '#ef4444' }} /> 1
          </span>
        </div>
      </div>

      <div style={{ marginTop: 10, position: 'relative' }}>
        <div style={{ position: 'absolute', left: 6, top: 5, bottom: 5, width: 1.5, background: 'rgba(176,122,16,0.18)' }} />
        {events.map((e, i) => {
          const c = colors[e.s];
          return (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 0', position: 'relative' }}>
              <div style={{
                width: 13, height: 13, borderRadius: 999,
                background: 'white', border: `2px solid ${c.dot}`,
                boxShadow: `0 0 0 3px ${c.ring}`,
                flexShrink: 0, zIndex: 1
              }} />
              <span className="tabular" style={{ fontSize: 9, fontWeight: 600, color: 'var(--ink-muted)', flexShrink: 0, width: 30 }}>{e.t}</span>
              <span className="mono" style={{
                fontSize: 8.5, padding: '1.5px 6px', borderRadius: 4,
                background: 'rgba(244,175,37,0.15)', color: '#8a5e0a',
                fontWeight: 600, flexShrink: 0
              }}>{e.tool}</span>
              <span style={{ fontSize: 10, color: c.text, flex: 1, fontFamily: e.tool === 'reflect' ? 'Playfair Display, serif' : 'inherit', fontStyle: e.tool === 'reflect' ? 'italic' : 'normal', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{e.txt}</span>
              <span className="tabular" style={{ fontSize: 8, color: 'var(--ink-muted)', flexShrink: 0 }}>{e.dur}</span>
            </div>
          );
        })}
      </div>

      <div style={{ marginTop: 8, display: 'flex', alignItems: 'center', gap: 6 }}>
        <button style={{
          padding: '6px 12px', borderRadius: 999,
          background: 'rgba(255,255,255,0.6)',
          border: '1px solid rgba(0,0,0,0.08)',
          color: 'var(--ink-secondary)', fontSize: 11, fontWeight: 600, cursor: 'pointer',
          display: 'inline-flex', alignItems: 'center', gap: 5
        }}>
          <Icon name="replay" size={12} /> Replay
        </button>
        <button style={{
          padding: '6px 12px', borderRadius: 999,
          background: 'transparent', border: '1px solid rgba(0,0,0,0.08)',
          color: 'var(--ink-muted)', fontSize: 11, fontWeight: 600, cursor: 'pointer',
          display: 'inline-flex', alignItems: 'center', gap: 5
        }}>
          <Icon name="download" size={12} /> Export
        </button>
        <span style={{ flex: 1 }} />
        <span style={{ fontSize: 9, color: 'var(--ink-muted)' }} className="mono">trace · 8c2f1a</span>
      </div>
    </div>
  );
};

window.ScreenInlineScenes = ScreenInlineScenes;

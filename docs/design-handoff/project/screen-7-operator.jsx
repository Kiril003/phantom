// Screen 7 — Operator — distinctive
// Unique: live plan-tree visualization (running state), token usage meter,
// inner-monologue with mixed event types, smart goal templates with categories

const ScreenOperator = () => (
  <div className="phantom-frame">
    <StatusBar state="● OPERATOR · RUNNING" stateTone="amber" clock="07:38:09" sensors={false} />

    {/* === HERO CARD with running goal === */}
    <div className="glass" style={{
      position: 'absolute', top: 68, left: 12, right: 12,
      height: 132, padding: 16,
      display: 'flex', alignItems: 'center', gap: 16,
      zIndex: 3,
      borderColor: 'rgba(244,175,37,0.4)'
    }}>
      {/* live ring */}
      <div style={{ position: 'relative', width: 84, height: 84, flexShrink: 0 }}>
        <svg viewBox="0 0 84 84" style={{ position: 'absolute', inset: 0 }}>
          <circle cx="42" cy="42" r="36" fill="none" stroke="rgba(244,175,37,0.18)" strokeWidth="3" />
          <circle cx="42" cy="42" r="36" fill="none"
            stroke="url(#runRing)" strokeWidth="3" strokeLinecap="round"
            strokeDasharray={`${2 * Math.PI * 36 * 0.42} ${2 * Math.PI * 36}`}
            transform="rotate(-90 42 42)"
            style={{ animation: 'orb-breathe 3s ease-in-out infinite' }} />
          <defs>
            <linearGradient id="runRing" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%" stopColor="#f4af25" /><stop offset="100%" stopColor="#fb923c" />
            </linearGradient>
          </defs>
        </svg>
        <div style={{
          position: 'absolute', inset: 12, borderRadius: 999,
          background: 'radial-gradient(circle at 35% 30%,#fff,#fde9b8,#f4af25)',
          animation: 'orb-breathe 4s ease-in-out infinite',
          boxShadow: '0 0 18px rgba(244,175,37,0.5)'
        }} />
      </div>

      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 5 }}>
          <span className="eyebrow-amber">OPERATOR · GOAL</span>
          <span style={{
            display: 'inline-flex', alignItems: 'center', gap: 5,
            padding: '2px 9px', borderRadius: 999,
            background: 'rgba(244,175,37,0.18)',
            border: '1px solid rgba(244,175,37,0.4)',
            fontSize: 9, fontWeight: 700, letterSpacing: '0.16em',
            color: '#8a5e0a'
          }}>
            <span style={{ width: 5, height: 5, borderRadius: 999, background: '#f4af25', animation: 'phantom-pulse 1s ease-in-out infinite' }} />
            RUNNING · STEP 4/9
          </span>
          <span style={{ fontSize: 10, color: 'var(--ink-muted)' }}>started 07:35:12 · 2m 57s</span>
        </div>
        <div className="playfair" style={{ fontSize: 19, color: 'var(--ink)', lineHeight: 1.25 }}>
          “Знайди презентацію Q3, заміни графік на свіжі дані з пошти, і надішли Лені до 09:00.”
        </div>
      </div>

      {/* stats */}
      <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
        <div style={{ padding: '8px 12px', borderRadius: 10, background: 'rgba(255,255,255,0.55)', border: '1px solid rgba(255,255,255,0.6)', minWidth: 110 }}>
          <div className="micro-label">BUDGET</div>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 3 }}>
            <span className="tabular" style={{ fontSize: 16, fontWeight: 700 }}>14</span>
            <span style={{ fontSize: 10, color: 'var(--ink-muted)' }}>/ 30 actions</span>
          </div>
          <div style={{ height: 3, marginTop: 4, borderRadius: 2, background: 'rgba(0,0,0,0.06)' }}>
            <div style={{ width: '47%', height: '100%', background: '#f4af25', borderRadius: 2 }} />
          </div>
          <div style={{ fontSize: 9, color: 'var(--ink-muted)', marginTop: 2 }}>2 reflections used</div>
        </div>
        <div style={{ padding: '8px 12px', borderRadius: 10, background: 'rgba(255,255,255,0.55)', border: '1px solid rgba(255,255,255,0.6)', minWidth: 110 }}>
          <div className="micro-label">TOKENS</div>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 3 }}>
            <span className="tabular" style={{ fontSize: 16, fontWeight: 700 }}>18.4k</span>
            <span style={{ fontSize: 10, color: 'var(--ink-muted)' }}>/ 50k</span>
          </div>
          <div style={{ height: 3, marginTop: 4, borderRadius: 2, background: 'rgba(0,0,0,0.06)' }}>
            <div style={{ width: '37%', height: '100%', background: 'linear-gradient(90deg,#f4af25,#fb923c)', borderRadius: 2 }} />
          </div>
          <div style={{ fontSize: 9, color: 'var(--ink-muted)', marginTop: 2 }}>Gemini · 1.5 Pro</div>
        </div>
      </div>
    </div>

    {/* === PLAN TREE (left) === */}
    <div className="glass" style={{
      position: 'absolute', top: 212, left: 12, width: 300, bottom: 200,
      padding: 14, zIndex: 2,
      display: 'flex', flexDirection: 'column'
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
        <Icon name="account_tree" size={14} style={{ color: '#b07a10' }} fill={1} />
        <span className="eyebrow-amber">PLAN TREE · 9 STEPS</span>
      </div>

      <div style={{ flex: 1, overflow: 'hidden', position: 'relative' }}>
        {/* connector line */}
        <div style={{ position: 'absolute', left: 8, top: 8, bottom: 8, width: 1.5, background: 'rgba(244,175,37,0.3)' }} />

        {[
          { i: 1, label: 'Шукаю файл "Q3 deck"', state: 'done', tool: 'file.search' },
          { i: 2, label: 'Знайдено 3 кандидати → обрано latest', state: 'done', tool: 'reflect' },
          { i: 3, label: 'Читаю поточний графік', state: 'done', tool: 'pptx.read' },
          { i: 4, label: 'Дістаю свіжі дані з пошти Q3', state: 'running', tool: 'mail.search' },
          { i: 5, label: 'Парсинг таблиці з вкладення', state: 'pending' },
          { i: 6, label: 'Заміна графіка', state: 'pending' },
          { i: 7, label: 'Експорт PDF + .pptx', state: 'pending' },
          { i: 8, label: 'Підготовка повідомлення для Лени', state: 'pending' },
          { i: 9, label: 'Підтвердження перед надсиланням', state: 'pending', highlight: true },
        ].map((step, idx) => {
          const colors = {
            done: { dot: '#22c55e', bg: 'rgba(34,197,94,0.08)', text: 'var(--ink-secondary)', border: 'rgba(34,197,94,0.2)' },
            running: { dot: '#f4af25', bg: 'rgba(244,175,37,0.18)', text: 'var(--ink)', border: 'rgba(244,175,37,0.4)' },
            pending: { dot: 'rgba(0,0,0,0.15)', bg: 'transparent', text: 'var(--ink-muted)', border: 'rgba(0,0,0,0.06)' },
          };
          const c = colors[step.state];
          return (
            <div key={idx} style={{ display: 'flex', alignItems: 'flex-start', gap: 10, marginBottom: 7, position: 'relative' }}>
              <div style={{
                width: 17, height: 17, borderRadius: 999,
                background: step.state === 'done' ? c.dot : 'white',
                border: `2px solid ${c.dot}`,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                flexShrink: 0,
                boxShadow: step.state === 'running' ? '0 0 0 4px rgba(244,175,37,0.2)' : 'none',
                animation: step.state === 'running' ? 'phantom-pulse 1.4s ease-in-out infinite' : 'none',
                zIndex: 1
              }}>
                {step.state === 'done' && <Icon name="check" size={9} style={{ color: 'white' }} weight={700} />}
                {step.state === 'running' && <span style={{ width: 5, height: 5, borderRadius: 999, background: c.dot }} />}
              </div>
              <div style={{
                flex: 1, padding: '6px 10px', borderRadius: 8,
                background: c.bg,
                border: `1px solid ${c.border}`,
                fontSize: 11
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span style={{ color: 'var(--ink-muted)', fontSize: 9, fontWeight: 700, letterSpacing: '0.05em' }}>{String(step.i).padStart(2,'0')}</span>
                  {step.tool && <span className="mono" style={{ fontSize: 9, padding: '1px 5px', borderRadius: 4, background: 'rgba(244,175,37,0.15)', color: '#8a5e0a' }}>{step.tool}</span>}
                  {step.highlight && <span style={{ fontSize: 8, padding: '1px 5px', borderRadius: 4, background: 'rgba(0,0,0,0.06)', color: 'var(--ink-secondary)', fontWeight: 700, letterSpacing: '0.1em' }}>HUMAN-IN-LOOP</span>}
                </div>
                <div style={{ marginTop: 2, color: c.text, fontWeight: step.state === 'running' ? 600 : 400 }}>
                  {step.label}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>

    {/* === INNER MONOLOGUE (right) === */}
    <div className="glass" style={{
      position: 'absolute', top: 212, left: 324, right: 12, bottom: 200,
      padding: 14, zIndex: 2,
      display: 'flex', flexDirection: 'column'
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
        <Icon name="psychology_alt" size={14} style={{ color: '#b07a10' }} fill={1} />
        <span className="eyebrow-amber">INNER MONOLOGUE</span>
        <span style={{ fontSize: 9, padding: '1px 7px', borderRadius: 999, background: 'rgba(244,175,37,0.15)', color: '#8a5e0a', fontWeight: 700 }}>14 events</span>
        <span style={{ flex: 1 }} />
        <button style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--ink-muted)', display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 10 }}>
          <Icon name="filter_list" size={12} /> filter
        </button>
      </div>

      <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column', gap: 6 }}>
        {[
          { t: '07:35', tool: 'reflect', tone: 'thought', txt: '"Користувач просить замінити графік. Спочатку знайду файл, потім дані."' },
          { t: '07:35', tool: 'file.search', tone: 'tech', txt: 'query="Q3 deck" → 3 results · ~/Documents/' },
          { t: '07:36', tool: 'reflect', tone: 'thought', txt: '"Latest = q3-deck-v4.pptx, modified 2 days ago. Беру цей."' },
          { t: '07:36', tool: 'pptx.read', tone: 'tech', txt: 'parsed 12 slides · chart on slide 5 · type=line' },
          { t: '07:37', tool: 'mail.search', tone: 'running', txt: 'searching: "q3 sales attached" · last 14 days…' },
          { t: '07:38', tool: 'reflect', tone: 'pending', txt: '↳ Will need to confirm Lena email before sending.' },
        ].map((e, i) => {
          const tones = {
            thought: { dot: '#b07a10', bg: 'rgba(244,175,37,0.05)', font: 'playfair' },
            tech: { dot: '#22c55e', bg: 'rgba(255,255,255,0.4)', font: 'mono' },
            running: { dot: '#f4af25', bg: 'rgba(244,175,37,0.15)', font: 'mono' },
            pending: { dot: 'rgba(0,0,0,0.2)', bg: 'transparent', font: 'sans' },
          };
          const c = tones[e.tone];
          return (
            <div key={i} style={{ display: 'flex', gap: 8, fontSize: 11, padding: '6px 10px', borderRadius: 8, background: c.bg, border: '1px solid rgba(255,255,255,0.4)' }}>
              <span className="tabular" style={{ fontSize: 9, fontWeight: 600, color: 'var(--ink-muted)', flexShrink: 0, paddingTop: 1 }}>{e.t}</span>
              <span className="mono" style={{
                fontSize: 9, padding: '2px 6px', borderRadius: 5,
                background: 'rgba(244,175,37,0.15)', color: '#8a5e0a',
                fontWeight: 600, flexShrink: 0, alignSelf: 'flex-start'
              }}>{e.tool}</span>
              {c.font === 'playfair' ? (
                <span className="playfair" style={{ flex: 1, fontSize: 13, color: 'var(--ink-secondary)', lineHeight: 1.3 }}>{e.txt}</span>
              ) : c.font === 'mono' ? (
                <span className="mono" style={{ flex: 1, fontSize: 11, color: 'var(--ink-secondary)' }}>{e.txt}</span>
              ) : (
                <span style={{ flex: 1, color: 'var(--ink-muted)' }}>{e.txt}</span>
              )}
              {e.tone === 'running' && (
                <span style={{ display: 'flex', gap: 2 }}>
                  {[0,1,2].map(j => <span key={j} style={{ width: 3, height: 3, borderRadius: 999, background: '#b07a10', animation: `phantom-pulse ${0.8 + j*0.15}s ease-in-out infinite` }} />)}
                </span>
              )}
            </div>
          );
        })}
      </div>
    </div>

    {/* === QUICK GOAL CHIPS === */}
    <div style={{
      position: 'absolute', bottom: 132, left: 12, right: 12,
      display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center', zIndex: 4
    }}>
      <span className="micro-label" style={{ marginRight: 4 }}>SHORTCUTS</span>
      {[
        { i: 'description', t: 'Знайди мою презентацію', cat: 'files' },
        { i: 'mail', t: 'Підсумуй пошту', cat: 'mail' },
        { i: 'event', t: 'Зустріч о 14', cat: 'cal' },
        { i: 'terminal', t: 'Скрипт для backup', cat: 'shell' },
        { i: 'translate', t: 'Переклад документа', cat: 'lang' },
      ].map((c, i) => (
        <button key={i} className="sub-glass" style={{
          padding: '6px 12px', borderRadius: 999, fontSize: 11,
          color: 'var(--ink-secondary)', cursor: 'pointer',
          border: '1px solid rgba(255,255,255,0.55)',
          display: 'inline-flex', alignItems: 'center', gap: 5
        }}>
          <Icon name={c.i} size={11} style={{ color: '#b07a10' }} />
          {c.t}
        </button>
      ))}
    </div>

    {/* === INPUT === */}
    <div className="glass-strong" style={{
      position: 'absolute', bottom: 76, left: 12, right: 12,
      height: 48, padding: '6px 8px',
      display: 'flex', alignItems: 'center', gap: 8,
      borderRadius: 14, zIndex: 5
    }}>
      <button style={{ width: 36, height: 36, borderRadius: 10, background: 'transparent', border: 'none', color: 'var(--ink-secondary)', cursor: 'pointer' }}>
        <Icon name="attach_file" size={16} />
      </button>
      <button style={{
        width: 36, height: 36, borderRadius: 10,
        background: 'rgba(244,175,37,0.18)',
        border: '1px solid rgba(244,175,37,0.4)',
        color: '#8a5e0a', cursor: 'pointer',
        display: 'flex', alignItems: 'center', justifyContent: 'center'
      }}>
        <Icon name="mic" size={16} fill={1} />
      </button>
      <span className="playfair" style={{ flex: 1, fontSize: 14, color: 'var(--ink-muted)' }}>
        Tell PHANTOM what to do…
      </span>
      <span className="mono" style={{ fontSize: 10, color: 'var(--ink-muted)', padding: '3px 8px', borderRadius: 6, background: 'rgba(0,0,0,0.05)' }}>⌃↵ run</span>
      <button style={{
        height: 36, padding: '0 16px', borderRadius: 10,
        background: 'linear-gradient(135deg,#f4af25,#fb923c)',
        border: 'none', cursor: 'pointer',
        color: 'white', fontSize: 12, fontWeight: 700,
        display: 'inline-flex', alignItems: 'center', gap: 6,
        boxShadow: '0 4px 12px rgba(244,175,37,0.4)'
      }}>
        Run
        <Icon name="arrow_forward" size={14} weight={500} />
      </button>
    </div>

    <FloatingToolbar active="terminal" />
  </div>
);

window.ScreenOperator = ScreenOperator;

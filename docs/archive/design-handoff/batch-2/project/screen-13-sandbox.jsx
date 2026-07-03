// Section 07 — Sandbox & Terminal: 2 frames

// ──────────────────────────────────────────────────────────────────
// 7A — sandbox-fullscreen (ROOT executor)
// ──────────────────────────────────────────────────────────────────
const ScreenSandboxFullscreen = () => (
  <div className="phantom-frame coral-tint">
    {/* Header strip — coral-protected mode */}
    <div className="glass-strong" style={{
      position: 'absolute', top: 12, left: 12, right: 12, height: 44,
      borderRadius: 12, padding: '0 14px',
      display: 'flex', alignItems: 'center', gap: 10, zIndex: 5,
      border: '1px solid rgba(239,68,68,0.3)'
    }}>
      <StatusPill tone="coral">SANDBOX · ROOT</StatusPill>
      <Divider />
      <Icon name="shield" size={14} fill={1} style={{ color: '#b9201f' }} />
      <span style={{ fontSize: 11, color: 'var(--ink-secondary)', fontWeight: 600 }}>
        SESSION <span className="tabular" style={{ color: 'var(--ink)' }}>3a8c12</span> · started <span className="tabular">07:42</span>
      </span>
      <span style={{ flex: 1 }} />
      <span className="micro-label" style={{ color: '#b9201f' }}>PROTECTED MODE · ESP32 RGB STRIP CORAL</span>
    </div>

    {/* === LEFT — INPUT/PLAN === */}
    <div className="glass" style={{
      position: 'absolute', top: 68, left: 12, bottom: 12, width: 500,
      borderRadius: 14, padding: 16, zIndex: 3,
      display: 'flex', flexDirection: 'column', gap: 10
    }}>
      <div className="eyebrow-amber" style={{ color: '#b9201f' }}>BUILD PLAN · LIVE</div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <PlanStep status="done" text="Парсинг команди користувача" />
        <PlanStep status="done" text="Перевірка sandbox обмежень" />
        <PlanStep status="running" text="Збирання Python скрипта" />
        <PlanStep status="pending" text="Виконання у jail-середовищі" />
        <PlanStep status="pending" text="Парсинг output для звіту" />
      </div>

      {/* AI thoughts */}
      <div style={{
        marginTop: 4,
        padding: '10px 12px',
        borderRadius: 10,
        background: 'rgba(244,175,37,0.10)',
        border: '1px solid rgba(244,175,37,0.25)',
      }}>
        <div className="eyebrow-amber" style={{ fontSize: 9 }}>AI THINKING</div>
        <div className="playfair" style={{ marginTop: 6, fontSize: 13, fontStyle: 'italic', color: 'var(--ink-secondary)', lineHeight: 1.5 }}>
          "Скрипт буде в <span className="mono" style={{ fontStyle: 'normal', fontSize: 11, color: 'var(--ink)' }}>/tmp/sb_3a8c12.py</span>. Дам йому 30 сек."
        </div>
        <div className="playfair" style={{ marginTop: 4, fontSize: 13, fontStyle: 'italic', color: 'var(--ink-secondary)', lineHeight: 1.5 }}>
          "Без імпортів <span className="mono" style={{ fontStyle: 'normal', fontSize: 11, color: '#b9201f' }}>os.system</span> — використовую <span className="mono" style={{ fontStyle: 'normal', fontSize: 11, color: 'var(--ink)' }}>subprocess.run</span> із timeout."
        </div>
      </div>

      <span style={{ flex: 1 }} />

      {/* command input */}
      <div className="sub-glass" style={{ padding: '10px 12px', borderRadius: 10 }}>
        <div className="eyebrow" style={{ fontSize: 9 }}>COMMAND · PYTHON</div>
        <div className="mono" style={{ marginTop: 6, fontSize: 11, lineHeight: 1.5, color: 'var(--ink)' }}>
          <span style={{ color: '#8a5e0a' }}>import</span> subprocess, pathlib<br/>
          files = pathlib.Path(<span style={{ color: '#b9201f' }}>"/tmp"</span>).glob(<span style={{ color: '#b9201f' }}>"*.cache"</span>)<br/>
          <span style={{ color: '#8a5e0a' }}>for</span> f <span style={{ color: '#8a5e0a' }}>in</span> files: f.unlink()
        </div>
      </div>

      <button style={{
        height: 44, borderRadius: 12, border: 'none', cursor: 'pointer',
        background: 'linear-gradient(135deg,#ef4444,#b9201f)',
        color: '#fff',
        fontSize: 13, fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase',
        display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
        boxShadow: '0 8px 24px rgba(239,68,68,0.35), 0 0 0 1px rgba(239,68,68,0.5)'
      }}>
        <Icon name="shield" size={16} fill={1} />
        EXECUTE
      </button>
    </div>

    {/* === RIGHT — LIVE OUTPUT === */}
    <div style={{
      position: 'absolute', top: 68, right: 12, bottom: 12, width: 500,
      borderRadius: 14, zIndex: 3,
      background: 'linear-gradient(180deg, rgba(34,28,16,0.94), rgba(20,16,10,0.94))',
      border: '1px solid rgba(244,175,37,0.25)',
      display: 'flex', flexDirection: 'column', overflow: 'hidden',
      boxShadow: '0 12px 30px rgba(0,0,0,0.25)'
    }}>
      {/* terminal header */}
      <div style={{
        padding: '10px 14px',
        borderBottom: '1px solid rgba(244,175,37,0.18)',
        display: 'flex', alignItems: 'center', gap: 8,
        color: '#f5e7c8'
      }}>
        <Icon name="terminal" size={14} style={{ color: '#f4af25' }} />
        <span style={{ fontSize: 11, fontWeight: 600, letterSpacing: '0.08em' }}>STDOUT · LIVE</span>
        <span style={{ flex: 1 }} />
        <span style={{ fontSize: 10, color: '#8a7f72', fontVariantNumeric: 'tabular-nums' }}>1.2 KB</span>
        <button style={{
          height: 22, padding: '0 8px', borderRadius: 6, cursor: 'pointer',
          background: 'rgba(244,175,37,0.15)', border: '1px solid rgba(244,175,37,0.3)',
          color: '#f4af25', fontSize: 9, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase'
        }}>↓ scroll</button>
      </div>

      {/* terminal body */}
      <div className="mono no-scrollbar" style={{
        flex: 1, padding: '12px 14px',
        fontSize: 11, lineHeight: 1.55,
        color: '#f4af25', overflow: 'auto',
        display: 'flex', flexDirection: 'column', gap: 2
      }}>
        <div><span style={{ color: '#8a7f72' }}>phantom@root</span> <span style={{ color: '#f5e7c8' }}>~/sandbox</span> $ ls /tmp</div>
        <div style={{ paddingLeft: 12, color: '#fb923c' }}>cache_a82c.cache  cache_b01d.cache  cache_d9ff.cache  cache_e21a.cache</div>
        <div style={{ marginTop: 6 }}><span style={{ color: '#8a7f72' }}>phantom@root</span> $ python /tmp/sb_3a8c12.py</div>
        <div style={{ paddingLeft: 12, color: '#f5e7c8' }}>[INFO] starting sweep · target /tmp · pattern *.cache</div>
        <div style={{ paddingLeft: 12, color: '#22c55e' }}>[+] removed cache_a82c.cache (4.2 KB)</div>
        <div style={{ paddingLeft: 12, color: '#22c55e' }}>[+] removed cache_b01d.cache (1.8 KB)</div>
        <div style={{ paddingLeft: 12, color: '#22c55e' }}>[+] removed cache_d9ff.cache (12.1 KB)</div>
        <div style={{ paddingLeft: 12, color: '#22c55e' }}>[+] removed cache_e21a.cache (3.9 KB)</div>
        <div style={{ paddingLeft: 12, color: '#f5e7c8', marginTop: 4 }}>[INFO] verifying integrity…</div>
        <div style={{ paddingLeft: 12, color: '#ef4444' }}>[WARN] /tmp/.lock — permission denied (skipped)</div>
        <div style={{ marginTop: 4, paddingLeft: 12 }}>
          <span style={{ color: '#ef4444' }}>Traceback (most recent call last):</span>
        </div>
        <div style={{ paddingLeft: 24, color: '#8a7f72' }}>File "/tmp/sb_3a8c12.py", line 14, in &lt;module&gt;</div>
        <div style={{ paddingLeft: 24, color: '#f5e7c8' }}>verify_quota(target)</div>
        <div style={{ paddingLeft: 24, color: '#ef4444' }}>QuotaError: sealed-region access requires ROOT confirm</div>
        <div style={{ marginTop: 6, color: '#22c55e' }}>process completed · exit 0 · 4.7s</div>
        {/* cursor */}
        <div style={{ marginTop: 4, display: 'flex', alignItems: 'center', gap: 4 }}>
          <span style={{ color: '#8a7f72' }}>phantom@root</span>
          <span> $ </span>
          <span style={{
            display: 'inline-block', width: 7, height: 13,
            background: '#f4af25',
            animation: 'phantom-pulse 1.1s steps(1) infinite'
          }} />
        </div>
      </div>

      {/* quick actions footer */}
      <div style={{
        padding: '8px 12px',
        borderTop: '1px solid rgba(244,175,37,0.18)',
        display: 'flex', gap: 6,
        background: 'rgba(20,16,10,0.5)'
      }}>
        {[
          { icon: 'content_copy', label: 'copy output' },
          { icon: 'replay', label: 'rerun' },
          { icon: 'save', label: 'save trace' },
        ].map((b, i) => (
          <button key={i} style={{
            height: 28, padding: '0 10px', borderRadius: 8, cursor: 'pointer',
            background: 'rgba(244,175,37,0.10)', border: '1px solid rgba(244,175,37,0.25)',
            color: '#f5e7c8', fontSize: 10, fontWeight: 600,
            display: 'flex', alignItems: 'center', gap: 6
          }}>
            <Icon name={b.icon} size={12} style={{ color: '#f4af25' }} />
            {b.label}
          </button>
        ))}
        <span style={{ flex: 1 }} />
        <button style={{
          height: 28, padding: '0 10px', borderRadius: 8, cursor: 'pointer',
          background: 'rgba(239,68,68,0.18)', border: '1px solid rgba(239,68,68,0.4)',
          color: '#fca5a5', fontSize: 10, fontWeight: 700, letterSpacing: '0.08em',
          display: 'flex', alignItems: 'center', gap: 6
        }}>
          <Icon name="stop_circle" size={12} fill={1} />
          KILL (ROOT)
        </button>
      </div>
    </div>

    {/*
    ANIMATION HINT — sandbox build sequence (JS stub):
    // Step 3 dots stream
    setInterval(() => {
      const dots = document.querySelector('.plan-running-dots');
      dots.textContent = ['.','..','...'][tick++ % 3];
    }, 200);
    // STDOUT lines stream bottom-up via slide-up-fade
    function appendLine(text) {
      const div = document.createElement('div');
      div.className = 'stdout-line';
      div.style.animation = `slide-up-fade ${200 + text.length * 4}ms ease-out`;
      div.textContent = text;
      terminal.appendChild(div);
      terminal.scrollTop = terminal.scrollHeight;
    }
    // ESP32 RGB strip — bind frame edges to coral pulse via WebSocket
    rgbStrip.send({ mode: 'protected', color: '#ef4444', pulse: 1.4 });
    // Reduced motion: drop animations, batch-render output
    */}
  </div>
);

const PlanStep = ({ status, text }) => {
  const colors = {
    done:    { dot: '#22c55e', text: 'var(--ink-secondary)', icon: 'check_circle' },
    running: { dot: '#f4af25', text: 'var(--ink)',           icon: 'play_arrow'   },
    pending: { dot: 'rgba(0,0,0,0.15)', text: 'var(--ink-muted)', icon: 'circle' }
  }[status];
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 10,
      padding: '8px 10px', borderRadius: 8,
      background: status === 'running' ? 'rgba(244,175,37,0.14)' : 'transparent',
      border: status === 'running' ? '1px solid rgba(244,175,37,0.32)' : '1px solid transparent',
      boxShadow: status === 'running' ? 'inset 0 0 12px rgba(244,175,37,0.18)' : 'none'
    }}>
      <Icon name={colors.icon} size={16} fill={status === 'done' || status === 'running' ? 1 : 0} style={{ color: colors.dot }} />
      <span style={{ fontSize: 12, fontWeight: status === 'running' ? 700 : 500, color: colors.text }}>
        {text}
        {status === 'running' && (
          <span style={{ marginLeft: 6, color: '#f4af25', fontFamily: 'monospace' }}>
            <span style={{ animation: 'phantom-pulse 0.6s ease-in-out infinite' }}>·</span>
            <span style={{ animation: 'phantom-pulse 0.6s ease-in-out infinite', animationDelay: '0.2s' }}>·</span>
            <span style={{ animation: 'phantom-pulse 0.6s ease-in-out infinite', animationDelay: '0.4s' }}>·</span>
          </span>
        )}
      </span>
      {status === 'running' && (
        <span className="micro-label" style={{ marginLeft: 'auto', color: '#b07a10' }}>RUNNING</span>
      )}
    </div>
  );
};

// ──────────────────────────────────────────────────────────────────
// 7B — inline-sandbox-result (in-chat scene)
// ──────────────────────────────────────────────────────────────────
const ScreenInlineSandbox = () => (
  <div className="phantom-frame">
    {/* center the inline scene against a neutral chat-like backdrop */}
    <div style={{
      position: 'absolute', inset: 0,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      padding: 24
    }}>
      <InlineSandboxCard />
    </div>

    {/* ambient chat bubble hint above */}
    <div className="glass" style={{
      position: 'absolute', top: 36, left: '50%', transform: 'translateX(-50%)',
      maxWidth: 480, padding: '10px 14px', borderRadius: 14
    }}>
      <div className="eyebrow-amber" style={{ fontSize: 9 }}>YOU · 07:42</div>
      <div style={{ marginTop: 4, fontSize: 13, color: 'var(--ink)' }}>
        Видали всі <span className="mono" style={{ fontSize: 11 }}>.cache</span> файли з <span className="mono" style={{ fontSize: 11 }}>/tmp</span> — в sandbox для початку.
      </div>
    </div>

    <div className="micro-label" style={{
      position: 'absolute', left: 0, right: 0, bottom: 16, textAlign: 'center'
    }}>
      INLINE SCENE · RENDERED BY ROOT-ACTION HANDLER · 540×260
    </div>
  </div>
);

const InlineSandboxCard = () => (
  <div style={{
    width: 540, position: 'relative',
    borderRadius: 16, overflow: 'hidden',
    background: 'rgba(255,255,255,0.7)',
    backdropFilter: 'blur(14px)',
    border: '1px solid rgba(255,255,255,0.6)',
    boxShadow: '0 16px 40px rgba(120,70,10,0.10), 0 2px 8px rgba(120,70,10,0.06)'
  }}>
    {/* coral stripe */}
    <div style={{
      position: 'absolute', left: 0, top: 0, bottom: 0, width: 3,
      background: 'linear-gradient(180deg,#ef4444,#b9201f)'
    }} />

    <div style={{ padding: '14px 18px 14px 22px' }}>
      {/* header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <Icon name="terminal" size={14} style={{ color: '#b9201f' }} />
        <span className="eyebrow-amber" style={{ color: '#b9201f', fontSize: 10 }}>BASH · EXECUTED BY ROOT</span>
        <span style={{ flex: 1 }} />
        <span style={{
          padding: '2px 8px', borderRadius: 999,
          background: 'rgba(34,197,94,0.12)', border: '1px solid rgba(34,197,94,0.32)',
          color: '#166534', fontSize: 9, fontWeight: 700, letterSpacing: '0.14em',
          fontVariantNumeric: 'tabular-nums'
        }}>EXIT 0</span>
      </div>

      {/* output preview */}
      <div className="mono" style={{
        marginTop: 10, padding: '10px 12px', borderRadius: 10,
        background: 'linear-gradient(180deg, rgba(34,28,16,0.94), rgba(20,16,10,0.94))',
        color: '#f4af25', fontSize: 11, lineHeight: 1.6
      }}>
        <div><span style={{ color: '#22c55e' }}>[+]</span> removed cache_a82c.cache <span style={{ color: '#8a7f72' }}>(4.2 KB)</span></div>
        <div><span style={{ color: '#22c55e' }}>[+]</span> removed cache_b01d.cache <span style={{ color: '#8a7f72' }}>(1.8 KB)</span></div>
        <div><span style={{ color: '#22c55e' }}>[+]</span> removed cache_d9ff.cache <span style={{ color: '#8a7f72' }}>(12.1 KB)</span></div>
        <div style={{ color: '#8a7f72', marginTop: 4 }}>… +12 more lines</div>
      </div>
      <button style={{
        marginTop: 6, padding: '4px 10px', borderRadius: 8,
        background: 'rgba(0,0,0,0.04)', border: '1px solid rgba(0,0,0,0.08)',
        cursor: 'pointer', fontSize: 10, fontWeight: 600,
        color: 'var(--ink-secondary)'
      }}>Show full output ↓</button>

      {/* AI commentary */}
      <div className="playfair" style={{
        marginTop: 12, fontSize: 14, fontStyle: 'italic',
        color: 'var(--ink-secondary)', lineHeight: 1.5
      }}>
        "Чисто. 4 файли видалені, симуляція на <span className="mono" style={{ fontSize: 11, fontStyle: 'normal', color: 'var(--ink)' }}>/tmp/</span>. Хочеш реальне виконання?"
      </div>

      {/* actions */}
      <div style={{ marginTop: 14, display: 'flex', gap: 8 }}>
        <button style={{
          flex: 1, height: 38, borderRadius: 10, cursor: 'pointer', border: 'none',
          background: 'linear-gradient(135deg,#ef4444,#b9201f)',
          color: '#fff', fontSize: 12, fontWeight: 700, letterSpacing: '0.1em',
          display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
          boxShadow: '0 6px 18px rgba(239,68,68,0.3)'
        }}>
          <Icon name="shield" size={14} fill={1} />
          RUN FOR REAL
        </button>
        <button className="sub-glass" style={{
          height: 38, padding: '0 14px', borderRadius: 10, cursor: 'pointer',
          fontSize: 12, fontWeight: 600, color: 'var(--ink-secondary)',
          display: 'flex', alignItems: 'center', gap: 6
        }}>
          <Icon name="edit" size={14} />
          Edit script
        </button>
        <button style={{
          height: 38, padding: '0 14px', borderRadius: 10, cursor: 'pointer',
          background: 'transparent', border: '1px dashed rgba(0,0,0,0.18)',
          fontSize: 12, fontWeight: 600, color: 'var(--ink-muted)'
        }}>
          Discard
        </button>
      </div>
    </div>
  </div>
);

window.ScreenSandboxFullscreen = ScreenSandboxFullscreen;
window.ScreenInlineSandbox = ScreenInlineSandbox;

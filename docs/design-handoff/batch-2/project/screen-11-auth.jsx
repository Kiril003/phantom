// Section 05 — Authentication: 3 frames

// ──────────────────────────────────────────────────────────────────
// 5A — pin-empty
// ──────────────────────────────────────────────────────────────────
const ScreenPinEmpty = () => (
  <div className="phantom-frame">
    {/* dimmed sun-orb at bottom */}
    <div style={{
      position: 'absolute', left: '50%', bottom: -120, transform: 'translateX(-50%)',
      width: 380, height: 380, borderRadius: 999,
      background: 'radial-gradient(circle at 50% 50%, rgba(244,175,37,0.4), rgba(251,146,60,0.2) 40%, transparent 70%)',
      filter: 'blur(12px)', opacity: 0.55, zIndex: 0,
      animation: 'orb-breathe 8s ease-in-out infinite', pointerEvents: 'none'
    }} />

    {/* operator card — centered */}
    <div className="glass" style={{
      position: 'absolute', left: '50%', top: 32, transform: 'translateX(-50%)',
      width: 180, height: 260, padding: 16,
      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'space-between',
      zIndex: 3
    }}>
      <div style={{ width: '100%', height: 152, borderRadius: 12, position: 'relative', overflow: 'hidden',
        background: 'linear-gradient(135deg,#f4af25,#fb923c 60%, #b07a10)' }}>
        <svg viewBox="0 0 152 152" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }}>
          {Array.from({length: 8}).map((_, i) => (
            <circle key={i} cx="76" cy="76" r={20 + i*8}
              fill="none" stroke="rgba(255,255,255,0.25)" strokeWidth="0.7" />
          ))}
          {Array.from({length: 12}).map((_, i) => {
            const a = (i / 12) * Math.PI * 2;
            return <line key={i} x1="76" y1="76"
              x2={76 + Math.cos(a)*72} y2={76 + Math.sin(a)*72}
              stroke="rgba(255,255,255,0.18)" strokeWidth="0.6" />;
          })}
          <circle cx="76" cy="76" r="14" fill="rgba(255,255,255,0.7)" />
        </svg>
      </div>
      <div style={{ textAlign: 'center', marginTop: 8 }}>
        <div className="eyebrow-amber" style={{ fontSize: 9 }}>ROOT</div>
        <div style={{ fontSize: 18, fontWeight: 600, color: 'var(--ink)', marginTop: 1 }}>phantom</div>
      </div>
    </div>

    {/* PIN dots */}
    <div style={{
      position: 'absolute', left: '50%', top: 312, transform: 'translateX(-50%)',
      display: 'flex', gap: 12, zIndex: 3
    }}>
      {Array.from({length: 6}).map((_, i) => (
        <div key={i} style={{
          width: 16, height: 16, borderRadius: 999,
          background: 'rgba(255,255,255,0.45)',
          border: '1.5px solid rgba(176,122,16,0.4)',
        }} />
      ))}
    </div>

    {/* Keypad */}
    <Keypad active={null} zIndex={3} />

    {/* whisper */}
    <div className="playfair" style={{
      position: 'absolute', left: 0, right: 0, bottom: 38, textAlign: 'center', zIndex: 3,
      fontSize: 13, fontStyle: 'italic', color: 'var(--ink-muted)'
    }}>
      "Скажіть свій код, або введіть руками."
    </div>

    {/* footer */}
    <div className="micro-label" style={{ position: 'absolute', left: 0, right: 0, bottom: 16, textAlign: 'center', zIndex: 3 }}>
      PHANTOM AUTH · ATTEMPTS 0 / 3
    </div>
  </div>
);

// ──────────────────────────────────────────────────────────────────
// 5B — pin-typing 3/6
// ──────────────────────────────────────────────────────────────────
const ScreenPinTyping = () => (
  <div className="phantom-frame">
    <div style={{
      position: 'absolute', left: '50%', bottom: -120, transform: 'translateX(-50%)',
      width: 380, height: 380, borderRadius: 999,
      background: 'radial-gradient(circle at 50% 50%, rgba(244,175,37,0.4), rgba(251,146,60,0.2) 40%, transparent 70%)',
      filter: 'blur(12px)', opacity: 0.55, zIndex: 0,
      animation: 'orb-breathe 8s ease-in-out infinite', pointerEvents: 'none'
    }} />

    <div className="glass" style={{
      position: 'absolute', left: '50%', top: 32, transform: 'translateX(-50%)',
      width: 180, height: 260, padding: 16,
      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'space-between',
      zIndex: 3, boxShadow: '0 0 0 1px rgba(244,175,37,0.4), 0 12px 40px rgba(244,175,37,0.18)'
    }}>
      <div style={{ width: '100%', height: 152, borderRadius: 12, position: 'relative', overflow: 'hidden',
        background: 'linear-gradient(135deg,#f4af25,#fb923c 60%, #b07a10)' }}>
        <svg viewBox="0 0 152 152" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }}>
          {Array.from({length: 8}).map((_, i) => (
            <circle key={i} cx="76" cy="76" r={20 + i*8}
              fill="none" stroke="rgba(255,255,255,0.25)" strokeWidth="0.7" />
          ))}
          <circle cx="76" cy="76" r="14" fill="rgba(255,255,255,0.7)" />
        </svg>
      </div>
      <div style={{ textAlign: 'center', marginTop: 8 }}>
        <div className="eyebrow-amber" style={{ fontSize: 9 }}>ROOT</div>
        <div style={{ fontSize: 18, fontWeight: 600, color: 'var(--ink)', marginTop: 1 }}>phantom</div>
      </div>
    </div>

    {/* PIN dots — 3 filled */}
    <div style={{
      position: 'absolute', left: '50%', top: 312, transform: 'translateX(-50%)',
      display: 'flex', gap: 12, zIndex: 3
    }}>
      {Array.from({length: 6}).map((_, i) => {
        const filled = i < 3;
        const isLatest = i === 2;
        return (
          <div key={i} style={{
            width: 16, height: 16, borderRadius: 999,
            background: filled ? 'linear-gradient(135deg,#f4af25,#fb923c)' : 'rgba(255,255,255,0.45)',
            border: filled ? 'none' : '1.5px solid rgba(176,122,16,0.4)',
            boxShadow: filled ? '0 0 0 1px rgba(244,175,37,0.4), 0 0 12px rgba(244,175,37,0.5)' : 'none',
            position: 'relative',
            animation: isLatest ? 'phantom-pulse 1.6s ease-in-out infinite' : 'none'
          }}>
            {isLatest && (
              <span style={{
                position: 'absolute', inset: -6, borderRadius: 999,
                border: '1.5px solid rgba(244,175,37,0.5)',
                animation: 'phantom-pulse 1.6s ease-in-out infinite'
              }} />
            )}
          </div>
        );
      })}
    </div>

    <Keypad active="5" zIndex={3} />

    <div className="playfair" style={{
      position: 'absolute', left: 0, right: 0, bottom: 38, textAlign: 'center', zIndex: 3,
      fontSize: 13, fontStyle: 'italic', color: 'var(--ink-muted)'
    }}>
      "Скажіть свій код, або введіть руками."
    </div>
    <div className="micro-label" style={{ position: 'absolute', left: 0, right: 0, bottom: 16, textAlign: 'center', zIndex: 3 }}>
      PHANTOM AUTH · ATTEMPTS 0 / 3
    </div>
  </div>
);

// ──────────────────────────────────────────────────────────────────
// 5C — pin-error-shake + rfid-waiting (split)
// ──────────────────────────────────────────────────────────────────
const ScreenPinErrorRfid = () => (
  <div className="phantom-frame">
    {/* divider */}
    <div style={{
      position: 'absolute', left: '50%', top: 24, bottom: 24, width: 1,
      background: 'linear-gradient(180deg, transparent, rgba(0,0,0,0.08), transparent)',
      zIndex: 2
    }} />

    {/* === LEFT — pin-error === */}
    <div style={{ position: 'absolute', left: 0, top: 0, width: 488, bottom: 0, zIndex: 3 }}>
      {/* coral flash */}
      <div style={{
        position: 'absolute', inset: 0,
        background: 'rgba(239,68,68,0.5)',
        animation: 'flash-coral 1.2s ease-in-out infinite',
        pointerEvents: 'none'
      }} />

      {/* attempt counter */}
      <div style={{
        position: 'absolute', top: 16, right: 16, zIndex: 3,
        padding: '4px 10px', borderRadius: 999,
        background: 'rgba(239,68,68,0.12)',
        border: '1px solid rgba(239,68,68,0.3)',
        color: '#b9201f', fontSize: 10, fontWeight: 700, letterSpacing: '0.16em'
      }}>1 / 3</div>

      {/* operator card with coral border */}
      <div className="glass" style={{
        position: 'absolute', left: '50%', top: 32, transform: 'translateX(-50%)',
        width: 160, height: 232, padding: 14,
        display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'space-between',
        boxShadow: '0 0 0 1.5px rgba(239,68,68,0.5), 0 12px 30px rgba(239,68,68,0.18)'
      }}>
        <div style={{ width: '100%', height: 132, borderRadius: 10, overflow: 'hidden',
          background: 'linear-gradient(135deg,#f4af25,#fb923c 60%, #b07a10)' }}>
          <svg viewBox="0 0 132 132" style={{ width: '100%', height: '100%' }}>
            {Array.from({length: 7}).map((_, i) => (
              <circle key={i} cx="66" cy="66" r={18 + i*7}
                fill="none" stroke="rgba(255,255,255,0.25)" strokeWidth="0.7" />
            ))}
          </svg>
        </div>
        <div style={{ textAlign: 'center', marginTop: 6 }}>
          <div className="eyebrow-amber" style={{ fontSize: 9 }}>ROOT</div>
          <div style={{ fontSize: 16, fontWeight: 600, marginTop: 1 }}>phantom</div>
        </div>
      </div>

      {/* shake-hint motion lines */}
      <svg style={{ position: 'absolute', left: 50, top: 110, width: 60, height: 60 }} viewBox="0 0 60 60">
        <path d="M 30 10 Q 8 25 30 40" fill="none" stroke="#ef4444" strokeWidth="1.5" strokeLinecap="round" opacity="0.5" />
        <path d="M 12 20 L 8 25 L 14 28" fill="none" stroke="#ef4444" strokeWidth="1.5" strokeLinecap="round" opacity="0.6" />
      </svg>
      <svg style={{ position: 'absolute', right: 50, top: 110, width: 60, height: 60 }} viewBox="0 0 60 60">
        <path d="M 30 10 Q 52 25 30 40" fill="none" stroke="#ef4444" strokeWidth="1.5" strokeLinecap="round" opacity="0.5" />
        <path d="M 48 20 L 52 25 L 46 28" fill="none" stroke="#ef4444" strokeWidth="1.5" strokeLinecap="round" opacity="0.6" />
      </svg>

      {/* PIN dots — all coral filled */}
      <div style={{
        position: 'absolute', left: '50%', top: 290, transform: 'translateX(-50%)',
        display: 'flex', gap: 10
      }}>
        {Array.from({length: 6}).map((_, i) => (
          <div key={i} style={{
            width: 14, height: 14, borderRadius: 999,
            background: 'linear-gradient(135deg,#ef4444,#b9201f)',
            boxShadow: '0 0 0 1px rgba(239,68,68,0.5), 0 0 8px rgba(239,68,68,0.4)'
          }} />
        ))}
      </div>

      {/* keypad — compact */}
      <KeypadCompact zIndex={3} top={326} />

      <div style={{
        position: 'absolute', left: 0, right: 0, bottom: 26,
        textAlign: 'center',
        fontSize: 10, fontWeight: 700, letterSpacing: '0.18em',
        color: '#b9201f'
      }}>
        НЕВІРНИЙ КОД · СПРОБУЙТЕ ЩЕ РАЗ
      </div>
    </div>

    {/* === RIGHT — rfid-waiting === */}
    <div style={{ position: 'absolute', right: 0, top: 0, width: 488, bottom: 0, zIndex: 3 }}>
      {/* concentric breathing rings */}
      <div style={{ position: 'absolute', left: '50%', top: '46%', transform: 'translate(-50%, -50%)', width: 340, height: 340 }}>
        {[340, 280, 220, 160].map((d, i) => (
          <div key={i} style={{
            position: 'absolute', left: '50%', top: '50%',
            transform: 'translate(-50%, -50%)',
            width: d, height: d, borderRadius: 999,
            border: `1.5px solid rgba(244,175,37,${0.5 - i*0.08})`,
            background: i === 3 ? 'radial-gradient(circle at 35% 30%, rgba(255,243,208,0.5), rgba(244,175,37,0.18))' : 'transparent',
            animation: `orb-breathe ${4 + i * 0.6}s ease-in-out infinite`,
            animationDelay: `${i * 0.4}s`
          }} />
        ))}
        {/* RFID chip icon center */}
        <div style={{
          position: 'absolute', left: '50%', top: '50%', transform: 'translate(-50%, -50%)',
          color: '#b07a10', display: 'flex', alignItems: 'center', justifyContent: 'center'
        }}>
          <Icon name="contactless" size={80} fill={1} weight={300} />
        </div>
      </div>

      <div className="playfair" style={{
        position: 'absolute', left: 24, right: 24, top: 60, textAlign: 'center',
        fontSize: 18, fontStyle: 'italic', color: 'var(--ink-secondary)'
      }}>
        "Піднесіть карту або браслет."
      </div>

      {/* progress bar */}
      <div style={{ position: 'absolute', left: 60, right: 60, bottom: 60 }}>
        <div style={{ height: 3, borderRadius: 2, background: 'rgba(255,255,255,0.5)', overflow: 'hidden', position: 'relative' }}>
          <div style={{
            position: 'absolute', left: '-30%', top: 0, bottom: 0, width: '30%',
            background: 'linear-gradient(90deg,transparent,#f4af25,#fb923c,transparent)',
            animation: 'rfid-scan 3s linear infinite'
          }} />
        </div>
        <style>{`@keyframes rfid-scan { 0% { left: -30%; } 100% { left: 100%; } }`}</style>
      </div>
      <div className="micro-label" style={{
        position: 'absolute', left: 0, right: 0, bottom: 26,
        textAlign: 'center', color: '#8a5e0a'
      }}>
        RFID READER · LISTENING · 13.56 MHz
      </div>
    </div>

    {/*
    ANIMATION HINT — RFID detection bloom (when card detected):
    1. idle      → rings pulsing as defined (loop)
    2. bloom     → 300ms: chip icon scale 1 → 1.3, all rings flash to opacity 1, glow burst (filter: drop-shadow saturated amber)
    3. checkmark → 200ms: chip icon morphs to <Icon name="check_circle" fill={1}/> (scale-in)
    4. fade      → 400ms: rings fade out, full sunrise gradient warms +10% saturation
    Trigger: setState('detected'); class .rfid-bloom on the rings container
    Reduced motion: skip stages 1-2, instant state change to checkmark
    */}
  </div>
);

// ──────────────────────────────────────────────────────────────────
// Keypad helpers
// ──────────────────────────────────────────────────────────────────
const Keypad = ({ active, zIndex = 3 }) => {
  const keys = [
    ['1','2','3'],
    ['4','5','6'],
    ['7','8','9'],
    ['mic','0','backspace'],
  ];
  return (
    <div style={{
      position: 'absolute', left: '50%', top: 348, transform: 'translateX(-50%)',
      display: 'grid', gridTemplateColumns: 'repeat(3, 88px)', gap: 8,
      zIndex
    }}>
      {keys.flat().map((k, i) => {
        const isIcon = k === 'mic' || k === 'backspace';
        const isActive = k === active;
        return (
          <button key={i} className={isActive ? 'glass-strong' : 'glass'} style={{
            width: 88, height: 56,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            cursor: 'pointer',
            border: isActive ? '1px solid rgba(244,175,37,0.5)' : undefined,
            boxShadow: isActive ? '0 0 0 2px rgba(244,175,37,0.25), inset 0 0 12px rgba(244,175,37,0.18)' : undefined,
            background: isActive ? 'rgba(244,175,37,0.18)' : undefined,
            color: isIcon ? '#b07a10' : 'var(--ink)',
            fontSize: isIcon ? 18 : 22,
            fontWeight: 300, fontVariantNumeric: 'tabular-nums'
          }}>
            {isIcon ? <Icon name={k} size={20} fill={k === 'mic' ? 1 : 0} /> : k}
          </button>
        );
      })}
    </div>
  );
};

const KeypadCompact = ({ top, zIndex = 3 }) => {
  const keys = [
    ['1','2','3'],
    ['4','5','6'],
    ['7','8','9'],
    ['mic','0','backspace'],
  ];
  return (
    <div style={{
      position: 'absolute', left: '50%', top, transform: 'translateX(-50%)',
      display: 'grid', gridTemplateColumns: 'repeat(3, 72px)', gap: 6,
      zIndex
    }}>
      {keys.flat().map((k, i) => {
        const isIcon = k === 'mic' || k === 'backspace';
        return (
          <button key={i} className="glass" style={{
            width: 72, height: 46,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            cursor: 'pointer',
            color: isIcon ? '#b07a10' : 'var(--ink)',
            fontSize: isIcon ? 14 : 18,
            fontWeight: 300, fontVariantNumeric: 'tabular-nums',
            border: '1px solid rgba(239,68,68,0.18)'
          }}>
            {isIcon ? <Icon name={k} size={16} fill={k === 'mic' ? 1 : 0} /> : k}
          </button>
        );
      })}
    </div>
  );
};

window.ScreenPinEmpty = ScreenPinEmpty;
window.ScreenPinTyping = ScreenPinTyping;
window.ScreenPinErrorRfid = ScreenPinErrorRfid;

// Section 06 — Sensor Overlays: 2 frames

// ──────────────────────────────────────────────────────────────────
// 6A — camera-overlay (face tracking fullscreen)
// ──────────────────────────────────────────────────────────────────
const ScreenCameraOverlay = () => (
  <div className="phantom-frame" style={{
    background: `
      radial-gradient(ellipse 90% 70% at 50% -10%, rgba(244,175,37,0.4) 0%, rgba(244,175,37,0) 60%),
      linear-gradient(180deg, #2a1f10 0%, #1a1612 60%, #0f0d0a 100%)
    `,
    color: '#f5e7c8'
  }}>
    {/* Live video placeholder — fills frame */}
    <div className="placeholder-stripe" style={{
      position: 'absolute', inset: 30,
      borderRadius: 12,
      background: `
        repeating-linear-gradient(135deg,
          rgba(244,175,37,0.10) 0px, rgba(244,175,37,0.10) 8px,
          rgba(244,175,37,0.04) 8px, rgba(244,175,37,0.04) 16px),
        radial-gradient(ellipse 60% 80% at 35% 50%, rgba(244,175,37,0.18), rgba(0,0,0,0.4) 65%),
        radial-gradient(ellipse 40% 60% at 75% 60%, rgba(251,146,60,0.10), transparent 70%),
        #1a1612
      `,
      border: '1px solid rgba(244,175,37,0.35)',
      boxShadow: 'inset 0 0 0 1px rgba(0,0,0,0.4), 0 0 0 1px rgba(244,175,37,0.18)'
    }} />

    {/* Frame edges (cinema bracket marks) */}
    {[
      {top: 30, left: 30, br: '12px 0 0 0'},
      {top: 30, right: 30, br: '0 12px 0 0'},
      {bottom: 30, left: 30, br: '0 0 0 12px'},
      {bottom: 30, right: 30, br: '0 0 12px 0'},
    ].map((p, i) => (
      <div key={i} style={{ position: 'absolute', width: 20, height: 20, ...p, pointerEvents: 'none', zIndex: 4 }}>
        <div style={{
          width: '100%', height: '100%',
          borderTop: i < 2 ? '2px solid #f4af25' : 'none',
          borderBottom: i >= 2 ? '2px solid #f4af25' : 'none',
          borderLeft: (i === 0 || i === 2) ? '2px solid #f4af25' : 'none',
          borderRight: (i === 1 || i === 3) ? '2px solid #f4af25' : 'none',
          borderRadius: p.br
        }} />
      </div>
    ))}

    {/* === FACE 1 — primary, locked === */}
    <FaceBox
      top={130} left={290} width={180} height={220}
      tone="amber" label="phantom · ROOT" conf="LOCKED · TRACKING"
      reticle showLandmarks
    />

    {/* === FACE 2 — secondary, unknown === */}
    <FaceBox
      top={170} left={620} width={120} height={150}
      tone="coral" label="unknown · 87%" conf="LOW CONF · NEW"
      dashed
    />

    {/* TOP-LEFT HUD: cam stats pill */}
    <div className="glass-strong" style={{
      position: 'absolute', top: 50, left: 50,
      padding: '8px 14px', borderRadius: 999,
      display: 'flex', alignItems: 'center', gap: 10,
      zIndex: 5,
      background: 'rgba(20,18,14,0.7)',
      border: '1px solid rgba(244,175,37,0.35)',
      color: '#f5e7c8'
    }}>
      <Icon name="videocam" size={16} fill={1} style={{ color: '#f4af25' }} />
      <span style={{ fontSize: 11, fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>
        CAM 0 · 1280×720 · 24fps · servo Δ +12° / -3°
      </span>
    </div>

    {/* TOP-RIGHT: biometric ID badge */}
    <div className="glass-strong" style={{
      position: 'absolute', top: 50, right: 50,
      padding: 10, borderRadius: 14,
      display: 'flex', alignItems: 'center', gap: 10,
      zIndex: 5,
      background: 'rgba(20,18,14,0.7)',
      border: '1px solid rgba(244,175,37,0.4)',
      width: 240,
      color: '#f5e7c8'
    }}>
      <div style={{
        width: 36, height: 36, borderRadius: 999,
        background: 'linear-gradient(135deg,#f4af25,#fb923c)',
        position: 'relative', overflow: 'hidden', flexShrink: 0
      }}>
        <svg viewBox="0 0 36 36" style={{ width: '100%', height: '100%' }}>
          {Array.from({length: 4}).map((_, i) => (
            <circle key={i} cx="18" cy="18" r={6 + i * 3} fill="none" stroke="rgba(255,255,255,0.3)" strokeWidth="0.5" />
          ))}
        </svg>
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.04em' }}>phantom · ROOT</div>
        <div style={{ marginTop: 4, height: 4, borderRadius: 2, background: 'rgba(255,255,255,0.12)', overflow: 'hidden' }}>
          <div style={{ width: '95%', height: '100%', background: 'linear-gradient(90deg,#f4af25,#fb923c)' }} />
        </div>
        <div style={{ marginTop: 3, fontSize: 9, color: '#f4af25', letterSpacing: '0.12em', fontWeight: 600 }}>CONF 95%</div>
      </div>
    </div>

    {/* BOTTOM-LEFT: live frame stats */}
    <div className="glass" style={{
      position: 'absolute', bottom: 50, left: 50,
      padding: '8px 12px', borderRadius: 10,
      display: 'flex', gap: 14,
      zIndex: 5,
      background: 'rgba(20,18,14,0.65)',
      border: '1px solid rgba(244,175,37,0.25)',
      color: '#f5e7c8',
      fontSize: 10, fontWeight: 600, fontVariantNumeric: 'tabular-nums'
    }}>
      <span><span style={{ color: '#8a7f72' }}>LATENCY </span><span style={{ color: '#f4af25' }}>18ms</span></span>
      <span><span style={{ color: '#8a7f72' }}>FACES </span><span style={{ color: '#f4af25' }}>2</span></span>
      <span><span style={{ color: '#8a7f72' }}>GAZE </span><span style={{ color: '#22c55e' }}>engaged →</span></span>
    </div>

    {/* BOTTOM-RIGHT: 3 quadrant action buttons */}
    <div style={{
      position: 'absolute', bottom: 50, right: 50,
      display: 'flex', gap: 8, zIndex: 5
    }}>
      {[
        { icon: 'pause', label: 'pause' },
        { icon: 'flash_on', label: 'IR illum' },
        { icon: 'close', label: 'exit' },
      ].map((b, i) => (
        <button key={i} className="glass" style={{
          width: 44, height: 44, borderRadius: 12,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          cursor: 'pointer',
          background: 'rgba(20,18,14,0.7)',
          border: '1px solid rgba(244,175,37,0.3)',
          color: '#f4af25'
        }}>
          <Icon name={b.icon} size={18} fill={i === 1 ? 1 : 0} />
        </button>
      ))}
    </div>

    {/* footer micro-label */}
    <div className="micro-label" style={{
      position: 'absolute', left: 0, right: 0, bottom: 14, textAlign: 'center',
      color: 'rgba(244,175,37,0.5)', zIndex: 5
    }}>
      FACE TRACKER · OPENCV HAARCASCADE + DLIB 68PT
    </div>

    {/*
    ANIMATION HINT — camera HUD:
    1. servo-lock indicator-tick on primary face: "LOCKED · TRACKING" blinks at 0.5Hz (opacity 1 → 0.4)
    2. landmark dots wobble ±1px on each axis at 8Hz (subtle jitter mimicking real tracker)
    3. gaze indicator arrow rotates ±15° based on simulated gaze direction (1Hz)
    4. reticle corners breathe: stroke-width 1.5 → 2.5 over 1.6s
    Reduced motion: freeze all timed loops; show last static frame
    */}
  </div>
);

// face bounding box helper
const FaceBox = ({ top, left, width, height, tone, label, conf, dashed, reticle, showLandmarks }) => {
  const stroke = tone === 'coral' ? '#ef4444' : '#f4af25';
  return (
    <div style={{ position: 'absolute', top, left, width, height, zIndex: 4 }}>
      {/* main bounding box */}
      <div style={{
        position: 'absolute', inset: 0,
        border: `${tone === 'coral' ? 2 : 4}px ${dashed ? 'dashed' : 'solid'} ${stroke}`,
        borderRadius: 4,
        boxShadow: tone === 'amber' ? `0 0 0 1px rgba(244,175,37,0.4), 0 0 24px rgba(244,175,37,0.5)` : 'none'
      }} />

      {/* label tab */}
      <div style={{
        position: 'absolute', top: -22, left: 0,
        padding: '2px 8px', borderRadius: '4px 4px 0 0',
        background: stroke,
        color: tone === 'coral' ? '#fff' : '#1a1612',
        fontSize: 9, fontWeight: 700, letterSpacing: '0.1em',
        textTransform: 'uppercase'
      }}>{label}</div>

      {/* conf tab below */}
      <div style={{
        position: 'absolute', bottom: -20, left: 0,
        fontSize: 9, fontWeight: 700, letterSpacing: '0.12em',
        color: stroke, textTransform: 'uppercase'
      }}>{conf}</div>

      {/* reticle corners */}
      {reticle && (
        <>
          {[
            { top: -6, left: -6, b: 'tl' },
            { top: -6, right: -6, b: 'tr' },
            { bottom: -6, left: -6, b: 'bl' },
            { bottom: -6, right: -6, b: 'br' },
          ].map((p, i) => (
            <div key={i} style={{
              position: 'absolute', width: 14, height: 14,
              ...p,
              borderTop: p.b.includes('t') ? `2px solid ${stroke}` : 'none',
              borderBottom: p.b.includes('b') ? `2px solid ${stroke}` : 'none',
              borderLeft: p.b.includes('l') ? `2px solid ${stroke}` : 'none',
              borderRight: p.b.includes('r') ? `2px solid ${stroke}` : 'none',
            }} />
          ))}
          {/* center crosshair */}
          <div style={{
            position: 'absolute', left: '50%', top: '50%', width: 1, height: 16,
            background: stroke, transform: 'translate(-50%, -50%)', opacity: 0.7
          }} />
          <div style={{
            position: 'absolute', left: '50%', top: '50%', width: 16, height: 1,
            background: stroke, transform: 'translate(-50%, -50%)', opacity: 0.7
          }} />
        </>
      )}

      {/* landmark mesh */}
      {showLandmarks && <FaceLandmarks width={width} height={height} stroke={stroke} />}
    </div>
  );
};

const FaceLandmarks = ({ width, height, stroke }) => {
  const cx = width / 2, cy = height / 2;
  // approximate dlib 68pt
  const points = [];
  // jaw line (17)
  for (let i = 0; i < 17; i++) {
    const t = i / 16;
    const x = cx + (t - 0.5) * width * 0.8;
    const y = cy + Math.sin(t * Math.PI) * height * 0.35 + height * 0.15;
    points.push([x, y, 'jaw']);
  }
  // brows (10)
  for (let i = 0; i < 5; i++) {
    const t = i / 4;
    points.push([cx - width * 0.22 + t * width * 0.18, cy - height * 0.18, 'brow']);
    points.push([cx + width * 0.04 + t * width * 0.18, cy - height * 0.18, 'brow']);
  }
  // nose (9)
  for (let i = 0; i < 4; i++) points.push([cx, cy - height * 0.10 + i * height * 0.05, 'nose']);
  for (let i = 0; i < 5; i++) points.push([cx - width * 0.06 + i * width * 0.03, cy + height * 0.08, 'nose']);
  // eyes (12)
  for (let i = 0; i < 6; i++) {
    const t = (i / 5) * Math.PI * 2;
    points.push([cx - width * 0.12 + Math.cos(t) * width * 0.05, cy - height * 0.08 + Math.sin(t) * height * 0.025, 'eye']);
    points.push([cx + width * 0.12 + Math.cos(t) * width * 0.05, cy - height * 0.08 + Math.sin(t) * height * 0.025, 'eye']);
  }
  // mouth (20)
  for (let i = 0; i < 12; i++) {
    const t = (i / 11) * Math.PI * 2;
    points.push([cx + Math.cos(t) * width * 0.15, cy + height * 0.20 + Math.sin(t) * height * 0.05, 'mouth']);
  }

  return (
    <svg style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none' }}>
      {/* connector lines */}
      <polyline
        points={points.filter(p => p[2] === 'jaw').map(p => `${p[0]},${p[1]}`).join(' ')}
        fill="none" stroke={stroke} strokeWidth="0.6" opacity="0.3"
      />
      {/* dots */}
      {points.map((p, i) => (
        <circle key={i} cx={p[0]} cy={p[1]} r="1.5" fill={stroke} opacity="0.8" />
      ))}
    </svg>
  );
};

// ──────────────────────────────────────────────────────────────────
// 6B — networks-overlay (WiFi + BLE tabs)
// ──────────────────────────────────────────────────────────────────
const networks = [
  { ssid: 'PHANTOM-MESH-5G', sec: true, band: '5GHz', rssi: -45, bars: 5, bssid: 'a4:f7:db:12', ch: 36, last: 'now', active: true },
  { ssid: 'Foundry_Café',    sec: true, band: '5GHz', rssi: -54, bars: 4, bssid: '8c:a1:e2:99', ch: 44, last: 'now' },
  { ssid: 'kyivstar_home_2g',sec: true, band: '2.4GHz', rssi: -62, bars: 4, bssid: 'b8:ee:0e:34', ch: 6,  last: 'now' },
  { ssid: 'Vodafone_KV-9c2', sec: true, band: '5GHz', rssi: -68, bars: 3, bssid: 'fc:8a:3d:7e', ch: 48, last: '2m' },
  { ssid: 'CIRCUITS_office', sec: true, band: '5GHz', rssi: -71, bars: 3, bssid: '3a:c0:17:fb', ch: 149, last: 'now' },
  { ssid: 'ChornogoraNet',   sec: true, band: '2.4GHz', rssi: -73, bars: 3, bssid: '78:8a:20:a1', ch: 11, last: '4m' },
  { ssid: 'guest_open',      sec: false, band: '2.4GHz', rssi: -76, bars: 2, bssid: 'd4:6e:0e:55', ch: 1, last: 'now' },
  { ssid: 'TP-LINK_4F8C',    sec: true, band: '2.4GHz', rssi: -78, bars: 2, bssid: '50:c7:bf:4f', ch: 6, last: '1m' },
  { ssid: 'eduroam',         sec: true, band: '5GHz', rssi: -80, bars: 2, bssid: '00:1e:65:a3', ch: 36, last: '8m' },
  { ssid: 'LinksysAA90B',    sec: true, band: '2.4GHz', rssi: -82, bars: 1, bssid: '94:10:3e:aa', ch: 11, last: '6m' },
  { ssid: 'NETIA-FREE',      sec: false, band: '2.4GHz', rssi: -85, bars: 1, bssid: 'a0:55:4f:c1', ch: 1, last: '15m' },
  { ssid: 'iPhone-Khrystyna',sec: true, band: '5GHz', rssi: -88, bars: 1, bssid: 'b2:a7:11:dd', ch: 149, last: '12m' },
];

const ScreenNetworksOverlay = () => (
  <div className="phantom-frame">
    <StatusBar state="SHADOW" sensors={false} />

    {/* Tab bar */}
    <div style={{
      position: 'absolute', top: 76, left: 16, right: 16,
      display: 'flex', alignItems: 'flex-end', gap: 24, zIndex: 3,
      borderBottom: '1px solid rgba(0,0,0,0.06)', paddingBottom: 8
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, paddingBottom: 4, borderBottom: '2px solid #f4af25', color: 'var(--ink)' }}>
        <Icon name="wifi" size={16} fill={1} style={{ color: '#b07a10' }} />
        <span style={{ fontSize: 14, fontWeight: 700 }}>WiFi</span>
        <span style={{ fontSize: 11, color: 'var(--ink-muted)', fontWeight: 600 }}>· 17</span>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, paddingBottom: 4, color: 'var(--ink-muted)' }}>
        <Icon name="bluetooth" size={16} />
        <span style={{ fontSize: 14, fontWeight: 600 }}>Bluetooth</span>
        <span style={{ fontSize: 11, fontWeight: 600 }}>· 8</span>
      </div>
      <span style={{ flex: 1 }} />
      <span className="eyebrow" style={{ fontSize: 9, color: 'var(--ink-muted)' }}>SCAN · LIVE</span>
    </div>

    {/* Filter row */}
    <div style={{
      position: 'absolute', top: 116, left: 16, right: 192,
      display: 'flex', gap: 8, alignItems: 'center', zIndex: 3
    }}>
      <div className="sub-glass" style={{
        flex: 1, height: 32, padding: '0 10px',
        display: 'flex', alignItems: 'center', gap: 6
      }}>
        <Icon name="search" size={14} style={{ color: 'var(--ink-muted)' }} />
        <span style={{ fontSize: 11, color: 'var(--ink-muted)' }}>Шукати SSID, BSSID, vendor…</span>
      </div>
      <button className="sub-glass" style={{ height: 32, padding: '0 12px', fontSize: 10, fontWeight: 600, color: 'var(--ink-secondary)', cursor: 'pointer' }}>
        📶 ≥ -70 dBm
      </button>
      <button className="sub-glass" style={{ height: 32, padding: '0 12px', fontSize: 10, fontWeight: 600, color: 'var(--ink-secondary)', cursor: 'pointer' }}>
        🔓 open
      </button>
      <button className="sub-glass" style={{ height: 32, padding: '0 12px', fontSize: 10, fontWeight: 600, color: 'var(--ink-secondary)', cursor: 'pointer' }}>
        🆕 new
      </button>
    </div>

    {/* WiFi list */}
    <div style={{
      position: 'absolute', top: 156, left: 16, right: 192, bottom: 124,
      display: 'flex', flexDirection: 'column', gap: 4,
      overflow: 'hidden', zIndex: 3
    }}>
      {networks.slice(0, 5).map((n, i) => <WifiRow key={i} {...n} />)}
    </div>

    {/* Aggregate panel — bottom */}
    <div className="glass-strong" style={{
      position: 'absolute', bottom: 16, left: 16, right: 192,
      padding: '12px 16px', borderRadius: 14,
      display: 'flex', alignItems: 'center', gap: 16, zIndex: 3, height: 96
    }}>
      <div>
        <div className="eyebrow-amber" style={{ fontSize: 9 }}>AGGREGATE WARDRIVING</div>
        <div style={{ marginTop: 4, fontSize: 22, fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>1 247</div>
        <div className="micro-label" style={{ marginTop: 2 }}>SCANNED TONIGHT</div>
      </div>
      <Divider />
      <div>
        <div style={{ fontSize: 22, fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>203</div>
        <div className="micro-label" style={{ marginTop: 2 }}>UNIQUE NETWORKS</div>
      </div>
      <Divider />
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 12 }}>
        <MiniDonut />
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2, fontSize: 10 }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ width: 8, height: 8, borderRadius: 2, background: '#f4af25' }} />
            <span style={{ color: 'var(--ink)' }}>WPA3 <strong>62%</strong></span>
          </span>
          <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ width: 8, height: 8, borderRadius: 2, background: '#fb923c' }} />
            <span style={{ color: 'var(--ink)' }}>WPA2 <strong>31%</strong></span>
          </span>
          <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ width: 8, height: 8, borderRadius: 2, background: '#ef4444' }} />
            <span style={{ color: 'var(--ink)' }}>OPEN <strong>7%</strong></span>
          </span>
        </div>
      </div>
    </div>

    {/* Right rail */}
    <div className="glass" style={{
      position: 'absolute', top: 76, right: 16, bottom: 16, width: 168,
      padding: 14, display: 'flex', flexDirection: 'column', gap: 12, zIndex: 3
    }}>
      <div>
        <div className="eyebrow-amber" style={{ fontSize: 9 }}>RSSI · 5MIN</div>
        <svg viewBox="0 0 140 50" style={{ width: '100%', height: 50, marginTop: 6 }}>
          <defs>
            <linearGradient id="spark" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#f4af25" stopOpacity="0.45" />
              <stop offset="100%" stopColor="#f4af25" stopOpacity="0" />
            </linearGradient>
          </defs>
          <path d="M 0 30 L 14 25 L 28 32 L 42 18 L 56 22 L 70 14 L 84 20 L 98 12 L 112 18 L 126 10 L 140 14 L 140 50 L 0 50 Z" fill="url(#spark)" />
          <path d="M 0 30 L 14 25 L 28 32 L 42 18 L 56 22 L 70 14 L 84 20 L 98 12 L 112 18 L 126 10 L 140 14" fill="none" stroke="#f4af25" strokeWidth="1.5" />
        </svg>
        <div className="micro-label" style={{ marginTop: 4 }}>STABILITY: STRONG</div>
      </div>

      <div style={{ height: 1, background: 'rgba(0,0,0,0.06)' }} />

      <div>
        <div className="eyebrow" style={{ fontSize: 9 }}>NOISE FLOOR</div>
        <div style={{ marginTop: 4, fontSize: 22, fontWeight: 700, fontVariantNumeric: 'tabular-nums', color: 'var(--ink-secondary)' }}>-92<span style={{ fontSize: 11, color: 'var(--ink-muted)', marginLeft: 3 }}>dBm</span></div>
      </div>

      <span style={{ flex: 1 }} />

      <button className="glass" style={{
        height: 36, borderRadius: 10,
        display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
        background: 'rgba(244,175,37,0.15)',
        border: '1px solid rgba(244,175,37,0.4)',
        color: '#8a5e0a',
        fontSize: 10, fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase',
        cursor: 'pointer'
      }}>
        <Icon name="download" size={14} />
        EXPORT GeoJSON
      </button>
    </div>
  </div>
);

const WifiRow = ({ ssid, sec, band, rssi, bars, bssid, ch, last, active }) => (
  <div className={active ? 'glass-strong' : 'glass'} style={{
    height: 76, padding: '0 14px', borderRadius: 12,
    display: 'flex', alignItems: 'center', gap: 12,
    background: active ? 'linear-gradient(135deg,rgba(244,175,37,0.92),rgba(251,146,60,0.92))' : undefined,
    border: active ? '1px solid rgba(244,175,37,0.5)' : undefined,
    boxShadow: active ? '0 0 0 1px rgba(244,175,37,0.4), 0 8px 24px rgba(244,175,37,0.25)' : undefined,
    color: active ? '#fff' : 'var(--ink)'
  }}>
    <Icon name="wifi" size={18} fill={active ? 1 : 0} style={{ color: active ? '#fff' : '#b07a10' }} />
    <div style={{ flex: 1, minWidth: 0 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <span style={{ fontSize: 14, fontWeight: 700 }}>{ssid}</span>
        <Icon name={sec ? 'lock' : 'lock_open'} size={12} fill={1} style={{ opacity: 0.7 }} />
        <span style={{
          fontSize: 8, padding: '1px 5px', borderRadius: 4,
          background: active ? 'rgba(255,255,255,0.25)' : 'rgba(0,0,0,0.06)',
          fontWeight: 700
        }}>{band}</span>
      </div>
      <div style={{ marginTop: 2, fontSize: 9, fontFamily: 'JetBrains Mono, monospace',
        color: active ? 'rgba(255,255,255,0.85)' : 'var(--ink-muted)' }}>
        {bssid}…  ·  ch {ch}  ·  {last}
      </div>
    </div>

    {/* RSSI bar */}
    <div style={{ display: 'flex', alignItems: 'flex-end', gap: 2, height: 18 }}>
      {[1,2,3,4,5].map(b => {
        const filled = b <= bars;
        return (
          <div key={b} style={{
            width: 5, height: 4 + b * 3,
            borderRadius: 1.5,
            background: filled
              ? (active ? '#fff' : 'linear-gradient(180deg,#f4af25,#fb923c)')
              : (active ? 'rgba(255,255,255,0.3)' : 'rgba(0,0,0,0.10)')
          }} />
        );
      })}
    </div>

    <span className="tabular" style={{
      width: 64, textAlign: 'right',
      fontSize: 14, fontWeight: 700,
      color: active ? '#fff' : (rssi > -65 ? '#b07a10' : 'var(--ink-muted)')
    }}>
      {rssi}<span style={{ fontSize: 9, marginLeft: 2, opacity: 0.7 }}>dBm</span>
    </span>

    <div style={{ display: 'flex', gap: 4 }}>
      <button style={{
        width: 28, height: 28, borderRadius: 8,
        background: 'transparent', border: 'none', cursor: 'pointer',
        color: active ? '#fff' : 'var(--ink-secondary)',
        display: 'flex', alignItems: 'center', justifyContent: 'center'
      }}>
        <Icon name="info" size={14} />
      </button>
      <button style={{
        width: 28, height: 28, borderRadius: 8,
        background: active ? 'rgba(255,255,255,0.2)' : 'rgba(0,0,0,0.04)',
        border: 'none', cursor: 'pointer',
        color: active ? '#fff' : 'var(--ink-secondary)',
        display: 'flex', alignItems: 'center', justifyContent: 'center'
      }}>
        <Icon name="link" size={14} />
      </button>
    </div>
  </div>
);

const MiniDonut = () => {
  const C = 2 * Math.PI * 18;
  return (
    <svg width="56" height="56" viewBox="0 0 56 56" style={{ transform: 'rotate(-90deg)' }}>
      <circle cx="28" cy="28" r="18" fill="none" stroke="rgba(0,0,0,0.06)" strokeWidth="6" />
      <circle cx="28" cy="28" r="18" fill="none" stroke="#f4af25" strokeWidth="6"
        strokeDasharray={`${C * 0.62} ${C}`} strokeLinecap="butt" />
      <circle cx="28" cy="28" r="18" fill="none" stroke="#fb923c" strokeWidth="6"
        strokeDasharray={`${C * 0.31} ${C}`} strokeDashoffset={-C * 0.62} />
      <circle cx="28" cy="28" r="18" fill="none" stroke="#ef4444" strokeWidth="6"
        strokeDasharray={`${C * 0.07} ${C}`} strokeDashoffset={-C * 0.93} />
    </svg>
  );
};

window.ScreenCameraOverlay = ScreenCameraOverlay;
window.ScreenNetworksOverlay = ScreenNetworksOverlay;

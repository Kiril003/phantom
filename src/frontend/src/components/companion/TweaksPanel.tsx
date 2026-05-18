import React, { useState, useRef, useCallback, useEffect } from 'react';

// ── useTweaks ───────────────────────────────────────────────────────────────
export function useTweaks<T>(defaults: T): [T, (key: keyof T, val: any) => void] {
  const [values, setValues] = useState(defaults);
  const setTweak = useCallback((key: keyof T, val: any) => {
    setValues((prev) => ({ ...prev, [key]: val }));
  }, []);
  return [values, setTweak];
}

// ── TweaksPanel ─────────────────────────────────────────────────────────────
export function TweaksPanel({ title = 'Tweaks', children }: { title?: string, children: React.ReactNode }) {
  const [open, setOpen] = useState(true);
  const dragRef = useRef<HTMLDivElement>(null);
  const offsetRef = useRef({ x: 16, y: 16 });
  const PAD = 16;

  const clampToViewport = useCallback(() => {
    const panel = dragRef.current;
    if (!panel) return;
    const w = panel.offsetWidth, h = panel.offsetHeight;
    const maxRight = Math.max(PAD, window.innerWidth - w - PAD);
    const maxBottom = Math.max(PAD, window.innerHeight - h - PAD);
    offsetRef.current = {
      x: Math.min(maxRight, Math.max(PAD, offsetRef.current.x)),
      y: Math.min(maxBottom, Math.max(PAD, offsetRef.current.y)),
    };
    panel.style.right = offsetRef.current.x + 'px';
    panel.style.bottom = offsetRef.current.y + 'px';
  }, []);

  useEffect(() => {
    if (!open) return;
    clampToViewport();
    window.addEventListener('resize', clampToViewport);
    return () => window.removeEventListener('resize', clampToViewport);
  }, [open, clampToViewport]);

  const onDragStart = (e: React.MouseEvent) => {
    const panel = dragRef.current;
    if (!panel) return;
    const r = panel.getBoundingClientRect();
    const sx = e.clientX, sy = e.clientY;
    const startRight = window.innerWidth - r.right;
    const startBottom = window.innerHeight - r.bottom;
    const move = (ev: MouseEvent) => {
      offsetRef.current = {
        x: startRight - (ev.clientX - sx),
        y: startBottom - (ev.clientY - sy),
      };
      clampToViewport();
    };
    const up = () => {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
    };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
  };

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        style={{
          position: 'fixed', right: 16, bottom: 16, zIndex: 1000,
          background: 'rgba(255,255,255,0.8)', padding: '8px 16px', borderRadius: 20,
          fontFamily: 'JetBrains Mono', fontSize: 11, border: '1px solid rgba(0,0,0,0.1)',
        }}
      >
        SHOW TWEAKS
      </button>
    );
  }

  return (
    <>
      <style>{`
        .twk-panel { position: fixed; z-index: 1000; width: 280px; max-height: calc(100vh - 32px); display: flex; flex-direction: column; background: rgba(250,249,247,0.85); color: #29261b; backdrop-filter: blur(24px) saturate(160%); border: 0.5px solid rgba(255,255,255,0.6); border-radius: 14px; box-shadow: 0 12px 40px rgba(0,0,0,0.18); font: 11.5px/1.4 system-ui, sans-serif; overflow: hidden; }
        .twk-hd { display: flex; align-items: center; justify-content: space-between; padding: 10px 14px; cursor: move; user-select: none; }
        .twk-hd b { font-size: 12px; font-weight: 600; }
        .twk-body { padding: 2px 14px 14px; display: flex; flex-direction: column; gap: 10px; overflow-y: auto; }
        .twk-sect { font-size: 10px; font-weight: 600; letter-spacing: 0.06em; text-transform: uppercase; color: rgba(41,38,27,0.45); padding: 10px 0 0; }
        .twk-row { display: flex; flex-direction: column; gap: 5px; }
        .twk-row-h { flex-direction: row; align-items: center; justify-content: space-between; }
        .twk-lbl { display: flex; justify-content: space-between; align-items: baseline; color: rgba(41,38,27,0.72); }
        .twk-val { color: rgba(41,38,27,0.5); font-family: 'JetBrains Mono'; }
        .twk-field { appearance: none; width: 100%; height: 26px; padding: 0 8px; border: 0.5px solid rgba(0,0,0,0.1); border-radius: 7px; background: rgba(255,255,255,0.6); color: inherit; font: inherit; outline: none; }
        .twk-slider { appearance: none; width: 100%; height: 4px; margin: 6px 0; border-radius: 999px; background: rgba(0,0,0,0.12); outline: none; }
        .twk-slider::-webkit-slider-thumb { appearance: none; width: 14px; height: 14px; border-radius: 50%; background: #fff; border: 0.5px solid rgba(0,0,0,0.12); box-shadow: 0 1px 3px rgba(0,0,0,0.2); }
        .twk-seg { position: relative; display: flex; padding: 2px; border-radius: 8px; background: rgba(0,0,0,0.06); user-select: none; }
        .twk-seg-thumb { position: absolute; top: 2px; bottom: 2px; border-radius: 6px; background: rgba(255,255,255,0.9); box-shadow: 0 1px 2px rgba(0,0,0,0.12); transition: left 0.15s cubic-bezier(0.3,0.7,0.4,1), width 0.15s; }
        .twk-seg button { appearance: none; position: relative; z-index: 1; flex: 1; border: 0; background: transparent; color: inherit; font: inherit; font-weight: 500; min-height: 22px; border-radius: 6px; padding: 4px 6px; }
      `}</style>
      <div ref={dragRef} className="twk-panel" style={{ right: offsetRef.current.x, bottom: offsetRef.current.y }}>
        <div className="twk-hd" onMouseDown={onDragStart}>
          <b>{title}</b>
          <button onClick={() => setOpen(false)} style={{ background: 'none', border: 0, cursor: 'pointer', opacity: 0.5 }}>✕</button>
        </div>
        <div className="twk-body">{children}</div>
      </div>
    </>
  );
}

export function TweakSection({ label, children }: { label: string, children?: React.ReactNode }) {
  return (
    <>
      <div className="twk-sect">{label}</div>
      {children}
    </>
  );
}

export function TweakSlider({ label, value, min = 0, max = 100, step = 1, unit = '', onChange }: { label: string, value: number, min?: number, max?: number, step?: number, unit?: string, onChange: (v: number) => void }) {
  return (
    <div className="twk-row">
      <div className="twk-lbl">
        <span>{label}</span>
        <span className="twk-val">{value}{unit}</span>
      </div>
      <input type="range" className="twk-slider" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} />
    </div>
  );
}

export function TweakRadio({ label, value, options, onChange }: { label: string, value: any, options: { value: any, label: string }[], onChange: (v: any) => void }) {
  const idx = options.findIndex(o => o.value === value);
  const n = options.length;
  return (
    <div className="twk-row">
      <div className="twk-lbl"><span>{label}</span></div>
      <div className="twk-seg">
        <div className="twk-seg-thumb" style={{ left: `calc(2px + ${idx} * (100% - 4px) / ${n})`, width: `calc((100% - 4px) / ${n})` }} />
        {options.map((o) => (
          <button key={o.value} type="button" onClick={() => onChange(o.value)}>{o.label}</button>
        ))}
      </div>
    </div>
  );
}

export function TweakSelect({ label, value, options, onChange }: { label: string, value: any, options: { value: any, label: string }[], onChange: (v: any) => void }) {
  return (
    <div className="twk-row">
      <div className="twk-lbl"><span>{label}</span></div>
      <select className="twk-field" value={value} onChange={(e) => onChange(e.target.value)}>
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </div>
  );
}

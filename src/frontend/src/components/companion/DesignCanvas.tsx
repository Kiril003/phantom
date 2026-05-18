import React, { useState, useRef } from 'react';

export function DesignCanvas({ children }: { children: React.ReactNode }) {
  const [zoom, setZoom] = useState(0.65);
  const [pan, setPan] = useState({ x: 50, y: 50 });
  const [isDragging, setIsDragging] = useState(false);
  const lastPos = useRef({ x: 0, y: 0 });

  const onWheel = (e: React.WheelEvent) => {
    if (e.ctrlKey) {
      setZoom(z => Math.max(0.1, Math.min(2, z - e.deltaY * 0.001)));
    } else {
      setPan(p => ({ x: p.x - e.deltaX / zoom, y: p.y - e.deltaY / zoom }));
    }
  };

  const onMouseDown = (e: React.MouseEvent) => {
    if (e.button === 0) {
      setIsDragging(true);
      lastPos.current = { x: e.clientX, y: e.clientY };
    }
  };

  const onMouseMove = (e: React.MouseEvent) => {
    if (isDragging) {
      const dx = (e.clientX - lastPos.current.x) / zoom;
      const dy = (e.clientY - lastPos.current.y) / zoom;
      setPan(p => ({ x: p.x + dx, y: p.y + dy }));
      lastPos.current = { x: e.clientX, y: e.clientY };
    }
  };

  const onMouseUp = () => setIsDragging(false);

  return (
    <div
      onWheel={onWheel}
      onMouseDown={onMouseDown}
      onMouseMove={onMouseMove}
      onMouseUp={onMouseUp}
      onMouseLeave={onMouseUp}
      style={{
        width: '100%', height: '100%',
        overflow: 'hidden',
        background: '#f6f1e8',
        cursor: isDragging ? 'grabbing' : 'grab',
        position: 'relative',
        touchAction: 'none',
      }}
    >
      <div style={{
        position: 'absolute',
        left: '50%', top: '50%',
        transform: `translate(-50%, -50%) translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
        transformOrigin: 'center center',
        display: 'flex', flexDirection: 'column', gap: 120,
        padding: 200,
      }}>
        {children}
      </div>

      <div style={{
        position: 'fixed', bottom: 20, right: 20,
        background: 'rgba(255,255,255,0.8)', padding: '4px 12px', borderRadius: 20,
        fontFamily: 'JetBrains Mono', fontSize: 11, color: '#6a5a44',
        border: '1px solid rgba(0,0,0,0.1)', zIndex: 10,
        pointerEvents: 'none',
      }}>
        ZOOM {Math.round(zoom * 100)}% · PAN {Math.round(pan.x)},{Math.round(pan.y)}
      </div>
    </div>
  );
}

export function DCSection({ title, subtitle, children }: { title: string, subtitle?: string, children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 40 }}>
      <div>
        <div style={{ fontFamily: 'JetBrains Mono', fontSize: 12, color: '#9a8a6f', textTransform: 'uppercase', letterSpacing: '0.2em' }}>{title}</div>
        {subtitle && <div style={{ fontSize: 14, color: '#6a5a44', marginTop: 4 }}>{subtitle}</div>}
      </div>
      <div style={{ display: 'flex', gap: 60 }}>
        {children}
      </div>
    </div>
  );
}

export function DCArtboard({ label, children }: { label: string, children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ fontFamily: 'JetBrains Mono', fontSize: 11, color: '#9a8a6f', textTransform: 'uppercase' }}>{label}</div>
      <div style={{ boxShadow: '0 40px 100px rgba(0,0,0,0.15)', borderRadius: 44 }}>
        {children}
      </div>
    </div>
  );
}

import { useEffect, useState } from 'react';

const TARGET_W = 1024;
const TARGET_H = 600;
const MIN_SUPPORTED_W = 640;

/**
 * ViewportFrame — centers the fixed 1024×600 UI inside the browser window.
 *
 * - Desktop (>1024 wide): dark matte around the frame, no scaling.
 * - Slightly smaller than target: scales the frame down to fit.
 * - Very small devices (<640 wide): shows a friendly hint; UI is optimised
 *   for the 7" 1024×600 touchscreen hardware.
 */
export function ViewportFrame({ children }: { children: React.ReactNode }) {
  const [dims, setDims] = useState(() => ({
    w: typeof window !== 'undefined' ? window.innerWidth : TARGET_W,
    h: typeof window !== 'undefined' ? window.innerHeight : TARGET_H,
  }));

  useEffect(() => {
    const onResize = () =>
      setDims({ w: window.innerWidth, h: window.innerHeight });
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  const tooSmall = dims.w < MIN_SUPPORTED_W;
  const needsScale = dims.w < TARGET_W || dims.h < TARGET_H;
  const scale = needsScale
    ? Math.min(dims.w / TARGET_W, dims.h / TARGET_H)
    : 1;

  if (tooSmall) {
    return (
      <div
        className="w-screen h-screen flex items-center justify-center"
        style={{ background: 'var(--surface-void)', padding: 24 }}
      >
        <div
          className="glass-card"
          style={{
            padding: 24,
            borderRadius: 20,
            maxWidth: 420,
            textAlign: 'center',
          }}
        >
          <div
            style={{
              fontFamily: 'var(--font-display)',
              fontSize: 'var(--fs-md)',
              color: 'var(--ink-primary)',
              marginBottom: 8,
              letterSpacing: 'var(--tracking-tight)',
            }}
          >
            Viewport too small
          </div>
          <div
            className="italic"
            style={{
              fontFamily: 'var(--font-serif)',
              fontSize: 'var(--fs-sm)',
              color: 'var(--ink-secondary)',
              lineHeight: 'var(--lh-relaxed)',
            }}
          >
            This UI is optimised for the 1024×600 touchscreen. Please resize
            your window — or mount PHANTOM on its 7″ panel.
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      className="w-screen h-screen flex items-center justify-center"
      style={{ background: 'var(--surface-void)', overflow: 'hidden' }}
    >
      <div
        style={{
          width: TARGET_W,
          height: TARGET_H,
          transform: scale === 1 ? undefined : `scale(${scale})`,
          transformOrigin: 'center center',
          boxShadow:
            scale === 1
              ? '0 0 80px 4px rgba(0,0,0,0.6), 0 0 0 1px rgba(255,255,255,0.04)'
              : 'none',
          borderRadius: 8,
          overflow: 'hidden',
          position: 'relative',
        }}
      >
        {children}
      </div>
    </div>
  );
}

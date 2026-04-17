/**
 * AmbientGlows — fixed fullscreen gradient blobs that live beneath all content.
 * Always present. Responsive to SystemState via --glow-primary / --glow-secondary
 * + the current --accent-glow on the bottom-right blob.
 */
export function AmbientGlows() {
  return (
    <div
      aria-hidden
      className="fixed inset-0 pointer-events-none overflow-hidden"
      style={{ zIndex: 0 }}
    >
      {/* Top-left cyan wash */}
      <div
        className="absolute rounded-full animate-pulse-slow"
        style={{
          top: '-25%',
          left: '-10%',
          width: '55%',
          height: '90%',
          filter: 'blur(120px)',
          background: 'var(--glow-primary)',
          opacity: 0.55,
        }}
      />
      {/* Bottom-right purple wash */}
      <div
        className="absolute rounded-full animate-pulse-slow"
        style={{
          bottom: '-25%',
          right: '-10%',
          width: '50%',
          height: '80%',
          filter: 'blur(110px)',
          background: 'var(--glow-secondary)',
          opacity: 0.5,
          animationDelay: '2s',
        }}
      />
      {/* Accent ring near centre — picks up SystemState accent */}
      <div
        className="absolute rounded-full animate-pulse-slow"
        style={{
          top: '15%',
          right: '30%',
          width: '35%',
          height: '50%',
          filter: 'blur(120px)',
          background: 'var(--accent-glow)',
          opacity: 0.35,
          animationDelay: '1.2s',
        }}
      />
    </div>
  );
}

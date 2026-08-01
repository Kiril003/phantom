export function ViewportFrame({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="w-full h-full min-h-screen flex items-stretch justify-stretch"
      style={{ background: 'var(--surface-base)', overflow: 'hidden' }}
    >
      <div className="flex-1 relative w-full h-full">
        {children}
      </div>
    </div>
  );
}


export default function DreamLayout() {
  return (
    <div className="w-[1024px] h-[600px] bg-phantom-bg flex flex-col animate-state-enter">
      {/* DREAM: minimal ambient glow (purple) */}
      <div className="flex-1 flex items-center justify-center">
        <div
          className="w-32 h-32 rounded-full animate-breathe"
          style={{
            background:
              'radial-gradient(circle, color-mix(in srgb, var(--phantom-dream, #9B8FD4) 19%, transparent) 0%, transparent 70%)',
            boxShadow:
              '0 0 40px color-mix(in srgb, var(--phantom-dream, #9B8FD4) 13%, transparent)',
          }}
        />
      </div>
    </div>
  );
}

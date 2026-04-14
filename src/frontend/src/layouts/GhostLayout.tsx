
export default function GhostLayout() {
  return (
    <div className="w-[1024px] h-[600px] bg-black flex flex-col">
      {/* GHOST: screen dark — only micro-indicator */}
      <div className="absolute bottom-2 right-2">
        <div className="w-2 h-2 rounded-full bg-phantom-ghost opacity-40" />
      </div>
    </div>
  );
}

import { StatusBar } from '../components/core/StatusBar';

export default function ShadowLayout() {
  return (
    <div className="w-[1024px] h-[600px] bg-phantom-bg flex flex-col animate-state-enter">
      <StatusBar />
      {/* SHADOW: minimal presence — dark screen with only status bar */}
      <div className="flex-1 relative overflow-hidden">
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="w-1 h-1 rounded-full bg-phantom-cyan opacity-30 animate-breathe" />
        </div>
      </div>
    </div>
  );
}

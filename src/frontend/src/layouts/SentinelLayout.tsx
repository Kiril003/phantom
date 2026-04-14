import { StatusBar } from '../components/core/StatusBar';

export default function SentinelLayout() {
  return (
    <div className="w-[1024px] h-[600px] bg-phantom-bg flex flex-col animate-state-enter animate-alert-flash">
      <StatusBar />
      {/* SENTINEL: full map + radar card + camera */}
      <div className="flex-1 flex overflow-hidden">
        <div className="flex-1 h-full relative" />
        <div className="w-[320px] h-full phantom-panel border-l border-phantom-danger flex flex-col" />
      </div>
    </div>
  );
}

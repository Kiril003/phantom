import { StatusBar } from '../components/core/StatusBar';

export default function DialogueLayout() {
  return (
    <div className="w-[1024px] h-[600px] bg-phantom-bg flex flex-col animate-state-enter">
      <StatusBar />
      {/* DIALOGUE: chat window expanded, avatar active */}
      <div className="flex-1 flex overflow-hidden">
        <div className="w-[280px] h-full phantom-panel border-r border-phantom-border flex flex-col" />
        <div className="flex-1 h-full flex flex-col" />
      </div>
    </div>
  );
}

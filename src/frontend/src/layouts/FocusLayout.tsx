import { StatusBar } from '../components/core/StatusBar';

export default function FocusLayout() {
  return (
    <div className="w-[1024px] h-[600px] bg-phantom-bg flex flex-col animate-state-enter">
      <StatusBar />
      {/* FOCUS: workspace area, sidebar + main content */}
      <div className="flex-1 flex overflow-hidden">
        <aside className="w-[200px] h-full phantom-panel border-r border-phantom-border flex flex-col" />
        <main className="flex-1 h-full overflow-hidden" />
      </div>
    </div>
  );
}

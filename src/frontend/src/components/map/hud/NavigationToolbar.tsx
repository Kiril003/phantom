import { Minus, Plus, Crosshair, MapPin } from 'lucide-react';

export function NavigationToolbar({
  onZoomIn,
  onZoomOut,
  onCenter,
  onAddPoi,
  fix,
}: {
  onZoomIn: () => void;
  onZoomOut: () => void;
  onCenter: () => void;
  onAddPoi: () => void;
  fix: boolean;
}) {
  return (
    <div className="glass-card flex items-center gap-1 px-2 h-[48px] rounded-full shadow-2xl">
      <ToolbarButton icon={<Minus size={16} strokeWidth={1.75} />} onClick={onZoomOut} label="Zoom out" />
      <ToolbarButton icon={<Plus size={16} strokeWidth={1.75} />} onClick={onZoomIn} label="Zoom in" />
      <span className="w-px h-5 bg-white/10 mx-1" />
      <ToolbarButton
        icon={<Crosshair size={16} strokeWidth={1.75} />}
        onClick={onCenter}
        label="Centre on operator"
        disabled={!fix}
      />
      <ToolbarButton 
        icon={<MapPin size={16} strokeWidth={1.75} />} 
        onClick={onAddPoi} 
        label="Drop POI" 
        accent 
      />
    </div>
  );
}

function ToolbarButton({
  icon,
  onClick,
  label,
  accent = false,
  disabled = false,
}: {
  icon: React.ReactNode;
  onClick: () => void;
  label: string;
  accent?: boolean;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`flex items-center justify-center w-10 h-10 min-w-[40px] min-h-[40px] rounded-full transition-all active:scale-90 ${
        accent ? 'bg-amber-500 text-ink-inverse shadow-[0_0_14px_rgba(244,175,37,0.4)]' : 'text-ink-secondary hover:bg-white/5'
      } ${disabled ? 'opacity-30' : 'opacity-100'}`}
      title={label}
    >
      {icon}
    </button>
  );
}

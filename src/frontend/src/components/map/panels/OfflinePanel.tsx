import { OfflineRegionManager } from '../hud/OfflineRegionManager';
import { X } from 'lucide-react';

export interface OfflinePanelProps {
  open: boolean;
  onClose: () => void;
}

export function OfflinePanel({ open, onClose }: OfflinePanelProps): JSX.Element | null {
  if (!open) return null;

  return (
    <div
      className="absolute inset-0 z-40 bg-black/40 backdrop-blur-[2px] flex justify-start pointer-events-none"
      onClick={onClose}
    >
      <div 
        className="relative pointer-events-auto ml-[72px] mt-20 animate-in zoom-in-95 duration-200"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          onClick={onClose}
          className="absolute -top-3 -right-3 z-10 p-2 rounded-full glass-elevated border border-black/10 text-[color:var(--ink-muted)] hover:text-[color:var(--ink-primary)] backdrop-blur-md shadow-xl transition-all active:scale-90"
        >
          <X size={14} />
        </button>
        <OfflineRegionManager className="shadow-2xl border border-black/10" />
      </div>
    </div>
  );
}

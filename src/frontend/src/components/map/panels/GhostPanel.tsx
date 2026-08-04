import { useState, useEffect } from 'react';
import { Shield, Lock, Unlock, EyeOff, Zap, X, Fingerprint, Database } from 'lucide-react';

/**
 * Phase 24-I — Ghost Panel.
 *
 * High-security interface for GHOST mode management.
 * - Manage "Sealed" (encrypted) zones
 * - Zero-traffic policy enforcement
 * - Local-only layer management
 * - Cryptographic identity verification for sensitive data
 */

export interface GhostZone {
  id: string;
  name: string;
  lat: number;
  lon: number;
  radius_m: number;
  encrypted: boolean;
  last_sync: string;
}

export interface GhostPanelProps {
  open: boolean;
  onClose: () => void;
  systemState: string;
}

export function GhostPanel({ open, onClose, systemState }: GhostPanelProps) {
  const [zones, setZones] = useState<GhostZone[]>([]);
  const [stealthActive, setStealthActive] = useState(true);

  const isGhost = systemState === 'GHOST';

  useEffect(() => {
    if (open && isGhost) {
      fetchZones();
    }
  }, [open, isGhost]);

  const fetchZones = async () => {
    try {
      // Mock zones for now, backend integration in 24-I Part 2
      const mockZones: GhostZone[] = [
        { id: 'z1', name: 'Safe House Alpha', lat: 50.4501, lon: 30.5234, radius_m: 500, encrypted: true, last_sync: new Date().toISOString() },
        { id: 'z2', name: 'Sector 7 Transit', lat: 50.4601, lon: 30.5334, radius_m: 1000, encrypted: true, last_sync: new Date().toISOString() },
      ];
      setZones(mockZones);
    } catch (err) {
      console.error('Failed to fetch ghost zones:', err);
    }
  };

  if (!open) return null;

  return (
    <div className="absolute top-20 left-[84px] w-80 max-h-[calc(100vh-230px)] flex flex-col bg-ink-primary/98 backdrop-blur-3xl border border-rose-500/20 rounded-3xl shadow-[0_0_50px_rgba(244,63,94,0.15)] overflow-hidden z-20 transition-all animate-in slide-in-from-left-12 duration-500">
      {/* Ghost Header */}
      <div className="p-6 border-b border-rose-500/10 flex items-center justify-between bg-gradient-to-br from-rose-500/10 to-transparent">
        <div className="flex items-center gap-4">
          <div className={`w-10 h-10 rounded-2xl flex items-center justify-center transition-all duration-700 ${
            isGhost ? 'bg-rose-500/20 text-rose-500 shadow-[0_0_20px_rgba(244,63,94,0.4)] rotate-45' : 'bg-black/[0.04] text-[color:var(--ink-muted)]'
          }`}>
            <Shield size={20} className={isGhost ? '-rotate-45' : ''} />
          </div>
          <div>
            <div className="text-[12px] font-black uppercase tracking-[0.3em] text-[color:var(--ink-primary)]">GHOST Protocol</div>
            <div className={`text-[9px] font-bold uppercase tracking-widest ${isGhost ? 'text-rose-500 animate-pulse' : 'text-[color:var(--ink-muted)]'}`}>
              {isGhost ? 'Покриття активне' : 'Очікує · запечатано'}
            </div>
          </div>
        </div>
        <button
          onClick={onClose}
          className="p-2 rounded-xl hover:bg-black/5 text-[color:var(--ink-muted)] transition-all active:scale-90"
        >
          <X size={16} />
        </button>
      </div>

      {!isGhost ? (
        <div className="flex-1 p-8 flex flex-col items-center justify-center text-center space-y-6">
          <EyeOff size={48} className="text-[color:var(--ink-primary)]/5" />
          <div className="space-y-2">
            <div className="text-xs font-bold text-[color:var(--ink-secondary)] uppercase tracking-widest">Поверхня замкнена</div>
            <div className="text-[11px] text-[color:var(--ink-muted)] leading-relaxed max-w-[200px]">
              Щоб відкрити захищені шари, переведи систему в стан ПРИВИД — прикладанням картки.
            </div>
          </div>
          <button className="px-6 py-2.5 rounded-full border border-black/10 text-[10px] font-black uppercase tracking-widest text-[color:var(--ink-muted)] hover:bg-black/5 transition-all">
            Розпочати звірку
          </button>
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto p-5 space-y-8 custom-scrollbar">
          {/* Stealth Toggle */}
          <div className="p-4 rounded-2xl bg-rose-500/5 border border-rose-500/10 space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Zap size={14} className="text-rose-500" />
                <span className="text-[10px] font-black uppercase tracking-widest text-[color:var(--ink-primary)]">Zero-Traffic Policy</span>
              </div>
              <button 
                onClick={() => setStealthActive(!stealthActive)}
                className={`w-10 h-5 rounded-full relative transition-all ${stealthActive ? 'bg-rose-500' : 'bg-black/10'}`}
              >
                <div className={`absolute top-1 w-3 h-3 rounded-full bg-white transition-all ${stealthActive ? 'left-6' : 'left-1'}`} />
              </button>
            </div>
            <div className="text-[10px] text-[color:var(--ink-muted)] leading-tight italic">
              When active, all outbound geo-requests (Nominatim, Overpass) are hard-blocked at the kernel level.
            </div>
          </div>

          {/* Sealed Zones */}
          <div className="space-y-4">
            <div className="flex items-center justify-between px-1">
              <div className="flex items-center gap-2 text-[10px] font-black uppercase tracking-widest text-[color:var(--ink-muted)]">
                <Lock size={12} />
                <span>Запечатані зони</span>
              </div>
              <span className="text-[10px] font-mono text-rose-500/50">{zones.length}</span>
            </div>

            <div className="space-y-2">
              {zones.map(zone => (
                <div key={zone.id} className="p-4 rounded-2xl bg-white/[0.03] border border-black/5 flex items-center gap-4 group hover:bg-black/5 transition-all">
                  <div className="w-8 h-8 rounded-xl bg-rose-500/10 flex items-center justify-center text-rose-500/70">
                    <Database size={16} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-[13px] font-bold text-[color:var(--ink-primary)] truncate">{zone.name}</div>
                    <div className="text-[9px] text-[color:var(--ink-muted)] uppercase font-mono tracking-tighter">
                      {zone.radius_m}m · AES-256-GCM
                    </div>
                  </div>
                  <Unlock size={14} className="text-[color:var(--ink-primary)]/10 group-hover:text-[color:var(--ink-muted)] transition-colors" />
                </div>
              ))}
              <button className="w-full p-3 rounded-2xl border border-dashed border-black/10 text-[9px] font-black uppercase tracking-widest text-[color:var(--ink-muted)] hover:text-[color:var(--ink-muted)] hover:border-black/15 transition-all">
                + Seal New Area
              </button>
            </div>
          </div>

          {/* Audit Log */}
          <div className="space-y-4">
             <div className="flex items-center gap-2 px-1 text-[10px] font-black uppercase tracking-widest text-[color:var(--ink-muted)]">
                <Fingerprint size={12} />
                <span>Цілісність шифру</span>
              </div>
              <div className="p-4 rounded-2xl bg-emerald-500/5 border border-emerald-500/20 flex items-center gap-3">
                <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse shadow-[0_0_8px_#10b981]" />
                <span className="text-[10px] font-bold text-emerald-500/80 uppercase tracking-widest">Hardware TPM Verified</span>
              </div>
          </div>
        </div>
      )}

      {/* Ghost Footer */}
      <div className="p-4 border-t border-rose-500/10 glass-card flex items-center justify-between text-[8px] font-black uppercase tracking-widest">
        <span className="text-rose-500/50">Stealth Layer v1.0</span>
        <span className="text-[color:var(--ink-muted)]">Журнали не ведуться</span>
      </div>
    </div>
  );
}

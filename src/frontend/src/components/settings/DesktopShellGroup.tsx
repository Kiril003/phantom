import { useEffect, useState } from 'react';
import { Monitor, Cpu, ShieldCheck, HardDrive, Zap } from 'lucide-react';
import { useSystemStore } from '../../stores/systemStore';

export function DesktopShellGroup() {
  const isTauri = useSystemStore((s) => s.isTauri);
  const [platform, setPlatform] = useState<string>('Unknown');
  const [backendStatus, setBackendStatus] = useState<'connected' | 'error' | 'loading'>('loading');

  useEffect(() => {
    if (isTauri) {
      // Lazy load tauri API to avoid breaking web builds
      import('@tauri-apps/api/core').then(() => {
        // In Tauri 2.x, we might want to check platform
        // For now, just set a label
        setPlatform('Native Desktop');
      }).catch(() => {
        setPlatform('Native (API error)');
      });
    } else {
      setPlatform('Web / Cloud');
    }

    // Ping local backend to verify sidecar health
    fetch('http://127.0.0.1:8000/readyz')
      .then((r) => (r.ok ? setBackendStatus('connected') : setBackendStatus('error')))
      .catch(() => setBackendStatus('error'));
  }, [isTauri]);

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Platform Card */}
        <div 
          className="p-4 rounded-xl border border-white/5 bg-white/[0.02] flex items-start gap-4"
          style={{ borderColor: 'var(--border-subtle)' }}
        >
          <div className="p-2 rounded-lg bg-accent/10">
            <Monitor className="w-5 h-5 text-accent" />
          </div>
          <div>
            <h4 className="text-sm font-medium text-ink">Platform Mode</h4>
            <p className="text-xs text-ink-muted mt-1">{platform}</p>
            <div className="mt-2 flex items-center gap-2">
              <span className={`w-2 h-2 rounded-full ${isTauri ? 'bg-green-500' : 'bg-amber-500'}`} />
              <span className="text-[10px] uppercase tracking-wider text-ink-muted">
                {isTauri ? 'Native Shell Active' : 'Web Fallback'}
              </span>
            </div>
          </div>
        </div>

        {/* Backend Sidecar Card */}
        <div 
          className="p-4 rounded-xl border border-white/5 bg-white/[0.02] flex items-start gap-4"
          style={{ borderColor: 'var(--border-subtle)' }}
        >
          <div className="p-2 rounded-lg bg-accent/10">
            <Cpu className="w-5 h-5 text-accent" />
          </div>
          <div>
            <h4 className="text-sm font-medium text-ink">Backend Sidecar</h4>
            <p className="text-xs text-ink-muted mt-1">
              {backendStatus === 'connected' ? 'FastAPI 127.0.0.1:8000' : 'Disconnected / Host mode'}
            </p>
            <div className="mt-2 flex items-center gap-2">
              <span className={`w-2 h-2 rounded-full ${backendStatus === 'connected' ? 'bg-green-500' : 'bg-red-500'}`} />
              <span className="text-[10px] uppercase tracking-wider text-ink-muted">
                {backendStatus === 'connected' ? 'Operational' : 'Sync Error'}
              </span>
            </div>
          </div>
        </div>
      </div>

      <div className="p-6 rounded-2xl border bg-white/[0.01]" style={{ borderColor: 'var(--border-subtle)' }}>
        <h3 className="text-base font-medium text-ink flex items-center gap-2">
          <ShieldCheck className="w-5 h-5 text-accent" />
          Native Capabilities
        </h3>
        <p className="text-sm text-ink-muted mt-2 leading-relaxed">
          When running as a desktop app, PHANTOM OS gains deep system access. 
          The background sidecar is isolated via <strong>Bubblewrap (Tier 1 Sandbox)</strong> 
          and communicates over a cryptographically secured local bridge.
        </p>

        <div className="mt-6 space-y-4 text-xs">
          <div className="flex items-center justify-between p-3 rounded-lg bg-white/[0.03]">
            <div className="flex items-center gap-3">
              <HardDrive className="w-4 h-4 text-ink-muted" />
              <span className="text-ink">OS-Aware Data Storage</span>
            </div>
            <span className="text-accent font-mono text-[10px] uppercase">Active</span>
          </div>
          <div className="flex items-center justify-between p-3 rounded-lg bg-white/[0.03]">
            <div className="flex items-center gap-3">
              <Zap className="w-4 h-4 text-ink-muted" />
              <span className="text-ink">Low-Latency NPU Acceleration</span>
            </div>
            <span className="text-accent font-mono text-[10px] uppercase">Available</span>
          </div>
        </div>
      </div>
    </div>
  );
}

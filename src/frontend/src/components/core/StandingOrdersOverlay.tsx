import { useEffect, useState, useCallback } from 'react';
import { 
  Play, 
  Pause, 
  Clock, 
  Zap, 
  Calendar, 
  ChevronRight,
  AlertCircle,
  Loader2
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

interface StandingOrder {
  id: string;
  description: string;
  kind: 'interval' | 'cron' | 'conditional' | 'one_shot_future';
  enabled: boolean;
  last_fired_at: string | null;
  fire_count: number;
  last_outcome: string | null;
}

export function StandingOrdersOverlay() {
  const [orders, setOrders] = useState<StandingOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchOrders = useCallback(async () => {
    try {
      const token = localStorage.getItem('phantom_token');
      const res = await fetch('/api/v1/agent/standing_orders', {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (!res.ok) throw new Error('Failed to fetch orders');
      const data = await res.json();
      setOrders(data.orders);
      setError(null);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchOrders();
  }, [fetchOrders]);

  const toggleOrder = async (order: StandingOrder) => {
    try {
      const token = localStorage.getItem('phantom_token');
      const res = await fetch(`/api/v1/agent/standing_orders/${order.id}`, {
        method: 'PATCH',
        headers: { 
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}` 
        },
        body: JSON.stringify({ enabled: !order.enabled })
      });
      if (!res.ok) throw new Error('Failed to update order');
      const data = await res.json();
      setOrders(prev => prev.map(o => o.id === data.order.id ? data.order : o));
    } catch (err: any) {
      setError(err.message);
    }
  };

  if (loading) {
    return (
      <div className="h-full flex items-center justify-center">
        <Loader2 className="animate-spin text-accent" size={24} />
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col bg-surface-deep">
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
        {error && (
          <div className="p-3 rounded bg-signal-alert/10 border border-signal-alert/20 text-signal-alert text-xs flex gap-2">
            <AlertCircle size={14} className="shrink-0" />
            {error}
          </div>
        )}

        {orders.length === 0 && !error && (
          <div className="h-full flex flex-col items-center justify-center text-center opacity-40 py-10">
            <Zap size={32} strokeWidth={1} className="mb-3" />
            <p className="text-xs font-display tracking-wider uppercase">No active protocols</p>
            <p className="text-[10px] font-mono mt-1">Autonomous background tasks will appear here</p>
          </div>
        )}

        <AnimatePresence mode="popLayout">
          {orders.map((order) => (
            <motion.div
              key={order.id}
              layout
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="glass-subtle rounded-xl p-4 border border-glass-border relative overflow-hidden group"
            >
              {/* Background Glow when enabled */}
              {order.enabled && (
                <div className="absolute inset-0 bg-accent/5 pointer-events-none" />
              )}

              <div className="flex items-start justify-between relative z-10">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-accent">
                      {order.kind === 'interval' && <Clock size={12} />}
                      {order.kind === 'cron' && <Calendar size={12} />}
                      {order.kind === 'conditional' && <Zap size={12} />}
                      {order.kind === 'one_shot_future' && <ChevronRight size={12} />}
                    </span>
                    <span className="text-[10px] font-display uppercase tracking-widest text-ink-muted">
                      {order.kind.replace(/_/g, ' ')}
                    </span>
                  </div>
                  <h3 className="text-sm font-display text-ink-primary leading-tight">
                    {order.description}
                  </h3>
                </div>

                <button
                  onClick={() => toggleOrder(order)}
                  className={`w-10 h-10 rounded-full flex items-center justify-center transition-all active:scale-90 ${
                    order.enabled 
                      ? 'bg-accent text-ink-inverse shadow-lg shadow-accent/20' 
                      : 'bg-glass-subtle text-ink-muted border border-glass-border'
                  }`}
                >
                  {order.enabled ? <Pause size={16} /> : <Play size={16} className="ml-0.5" />}
                </button>
              </div>

              <div className="mt-4 pt-3 border-t border-glass-border/50 flex items-center justify-between">
                <div className="flex gap-4">
                  <div className="flex flex-col">
                    <span className="text-[9px] uppercase tracking-tighter text-ink-faint">Fires</span>
                    <span className="text-[11px] font-mono tabular-nums text-ink-muted">{order.fire_count}</span>
                  </div>
                  <div className="flex flex-col">
                    <span className="text-[9px] uppercase tracking-tighter text-ink-faint">Last Outcome</span>
                    <span className={`text-[11px] font-mono uppercase ${
                      order.last_outcome === 'success' ? 'text-signal-ok' : 
                      order.last_outcome === 'failed' ? 'text-signal-alert' : 'text-ink-muted'
                    }`}>
                      {order.last_outcome || '—'}
                    </span>
                  </div>
                </div>
                
                {order.last_fired_at && (
                  <div className="text-right">
                    <span className="text-[9px] uppercase tracking-tighter text-ink-faint block">Last Run</span>
                    <span className="text-[10px] font-mono text-ink-muted">
                      {new Date(order.last_fired_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </span>
                  </div>
                )}
              </div>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </div>
  );
}

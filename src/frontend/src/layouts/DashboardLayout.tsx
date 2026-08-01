import React from 'react';
import { NavLink, Outlet } from 'react-router-dom';
import {
  Map,
  Key,
  Settings,
  BrainCircuit,
  Activity,
  Hexagon,
  MessageSquare,
  Users,
  Gauge,
  ShieldAlert,
} from 'lucide-react';
import { useUIStore } from '../stores/uiStore';
import { useSystemStore } from '../stores/systemStore';
import { motion } from 'framer-motion';

export default function DashboardLayout() {
  const setIntelligenceHubOpen = useUIStore((s) => s.setIntelligenceHubOpen);
  const wsConnected = useSystemStore((s) => s.wsConnected);

  return (
    <div
      className="flex h-screen w-screen overflow-hidden font-sans"
      style={{ background: 'var(--surface-void)', color: 'var(--ink-primary)' }}
    >
      <motion.aside
        initial={{ x: -240, opacity: 0 }}
        animate={{ x: 0, opacity: 1 }}
        transition={{ duration: 0.5, ease: 'easeOut' }}
        className="w-60 border-r flex flex-col shrink-0 relative z-10"
        style={{
          background: 'var(--surface-raised)',
          backdropFilter: 'blur(16px)',
          WebkitBackdropFilter: 'blur(16px)',
          borderColor: 'var(--glass-border)',
        }}
      >
        <div
          className="h-14 flex items-center px-5 border-b shrink-0"
          style={{ borderColor: 'var(--glass-border)' }}
        >
          <div className="flex items-center gap-3">
            <div
              className="w-7 h-7 rounded-lg flex items-center justify-center"
              style={{ background: 'var(--accent)', boxShadow: '0 0 16px var(--accent-glow)' }}
            >
              <Hexagon size={16} style={{ color: 'var(--surface-void)' }} />
            </div>
            <span
              className="tracking-widest text-xs font-bold"
              style={{ fontFamily: 'var(--font-display)', color: 'var(--ink-primary)' }}
            >
              PHANTOM OS
            </span>
          </div>
        </div>

        <nav className="flex-1 px-2 py-2 space-y-px overflow-y-auto no-scrollbar">
          <Group>розмова</Group>
          <NavItem to="/chat" icon={<MessageSquare size={17} />} label="Чат" />
          <NavItem to="/operator" icon={<Users size={17} />} label="Штаб агентів" />

          <Group>простір</Group>
          <NavItem to="/map" icon={<Map size={17} />} label="Мапа" />
          <NavItem to="/polis" icon={<Key size={17} />} label="Поліс" />

          <Group>стан</Group>
          <NavItem to="/" end icon={<Activity size={17} />} label="Огляд" />
          <NavItem to="/system" icon={<Gauge size={17} />} label="Система" />
          <NavItem to="/sentinel" icon={<ShieldAlert size={17} />} label="Варта" />

          <Group>налаштування</Group>
          <button
            onClick={() => setIntelligenceHubOpen(true)}
            className="w-full flex items-center gap-3 px-3 py-2 rounded-xl min-h-[40px] transition-colors"
            style={{ color: 'var(--ink-muted)' }}
          >
            <BrainCircuit size={17} />
            <span className="font-medium text-sm">Розум</span>
          </button>
          <NavItem to="/settings" icon={<Settings size={17} />} label="Налаштування" />
        </nav>

        <div className="p-4 border-t shrink-0" style={{ borderColor: 'var(--glass-border)' }}>
          <div className="flex items-center gap-2.5 px-1">
            <span
              className={`w-1.5 h-1.5 rounded-full ${wsConnected ? 'animate-pulse' : ''}`}
              style={{
                background: wsConnected ? 'var(--accent)' : 'var(--ink-faint)',
                boxShadow: wsConnected ? '0 0 8px var(--accent-glow)' : 'none',
              }}
            />
            <span className="text-xs font-medium" style={{ color: 'var(--ink-muted)' }}>
              {wsConnected ? 'на зв\'язку' : 'зв\'язку немає'}
            </span>
          </div>
        </div>
      </motion.aside>

      <main
        className="flex-1 relative flex flex-col overflow-hidden"
        style={{ background: 'var(--surface-void)' }}
      >
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.1, ease: 'easeOut' }}
          className="flex-1 relative z-10 w-full h-full overflow-y-auto no-scrollbar"
        >
          <Outlet />
        </motion.div>
      </main>
    </div>
  );
}

function Group({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="px-3 pt-3 pb-1 text-[9px] font-bold tracking-widest uppercase"
      style={{ color: 'var(--ink-faint)' }}
    >
      {children}
    </div>
  );
}

function NavItem({
  to,
  icon,
  label,
  end,
}: {
  to: string;
  icon: React.ReactNode;
  label: string;
  end?: boolean;
}) {
  return (
    <NavLink
      to={to}
      end={end}
      className="flex items-center gap-3 px-3 py-2 rounded-xl min-h-[40px] transition-colors"
      style={({ isActive }) => ({
        background: isActive ? 'var(--accent-glow)' : 'transparent',
        color: isActive ? 'var(--accent)' : 'var(--ink-muted)',
        boxShadow: isActive ? 'inset 0 0 0 1px var(--accent-glow)' : 'none',
      })}
    >
      {icon}
      <span className="font-medium text-sm">{label}</span>
    </NavLink>
  );
}

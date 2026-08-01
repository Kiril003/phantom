import React from 'react';
import { NavLink, Outlet } from 'react-router-dom';
import { Map, Key, Settings, BrainCircuit, Activity, Hexagon, Store, MessageSquare, Users, Gauge, ShieldAlert } from 'lucide-react';
import { useUIStore } from '../stores/uiStore';
import { motion } from 'framer-motion';

export default function DashboardLayout() {
  const setIntelligenceHubOpen = useUIStore((s) => s.setIntelligenceHubOpen);

  return (
    <div className="flex h-screen w-screen bg-[#0a0a0a] text-white overflow-hidden font-sans">
      {/* Sidebar - Glassmorphic Dark */}
      <motion.aside
        initial={{ x: -300, opacity: 0 }}
        animate={{ x: 0, opacity: 1 }}
        transition={{ duration: 0.5, ease: 'easeOut' }}
        className="w-64 border-r flex flex-col shrink-0 relative z-10"
        style={{
          background: 'rgba(20, 20, 22, 0.65)',
          backdropFilter: 'blur(16px)',
          WebkitBackdropFilter: 'blur(16px)',
          borderColor: 'rgba(255, 255, 255, 0.05)',
        }}
      >
        {/* Branding */}
        <div className="h-20 flex items-center px-6 border-b" style={{ borderColor: 'rgba(255, 255, 255, 0.05)' }}>
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg flex items-center justify-center bg-gradient-to-br from-amber-500 to-orange-600 shadow-lg shadow-orange-500/20">
              <Hexagon size={18} className="text-white" />
            </div>
            <span className="font-display tracking-widest text-sm font-bold bg-clip-text text-transparent bg-gradient-to-r from-amber-400 to-orange-500">
              PHANTOM OS
            </span>
          </div>
        </div>

        {/* Navigation */}
        <nav className="flex-1 px-3 py-6 space-y-1 overflow-y-auto no-scrollbar">
          <div className="px-3 mb-2 text-[10px] font-bold tracking-widest text-zinc-500 uppercase">
            Core Systems
          </div>
          
          <NavLink
            to="/"
            end
            className={({ isActive }) =>
              `flex items-center gap-3 px-3 py-2.5 rounded-xl transition-all duration-200 ${
                isActive
                  ? 'bg-amber-500/10 text-amber-400 shadow-[inset_0_0_0_1px_rgba(245,158,11,0.2)]'
                  : 'text-zinc-400 hover:text-zinc-100 hover:bg-white/5'
              }`
            }
          >
            <Activity size={18} />
            <span className="font-medium text-sm">Overview</span>
          </NavLink>

          <NavLink
            to="/map"
            className={({ isActive }) =>
              `flex items-center gap-3 px-3 py-2.5 rounded-xl transition-all duration-200 ${
                isActive
                  ? 'bg-amber-500/10 text-amber-400 shadow-[inset_0_0_0_1px_rgba(245,158,11,0.2)]'
                  : 'text-zinc-400 hover:text-zinc-100 hover:bg-white/5'
              }`
            }
          >
            <Map size={18} />
            <span className="font-medium text-sm">Map</span>
          </NavLink>
          
          <NavLink
            to="/polis"
            className={({ isActive }) =>
              `flex items-center gap-3 px-3 py-2.5 rounded-xl transition-all duration-200 ${
                isActive
                  ? 'bg-amber-500/10 text-amber-400 shadow-[inset_0_0_0_1px_rgba(245,158,11,0.2)]'
                  : 'text-zinc-400 hover:text-zinc-100 hover:bg-white/5'
              }`
            }
          >
            <Key size={18} />
            <span className="font-medium text-sm">Polis</span>
          </NavLink>

          <NavItem to="/chat" icon={<MessageSquare size={18} />} label="Чат" />
          <NavItem to="/operator" icon={<Users size={18} />} label="Штаб агентів" />
          <NavItem to="/system" icon={<Gauge size={18} />} label="Система" />
          <NavItem to="/sentinel" icon={<ShieldAlert size={18} />} label="Варта" />

          <div className="px-3 mt-8 mb-2 text-[10px] font-bold tracking-widest text-zinc-500 uppercase">
            Intelligence
          </div>

          <button
            onClick={() => setIntelligenceHubOpen(true)}
            className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-zinc-400 hover:text-zinc-100 hover:bg-white/5 transition-all duration-200"
          >
            <BrainCircuit size={18} />
            <span className="font-medium text-sm">Intelligence Hub</span>
          </button>

          <NavLink
            to="/marketplace"
            className={({ isActive }) =>
              `flex items-center gap-3 px-3 py-2.5 rounded-xl transition-all duration-200 ${
                isActive
                  ? 'bg-amber-500/10 text-amber-400 shadow-[inset_0_0_0_1px_rgba(245,158,11,0.2)]'
                  : 'text-zinc-400 hover:text-zinc-100 hover:bg-white/5'
              }`
            }
          >
            <Store size={18} />
            <span className="font-medium text-sm">Marketplace</span>
          </NavLink>

          <div className="px-3 mt-8 mb-2 text-[10px] font-bold tracking-widest text-zinc-500 uppercase">
            Configuration
          </div>

          <NavLink
            to="/settings"
            className={({ isActive }) =>
              `flex items-center gap-3 px-3 py-2.5 rounded-xl transition-all duration-200 ${
                isActive
                  ? 'bg-amber-500/10 text-amber-400 shadow-[inset_0_0_0_1px_rgba(245,158,11,0.2)]'
                  : 'text-zinc-400 hover:text-zinc-100 hover:bg-white/5'
              }`
            }
          >
            <Settings size={18} />
            <span className="font-medium text-sm">Settings</span>
          </NavLink>
        </nav>

        {/* User Profile / Status Bottom */}
        <div className="p-4 border-t" style={{ borderColor: 'rgba(255, 255, 255, 0.05)' }}>
          <div className="flex items-center gap-3 px-2">
            <div className="w-2 h-2 rounded-full bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.6)] animate-pulse" />
            <div className="text-xs text-zinc-400 font-medium">System Online</div>
          </div>
        </div>
      </motion.aside>

      {/* Main Content Area */}
      <main className="flex-1 relative flex flex-col overflow-hidden bg-black/40">
        <div className="absolute inset-0 bg-gradient-to-br from-black via-zinc-900/20 to-black pointer-events-none" />
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

function NavItem({ to, icon, label }: { to: string; icon: React.ReactNode; label: string }) {
  return (
    <NavLink
      to={to}
      className={({ isActive }) =>
        `flex items-center gap-3 px-3 py-2.5 rounded-xl transition-all duration-200 min-h-[44px] ${
          isActive
            ? 'bg-amber-500/10 text-amber-400 shadow-[inset_0_0_0_1px_rgba(245,158,11,0.2)]'
            : 'text-zinc-400 hover:text-zinc-100 hover:bg-white/5'
        }`
      }
    >
      {icon}
      <span className="font-medium text-sm">{label}</span>
    </NavLink>
  );
}

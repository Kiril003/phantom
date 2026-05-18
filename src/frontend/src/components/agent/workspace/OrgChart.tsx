import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { 
  Users, ShieldCheck, Cpu, 
  Terminal, Search, BookOpen, 
  ChevronRight, PencilLine, Check, X,
  Briefcase
} from 'lucide-react';
import { useAgentStore } from '../../../stores/agentStore';

/**
 * OrgChart — Phase 30.
 *
 * Visualizes the sub-agent team, their roles, and trust relationships.
 * Supports editing standing orders for each specialized role.
 */

const ROLE_ICONS: Record<string, any> = {
  'CEO': Briefcase,
  'Developer': Terminal,
  'Researcher': Search,
  'Auditor': ShieldCheck,
};

export function OrgChart() {
  const orgChart = useAgentStore((s) => s.orgChart);
  const loadOrgChart = useAgentStore((s) => s.loadOrgChart);
  const updateRoleOrders = useAgentStore((s) => s.updateRoleOrders);

  const [selectedRoleId, setSelectedRoleId] = useState<string | null>(null);
  const [editingOrders, setEditingOrders] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    loadOrgChart();
  }, [loadOrgChart]);

  if (!orgChart) {
    return (
      <div className="flex-1 flex items-center justify-center opacity-40 font-mono text-[10px] tracking-widest uppercase">
        Initializing Org-Chart Protocol...
      </div>
    );
  }

  const selectedRole = orgChart.roles.find(r => r.id === selectedRoleId) || orgChart.roles[0];

  const handleSaveOrders = async () => {
    if (!selectedRoleId || editingOrders === null) return;
    setBusy(true);
    try {
      await updateRoleOrders(selectedRoleId, editingOrders);
      setEditingOrders(null);
    } catch (err) {
      // Handled by store/toast
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex-1 flex flex-col gap-4 p-4 min-h-0">
      {/* ── Hierarchy View ────────────────────────────────────────────────── */}
      <div className="grid grid-cols-4 gap-3 shrink-0">
        {orgChart.roles.map((role) => {
          const Icon = ROLE_ICONS[role.name] || Users;
          const isSelected = selectedRole?.id === role.id;
          
          return (
            <motion.button
              key={role.id}
              onClick={() => { setSelectedRoleId(role.id); setEditingOrders(null); }}
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
              className={`p-3 rounded-2xl border transition-all flex flex-col items-center text-center gap-2 ${
                isSelected 
                  ? 'bg-primary/10 border-primary shadow-lg shadow-primary/10' 
                  : 'bg-white/40 border-black/5 hover:bg-white/60'
              }`}
            >
              <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${isSelected ? 'bg-primary text-white' : 'bg-black/5 text-slate-400'}`}>
                <Icon size={20} />
              </div>
              <div className="flex flex-col gap-0.5">
                <span className={`text-[11px] font-bold uppercase tracking-widest ${isSelected ? 'text-primary-deep' : 'text-slate-500'}`}>
                  {role.name}
                </span>
                <span className="text-[9px] text-slate-400 opacity-60">ACTIVE</span>
              </div>
            </motion.button>
          );
        })}
      </div>

      {/* ── Detail View ───────────────────────────────────────────────────── */}
      <AnimatePresence mode="wait">
        {selectedRole && (
          <motion.div
            key={selectedRole.id}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            className="flex-1 flex flex-col gap-4 bg-white/60 border border-black/5 rounded-[24px] p-5 shadow-sm"
          >
            <div className="flex items-start justify-between">
               <div className="flex flex-col gap-1">
                  <span className="micro-label text-primary font-bold">ROLE_SPECIFICATION</span>
                  <h2 className="text-[18px] font-bold text-slate-900 font-display">{selectedRole.name}</h2>
                  <p className="text-[12px] text-slate-500 leading-relaxed max-w-[400px]">
                    {selectedRole.description}
                  </p>
               </div>
               
               <div className="flex flex-col items-end gap-2">
                  <div className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-black/5 border border-black/5">
                     <div className="w-1.5 h-1.5 rounded-full bg-green-500" />
                     <span className="text-[9px] font-bold font-mono text-slate-500 uppercase">Trusted_Node</span>
                  </div>
               </div>
            </div>

            <div className="flex-1 grid grid-cols-2 gap-4 min-h-0">
               {/* Standing Orders */}
               <div className="flex flex-col gap-2">
                  <div className="flex items-center justify-between">
                     <span className="micro-label text-slate-400 flex items-center gap-2">
                        <BookOpen size={12} /> Standing Orders
                     </span>
                     {editingOrders === null ? (
                        <button 
                          onClick={() => setEditingOrders(selectedRole.standing_orders)}
                          className="p-1 text-primary/60 hover:text-primary transition-colors"
                        >
                           <PencilLine size={12} />
                        </button>
                     ) : (
                        <div className="flex items-center gap-2">
                           <button onClick={handleSaveOrders} disabled={busy} className="p-1 text-green-600 hover:scale-110 transition-transform">
                              <Check size={12} />
                           </button>
                           <button onClick={() => setEditingOrders(null)} className="p-1 text-red-500 hover:scale-110 transition-transform">
                              <X size={12} />
                           </button>
                        </div>
                     )}
                  </div>
                  
                  {editingOrders !== null ? (
                     <textarea
                       autoFocus
                       value={editingOrders}
                       onChange={(e) => setEditingOrders(e.target.value)}
                       className="flex-1 bg-white/80 border border-primary/20 rounded-xl p-3 text-[12px] font-display text-slate-800 outline-none focus:border-primary/50 transition-all resize-none shadow-inner"
                     />
                  ) : (
                     <div className="flex-1 bg-black/[0.03] border border-black/5 rounded-xl p-4 text-[12px] text-slate-700 italic leading-relaxed font-display overflow-y-auto">
                        "{selectedRole.standing_orders || 'No orders defined.'}"
                     </div>
                  )}
               </div>

               {/* Cognitive Context & Relations */}
               <div className="flex flex-col gap-4">
                  <div className="flex flex-col gap-2">
                     <span className="micro-label text-slate-400 flex items-center gap-2">
                        <Cpu size={12} /> Prompt Extension
                     </span>
                     <div className="bg-black/5 border border-black/5 rounded-xl p-3 font-mono text-[10px] text-slate-500 leading-normal">
                        {selectedRole.system_prompt_extension}
                     </div>
                  </div>

                  <div className="flex flex-col gap-2">
                     <span className="micro-label text-slate-400 flex items-center gap-2">
                        <Users size={12} /> Team Relations
                     </span>
                     <div className="flex flex-col gap-1.5">
                        {orgChart.relations
                          .filter(rel => rel.source_role_id === selectedRole.id)
                          .map(rel => {
                            const target = orgChart.roles.find(r => r.id === rel.target_role_id);
                            return (
                              <div key={rel.id} className="flex items-center justify-between px-3 py-2 bg-white/40 border border-black/5 rounded-lg shadow-sm">
                                 <div className="flex items-center gap-2">
                                    <span className="text-[10px] font-bold text-slate-700">{target?.name}</span>
                                    <ChevronRight size={10} className="text-slate-300" />
                                    <span className="text-[9px] font-mono font-bold text-primary uppercase">{rel.relation_type}</span>
                                 </div>
                                 <span className="text-[9px] font-mono text-slate-400">{(rel.trust_level * 100).toFixed(0)}% TRUST</span>
                              </div>
                            );
                          })}
                     </div>
                  </div>
               </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

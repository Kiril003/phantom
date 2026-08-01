import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useUIStore } from '../../stores/uiStore';
import { Bot, Zap, Search } from 'lucide-react';

interface AgentTemplate {
  id: string;
  name: string;
  description: string;
  category: string;
  icon: string;
  author: string;
  downloads: number;
}

const MOCK_AGENTS: AgentTemplate[] = [
  {
    id: 't-1',
    name: 'OSINT Gatherer',
    description: 'Scrapes public intelligence data from multiple sources.',
    category: 'Intelligence',
    icon: '🕵️',
    author: 'Phantom Labs',
    downloads: 1250,
  },
  {
    id: 't-2',
    name: 'Security Auditor',
    description: 'Automated vulnerability scanning and reporting agent.',
    category: 'Security',
    icon: '🛡️',
    author: 'CyberOps',
    downloads: 840,
  },
  {
    id: 't-3',
    name: 'Data Synthesizer',
    description: 'Aggregates and formats raw data into clean JSON schemas.',
    category: 'Data',
    icon: '📊',
    author: 'DataCorp',
    downloads: 3200,
  },
  {
    id: 't-4',
    name: 'Network Mapper',
    description: 'Visualizes and monitors local or remote network topography.',
    category: 'Networking',
    icon: '🌐',
    author: 'NetSec',
    downloads: 512,
  },
  {
    id: 't-5',
    name: 'Social Engineer',
    description: 'Runs automated phishing campaigns for security training.',
    category: 'Offensive',
    icon: '🎭',
    author: 'RedTeam',
    downloads: 215,
  }
];

export default function AgentMarketplace() {
  const toast = useUIStore((s) => s.toast);
  const [agents, setAgents] = useState<AgentTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [deploying, setDeploying] = useState<string | null>(null);

  useEffect(() => {
    // Mocking GET /api/v1/marketplace/agents
    const fetchAgents = async () => {
      setLoading(true);
      try {
        // In a real app we'd fetch from an API
        // const res = await fetch('/api/v1/marketplace/agents');
        // const data = await res.json();
        
        // Simulating network delay
        await new Promise((resolve) => setTimeout(resolve, 800));
        setAgents(MOCK_AGENTS);
      } catch (err) {
        toast({ kind: 'error', message: 'Failed to load templates' });
      } finally {
        setLoading(false);
      }
    };
    fetchAgents();
  }, [toast]);

  const deployAgent = async (agent: AgentTemplate) => {
    setDeploying(agent.id);
    try {
      // Mocking POST /api/v1/tenant/agents/deploy
      // await fetch('/api/v1/tenant/agents/deploy', { method: 'POST', body: JSON.stringify({ templateId: agent.id }) });
      await new Promise((resolve) => setTimeout(resolve, 1500));
      toast({ kind: 'success', message: `${agent.name} deployed successfully.` });
    } catch (err) {
      toast({ kind: 'error', message: `Failed to deploy ${agent.name}.` });
    } finally {
      setDeploying(null);
    }
  };

  return (
    <div className="w-full h-full p-8 flex flex-col text-white">
      {/* Header */}
      <div className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-white to-white/50 flex items-center gap-3">
            <Bot className="text-amber-500" size={32} />
            Agent Marketplace
          </h1>
          <p className="text-zinc-400 mt-2 text-sm">
            Discover and deploy specialized AI agents into your Phantom OS tenant.
          </p>
        </div>
        
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500" size={18} />
          <input 
            type="text" 
            placeholder="Search agents..." 
            className="bg-black/40 border border-white/10 rounded-full py-2 pl-10 pr-4 text-sm focus:outline-none focus:border-amber-500/50 transition-colors w-64"
          />
        </div>
      </div>

      {/* Grid */}
      <div className="flex-1 overflow-y-auto no-scrollbar pb-12">
        {loading ? (
          <div className="flex items-center justify-center h-64">
            <div className="w-8 h-8 border-2 rounded-full animate-spin border-amber-500 border-t-transparent" />
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
            <AnimatePresence>
              {agents.map((agent, i) => (
                <motion.div
                  key={agent.id}
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: i * 0.05 }}
                  className="group relative rounded-2xl overflow-hidden border border-white/5 bg-white/[0.02] hover:bg-white/[0.04] transition-colors"
                  style={{ backdropFilter: 'blur(12px)' }}
                >
                  {/* Glassmorphic Gradient */}
                  <div className="absolute inset-0 bg-gradient-to-br from-amber-500/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-500" />
                  
                  <div className="p-6 relative z-10 flex flex-col h-full">
                    <div className="flex items-start justify-between mb-4">
                      <div className="w-12 h-12 rounded-xl bg-black/40 flex items-center justify-center text-2xl border border-white/5 shadow-inner">
                        {agent.icon}
                      </div>
                      <span className="text-[10px] font-bold tracking-widest uppercase text-amber-500/80 bg-amber-500/10 px-2 py-1 rounded-full">
                        {agent.category}
                      </span>
                    </div>
                    
                    <h3 className="text-lg font-bold mb-2 group-hover:text-amber-400 transition-colors">
                      {agent.name}
                    </h3>
                    <p className="text-sm text-zinc-400 mb-6 flex-1">
                      {agent.description}
                    </p>
                    
                    <div className="flex items-center justify-between mt-auto pt-4 border-t border-white/5">
                      <div className="flex flex-col">
                        <span className="text-xs text-zinc-500 font-medium">By {agent.author}</span>
                        <span className="text-xs text-zinc-600">{agent.downloads.toLocaleString()} installs</span>
                      </div>
                      
                      <button
                        onClick={() => deployAgent(agent)}
                        disabled={deploying === agent.id}
                        className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                          deploying === agent.id
                            ? 'bg-amber-500/20 text-amber-500 cursor-not-allowed'
                            : 'bg-white/10 hover:bg-amber-500 text-white hover:text-black'
                        }`}
                      >
                        {deploying === agent.id ? (
                          <>
                            <div className="w-4 h-4 border-2 rounded-full animate-spin border-amber-500 border-t-transparent" />
                            Deploying...
                          </>
                        ) : (
                          <>
                            <Zap size={16} />
                            Deploy
                          </>
                        )}
                      </button>
                    </div>
                  </div>
                </motion.div>
              ))}
            </AnimatePresence>
          </div>
        )}
      </div>
    </div>
  );
}

import React, { useState, useEffect, useRef } from 'react';
import {
  X,
  Bot,
  ShieldAlert,
  Code2,
  Database,
  Layers,
  Cpu,
  Volume2,
  Play,
  CheckCircle2,
  Download,
  KeyRound,
  EyeOff,
  BatteryCharging,
  Search,
  Zap,
} from 'lucide-react';
import { soundFx } from '../../utils/messengerSound';

interface AgenticWorkspaceVirtualizationModalProps {
  isOpen: boolean;
  onClose: () => void;
  chatTitle?: string;
}

type TabType = 'agents' | 'sandbox' | 'spatial' | 'sovereignty';

interface SecurityIssue {
  id: string;
  file: string;
  severity: 'high' | 'medium' | 'low';
  title: string;
  cveId: string;
  autoBlocked: boolean;
}

interface RAGSearchResult {
  id: string;
  query: string;
  citation: string;
  sourceType: 'message' | 'canvas' | 'pdf';
  sourceTitle: string;
  author: string;
  timestamp: string;
  similarity: number;
}

interface ComputeNode {
  id: string;
  name: string;
  role: string;
  ip: string;
  status: 'online' | 'busy' | 'standby';
  cpuUsage: number;
  memoryUsage: number;
  isOffloadTarget: boolean;
  batteryLevel?: number;
}

interface SpatialParticipant {
  id: string;
  name: string;
  avatar: string;
  x: number;
  y: number;
  volume: number;
  pan: number; // -1 (left) to 1 (right)
}

export const AgenticWorkspaceVirtualizationModal: React.FC<AgenticWorkspaceVirtualizationModalProps> = ({
  isOpen,
  onClose,
  chatTitle = 'Командний Простір',
}) => {
  const [activeTab, setActiveTab] = useState<TabType>('agents');

  // --- TAB 1: SUB-AGENTS & RAG ---
  const [cveIssues] = useState<SecurityIssue[]>([
    {
      id: 'cve-1',
      file: 'src/crypto/handshake.rs',
      severity: 'high',
      title: 'Небезпечний генератор випадкових чисел у старому крейті rand_core',
      cveId: 'CVE-2026-4419',
      autoBlocked: true,
    },
    {
      id: 'cve-2',
      file: 'package.json (ws)',
      severity: 'medium',
      title: 'Вразливість DoS через некоректний парсинг UTF-8 WebSocket фреймів',
      cveId: 'CVE-2026-1182',
      autoBlocked: true,
    },
  ]);
  const [isScanningSecurity, setIsScanningSecurity] = useState(false);

  // Test Generator
  const [codeSnippet, setCodeSnippet] = useState(
    `export function calculateMeshThroughput(nodes: number, packetLoss: number): number {\n  if (packetLoss >= 1) return 0;\n  return Math.round(nodes * 128 * (1 - packetLoss));\n}`
  );
  const [isGeneratingTests, setIsGeneratingTests] = useState(false);
  const [generatedTests, setGeneratedTests] = useState<string | null>(null);
  const [testCoverage, setTestCoverage] = useState<number | null>(null);

  // Local RAG
  const [ragQuery, setRagQuery] = useState('де обговорювався вибір бази даних?');
  const [ragResults] = useState<RAGSearchResult[]>([
    {
      id: 'rag-1',
      query: 'вибір бази даних',
      citation: '«Для суверенних вузлів беремо SQLite + CRDT LWW-Element-Set для повної автономності без зовнішнього Postgres»',
      sourceType: 'canvas',
      sourceTitle: 'Архітектурний маніфест (Canvas)',
      author: 'Кирило (Lead)',
      timestamp: '24 Серпня 2026, 14:20',
      similarity: 0.96,
    },
    {
      id: 'rag-2',
      query: 'вибір бази даних',
      citation: '«Погоджено: шифрування бази через SQLCipher з ключем, розбитим за схемою Шаміра»',
      sourceType: 'message',
      sourceTitle: 'Чат #core-devs',
      author: 'Саня (Dev)',
      timestamp: '25 Серпня 2026, 09:15',
      similarity: 0.91,
    },
  ]);
  const [isSearchingRag, setIsSearchingRag] = useState(false);

  // --- TAB 2: SANDBOX & COMPUTE SWARM ---
  const [manifestPermissions, setManifestPermissions] = useState({
    'storage:local': true,
    'network:p2p-only': true,
    'clipboard:read-on-click': false,
    'media:microphone': false,
    'eval:wasm-sandbox': true,
  });

  const [computeNodes] = useState<ComputeNode[]>([
    {
      id: 'node-home',
      name: 'Radxa Home Server (Node #01)',
      role: 'Master Compute Node',
      ip: '192.168.1.104:8000',
      status: 'online',
      cpuUsage: 24,
      memoryUsage: 48,
      isOffloadTarget: true,
    },
    {
      id: 'node-workstation',
      name: 'Workstation AMD Threadripper',
      role: 'Heavy LLM & Compile Worker',
      ip: '192.168.1.120:8000',
      status: 'busy',
      cpuUsage: 78,
      memoryUsage: 62,
      isOffloadTarget: true,
    },
    {
      id: 'node-laptop',
      name: 'MacBook Air (Mobile Client)',
      role: 'Local Battery-Saver Node',
      ip: '192.168.1.215 (Wi-Fi)',
      status: 'online',
      cpuUsage: 12,
      memoryUsage: 35,
      isOffloadTarget: false,
      batteryLevel: 42,
    },
  ]);
  const [autoOffloadEnabled, setAutoOffloadEnabled] = useState(true);

  // --- TAB 3: SPATIAL AUDIO & DEEP WORK ---
  const [isDeepWorkActive, setIsDeepWorkActive] = useState(false);
  const [deepWorkSecondsLeft, setDeepWorkSecondsLeft] = useState(90 * 60);
  const [keymapMode, setKeymapMode] = useState<'vim' | 'emacs' | 'sublime' | 'standard'>('vim');

  const [spatialParticipants, setSpatialParticipants] = useState<SpatialParticipant[]>([
    { id: 'p_you', name: 'Ви (Слухач)', avatar: '👤', x: 200, y: 150, volume: 100, pan: 0 },
    { id: 'p_sanya', name: 'Саня (Dev)', avatar: '👨‍💻', x: 90, y: 70, volume: 85, pan: -0.6 },
    { id: 'p_maryna', name: 'Марина (UI)', avatar: '👩‍🎨', x: 310, y: 80, volume: 78, pan: 0.7 },
    { id: 'p_oleksandr', name: 'Олександр (Ops)', avatar: '🧙‍♂️', x: 200, y: 260, volume: 60, pan: 0.1 },
  ]);

  const [draggingParticipantId, setDraggingParticipantId] = useState<string | null>(null);
  const spatialCanvasRef = useRef<HTMLDivElement>(null);

  // --- TAB 4: SHAMIR SECRET SHARING & EXPORT ---
  const [shamirThreshold] = useState(3);
  const [shamirTotalShards] = useState(5);
  const [shardsAssigned] = useState([
    { shardIndex: 1, holder: 'Домашній Radxa Server', verified: true },
    { shardIndex: 2, holder: 'Саня (Довірений пір)', verified: true },
    { shardIndex: 3, holder: 'Марина (Довірений пір)', verified: true },
    { shardIndex: 4, holder: 'Зашифрована Cold USB флешка', verified: true },
    { shardIndex: 5, holder: 'Резервний вузол батьків', verified: false },
  ]);
  const [isExporting, setIsExporting] = useState(false);
  const [exportComplete, setExportComplete] = useState(false);

  // Deep work countdown timer
  useEffect(() => {
    if (!isDeepWorkActive) return;
    const interval = setInterval(() => {
      setDeepWorkSecondsLeft((prev) => {
        if (prev <= 1) {
          setIsDeepWorkActive(false);
          return 90 * 60;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(interval);
  }, [isDeepWorkActive]);

  // Handle Dragging in Spatial Grid
  const handleSpatialMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!draggingParticipantId || !spatialCanvasRef.current) return;
    const rect = spatialCanvasRef.current.getBoundingClientRect();
    const x = Math.max(20, Math.min(rect.width - 20, e.clientX - rect.left));
    const y = Math.max(20, Math.min(rect.height - 20, e.clientY - rect.top));

    setSpatialParticipants((prev) => {
      const updated = prev.map((p) => (p.id === draggingParticipantId ? { ...p, x, y } : p));
      const you = updated.find((p) => p.id === 'p_you') || { x: 200, y: 150 };

      // Recalculate 3D stereo pan and volume attenuation based on distance to 'p_you'
      return updated.map((p) => {
        if (p.id === 'p_you') return p;
        const dx = p.x - you.x;
        const dy = p.y - you.y;
        const distance = Math.sqrt(dx * dx + dy * dy);
        const maxDist = 300;
        const volume = Math.max(10, Math.round((1 - Math.min(distance, maxDist) / maxDist) * 100));
        const pan = Math.max(-1, Math.min(1, dx / 150));
        return { ...p, volume, pan: Number(pan.toFixed(2)) };
      });
    });
  };

  // Run Test Gen
  const handleGenerateTests = () => {
    soundFx.playTap();
    setIsGeneratingTests(true);
    setTimeout(() => {
      setIsGeneratingTests(false);
      setGeneratedTests(`describe('calculateMeshThroughput', () => {
  it('returns 0 when packet loss is 100%', () => {
    expect(calculateMeshThroughput(10, 1.0)).toBe(0);
  });

  it('calculates optimal throughput on 0% loss', () => {
    expect(calculateMeshThroughput(5, 0.0)).toBe(640);
  });

  it('handles partial loss gracefully', () => {
    expect(calculateMeshThroughput(8, 0.25)).toBe(768);
  });
});`);
      setTestCoverage(97.4);
      soundFx.playChime();
    }, 1200);
  };

  // Run RAG Query
  const handleSearchRag = () => {
    if (!ragQuery.trim()) return;
    soundFx.playTap();
    setIsSearchingRag(true);
    setTimeout(() => {
      setIsSearchingRag(false);
      soundFx.playChime();
    }, 800);
  };

  // Run Export
  const handleExportWorkspace = () => {
    soundFx.playTap();
    setIsExporting(true);
    setTimeout(() => {
      setIsExporting(false);
      setExportComplete(true);
      soundFx.playChime();
      setTimeout(() => setExportComplete(false), 4000);
    }, 1600);
  };

  const formatTime = (secs: number) => {
    const m = Math.floor(secs / 60);
    const s = secs % 60;
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  };

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6 bg-black/60 backdrop-blur-md animate-in fade-in duration-200"
      onClick={onClose}
    >
      <div
        className="w-full max-w-5xl max-h-[90vh] bg-[#FDFCF9] border border-[#E5DEC9] rounded-2xl shadow-2xl overflow-hidden flex flex-col text-[#21261F] animate-in zoom-in-95 duration-150 select-text"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-5 py-3.5 bg-[#FAF7F0] border-b border-[#E5DEC9] flex items-center justify-between gap-3 shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-[#FDF5ED] border border-[#E8D9C5] flex items-center justify-center text-[#D96C35] shadow-xs">
              <Bot className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-base font-bold text-[#21261F]">
                  Agentic Runtime & Нейроергономіка
                </h3>
                <span className="px-2 py-0.5 rounded-full bg-[#EFE9DC] text-[#6E7568] text-[10.5px] font-bold">
                  {chatTitle}
                </span>
              </div>
              <p className="text-xs text-[#6E7568]">
                Автономні AI-агенти, Wasm-пісочниця, Compute Swarm, 3D Spatial Audio та ZK-бекап
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="p-1.5 hover:bg-[#EFE9DC] rounded-lg text-[#6E7568] hover:text-[#21261F] transition-colors"
            title="Закрити"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Navigation Tabs */}
        <div className="px-5 pt-2 bg-[#FAF7F0] border-b border-[#E5DEC9] flex items-center gap-2 overflow-x-auto shrink-0">
          {[
            { id: 'agents', label: '1. AI-Агенти & RAG', icon: Bot },
            { id: 'sandbox', label: '2. Wasm Sandbox & Swarm', icon: Cpu },
            { id: 'spatial', label: '3. Spatial Audio & Deep Work', icon: Volume2 },
            { id: 'sovereignty', label: '4. Shamir ZK & Експорт', icon: KeyRound },
          ].map((tab) => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => {
                  soundFx.playTap();
                  setActiveTab(tab.id as TabType);
                }}
                className={`flex items-center gap-2 px-3.5 py-2 rounded-t-xl text-xs font-bold transition-all border-t border-x ${
                  isActive
                    ? 'bg-[#FDFCF9] text-[#D96C35] border-[#E5DEC9] shadow-xs'
                    : 'bg-transparent text-[#6E7568] hover:text-[#21261F] border-transparent'
                }`}
              >
                <Icon className="w-3.5 h-3.5" />
                <span>{tab.label}</span>
              </button>
            );
          })}
        </div>

        {/* Content Body */}
        <div className="flex-1 min-h-0 p-5 bg-[#FAF7F0] overflow-y-auto custom-scrollbar">
          {/* TAB 1: AGENTS & RAG */}
          {activeTab === 'agents' && (
            <div className="space-y-6">
              {/* Security Sentinel Sub-Agent */}
              <div className="p-4 bg-white border border-[#E5DEC9] rounded-2xl shadow-xs">
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <ShieldAlert className="w-4 h-4 text-red-500" />
                    <h4 className="text-sm font-bold text-[#21261F]">
                      Фоновий агент «Security Sentinel»
                    </h4>
                    <span className="px-2 py-0.5 bg-red-100 text-red-700 text-[10px] font-bold rounded-full">
                      ● Active Guardian
                    </span>
                  </div>
                  <button
                    onClick={() => {
                      soundFx.playTap();
                      setIsScanningSecurity(true);
                      setTimeout(() => {
                        setIsScanningSecurity(false);
                        soundFx.playChime();
                      }, 1000);
                    }}
                    className="flex items-center gap-1.5 px-3 py-1 bg-[#FAF7F0] hover:bg-[#FDF5ED] border border-[#E5DEC9] text-xs font-semibold text-[#21261F] rounded-lg transition-all"
                  >
                    <Zap className={`w-3.5 h-3.5 text-[#D96C35] ${isScanningSecurity ? 'animate-spin' : ''}`} />
                    <span>{isScanningSecurity ? 'Сканування CVE...' : 'Сканувати код'}</span>
                  </button>
                </div>
                <p className="text-xs text-[#6E7568] mb-3">
                  Автоматично перевіряє код і залежності простору, звіряє з локальною базою CVE та блокує небезпечні merge.
                </p>

                <div className="space-y-2">
                  {cveIssues.map((issue) => (
                    <div
                      key={issue.id}
                      className="p-3 bg-[#FAF8F5] border border-[#E8E1D3] rounded-xl flex items-start justify-between gap-3 text-xs"
                    >
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="font-bold text-red-600">{issue.cveId}</span>
                          <span className="font-mono text-[11px] text-[#21261F] bg-white px-1.5 py-0.5 rounded border border-[#E5DEC9]">
                            {issue.file}
                          </span>
                        </div>
                        <p className="text-[11.5px] text-[#6E7568] mt-1">{issue.title}</p>
                      </div>
                      <span className="px-2 py-1 bg-red-50 border border-red-200 text-red-700 font-bold rounded-lg shrink-0">
                        🚫 Merge Заблоковано
                      </span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Auto-Refactoring & Wasm Test Generator */}
              <div className="p-4 bg-white border border-[#E5DEC9] rounded-2xl shadow-xs">
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <Code2 className="w-4 h-4 text-emerald-600" />
                    <h4 className="text-sm font-bold text-[#21261F]">
                      Wasm Test Generator (@agent test-gen)
                    </h4>
                  </div>
                  {testCoverage !== null && (
                    <div className="flex items-center gap-1.5 px-2.5 py-1 bg-emerald-50 border border-emerald-300 text-emerald-800 text-xs font-bold rounded-lg">
                      <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                      <span>Покриття коду: {testCoverage}%</span>
                    </div>
                  )}
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div>
                    <label className="text-[11px] font-bold text-[#6E7568] block mb-1">
                      Вихідний код (Canvas/File):
                    </label>
                    <textarea
                      value={codeSnippet}
                      onChange={(e) => setCodeSnippet(e.target.value)}
                      rows={5}
                      className="w-full p-2.5 bg-[#1C211D] text-emerald-400 font-mono text-xs rounded-xl focus:outline-none leading-relaxed resize-none"
                    />
                    <button
                      onClick={handleGenerateTests}
                      disabled={isGeneratingTests}
                      className="mt-2 w-full flex items-center justify-center gap-1.5 py-2 bg-[#D96C35] hover:bg-[#B85425] text-white text-xs font-bold rounded-xl shadow-xs transition-all disabled:opacity-50"
                    >
                      <Play className="w-3.5 h-3.5" />
                      <span>{isGeneratingTests ? 'Wasm компіляція та генерація тестів...' : 'Згенерувати та запустити тести'}</span>
                    </button>
                  </div>

                  <div>
                    <label className="text-[11px] font-bold text-[#6E7568] block mb-1">
                      Згенеровані тести (Wasm Sandbox output):
                    </label>
                    <div className="w-full h-[142px] p-2.5 bg-[#181B19] text-gray-300 font-mono text-[11px] rounded-xl overflow-y-auto border border-[#2B332C]">
                      {generatedTests ? (
                        <pre className="whitespace-pre-wrap text-emerald-300">{generatedTests}</pre>
                      ) : (
                        <span className="text-gray-500 italic">
                          Натисніть кнопку ліворуч для генерації юніт-тестів та перевірки покриття.
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              </div>

              {/* Local RAG Knowledge Synthesizer */}
              <div className="p-4 bg-white border border-[#E5DEC9] rounded-2xl shadow-xs">
                <div className="flex items-center gap-2 mb-2">
                  <Database className="w-4 h-4 text-indigo-600" />
                  <h4 className="text-sm font-bold text-[#21261F]">
                    Local RAG & Knowledge Synthesizer
                  </h4>
                </div>
                <p className="text-xs text-[#6E7568] mb-3">
                  Векторний семантичний пошук по всіх PDF, діаграмах, повідомленнях та рішеннях Canvas без звернення до хмари.
                </p>

                <div className="flex items-center gap-2 mb-3">
                  <div className="relative flex-1">
                    <Search className="w-4 h-4 text-[#8A9186] absolute left-3 top-2.5" />
                    <input
                      type="text"
                      value={ragQuery}
                      onChange={(e) => setRagQuery(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && handleSearchRag()}
                      placeholder="Запитайте у бази знань простору..."
                      className="w-full pl-9 pr-3 py-2 bg-[#FAF7F0] border border-[#E5DEC9] rounded-xl text-xs focus:outline-none focus:border-[#D96C35]"
                    />
                  </div>
                  <button
                    onClick={handleSearchRag}
                    disabled={isSearchingRag}
                    className="px-4 py-2 bg-[#D96C35] hover:bg-[#B85425] text-white text-xs font-bold rounded-xl shadow-xs transition-all disabled:opacity-50"
                  >
                    {isSearchingRag ? 'Пошук...' : 'Пошук'}
                  </button>
                </div>

                <div className="space-y-2">
                  {ragResults.map((res) => (
                    <div
                      key={res.id}
                      className="p-3 bg-[#FAF8F5] border border-[#E8E1D3] rounded-xl text-xs flex flex-col gap-1"
                    >
                      <div className="flex items-center justify-between text-[11px] text-[#6E7568]">
                        <span className="font-bold text-[#D96C35]">{res.sourceTitle}</span>
                        <span>{res.author} • {res.timestamp}</span>
                      </div>
                      <p className="text-xs text-[#21261F] font-medium leading-relaxed italic">
                        {res.citation}
                      </p>
                      <div className="flex justify-end pt-1">
                        <span className="text-[10px] font-mono text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded border border-emerald-200">
                          Схожість: {Math.round(res.similarity * 100)}%
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* TAB 2: SANDBOX & COMPUTE SWARM */}
          {activeTab === 'sandbox' && (
            <div className="space-y-6">
              {/* Plugin Manifest v3 Sandbox */}
              <div className="p-4 bg-white border border-[#E5DEC9] rounded-2xl shadow-xs">
                <div className="flex items-center gap-2 mb-2">
                  <Layers className="w-4 h-4 text-[#D96C35]" />
                  <h4 className="text-sm font-bold text-[#21261F]">
                    Phantom Sandboxed Extensions (Plugin Manifest v3)
                  </h4>
                </div>
                <p className="text-xs text-[#6E7568] mb-4">
                  Сувора ізоляція прав плагінів. Заборонені мережеві виклики блокуються на рівні Wasm/iframe пісочниці.
                </p>

                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
                  {Object.entries(manifestPermissions).map(([perm, enabled]) => (
                    <div
                      key={perm}
                      className={`p-3 rounded-xl border flex items-center justify-between transition-all ${
                        enabled ? 'bg-[#FDF9F3] border-[#D96C35]/40' : 'bg-[#FAF8F5] border-[#E8E1D3]'
                      }`}
                    >
                      <div className="min-w-0 pr-2">
                        <div className="font-mono text-xs font-bold text-[#21261F] truncate">{perm}</div>
                        <div className="text-[10px] text-[#6E7568]">
                          {perm === 'storage:local'
                            ? 'Локальне сховище'
                            : perm === 'network:p2p-only'
                            ? 'Тільки P2P звʼязок'
                            : perm === 'clipboard:read-on-click'
                            ? 'Буфер за кліком'
                            : 'Wasm пісочниця'}
                        </div>
                      </div>
                      <input
                        type="checkbox"
                        checked={enabled}
                        onChange={(e) => {
                          soundFx.playTap();
                          setManifestPermissions((prev) => ({ ...prev, [perm]: e.target.checked }));
                        }}
                        className="w-4 h-4 accent-[#D96C35] rounded cursor-pointer shrink-0"
                      />
                    </div>
                  ))}
                </div>
              </div>

              {/* Headless Node Daemon Cluster (Compute Swarm) */}
              <div className="p-4 bg-white border border-[#E5DEC9] rounded-2xl shadow-xs">
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <Cpu className="w-4 h-4 text-indigo-600" />
                    <h4 className="text-sm font-bold text-[#21261F]">
                      Headless Compute Swarm (Розподілений Кластер)
                    </h4>
                  </div>
                  <label className="flex items-center gap-2 text-xs font-semibold text-[#21261F] cursor-pointer">
                    <input
                      type="checkbox"
                      checked={autoOffloadEnabled}
                      onChange={(e) => {
                        soundFx.playTap();
                        setAutoOffloadEnabled(e.target.checked);
                      }}
                      className="w-4 h-4 accent-[#D96C35] rounded"
                    />
                    <span>Авто-оффлоад при роботі від батареї</span>
                  </label>
                </div>

                <div className="space-y-3">
                  {computeNodes.map((node) => (
                    <div
                      key={node.id}
                      className="p-3.5 bg-[#FAF8F5] border border-[#E8E1D3] rounded-xl flex flex-wrap items-center justify-between gap-3 text-xs"
                    >
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <h5 className="font-bold text-[#21261F]">{node.name}</h5>
                          <span className="px-2 py-0.5 bg-emerald-100 text-emerald-800 text-[10px] font-bold rounded-full">
                            {node.status}
                          </span>
                          {node.batteryLevel !== undefined && (
                            <span className="flex items-center gap-1 text-[11px] text-amber-700 bg-amber-50 px-2 py-0.5 rounded border border-amber-200">
                              <BatteryCharging className="w-3 h-3" />
                              <span>{node.batteryLevel}% (Battery)</span>
                            </span>
                          )}
                        </div>
                        <p className="text-[11px] text-[#6E7568] mt-0.5">{node.role} • {node.ip}</p>
                      </div>

                      <div className="flex items-center gap-4">
                        <div className="text-right">
                          <div className="text-[11px] font-bold text-[#21261F]">CPU: {node.cpuUsage}%</div>
                          <div className="w-24 bg-[#E5DEC9] h-1.5 rounded-full mt-1 overflow-hidden">
                            <div className="bg-[#D96C35] h-full" style={{ width: `${node.cpuUsage}%` }} />
                          </div>
                        </div>
                        {node.isOffloadTarget && (
                          <span className="px-2.5 py-1 bg-indigo-50 border border-indigo-200 text-indigo-700 font-bold rounded-lg text-[10.5px]">
                            ⚡ Offload Ready
                          </span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* TAB 3: SPATIAL AUDIO & DEEP WORK */}
          {activeTab === 'spatial' && (
            <div className="space-y-6">
              {/* Deep Work Mode */}
              <div className="p-4 bg-white border border-[#E5DEC9] rounded-2xl shadow-xs flex items-center justify-between gap-4 flex-wrap">
                <div>
                  <div className="flex items-center gap-2">
                    <EyeOff className="w-4 h-4 text-[#D96C35]" />
                    <h4 className="text-sm font-bold text-[#21261F]">
                      Режим «Глибоке занурення» (Deep Work Mode)
                    </h4>
                  </div>
                  <p className="text-xs text-[#6E7568] mt-1">
                    Повне приховування непрочитаних, повідомлень та звуків на період фокусу зі збереженням Canvas.
                  </p>
                </div>

                <div className="flex items-center gap-3">
                  <div className="text-right font-mono font-bold text-sm text-[#21261F]">
                    {formatTime(deepWorkSecondsLeft)}
                  </div>
                  <button
                    onClick={() => {
                      soundFx.playSend();
                      setIsDeepWorkActive(!isDeepWorkActive);
                    }}
                    className={`px-4 py-2 rounded-xl text-xs font-bold transition-all shadow-xs ${
                      isDeepWorkActive
                        ? 'bg-red-600 hover:bg-red-700 text-white'
                        : 'bg-[#D96C35] hover:bg-[#B85425] text-white'
                    }`}
                  >
                    {isDeepWorkActive ? 'Зупинити занурення' : 'Старт 90 хв фокусу'}
                  </button>
                </div>
              </div>

              {/* Spatial Audio Grid in Huddles */}
              <div className="p-4 bg-white border border-[#E5DEC9] rounded-2xl shadow-xs">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <Volume2 className="w-4 h-4 text-emerald-600" />
                    <h4 className="text-sm font-bold text-[#21261F]">
                      Spatial Audio Grid у Huddles (3D WebAudio Panner)
                    </h4>
                  </div>
                  <span className="text-xs text-[#6E7568]">Перетягніть аватари для зміни панорами та гучності</span>
                </div>

                {/* 2D Interactive Soundstage Canvas */}
                <div
                  ref={spatialCanvasRef}
                  onMouseMove={handleSpatialMouseMove}
                  onMouseUp={() => setDraggingParticipantId(null)}
                  className="relative w-full h-72 bg-[#1A1E1B] rounded-2xl overflow-hidden border border-[#2E3630] cursor-crosshair select-none"
                >
                  {/* Grid Lines */}
                  <div className="absolute inset-0 bg-[radial-gradient(#313D33_1px,transparent_1px)] [background-size:24px_24px] opacity-40" />

                  {/* Sound Wave Field Rings around listener */}
                  {(() => {
                    const you = spatialParticipants.find((p) => p.id === 'p_you') || { x: 200, y: 150 };
                    return (
                      <>
                        <div
                          className="absolute rounded-full border border-emerald-500/20 pointer-events-none -translate-x-1/2 -translate-y-1/2"
                          style={{ left: `${you.x}px`, top: `${you.y}px`, width: 140, height: 140 }}
                        />
                        <div
                          className="absolute rounded-full border border-emerald-500/10 pointer-events-none -translate-x-1/2 -translate-y-1/2"
                          style={{ left: `${you.x}px`, top: `${you.y}px`, width: 260, height: 260 }}
                        />
                      </>
                    );
                  })()}

                  {/* Draggable Avatars */}
                  {spatialParticipants.map((p) => {
                    const isYou = p.id === 'p_you';
                    return (
                      <div
                        key={p.id}
                        onMouseDown={() => setDraggingParticipantId(p.id)}
                        style={{ left: `${p.x}px`, top: `${p.y}px` }}
                        className={`absolute -translate-x-1/2 -translate-y-1/2 cursor-grab active:cursor-grabbing flex flex-col items-center gap-1 group z-10`}
                      >
                        <div
                          className={`w-11 h-11 rounded-full flex items-center justify-center text-lg border-2 shadow-lg transition-transform group-hover:scale-110 ${
                            isYou
                              ? 'bg-emerald-600 border-white text-white ring-4 ring-emerald-500/30'
                              : 'bg-[#2A312C] border-[#D96C35] text-white'
                          }`}
                        >
                          {p.avatar}
                        </div>
                        <div className="px-2 py-0.5 bg-black/75 backdrop-blur-xs text-[10px] font-bold text-white rounded-md whitespace-nowrap">
                          {p.name}
                          {!isYou && ` • ${p.volume}% (Pan ${p.pan > 0 ? `+${p.pan}` : p.pan})`}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Dynamic Keyboard Orchestration */}
              <div className="p-4 bg-white border border-[#E5DEC9] rounded-2xl shadow-xs">
                <div className="flex items-center justify-between">
                  <div>
                    <h4 className="text-sm font-bold text-[#21261F]">
                      Керування розкладками (Keyboard Orchestration)
                    </h4>
                    <p className="text-xs text-[#6E7568]">Режими навігації для Canvas, коду та таблиць</p>
                  </div>
                  <div className="flex items-center gap-1 bg-[#FAF7F0] p-1 rounded-xl border border-[#E5DEC9]">
                    {(['vim', 'emacs', 'sublime', 'standard'] as const).map((mode) => (
                      <button
                        key={mode}
                        onClick={() => {
                          soundFx.playTap();
                          setKeymapMode(mode);
                        }}
                        className={`px-3 py-1 rounded-lg text-xs font-bold uppercase transition-all ${
                          keymapMode === mode
                            ? 'bg-[#D96C35] text-white shadow-2xs'
                            : 'text-[#6E7568] hover:text-[#21261F]'
                        }`}
                      >
                        {mode}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* TAB 4: SHAMIR SECRET SHARING & EXPORT */}
          {activeTab === 'sovereignty' && (
            <div className="space-y-6">
              {/* Shamir's Secret Sharing */}
              <div className="p-4 bg-white border border-[#E5DEC9] rounded-2xl shadow-xs">
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <KeyRound className="w-4 h-4 text-[#D96C35]" />
                    <h4 className="text-sm font-bold text-[#21261F]">
                      Zero-Knowledge Backup Pools (Shamir's Secret Sharing)
                    </h4>
                  </div>
                  <span className="px-2.5 py-1 bg-amber-50 border border-amber-200 text-amber-900 text-xs font-bold rounded-lg font-mono">
                    Схема: {shamirThreshold} з {shamirTotalShards} ключів
                  </span>
                </div>
                <p className="text-xs text-[#6E7568] mb-4">
                  Майстер-ключ відновлення шифрується і розбивається на {shamirTotalShards} частин. Будь-які {shamirThreshold} довірені вузли можуть відновити доступ без розкриття своїх фрагментів.
                </p>

                <div className="space-y-2">
                  {shardsAssigned.map((shard) => (
                    <div
                      key={shard.shardIndex}
                      className="p-3 bg-[#FAF8F5] border border-[#E8E1D3] rounded-xl flex items-center justify-between text-xs"
                    >
                      <div className="flex items-center gap-2.5">
                        <span className="w-6 h-6 rounded-lg bg-white border border-[#E5DEC9] font-bold text-[#D96C35] flex items-center justify-center font-mono">
                          #{shard.shardIndex}
                        </span>
                        <div>
                          <div className="font-bold text-[#21261F]">{shard.holder}</div>
                          <div className="text-[10.5px] text-[#6E7568]">Зашифровано відкритим ключем X25519</div>
                        </div>
                      </div>
                      <span
                        className={`px-2.5 py-0.5 rounded-full font-bold text-[10.5px] ${
                          shard.verified
                            ? 'bg-emerald-100 text-emerald-800'
                            : 'bg-amber-100 text-amber-800'
                        }`}
                      >
                        {shard.verified ? '✓ Звірено піром' : 'Очікує підтвердження'}
                      </span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Federated Zero-Lockin Export */}
              <div className="p-4 bg-white border border-[#E5DEC9] rounded-2xl shadow-xs flex items-center justify-between gap-4 flex-wrap">
                <div>
                  <div className="flex items-center gap-2">
                    <Download className="w-4 h-4 text-emerald-600" />
                    <h4 className="text-sm font-bold text-[#21261F]">
                      Federated Identity & Zero-Lockin Export
                    </h4>
                  </div>
                  <p className="text-xs text-[#6E7568] mt-1">
                    Експорт усього простору в один клік: чистий SQLite, дерево Markdown, JSON-схеми та оригінальні медіа.
                  </p>
                </div>

                <button
                  onClick={handleExportWorkspace}
                  disabled={isExporting}
                  className="flex items-center gap-2 px-4 py-2 bg-[#D96C35] hover:bg-[#B85425] text-white text-xs font-bold rounded-xl shadow-xs transition-all disabled:opacity-50"
                >
                  <Download className={`w-3.5 h-3.5 ${isExporting ? 'animate-bounce' : ''}`} />
                  <span>
                    {isExporting
                      ? 'Архівування SQLite + Markdown...'
                      : exportComplete
                      ? '✓ Експорт завантажено!'
                      : 'Експортувати простір (.tar.gz)'}
                  </span>
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

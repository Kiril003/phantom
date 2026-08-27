/**
 * PHANTOM OS — Round-Table Multi-Agent Orchestrator (Круглий стіл експертів)
 * Колегія 4 автономних агентів:
 * 1. 🏛️ System Designer (Архітектор систем)
 * 2. 🛡️ Red Team / Challenger (Критик & Безпека)
 * 3. ⚡ Hardware & Performance Profiler (Оптимізатор заліза $O(N)$)
 * 4. 🔮 Lead Summarizer (Синтезатор консенсусу)
 */

import React, { useState, useRef, useEffect } from 'react';
import {
  Users,
  Play,
  Square,
  Send,
  AlertTriangle,
  ArrowRight,
  Layers,
} from 'lucide-react';
import {
  useAISynthesisStore,
  RoundTableAgent,
  DebateMessage,
} from '../../stores/aiSynthesisStore';
import { soundFx } from '../../utils/messengerSound';

export const RoundTableOrchestrator: React.FC = () => {
  const {
    roundTable,
    roundTableAgents,
    startRoundTableDebate,
    stopRoundTableDebate,
    interveneInRoundTable,
    updateArtifactContent,
    setActiveCanvasTab,
    sessions,
    activeSessionId,
  } = useAISynthesisStore();

  const [topicInput, setTopicInput] = useState(roundTable.topic || 'WebSockets vs WebRTC Data Channels (P2P Resilience)');
  const [interventionText, setInterventionText] = useState('');
  const messagesEndRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [roundTable.messages.length, roundTable.currentSpeaker]);

  const handleStart = (e: React.FormEvent) => {
    e.preventDefault();
    if (!topicInput.trim()) return;
    startRoundTableDebate(topicInput.trim());
  };

  const handleIntervene = (e: React.FormEvent) => {
    e.preventDefault();
    if (!interventionText.trim()) return;
    interveneInRoundTable(interventionText.trim());
    setInterventionText('');
  };

  const handleExportToCanvas = () => {
    soundFx.playChime();
    const currentSession = sessions.find((s) => s.id === activeSessionId);
    if (!currentSession || !roundTable.finalArtifactSummary) return;

    const exportText = `// 🔮 PHANTOM OS Architecture Decision Record (ADR-042)\n// Topic: ${roundTable.topic}\n// Status: CONSENSUS_REACHED (Round Table Collegium)\n\n${roundTable.finalArtifactSummary}\n\n// Action items for P2P Mesh & Vault synced.`;

    if (currentSession.artifacts.length > 0) {
      updateArtifactContent(currentSession.artifacts[0].id, exportText);
    }
    setActiveCanvasTab('preview');
  };

  return (
    <div className="flex-1 flex flex-col h-full bg-[#FAF7F0] border-l border-[#E0D7C6] overflow-hidden select-none">
      {/* Round Table Top Bar */}
      <div className="p-4 bg-white/95 backdrop-blur-md border-b border-[#E8E1D3] flex items-center justify-between gap-3 shrink-0">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-2xl bg-purple-50 border border-purple-200 flex items-center justify-center text-purple-700 shadow-2xs">
            <Users className="w-5 h-5" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h3 className="font-extrabold text-sm text-[#1E2521]">Круглий стіл експертів (Round-Table Matrix)</h3>
              <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider ${
                roundTable.consensusStatus === 'consensus_reached'
                  ? 'bg-emerald-100 text-emerald-800 border border-emerald-300'
                  : roundTable.isActive
                  ? 'bg-purple-100 text-purple-800 border border-purple-300 animate-pulse'
                  : 'bg-[#F2ECE1] text-[#6E7568]'
              }`}>
                {roundTable.consensusStatus === 'consensus_reached'
                  ? '✓ Консенсус досягнуто'
                  : roundTable.isActive
                  ? '⚡ Дебати в процесі'
                  : 'Очікує старту'}
              </span>
            </div>
            <p className="text-[11px] text-[#6E7568] truncate max-w-md">
              Автономна колегія 4 спеціалізованих агентів для всебічного аудиту рішень
            </p>
          </div>
        </div>

        {/* Action Controls */}
        <div className="flex items-center gap-2">
          {roundTable.isActive ? (
            <button
              onClick={stopRoundTableDebate}
              className="px-3 py-1.5 bg-red-100 hover:bg-red-200 text-red-800 border border-red-300 rounded-xl text-xs font-bold flex items-center gap-1.5 transition-colors"
            >
              <Square className="w-3.5 h-3.5 fill-current" />
              <span>Зупинити</span>
            </button>
          ) : (
            <button
              onClick={() => startRoundTableDebate(topicInput)}
              className="px-3 py-1.5 bg-[#C25925] hover:bg-[#AA491A] text-white rounded-xl text-xs font-bold flex items-center gap-1.5 shadow-2xs transition-colors"
            >
              <Play className="w-3.5 h-3.5 fill-current" />
              <span>Розпочати дебати</span>
            </button>
          )}

          {roundTable.finalArtifactSummary && (
            <button
              onClick={handleExportToCanvas}
              className="px-3 py-1.5 bg-purple-600 hover:bg-purple-700 text-white rounded-xl text-xs font-bold flex items-center gap-1.5 shadow-2xs transition-colors"
            >
              <Layers className="w-3.5 h-3.5" />
              <span>Експортувати в Canvas</span>
            </button>
          )}
        </div>
      </div>

      {/* Agents Seat Ring & Status Badges */}
      <div className="p-3 bg-[#F5F1E6] border-b border-[#EBE3D3] grid grid-cols-2 sm:grid-cols-4 gap-2.5">
        {roundTableAgents.map((agent: RoundTableAgent) => {
          const isSpeaking = roundTable.currentSpeaker === agent.id;

          return (
            <div
              key={agent.id}
              className={`p-2.5 rounded-2xl border transition-all ${
                isSpeaking
                  ? 'bg-white shadow-xs ring-2 ring-purple-500/50 border-purple-400 scale-[1.02]'
                  : 'bg-white/80 border-[#E0D7C6]'
              }`}
            >
              <div className="flex items-center gap-2">
                <span className="text-xl">{agent.avatar}</span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between">
                    <span className="font-extrabold text-xs text-[#1E2521] truncate">{agent.name}</span>
                    {isSpeaking && (
                      <span className="w-2 h-2 rounded-full bg-purple-600 animate-ping" />
                    )}
                  </div>
                  <p className="text-[10px] text-[#6E7568] font-mono truncate">{agent.handle}</p>
                </div>
              </div>
              <div className="mt-1.5 pt-1.5 border-t border-[#F2ECE1] flex items-center justify-between text-[9.5px]">
                <span className="px-1.5 py-0.5 rounded font-bold" style={{ backgroundColor: `${agent.color}15`, color: agent.color }}>
                  {agent.badge}
                </span>
                <span className="text-[#8A9186] font-semibold">{isSpeaking ? 'Говорить...' : 'Аналізує'}</span>
              </div>
            </div>
          );
        })}
      </div>

      {/* Main Debate Stream Area */}
      <div className="flex-1 overflow-y-auto p-4 space-y-3.5">
        {roundTable.messages.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-center p-8">
            <div className="w-16 h-16 rounded-3xl bg-[#F2ECE1] border border-[#DDD3BF] flex items-center justify-center text-purple-700 mb-3">
              <Users className="w-8 h-8" />
            </div>
            <h4 className="font-extrabold text-base text-[#1E2521] mb-1">Колегія експертів готова до запуску</h4>
            <p className="text-xs text-[#6E7568] max-w-md mb-4">
              Введіть тему архітектурного дослідження або виберіть готову гіпотезу нижче для багатоагентного аудиту.
            </p>
            <form onSubmit={handleStart} className="w-full max-w-md flex gap-2">
              <input
                type="text"
                value={topicInput}
                onChange={(e) => setTopicInput(e.target.value)}
                placeholder="Тема архітектурного аудиту..."
                className="flex-1 px-4 py-2.5 bg-white border border-[#DDD3BF] rounded-2xl text-xs text-[#1E2521] focus:outline-none focus:border-[#C25925]"
              />
              <button
                type="submit"
                className="px-4 py-2.5 bg-[#C25925] text-white font-bold rounded-2xl text-xs flex items-center gap-1 shadow-2xs"
              >
                <span>Запустити</span>
                <ArrowRight className="w-3.5 h-3.5" />
              </button>
            </form>
          </div>
        ) : (
          roundTable.messages.map((msg: DebateMessage) => {
            const isUser = msg.agentRole === 'user';
            const isRed = msg.agentRole === 'red_team';
            const isHw = msg.agentRole === 'hardware';
            const isSum = msg.agentRole === 'summarizer';

            return (
              <div
                key={msg.id}
                className={`p-4 rounded-3xl border text-xs leading-relaxed animate-in fade-in transition-all ${
                  isUser
                    ? 'bg-[#FAF7F0] border-[#C25925] text-[#1E2521] ml-8'
                    : isRed
                    ? 'bg-rose-50/70 border-rose-200 text-rose-950'
                    : isHw
                    ? 'bg-emerald-50/70 border-emerald-200 text-emerald-950'
                    : isSum
                    ? 'bg-purple-50/80 border-purple-200 text-purple-950 shadow-xs'
                    : 'bg-white border-[#E0D7C6] text-[#1E2521]'
                }`}
              >
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <span className="text-base">{msg.avatar}</span>
                    <span className="font-extrabold text-[#1E2521]">{msg.agentName}</span>
                    <span className="text-[10px] text-[#8A9186] font-mono">{msg.handle}</span>
                    <span
                      className="px-1.5 py-0.5 rounded text-[9.5px] font-bold uppercase"
                      style={{ backgroundColor: `${msg.color}20`, color: msg.color }}
                    >
                      {msg.badge}
                    </span>
                  </div>
                  <div className="flex items-center gap-2 text-[10px] text-[#8A9186]">
                    {msg.confidenceScore && (
                      <span className="font-mono text-emerald-800 bg-emerald-100/80 px-1.5 py-0.2 rounded font-bold">
                        Score: {Math.round(msg.confidenceScore * 100)}%
                      </span>
                    )}
                    <span>{msg.timestamp}</span>
                  </div>
                </div>

                <div className="whitespace-pre-wrap">{msg.content}</div>

                {msg.objectionLevel === 'critical' && (
                  <div className="mt-2.5 p-2 bg-rose-100/80 border border-rose-300 rounded-xl flex items-center gap-1.5 text-rose-900 font-bold text-[11px]">
                    <AlertTriangle className="w-3.5 h-3.5 shrink-0 text-rose-600" />
                    <span>Потрібна увага: потенційний Race Condition у P2P каналі</span>
                  </div>
                )}
              </div>
            );
          })
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Intervention Composer for User */}
      <div className="p-3 bg-white border-t border-[#E8E1D3]">
        <div className="flex items-center gap-2 mb-2">
          <span className="text-[10.5px] text-[#8A9186] font-semibold">Швидке звернення:</span>
          {roundTableAgents.map((ag) => (
            <button
              key={ag.id}
              type="button"
              onClick={() => setInterventionText((prev) => `${ag.handle} ${prev}`)}
              className="px-2 py-0.5 bg-[#FAF7F0] hover:bg-[#F2ECE1] border border-[#DDD3BF] rounded-lg text-[10.5px] font-mono text-[#1E2521] transition-colors"
            >
              {ag.handle}
            </button>
          ))}
        </div>

        <form onSubmit={handleIntervene} className="flex items-center gap-2">
          <input
            type="text"
            value={interventionText}
            onChange={(e) => setInterventionText(e.target.value)}
            placeholder="Втрутитися в дебати: задати питання конкретному експерту через @RedTeam чи змінити курс..."
            className="flex-1 px-4 py-2 text-xs bg-[#FAF7F0] border border-[#DDD3BF] rounded-2xl text-[#1E2521] focus:outline-none focus:border-[#C25925]"
          />
          <button
            type="submit"
            disabled={!interventionText.trim()}
            className="p-2 bg-[#C25925] hover:bg-[#AA491A] text-white rounded-2xl transition-colors disabled:opacity-40 shadow-2xs"
          >
            <Send className="w-4 h-4" />
          </button>
        </form>
      </div>
    </div>
  );
};

/**
 * PHANTOM OS — AI Synthesis Lab & Companion Studio Modal
 * Повноцінний когнітивний полігон оператора:
 * - 3-Plane Dynamic Lab UI (Діалог <-> Canvas <-> Телеметрія/ANSI Термінал).
 * - Мультиагентний Круглий стіл експертів (RoundTableOrchestrator).
 * - Git-подібне дерево думок (Side-by-Side Diff, Merge Insights).
 * - Локальний інструментальний суверенітет (LocalToolExecutionDrawer).
 */

import React, { useState, useRef, useEffect } from 'react';
import {
  X,
  Send,
  Sparkles,
  GitBranch,
  Cpu,
  ChevronDown,
  Paperclip,
  Mic,
  Database,
  Eye,
  Brain,
  Users,
  FolderTree,
} from 'lucide-react';
import {
  useAISynthesisStore,
  CognitivePersona,
  AVAILABLE_MODELS,
  AIMessage,
} from '../../stores/aiSynthesisStore';
import { ProceduralAvatarCore } from './ProceduralAvatarCore';
import { TreeOfThoughtVisualizer } from './TreeOfThoughtVisualizer';
import { DynamicArtifactStudio } from './DynamicArtifactStudio';
import { RuntimeTelemetryConsole } from './RuntimeTelemetryConsole';
import { RoundTableOrchestrator } from './RoundTableOrchestrator';
import { BranchDiffModal } from './BranchDiffModal';
import { LocalToolExecutionDrawer } from './LocalToolExecutionDrawer';
import { MultimodalMediaInspector } from './MultimodalMediaInspector';
import { VoiceCompanionOverlay } from './VoiceCompanionOverlay';
import { soundFx } from '../../utils/messengerSound';

export const AISynthesisStudioModal: React.FC = () => {
  const {
    isStudioOpen,
    setStudioOpen,
    activeSessionId,
    sessions,
    computeState,
    activeModel,
    setActiveModel,
    activePersona,
    setActivePersona,
    layoutMode,
    setLayoutMode,
    isTreeOfThoughtOpen,
    setTreeOfThoughtOpen,
    isMediaInspectorOpen,
    setMediaInspectorOpen,
    isToolsDrawerOpen,
    setToolsDrawerOpen,
    diffBranchIds,
    setDiffBranchIds,
    setVoiceModeActive,
    sendMessage,
    createThoughtBranch,
    startRoundTableDebate,
  } = useAISynthesisStore();

  const [inputPrompt, setInputPrompt] = useState('');
  const [isModelDropdownOpen, setIsModelDropdownOpen] = useState(false);
  const [isPersonaDropdownOpen, setIsPersonaDropdownOpen] = useState(false);
  const [showBottomConsole, setShowBottomConsole] = useState(true);
  const [expandedThoughts, setExpandedThoughts] = useState<Record<string, boolean>>({});

  const messagesEndRef = useRef<HTMLDivElement | null>(null);

  const currentSession = sessions.find((s) => s.id === activeSessionId) || sessions[0];
  const messages = currentSession?.messages || [];
  const currentBranchId = currentSession?.currentBranchId;

  // Filter messages for active thought branch
  const activeBranchMessages = messages.filter(
    (m) => m.branchId === currentBranchId || m.role === 'system'
  );

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length, computeState]);

  if (!isStudioOpen) return null;

  const handleSend = (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputPrompt.trim()) return;
    sendMessage(inputPrompt.trim());
    setInputPrompt('');
  };

  const handleQuickBranch = (msgId: string, branchName: string, promptText: string) => {
    soundFx.playChime();
    createThoughtBranch(msgId, branchName, promptText);
  };

  const toggleThoughtAccordion = (msgId: string) => {
    soundFx.playTap();
    setExpandedThoughts((prev) => ({ ...prev, [msgId]: !prev[msgId] }));
  };

  const activeModelObj = AVAILABLE_MODELS.find((m) => m.id === activeModel) || AVAILABLE_MODELS[0];

  const PERSONA_LABELS: Record<CognitivePersona, { name: string; icon: string; vibe: string }> = {
    architect: { name: 'Thought Architect', icon: '🏛️', vibe: 'Сократівський діалог, аналіз ризиків' },
    pair_coder: { name: 'Pair Programmer', icon: '💻', vibe: 'AST аналіз, live sandbox, рефакторинг' },
    researcher: { name: 'Data & RAG Scientist', icon: '🔬', vibe: 'Синтез бази знань, графіки' },
    app_maker: { name: 'Interactive Mini-Apps', icon: '🎨', vibe: 'Генерація живих віджетів на льоту' },
    voice_companion: { name: 'Voice Companion', icon: '🎙️', vibe: 'Повнодуплексний аудіо-потік' },
    round_table: { name: 'Круглий стіл (4 Експерти)', icon: '👥', vibe: 'Колегія багатоагентного аудиту' },
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-md flex items-center justify-center p-2 sm:p-4 select-none animate-in fade-in">
      <div className="w-full h-full max-w-[1720px] max-h-[980px] bg-[#0C110D] border border-[rgba(255,255,255,0.09)] rounded-3xl shadow-2xl flex flex-col overflow-hidden text-[#F8FAF8]">
        {/* Top Master Header */}
        <div className="px-4 py-3 bg-[#0E1410] border-b border-[rgba(255,255,255,0.07)] flex items-center justify-between gap-3 shrink-0">
          {/* Left: Avatar Core & Studio Brand */}
          <div className="flex items-center gap-3">
            <ProceduralAvatarCore
              computeState={computeState}
              size={42}
              interactive={true}
              onClick={() => soundFx.playChime()}
            />
            <div>
              <div className="flex items-center gap-2">
                <h2 className="font-extrabold text-sm text-[#F8FAF8] tracking-tight">
                  PHANTOM AI Synthesis Lab
                </h2>
                <span className="px-2 py-0.5 bg-[#F4AF25]/15 text-[#F4AF25] border border-[#F4AF25]/40 rounded-full text-[10px] font-bold uppercase tracking-wider">
                  Cognitive Polygon
                </span>
              </div>
              <p className="text-[11px] text-[#8EA093] truncate max-w-xs">
                {currentSession?.title || 'Персональний когнітивний полігон'}
              </p>
            </div>
          </div>

          {/* Center: Model Matrix & Persona Switcher */}
          <div className="hidden lg:flex items-center gap-2">
            {/* Persona Switcher Pill */}
            <div className="relative">
              <button
                onClick={() => {
                  soundFx.playTap();
                  setIsPersonaDropdownOpen(!isPersonaDropdownOpen);
                  setIsModelDropdownOpen(false);
                }}
                className="px-3 py-1.5 bg-[#141C16] hover:bg-[#18231C] border border-[rgba(255,255,255,0.09)] rounded-2xl flex items-center gap-2 text-xs font-bold text-[#F8FAF8] transition-colors"
              >
                <span>{PERSONA_LABELS[activePersona]?.icon || '🏛️'}</span>
                <span>{PERSONA_LABELS[activePersona]?.name || 'Thought Architect'}</span>
                <ChevronDown className="w-3.5 h-3.5 text-[#8EA093]" />
              </button>

              {isPersonaDropdownOpen && (
                <div className="absolute top-full mt-1 left-0 w-64 bg-[#141C16] border border-[rgba(255,255,255,0.1)] rounded-2xl shadow-2xl p-1.5 z-50 space-y-1">
                  {(Object.keys(PERSONA_LABELS) as CognitivePersona[]).map((pKey) => (
                    <button
                      key={pKey}
                      onClick={() => {
                        setActivePersona(pKey);
                        if (pKey === 'round_table') {
                          startRoundTableDebate('Архітектурний аудит P2P Mesh & WebRTC');
                        } else {
                          setLayoutMode('3pane');
                        }
                        setIsPersonaDropdownOpen(false);
                      }}
                      className={`w-full p-2 rounded-xl text-left flex items-start gap-2 text-xs transition-colors ${
                        activePersona === pKey ? 'bg-[#18231C] border border-[#F4AF25]/40 text-[#F4AF25] font-bold' : 'hover:bg-[#18231C] text-[#F8FAF8]'
                      }`}
                    >
                      <span className="text-base">{PERSONA_LABELS[pKey].icon}</span>
                      <div>
                        <div className="font-bold">{PERSONA_LABELS[pKey].name}</div>
                        <div className="text-[10px] text-[#8EA093]">{PERSONA_LABELS[pKey].vibe}</div>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Model Matrix Dropdown */}
            <div className="relative">
              <button
                onClick={() => {
                  soundFx.playTap();
                  setIsModelDropdownOpen(!isModelDropdownOpen);
                  setIsPersonaDropdownOpen(false);
                }}
                className="px-3 py-1.5 bg-[#141C16] hover:bg-[#18231C] border border-[rgba(255,255,255,0.09)] rounded-2xl flex items-center gap-2 text-xs font-bold text-[#F8FAF8] transition-colors"
              >
                <Cpu className="w-3.5 h-3.5 text-[#F4AF25]" />
                <span className="truncate max-w-[140px]">{activeModelObj.name}</span>
                <span className="text-[10px] text-[#8EA093]">({activeModelObj.latencyAvgMs}ms)</span>
                <ChevronDown className="w-3.5 h-3.5 text-[#8EA093]" />
              </button>

              {isModelDropdownOpen && (
                <div className="absolute top-full mt-1 right-0 w-80 bg-[#141C16] border border-[rgba(255,255,255,0.1)] rounded-2xl shadow-2xl p-2 z-50 space-y-1.5">
                  <div className="px-2 py-1 text-[10.5px] font-bold text-[#8EA093] uppercase tracking-wider">
                    Матриця нейрорушіїв (Model Matrix)
                  </div>
                  {AVAILABLE_MODELS.map((model) => (
                    <button
                      key={model.id}
                      onClick={() => {
                        setActiveModel(model.id);
                        setIsModelDropdownOpen(false);
                      }}
                      className={`w-full p-2.5 rounded-xl text-left flex flex-col gap-1 transition-colors ${
                        activeModel === model.id ? 'bg-[#18231C] border border-[#F4AF25]/40 text-[#F4AF25]' : 'hover:bg-[#18231C] text-[#F8FAF8]'
                      }`}
                    >
                      <div className="flex items-center justify-between w-full">
                        <span className="font-bold text-xs">{model.name}</span>
                        <span className="text-[10px] font-mono px-1.5 py-0.5 bg-[#0E1410] text-[#F4AF25] border border-[#F4AF25]/30 rounded font-bold">
                          {model.latencyAvgMs}ms
                        </span>
                      </div>
                      <p className="text-[10.5px] text-[#8EA093] line-clamp-1">{model.description}</p>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Right Tool Actions */}
          <div className="flex items-center gap-2">
            {/* Round Table Toggle */}
            <button
              onClick={() => {
                if (layoutMode === 'round_table') setLayoutMode('3pane');
                else startRoundTableDebate('Оптимізація P2P Mesh та консенсусу');
              }}
              className={`px-3 py-1.5 rounded-2xl border text-xs font-bold flex items-center gap-1.5 transition-all ${
                layoutMode === 'round_table'
                  ? 'bg-[#F4AF25] text-[#0C110D] border-[#F4AF25]'
                  : 'bg-[#141C16] hover:bg-[#18231C] text-[#F8FAF8] border-[rgba(255,255,255,0.08)]'
              }`}
            >
              <Users className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Круглий стіл</span>
            </button>

            {/* Tree of Thought Toggle */}
            <button
              onClick={() => setTreeOfThoughtOpen(!isTreeOfThoughtOpen)}
              className={`px-3 py-1.5 rounded-2xl border text-xs font-bold flex items-center gap-1.5 transition-all ${
                isTreeOfThoughtOpen
                  ? 'bg-purple-950/80 text-purple-300 border-purple-800'
                  : 'bg-[#141C16] hover:bg-[#18231C] text-[#F8FAF8] border-[rgba(255,255,255,0.08)]'
              }`}
            >
              <GitBranch className="w-3.5 h-3.5 text-[#F4AF25]" />
              <span className="hidden sm:inline">Дерево думок</span>
              <span className="w-4 h-4 rounded-full bg-[#18231C] text-[#F4AF25] border border-[#F4AF25]/30 text-[10px] flex items-center justify-center font-bold">
                {currentSession?.thoughtNodes.length || 1}
              </span>
            </button>

            {/* Local Tool Sovereignty Toggle */}
            <button
              onClick={() => setToolsDrawerOpen(!isToolsDrawerOpen)}
              className={`p-2 rounded-2xl border text-xs font-bold transition-all ${
                isToolsDrawerOpen
                  ? 'bg-[#F4AF25]/20 text-[#F4AF25] border-[#F4AF25]/40'
                  : 'bg-[#141C16] hover:bg-[#18231C] text-[#8EA093] border-[rgba(255,255,255,0.08)]'
              }`}
              title="Локальні інструменти MCP (Файли, SQL, P2P)"
            >
              <FolderTree className="w-4 h-4" />
            </button>

            {/* Media Inspector Toggle */}
            <button
              onClick={() => setMediaInspectorOpen(!isMediaInspectorOpen)}
              className={`p-2 rounded-2xl border text-xs font-bold transition-all ${
                isMediaInspectorOpen
                  ? 'bg-[#F4AF25]/20 text-[#F4AF25] border-[#F4AF25]/40'
                  : 'bg-[#141C16] hover:bg-[#18231C] text-[#8EA093] border-[rgba(255,255,255,0.08)]'
              }`}
              title="Мультимодальний інспектор медіа"
            >
              <Eye className="w-4 h-4" />
            </button>

            {/* Voice Mode */}
            <button
              onClick={() => setVoiceModeActive(true)}
              className="px-3 py-1.5 bg-[#F4AF25] hover:bg-[#FFB340] text-[#0C110D] font-bold rounded-2xl text-xs flex items-center gap-1.5 shadow-md transition-colors"
            >
              <Mic className="w-3.5 h-3.5" />
              <span className="hidden md:inline">Голос</span>
            </button>

            {/* Close Studio Button */}
            <button
              onClick={() => setStudioOpen(false)}
              className="w-8 h-8 rounded-2xl bg-[#141C16] hover:bg-[#18231C] text-[#8EA093] hover:text-white flex items-center justify-center transition-colors ml-1"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Studio Core Content Area */}
        <div className="flex-1 flex overflow-hidden relative">
          {/* Main 3-Pane or Round-Table layout */}
          {layoutMode === 'round_table' ? (
            <RoundTableOrchestrator />
          ) : (
            <>
              {/* LEFT PANE: Dialogue & Reasoning Stream */}
              <div className="flex-1 flex flex-col min-w-0 bg-[#0C110D] h-full">
                {/* RAG Context Banner */}
                <div className="px-4 py-1.5 bg-[#0E1410] border-b border-[rgba(255,255,255,0.07)] flex items-center justify-between text-[11px] text-[#8EA093]">
                  <div className="flex items-center gap-2">
                    <Database className="w-3 h-3 text-[#F4AF25]" />
                    <span className="font-semibold text-[#F8FAF8]">RAG Контекст:</span>
                    <span className="truncate max-w-xs">3 простори підключено (Aura Architecture, Vault, CS Theory)</span>
                  </div>
                  <span className="text-[10px] text-emerald-400 font-bold bg-emerald-950/80 border border-emerald-800/60 px-2 py-0.5 rounded-full">
                    Zero-Leak Privacy
                  </span>
                </div>

                {/* Messages Scroll Area */}
                <div className="flex-1 overflow-y-auto p-4 space-y-4">
                  {activeBranchMessages.map((msg: AIMessage) => {
                    const isUser = msg.role === 'user';
                    const isSystem = msg.role === 'system';

                    if (isSystem) {
                      return (
                        <div key={msg.id} className="p-2.5 bg-[#18241D] border border-[#F4AF25]/30 rounded-2xl text-center text-xs text-[#F4AF25] max-w-lg mx-auto font-medium">
                          {msg.content}
                        </div>
                      );
                    }

                    return (
                      <div
                        key={msg.id}
                        className={`flex flex-col ${isUser ? 'items-end' : 'items-start'} max-w-2xl ${
                          isUser ? 'ml-auto' : 'mr-auto'
                        }`}
                      >
                        {/* Message Header */}
                        <div className="flex items-center gap-1.5 text-[10.5px] text-[#8EA093] mb-1 px-1">
                          <span className="font-bold text-[#F8FAF8]">{isUser ? 'Кирило (Оператор)' : 'PHANTOM AI Core'}</span>
                          <span>·</span>
                          <span>{msg.timestamp}</span>
                          {msg.modelUsed && (
                            <span className="px-1.5 py-0.2 bg-[#141C16] border border-[rgba(255,255,255,0.06)] rounded text-[9.5px] text-[#8EA093] font-mono">
                              {msg.modelUsed}
                            </span>
                          )}
                        </div>

                        {/* Step-by-Step Chain-of-Thought (Accordion for Assistant) */}
                        {!isUser && msg.thoughtSteps && msg.thoughtSteps.length > 0 && (
                          <div className="w-full mb-2 bg-purple-950/60 border border-purple-800/60 rounded-2xl overflow-hidden text-xs">
                            <button
                              onClick={() => toggleThoughtAccordion(msg.id)}
                              className="w-full p-2.5 flex items-center justify-between text-purple-300 font-bold hover:bg-purple-900/40 transition-colors"
                            >
                              <div className="flex items-center gap-2">
                                <Brain className="w-4 h-4 text-purple-400" />
                                <span>Процес мислення (Chain-of-Thought) · {msg.thinkingDurationMs}ms</span>
                              </div>
                              <ChevronDown className={`w-3.5 h-3.5 transition-transform ${expandedThoughts[msg.id] ? 'rotate-180' : ''}`} />
                            </button>

                            {expandedThoughts[msg.id] && (
                              <div className="p-3 bg-[#0E1410] border-t border-purple-900/40 space-y-2 text-xs">
                                {msg.thoughtSteps.map((step) => (
                                  <div key={step.id} className="flex items-start gap-2">
                                    <span className="w-4 h-4 rounded-full bg-purple-900 text-purple-200 text-[10px] flex items-center justify-center font-bold shrink-0 mt-0.5">
                                      ✓
                                    </span>
                                    <div>
                                      <div className="font-bold text-[#F8FAF8]">{step.title}</div>
                                      <div className="text-[11px] text-[#8EA093]">{step.detail}</div>
                                    </div>
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        )}

                        {/* Message Bubble Body */}
                        <div
                          className={`p-4 rounded-3xl text-xs leading-relaxed ${
                            isUser
                              ? 'bg-[#F4AF25] text-[#0C110D] font-medium shadow-md rounded-br-xs'
                              : 'bg-[#141C16] text-[#F8FAF8] border border-[rgba(255,255,255,0.08)] shadow-md rounded-bl-xs'
                          }`}
                        >
                          <div className="whitespace-pre-wrap">{msg.content}</div>
                        </div>

                        {/* Branching options pills */}
                        {!isUser && msg.branchOptions && msg.branchOptions.length > 0 && (
                          <div className="mt-2.5 flex flex-wrap gap-1.5">
                            {msg.branchOptions.map((opt) => (
                              <button
                                key={opt.branchId}
                                onClick={() => handleQuickBranch(msg.id, opt.title, opt.prompt)}
                                className="px-2.5 py-1 bg-[#141C16] hover:bg-[#18231C] border border-[rgba(255,255,255,0.08)] rounded-xl text-[11px] font-semibold text-[#F8FAF8] flex items-center gap-1 shadow-sm transition-colors"
                              >
                                <GitBranch className="w-3 h-3 text-[#F4AF25]" />
                                <span>{opt.title}</span>
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })}

                  {computeState === 'thinking' && (
                    <div className="flex items-center gap-2 p-3 bg-[#141C16] border border-[#F4AF25]/30 rounded-2xl max-w-xs shadow-md text-xs">
                      <Sparkles className="w-4 h-4 text-[#F4AF25] animate-spin" />
                      <span className="font-bold text-[#F8FAF8]">Нейроінференс у процесі...</span>
                    </div>
                  )}

                  <div ref={messagesEndRef} />
                </div>

                {/* Input Composer Box */}
                <form onSubmit={handleSend} className="p-3 bg-[#0E1410] border-t border-[rgba(255,255,255,0.07)] flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setMediaInspectorOpen(true)}
                    className="p-2 bg-[#141C16] hover:bg-[#18231C] border border-[rgba(255,255,255,0.08)] text-[#8EA093] hover:text-[#F4AF25] rounded-xl transition-colors shrink-0"
                    title="Прикріпити медіа або контекст"
                  >
                    <Paperclip className="w-4 h-4" />
                  </button>

                  <input
                    type="text"
                    value={inputPrompt}
                    onChange={(e) => setInputPrompt(e.target.value)}
                    placeholder="Запитай що завгодно: напиши код, створи віджет, запусти симуляцію…"
                    className="flex-1 bg-[#141C16] border border-[rgba(255,255,255,0.09)] rounded-2xl px-4 py-2.5 text-xs text-[#F8FAF8] placeholder-[#64748B] focus:outline-none focus:border-[#F4AF25]/50 transition-colors"
                  />

                  <button
                    type="submit"
                    disabled={!inputPrompt.trim()}
                    className="p-2.5 bg-[#F4AF25] hover:bg-[#FFB340] disabled:opacity-40 disabled:hover:bg-[#F4AF25] text-[#0C110D] font-bold rounded-2xl transition-colors shrink-0 shadow-md"
                    title="Надіслати"
                  >
                    <Send className="w-4 h-4" strokeWidth={2.5} />
                  </button>
                </form>
              </div>

              {/* CENTER/RIGHT PANE: Dynamic Artifact Studio (Canvas & Mini-Apps) */}
              <div className="hidden md:flex flex-1 flex-col h-full overflow-hidden">
                <div className="flex-1 flex flex-col h-full overflow-hidden">
                  <DynamicArtifactStudio onOpenSandbox={() => setShowBottomConsole(true)} />

                  {/* BOTTOM EXECUTION TELEMETRY & ANSI CONSOLE */}
                  {showBottomConsole && (
                    <div className="h-64 shrink-0">
                      <RuntimeTelemetryConsole onClose={() => setShowBottomConsole(false)} />
                    </div>
                  )}
                </div>
              </div>
            </>
          )}

          {/* SLIDE-OVER: Tree of Thought Visualizer Drawer */}
          {isTreeOfThoughtOpen && (
            <div className="w-80 h-full shrink-0 shadow-xl z-20">
              <TreeOfThoughtVisualizer onClose={() => setTreeOfThoughtOpen(false)} />
            </div>
          )}

          {/* SLIDE-OVER: Local Tool Sovereignty Drawer */}
          {isToolsDrawerOpen && (
            <div className="w-80 h-full shrink-0 shadow-xl z-20">
              <LocalToolExecutionDrawer onClose={() => setToolsDrawerOpen(false)} />
            </div>
          )}

          {/* SLIDE-OVER: Multimodal Media Inspector */}
          {isMediaInspectorOpen && (
            <div className="w-80 h-full shrink-0 shadow-xl z-20">
              <MultimodalMediaInspector onClose={() => setMediaInspectorOpen(false)} />
            </div>
          )}
        </div>
      </div>

      {/* Side-by-Side Branch Diff Modal */}
      {diffBranchIds && (
        <BranchDiffModal onClose={() => setDiffBranchIds(null)} />
      )}

      {/* Real-time Voice Companion Overlay */}
      <VoiceCompanionOverlay />
    </div>
  );
};

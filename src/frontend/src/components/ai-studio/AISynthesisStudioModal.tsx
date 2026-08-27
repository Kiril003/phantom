/**
 * PHANTOM OS — AI Synthesis Lab & Companion Studio Modal
 * Повноцінний когнітивний полігон оператора: трипанельний спліт (Діалог <-> Canvas <-> Пісочниця),
 * матриця моделей (Local WebGPU / Cloud), дерево думок (Tree of Thought) та процедурний аватар.
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
import { LiveExecutionSandbox } from './LiveExecutionSandbox';
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
    isTreeOfThoughtOpen,
    setTreeOfThoughtOpen,
    isMediaInspectorOpen,
    setMediaInspectorOpen,
    setVoiceModeActive,
    sendMessage,
    createThoughtBranch,
  } = useAISynthesisStore();

  const [inputPrompt, setInputPrompt] = useState('');
  const [isModelDropdownOpen, setIsModelDropdownOpen] = useState(false);
  const [isPersonaDropdownOpen, setIsPersonaDropdownOpen] = useState(false);
  const [showBottomSandbox, setShowBottomSandbox] = useState(true);
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
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-md flex items-center justify-center p-2 sm:p-4 select-none animate-in fade-in">
      <div className="w-full h-full max-w-[1680px] max-h-[960px] bg-[#FAF7F0] border border-[#E0D7C6] rounded-3xl shadow-2xl flex flex-col overflow-hidden text-[#1E2521]">
        {/* Top Master Header */}
        <div className="px-4 py-3 bg-white/90 backdrop-blur-md border-b border-[#E8E1D3] flex items-center justify-between gap-3 shrink-0">
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
                <h2 className="font-extrabold text-sm text-[#1E2521] tracking-tight">
                  PHANTOM AI Synthesis Lab
                </h2>
                <span className="px-2 py-0.5 bg-amber-50 text-[#C25925] border border-amber-200 rounded-full text-[10px] font-bold uppercase tracking-wider">
                  Companion Studio
                </span>
              </div>
              <p className="text-[11px] text-[#6E7568] truncate max-w-xs">
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
                className="px-3 py-1.5 bg-[#FAF7F0] hover:bg-[#F2ECE1] border border-[#DDD3BF] rounded-2xl flex items-center gap-2 text-xs font-bold text-[#1E2521] transition-colors"
              >
                <span>{PERSONA_LABELS[activePersona].icon}</span>
                <span>{PERSONA_LABELS[activePersona].name}</span>
                <ChevronDown className="w-3.5 h-3.5 text-[#8A9186]" />
              </button>

              {isPersonaDropdownOpen && (
                <div className="absolute top-full mt-1 left-0 w-64 bg-white border border-[#E0D7C6] rounded-2xl shadow-xl p-1.5 z-50 space-y-1">
                  {(Object.keys(PERSONA_LABELS) as CognitivePersona[]).map((pKey) => (
                    <button
                      key={pKey}
                      onClick={() => {
                        setActivePersona(pKey);
                        setIsPersonaDropdownOpen(false);
                      }}
                      className={`w-full p-2 rounded-xl text-left flex items-start gap-2 text-xs transition-colors ${
                        activePersona === pKey ? 'bg-[#FAF7F0] border border-[#DDD3BF] font-bold' : 'hover:bg-[#F5F1E6]'
                      }`}
                    >
                      <span className="text-base">{PERSONA_LABELS[pKey].icon}</span>
                      <div>
                        <div className="font-bold text-[#1E2521]">{PERSONA_LABELS[pKey].name}</div>
                        <div className="text-[10px] text-[#6E7568]">{PERSONA_LABELS[pKey].vibe}</div>
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
                className="px-3 py-1.5 bg-[#FAF7F0] hover:bg-[#F2ECE1] border border-[#DDD3BF] rounded-2xl flex items-center gap-2 text-xs font-bold text-[#1E2521] transition-colors"
              >
                <Cpu className="w-3.5 h-3.5 text-[#C25925]" />
                <span className="truncate max-w-[140px]">{activeModelObj.name}</span>
                <span className="text-[10px] text-[#8A9186]">({activeModelObj.latencyAvgMs}ms)</span>
                <ChevronDown className="w-3.5 h-3.5 text-[#8A9186]" />
              </button>

              {isModelDropdownOpen && (
                <div className="absolute top-full mt-1 right-0 w-80 bg-white border border-[#E0D7C6] rounded-2xl shadow-xl p-2 z-50 space-y-1.5">
                  <div className="px-2 py-1 text-[10.5px] font-bold text-[#8A9186] uppercase tracking-wider">
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
                        activeModel === model.id ? 'bg-[#FAF7F0] border border-[#DDD3BF]' : 'hover:bg-[#F5F1E6]'
                      }`}
                    >
                      <div className="flex items-center justify-between w-full">
                        <span className="font-bold text-xs text-[#1E2521]">{model.name}</span>
                        <span className="text-[10px] font-mono px-1.5 py-0.5 bg-amber-50 text-amber-900 rounded font-bold">
                          {model.latencyAvgMs}ms
                        </span>
                      </div>
                      <p className="text-[10.5px] text-[#6E7568] line-clamp-1">{model.description}</p>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Right Tool Actions */}
          <div className="flex items-center gap-2">
            {/* Tree of Thought Toggle */}
            <button
              onClick={() => setTreeOfThoughtOpen(!isTreeOfThoughtOpen)}
              className={`px-3 py-1.5 rounded-2xl border text-xs font-bold flex items-center gap-1.5 transition-all ${
                isTreeOfThoughtOpen
                  ? 'bg-purple-100 text-purple-900 border-purple-300 shadow-2xs'
                  : 'bg-[#FAF7F0] hover:bg-[#F2ECE1] text-[#1E2521] border-[#DDD3BF]'
              }`}
            >
              <GitBranch className="w-3.5 h-3.5 text-purple-700" />
              <span className="hidden sm:inline">Дерево думок</span>
              <span className="w-4 h-4 rounded-full bg-purple-200 text-purple-900 text-[10px] flex items-center justify-center font-bold">
                {currentSession?.thoughtNodes.length || 1}
              </span>
            </button>

            {/* Media Inspector Toggle */}
            <button
              onClick={() => setMediaInspectorOpen(!isMediaInspectorOpen)}
              className={`p-2 rounded-2xl border text-xs font-bold transition-all ${
                isMediaInspectorOpen
                  ? 'bg-orange-100 text-orange-900 border-orange-300 shadow-2xs'
                  : 'bg-[#FAF7F0] hover:bg-[#F2ECE1] text-[#1E2521] border-[#DDD3BF]'
              }`}
              title="Мультимодальний інспектор медіа"
            >
              <Eye className="w-4 h-4" />
            </button>

            {/* Voice Mode */}
            <button
              onClick={() => setVoiceModeActive(true)}
              className="px-3 py-1.5 bg-[#C25925] hover:bg-[#AA491A] text-white rounded-2xl text-xs font-bold flex items-center gap-1.5 shadow-2xs transition-colors"
            >
              <Mic className="w-3.5 h-3.5" />
              <span className="hidden md:inline">Голос</span>
            </button>

            {/* Close Studio Button */}
            <button
              onClick={() => setStudioOpen(false)}
              className="w-8 h-8 rounded-2xl bg-[#F2ECE1] hover:bg-[#EAE3D3] text-[#1E2521] flex items-center justify-center transition-colors ml-1"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Studio Core Content Area */}
        <div className="flex-1 flex overflow-hidden relative">
          {/* LEFT PANE: Dialogue & Reasoning Stream */}
          <div className="flex-1 flex flex-col min-w-0 bg-[#FAF7F0] h-full">
            {/* RAG Context Banner */}
            <div className="px-4 py-1.5 bg-[#F5F1E6] border-b border-[#EBE3D3] flex items-center justify-between text-[11px] text-[#6E7568]">
              <div className="flex items-center gap-2">
                <Database className="w-3 h-3 text-[#C25925]" />
                <span className="font-semibold text-[#1E2521]">RAG Контекст:</span>
                <span className="truncate max-w-xs">3 простори підключено (Aura Architecture, Vault, CS Theory)</span>
              </div>
              <span className="text-[10px] text-emerald-800 font-bold bg-emerald-100/80 px-2 py-0.5 rounded-full">
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
                    <div key={msg.id} className="p-2.5 bg-amber-50/70 border border-amber-200/80 rounded-2xl text-center text-xs text-amber-900 max-w-lg mx-auto font-medium">
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
                    <div className="flex items-center gap-1.5 text-[10.5px] text-[#8A9186] mb-1 px-1">
                      <span className="font-bold text-[#1E2521]">{isUser ? 'Кирило (Оператор)' : 'PHANTOM AI Core'}</span>
                      <span>·</span>
                      <span>{msg.timestamp}</span>
                      {msg.modelUsed && (
                        <span className="px-1.5 py-0.2 bg-[#F2ECE1] rounded text-[9.5px] text-[#6E7568] font-mono">
                          {msg.modelUsed}
                        </span>
                      )}
                    </div>

                    {/* Step-by-Step Chain-of-Thought (Accordion for Assistant) */}
                    {!isUser && msg.thoughtSteps && msg.thoughtSteps.length > 0 && (
                      <div className="w-full mb-2 bg-purple-50/50 border border-purple-200/70 rounded-2xl overflow-hidden text-xs">
                        <button
                          onClick={() => toggleThoughtAccordion(msg.id)}
                          className="w-full p-2.5 flex items-center justify-between text-purple-900 font-bold hover:bg-purple-100/50 transition-colors"
                        >
                          <div className="flex items-center gap-2">
                            <Brain className="w-4 h-4 text-purple-700" />
                            <span>Процес мислення (Chain-of-Thought) · {msg.thinkingDurationMs}ms</span>
                          </div>
                          <ChevronDown className={`w-3.5 h-3.5 transition-transform ${expandedThoughts[msg.id] ? 'rotate-180' : ''}`} />
                        </button>

                        {expandedThoughts[msg.id] && (
                          <div className="p-3 bg-white/70 border-t border-purple-100 space-y-2 text-xs">
                            {msg.thoughtSteps.map((step) => (
                              <div key={step.id} className="flex items-start gap-2">
                                <span className="w-4 h-4 rounded-full bg-purple-200 text-purple-900 text-[10px] flex items-center justify-center font-bold shrink-0 mt-0.5">
                                  ✓
                                </span>
                                <div>
                                  <div className="font-bold text-[#1E2521]">{step.title}</div>
                                  <div className="text-[11px] text-[#6E7568]">{step.detail}</div>
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
                          ? 'bg-[#C25925] text-white shadow-xs rounded-br-xs'
                          : 'bg-white text-[#1E2521] border border-[#E0D7C6] shadow-2xs rounded-bl-xs'
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
                            className="px-2.5 py-1 bg-white hover:bg-[#F2ECE1] border border-[#DDD3BF] rounded-xl text-[11px] font-semibold text-[#1E2521] flex items-center gap-1 shadow-2xs transition-colors"
                          >
                            <GitBranch className="w-3 h-3 text-[#C25925]" />
                            <span>{opt.title}</span>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}

              {computeState === 'thinking' && (
                <div className="flex items-center gap-2 p-3 bg-white border border-[#E0D7C6] rounded-2xl max-w-xs shadow-2xs text-xs">
                  <Sparkles className="w-4 h-4 text-[#8A58D6] animate-spin" />
                  <span className="font-bold text-[#1E2521]">Нейроінференс у процесі...</span>
                </div>
              )}

              <div ref={messagesEndRef} />
            </div>

            {/* Input Composer Box */}
            <form onSubmit={handleSend} className="p-3 bg-white border-t border-[#E8E1D3] flex items-center gap-2">
              <button
                type="button"
                onClick={() => setMediaInspectorOpen(true)}
                className="p-2 bg-[#FAF7F0] hover:bg-[#F2ECE1] border border-[#DDD3BF] rounded-2xl text-[#6E7568] transition-colors"
                title="Додати медіа для аналізу"
              >
                <Paperclip className="w-4 h-4" />
              </button>

              <input
                type="text"
                value={inputPrompt}
                onChange={(e) => setInputPrompt(e.target.value)}
                placeholder="Запитай що завгодно: напиши код, створи інтерактивний додаток, випробуй гіпотезу..."
                className="flex-1 px-4 py-2.5 text-xs bg-[#FAF7F0] border border-[#DDD3BF] rounded-2xl text-[#1E2521] focus:outline-none focus:border-[#C25925]"
              />

              <button
                type="submit"
                disabled={!inputPrompt.trim()}
                className="p-2.5 bg-[#C25925] hover:bg-[#AA491A] text-white rounded-2xl transition-colors disabled:opacity-40 shadow-xs"
              >
                <Send className="w-4 h-4" />
              </button>
            </form>
          </div>

          {/* CENTER/RIGHT PANE: Dynamic Artifact Studio (Canvas & Mini-Apps) */}
          <div className="hidden md:flex flex-1 flex-col h-full overflow-hidden">
            <div className="flex-1 flex flex-col h-full overflow-hidden">
              <DynamicArtifactStudio onOpenSandbox={() => setShowBottomSandbox(true)} />

              {/* BOTTOM EXECUTION SANDBOX (Collapsible) */}
              {showBottomSandbox && (
                <div className="h-64 shrink-0">
                  <LiveExecutionSandbox onClose={() => setShowBottomSandbox(false)} />
                </div>
              )}
            </div>
          </div>

          {/* SLIDE-OVER: Tree of Thought Visualizer Drawer */}
          {isTreeOfThoughtOpen && (
            <div className="w-80 h-full shrink-0 shadow-xl z-20">
              <TreeOfThoughtVisualizer onClose={() => setTreeOfThoughtOpen(false)} />
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

      {/* Real-time Voice Companion Overlay */}
      <VoiceCompanionOverlay />
    </div>
  );
};

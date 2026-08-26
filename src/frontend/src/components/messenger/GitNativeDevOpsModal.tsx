import React, { useState } from 'react';
import {
  GitBranch,
  GitPullRequest,
  Terminal,
  RotateCcw,
  X,
  Check,
} from 'lucide-react';
import { soundFx } from '../../utils/messengerSound';
import { useMessengerStore } from '../../stores/messengerStore';

interface PullRequest {
  id: string;
  title: string;
  author: string;
  branch: string;
  changes: string;
  status: 'Open' | 'Merged' | 'CI Passing';
}

interface CiJob {
  id: string;
  name: string;
  status: 'Passed' | 'Running' | 'Failed';
  duration: string;
  logSnippet: string;
}

interface GitNativeDevOpsModalProps {
  isOpen: boolean;
  onClose: () => void;
  chatTitle?: string;
}

export const GitNativeDevOpsModal: React.FC<GitNativeDevOpsModalProps> = ({
  isOpen,
  onClose,
  chatTitle = 'Інженерний простір',
}) => {
  const [activeTab, setActiveTab] = useState<'git_pr' | 'cicd' | 'debug_ssh'>('git_pr');
  const [codeSuggestionAccepted, setCodeSuggestionAccepted] = useState(false);
  const [ciJobs, setCiJobs] = useState<CiJob[]>([
    {
      id: 'j1',
      name: 'Cargo Test Suite (aarch64 / x86_64)',
      status: 'Passed',
      duration: '42s',
      logSnippet: 'test result: ok. 82 passed; 0 failed; 0 ignored',
    },
    {
      id: 'j2',
      name: 'E2E P2P Gossipsub Mesh Simulation',
      status: 'Passed',
      duration: '1m 15s',
      logSnippet: '✓ 16 simulated Radxa nodes converged in 28ms',
    },
    {
      id: 'j3',
      name: 'Deploy to Production Node (Canary)',
      status: 'Running',
      duration: '18s',
      logSnippet: 'Streaming container layers to /opt/phantom/bin...',
    },
  ]);

  const [pullRequests] = useState<PullRequest[]>([
    {
      id: 'pr-42',
      title: 'feat(mesh): LoRa SX1262 Bare-metal Direct PTT Driver',
      author: 'Саня (@alex_hw)',
      branch: 'feature/lora-sx1262-mesh',
      changes: '+340 / -18 рядків',
      status: 'CI Passing',
    },
    {
      id: 'pr-43',
      title: 'fix(crdt): State-based vector clock merge under high packet loss',
      author: 'Марина (@marina_core)',
      branch: 'fix/vector-clock-sec',
      changes: '+84 / -12 рядків',
      status: 'Open',
    },
  ]);

  if (!isOpen) return null;

  const handleApplySuggestion = () => {
    soundFx.playSend();
    setCodeSuggestionAccepted(true);
    const store = useMessengerStore.getState();
    store.addCustomMessage({
      id: `msg_git_commit_${Date.now()}`,
      senderId: store.currentUser.id,
      senderName: 'Git-Native Bridge',
      senderAvatar: store.currentUser.avatar,
      timestamp: new Date().toLocaleTimeString('uk-UA', { hour: '2-digit', minute: '2-digit' }),
      type: 'text',
      isSelf: true,
      text: '🚀 **[Git Commit & Push — PR #42]**\n`commit c8f21e0: apply inline code review suggestion for zero-copy ring buffer`\n\n*(Зміни автоматично закомічені в гілку `feature/lora-sx1262-mesh`)*',
    });
  };

  const handleRetryJob = (id: string) => {
    soundFx.playTap();
    setCiJobs(
      ciJobs.map((j) =>
        j.id === id ? { ...j, status: 'Running', logSnippet: 'Re-running test runner in container...' } : j
      )
    );
  };

  return (
    <div
      className="fixed inset-0 phantom-scrim z-50 flex items-center justify-center p-4 animate-in fade-in duration-150"
      onClick={onClose}
    >
      <div
        className="bg-white border border-[#E5DEC9] text-[#21261F] rounded-2xl w-full max-w-3xl shadow-2xl overflow-hidden flex flex-col max-h-[85vh] animate-in zoom-in-95 duration-150 select-text"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-5 py-4 bg-[#FAF8F5] border-b border-[#E8E1D3] flex items-center justify-between gap-3 shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-xl bg-[#FDF5ED] text-[#D96C35] border border-[#E5DEC9]">
              <GitBranch className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-bold text-sm text-[#21261F]">
                Git-Native Space & Інженерний DevOps Хаб
              </h3>
              <p className="text-[11px] text-[#6E7568]">
                {chatTitle} · Інлайн-рев'ю коду, Pull Requests, CI/CD та P2P-термінали
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <div className="flex items-center bg-[#EFE9DC] p-0.5 rounded-lg text-xs font-medium text-[#6E7568]">
              <button
                onClick={() => setActiveTab('git_pr')}
                className={`px-2.5 py-1 rounded-md transition-all ${
                  activeTab === 'git_pr' ? 'bg-white text-[#21261F] font-bold shadow-2xs' : 'hover:text-[#21261F]'
                }`}
              >
                Pull Requests ({pullRequests.length})
              </button>
              <button
                onClick={() => setActiveTab('cicd')}
                className={`px-2.5 py-1 rounded-md transition-all ${
                  activeTab === 'cicd' ? 'bg-white text-[#21261F] font-bold shadow-2xs' : 'hover:text-[#21261F]'
                }`}
              >
                CI/CD Пайплайни
              </button>
              <button
                onClick={() => setActiveTab('debug_ssh')}
                className={`px-2.5 py-1 rounded-md transition-all ${
                  activeTab === 'debug_ssh' ? 'bg-white text-[#21261F] font-bold shadow-2xs' : 'hover:text-[#21261F]'
                }`}
              >
                P2P SSH & Stack Trace
              </button>
            </div>

            <button
              onClick={onClose}
              className="p-1.5 hover:bg-[#EFE9DC] rounded-lg text-[#6E7568] hover:text-[#21261F] transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="p-6 flex-1 overflow-y-auto custom-scrollbar space-y-4">
          {/* TAB 1: Pull Requests & Inline Review */}
          {activeTab === 'git_pr' && (
            <div className="space-y-4">
              <div className="p-3.5 bg-indigo-50 border border-indigo-200 rounded-xl text-xs text-indigo-950 flex items-center justify-between">
                <div className="flex items-center gap-2 font-bold text-indigo-900">
                  <GitPullRequest className="w-4 h-4 text-indigo-600" />
                  <span>Інлайн-рев'ю коду та 1-Click Commit прямо в чаті</span>
                </div>
                <span className="font-mono font-bold">git rev-parse HEAD</span>
              </div>

              {/* PR Item */}
              <div className="p-4 bg-white border border-[#E5DEC9] rounded-xl space-y-3 shadow-2xs">
                <div className="flex items-center justify-between">
                  <div>
                    <span className="font-mono text-xs font-bold text-[#D96C35]">PR #42</span>
                    <h5 className="font-bold text-xs text-[#21261F] mt-0.5">
                      feat(mesh): LoRa SX1262 Bare-metal Direct PTT Driver
                    </h5>
                    <p className="text-[11px] text-[#6E7568]">
                      Автор: Саня (@alex_hw) · Гілка: <code className="bg-[#FAF8F5] px-1 rounded font-mono">feature/lora-sx1262-mesh</code>
                    </p>
                  </div>

                  <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-100 text-emerald-800">
                    CI Passing ✓
                  </span>
                </div>

                {/* Inline Diff & Suggestion Block */}
                <div className="border border-[#E5DEC9] rounded-lg overflow-hidden text-[11px] font-mono">
                  <div className="bg-[#FAF8F5] px-3 py-1.5 border-b border-[#E8E1D3] text-[#6E7568] flex justify-between">
                    <span>drivers/lora_sx1262.rs (L48-L54)</span>
                    <span>Diff preview</span>
                  </div>
                  <div className="p-3 bg-white space-y-1">
                    <div className="text-red-600 bg-red-50/50 px-1 rounded">- let buffer = allocate_heap_vec(size);</div>
                    <div className="text-emerald-700 bg-emerald-50/50 px-1 rounded">+ let buffer = ZeroCopyRingBuffer::with_capacity(size);</div>
                  </div>
                </div>

                {/* Suggestion action */}
                <div className="flex items-center justify-between pt-1">
                  <span className="text-[11px] text-[#6E7568]">Пропозиція виправлення від @Кирило</span>
                  <button
                    onClick={handleApplySuggestion}
                    disabled={codeSuggestionAccepted}
                    className={`px-3.5 py-1.5 rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 ${
                      codeSuggestionAccepted
                        ? 'bg-emerald-600 text-white'
                        : 'bg-[#D96C35] hover:bg-[#B85425] text-white shadow-xs'
                    }`}
                  >
                    <Check className="w-3.5 h-3.5" />
                    <span>{codeSuggestionAccepted ? 'Закомічено в гілку ✓' : 'Прийняти suggestion & Push'}</span>
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* TAB 2: CI/CD Pipelines */}
          {activeTab === 'cicd' && (
            <div className="space-y-3">
              <h4 className="font-bold text-xs text-[#21261F]">Живий стан пайплайнів збірки</h4>
              <div className="space-y-2.5">
                {ciJobs.map((job) => (
                  <div key={job.id} className="p-4 bg-white border border-[#E5DEC9] rounded-xl space-y-2 shadow-2xs">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-xs text-[#21261F]">{job.name}</span>
                        <span className="text-[10px] font-mono text-[#8A9186]">({job.duration})</span>
                      </div>

                      <div className="flex items-center gap-2">
                        <span
                          className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                            job.status === 'Passed'
                              ? 'bg-emerald-100 text-emerald-800'
                              : 'bg-indigo-100 text-indigo-800'
                          }`}
                        >
                          {job.status}
                        </span>

                        <button
                          onClick={() => handleRetryJob(job.id)}
                          className="p-1 hover:bg-[#FAF8F5] rounded border border-[#E5DEC9] text-[#6E7568]"
                          title="Retry job"
                        >
                          <RotateCcw className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>

                    <div className="p-2.5 bg-[#FAF8F5] border border-[#E8E1D3] rounded-lg font-mono text-[11px] text-[#21261F]">
                      {job.logSnippet}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* TAB 3: P2P SSH & Stack Trace Formatter */}
          {activeTab === 'debug_ssh' && (
            <div className="space-y-4">
              <div className="p-4 bg-emerald-50 border border-emerald-200 rounded-xl space-y-2 text-xs text-emerald-950">
                <div className="flex items-center gap-2 font-bold text-emerald-900">
                  <Terminal className="w-4 h-4 text-emerald-600" />
                  <span>Спільні P2P SSH сесії та Stack Trace Formatter</span>
                </div>
                <p className="leading-relaxed">
                  Парне налагодження серверів без розкриття портів у публічний інтернет. Всі виведені паніки та помилки автоматично форматуються в інтерактивні клікабельні стеки викликів.
                </p>
              </div>

              {/* Stack Trace Preview */}
              <div className="p-4 bg-white border border-[#E5DEC9] rounded-xl space-y-2 shadow-2xs font-mono text-xs">
                <div className="flex justify-between items-center text-[#6E7568] border-b border-[#E8E1D3] pb-1 text-[11px]">
                  <span>Parsed Exception (Rust Panic)</span>
                  <span className="text-red-600 font-bold">SIGSEGV Handled</span>
                </div>

                <div className="space-y-1 text-[11px]">
                  <div className="text-red-600">thread 'mesh-worker' panicked at 'Channel full: capacity 1024'</div>
                  <div className="text-[#21261F] pl-2">↳ at <span className="underline text-indigo-600 cursor-pointer">src/mesh/queue.rs:88</span></div>
                  <div className="text-[#6E7568] pl-4">↳ src/mesh/router.rs:142 in `route_packet`</div>
                  <div className="text-[#6E7568] pl-6">↳ src/main.rs:24 in `main`</div>
                </div>

                <button
                  onClick={() => {
                    soundFx.playSend();
                    alert('Сесія P2P SSH підключена до radxa-dev-01.pht (Node ID: #8491)');
                  }}
                  className="w-full mt-2 py-2 bg-[#21261F] hover:bg-[#3E453A] text-white rounded-xl text-xs font-bold transition-all"
                >
                  Підключити спільну термінальну P2P-сесію
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-2.5 bg-[#FAF8F5] border-t border-[#E8E1D3] flex items-center justify-between text-[11px] text-[#8A9186]">
          <span>Git-Native Collaboration Layer</span>
          <span className="font-mono">Libgit2 / P2P SSH v2</span>
        </div>
      </div>
    </div>
  );
};

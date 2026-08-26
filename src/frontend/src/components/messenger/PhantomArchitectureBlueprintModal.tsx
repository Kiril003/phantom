import React, { useState } from 'react';
import {
  Layers,
  X,
  GitBranch,
  Terminal,
} from 'lucide-react';
import { soundFx } from '../../utils/messengerSound';

interface PhantomArchitectureBlueprintModalProps {
  isOpen: boolean;
  onClose: () => void;
  chatTitle?: string;
}

export const PhantomArchitectureBlueprintModal: React.FC<PhantomArchitectureBlueprintModalProps> = ({
  isOpen,
  onClose,
  chatTitle = 'Архітектурна специфікація',
}) => {
  const [activeSection, setActiveSection] = useState<'kernel' | 'gitops' | 'academy' | 'erp' | 'mesh'>('kernel');
  const [crdtVectorClock, setCrdtVectorClock] = useState(142);
  const [simulatedDlpText, setSimulatedDlpText] = useState('AWS_SECRET_KEY=AKIAIOSFODNN7EXAMPLE');
  const [isDlpBlocked, setIsDlpBlocked] = useState(true);

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 phantom-scrim z-50 flex items-center justify-center p-4 animate-in fade-in duration-150"
      onClick={onClose}
    >
      <div
        className="bg-white border border-[#E5DEC9] text-[#21261F] rounded-2xl w-full max-w-4xl shadow-2xl overflow-hidden flex flex-col max-h-[85vh] animate-in zoom-in-95 duration-150 select-text"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-5 py-4 bg-[#FAF8F5] border-b border-[#E8E1D3] flex items-center justify-between gap-3 shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-xl bg-[#FDF5ED] text-[#D96C35] border border-[#E5DEC9]">
              <Layers className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-bold text-sm text-[#21261F]">
                Phantom OS — Повна Технічна & Продуктова Специфікація
              </h3>
              <p className="text-[11px] text-[#6E7568]">
                {chatTitle} · Архітектура Block-Node, GitOps, LMS, Local ERP та Multi-Hop Mesh
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <div className="flex items-center bg-[#EFE9DC] p-0.5 rounded-lg text-xs font-medium text-[#6E7568]">
              <button
                onClick={() => setActiveSection('kernel')}
                className={`px-2.5 py-1 rounded-md transition-all ${
                  activeSection === 'kernel' ? 'bg-white text-[#21261F] font-bold shadow-2xs' : 'hover:text-[#21261F]'
                }`}
              >
                1. Block-Node Kernel
              </button>
              <button
                onClick={() => setActiveSection('gitops')}
                className={`px-2.5 py-1 rounded-md transition-all ${
                  activeSection === 'gitops' ? 'bg-white text-[#21261F] font-bold shadow-2xs' : 'hover:text-[#21261F]'
                }`}
              >
                2. GitOps & Compute
              </button>
              <button
                onClick={() => setActiveSection('academy')}
                className={`px-2.5 py-1 rounded-md transition-all ${
                  activeSection === 'academy' ? 'bg-white text-[#21261F] font-bold shadow-2xs' : 'hover:text-[#21261F]'
                }`}
              >
                3. LMS & Research
              </button>
              <button
                onClick={() => setActiveSection('erp')}
                className={`px-2.5 py-1 rounded-md transition-all ${
                  activeSection === 'erp' ? 'bg-white text-[#21261F] font-bold shadow-2xs' : 'hover:text-[#21261F]'
                }`}
              >
                4. Local ERP & Escrow
              </button>
              <button
                onClick={() => setActiveSection('mesh')}
                className={`px-2.5 py-1 rounded-md transition-all ${
                  activeSection === 'mesh' ? 'bg-white text-[#21261F] font-bold shadow-2xs' : 'hover:text-[#21261F]'
                }`}
              >
                5. Mesh & Zero-Trust
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
        <div className="p-6 flex-1 overflow-y-auto custom-scrollbar space-y-4 text-xs">
          {/* SECTION 1: Block-Node Kernel */}
          {activeSection === 'kernel' && (
            <div className="space-y-4">
              <div className="p-4 bg-indigo-50 border border-indigo-200 rounded-xl space-y-1 text-indigo-950">
                <span className="font-bold text-indigo-900">Універсальна сутність Block-Node: CRDT замість незмінного рядка</span>
                <p className="text-[11px] leading-relaxed">
                  Будь-який елемент монтується за посиланням (Pointer Ref). Редагування в Canvas автоматично оновлює стан віджета в чаті без надсилання нового повідомлення.
                </p>
              </div>

              {/* Node Schema JSON Inspector */}
              <div className="p-4 bg-[#21261F] text-emerald-400 font-mono rounded-xl space-y-1 shadow-2xs">
                <div className="text-[#8A9186] text-[10px] pb-1">// Унифікована схема атомарного вузла (Universal Node Object):</div>
                <pre className="text-[11px] leading-relaxed">{`{
  "node_id": "01J9Y4D28Q7Z5V8P9N3M1K0X2R",       // ULID v7 (часовий порядок)
  "space_id": "sp_engineering_aura",              // Криптографічна сфера
  "schema_type": "code_sandbox | stream_pipe",    // Тип сутності
  "state_crdt": {
    "vector_clock": ${crdtVectorClock},
    "delta_bytes": "0x4f810a9b...",               // Бінарна дельта операцій
    "lamport_ts": 1787769400
  },
  "permissions": "0b1111",                        // RWES (Read/Write/Exec/Sign)
  "signature": "ed25519:5a9b7c8e2f..."            // Підпис автора (No Central Server)
}`}</pre>
              </div>

              <div className="p-3 bg-[#FAF8F5] border border-[#E8E1D3] rounded-xl flex justify-between items-center">
                <span className="text-[#6E7568]">Live Data Pipe: Трансляція UNIX-сокета на частоті 60 FPS</span>
                <button
                  onClick={() => {
                    soundFx.playTap();
                    setCrdtVectorClock((prev) => prev + 1);
                  }}
                  className="px-3 py-1 bg-[#D96C35] hover:bg-[#B85425] text-white rounded-lg font-bold shadow-xs transition-all"
                >
                  Симулювати CRDT мутацію (+1 Clock)
                </button>
              </div>
            </div>
          )}

          {/* SECTION 2: GitOps & Local Compute */}
          {activeSection === 'gitops' && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div className="p-4 bg-white border border-[#E5DEC9] rounded-xl space-y-2 shadow-2xs">
                  <div className="flex items-center gap-2 font-bold text-[#21261F]">
                    <GitBranch className="w-4 h-4 text-[#D96C35]" />
                    <span>Git-Native Workflow & Diff</span>
                  </div>
                  <p className="text-[#6E7568] text-[11px]">
                    Side-by-Side visual diff, коментування рядків L42–L58, 1-клік «Accept Patch» та автогенерація комітів через локальний libgit2.
                  </p>
                  <div className="font-mono text-[10px] bg-[#FAF8F5] p-2 rounded border border-[#E8E1D3] text-emerald-700">
                    $ git push phantom main --signed
                  </div>
                </div>

                <div className="p-4 bg-white border border-[#E5DEC9] rounded-xl space-y-2 shadow-2xs">
                  <div className="flex items-center gap-2 font-bold text-[#21261F]">
                    <Terminal className="w-4 h-4 text-emerald-600" />
                    <span>Inline Wasm Sandbox & Pair-Shell</span>
                  </div>
                  <p className="text-[#6E7568] text-[11px]">
                    Виконання C++, Rust, Python у WebAssembly-контейнері. Спільна TTY pair-shell сесія через наскрізний P2P тунель.
                  </p>
                  <div className="font-mono text-[10px] bg-[#21261F] text-emerald-400 p-2 rounded">
                    [wasm-sandbox]: exit code 0 (0.8ms)
                  </div>
                </div>
              </div>

              <div className="p-3 bg-[#FAF8F5] border border-[#E8E1D3] rounded-xl flex justify-between items-center">
                <span>Апаратний WebGL/WebGPU CAD в'ювер:</span>
                <span className="font-mono font-bold text-indigo-700">Підтримка .step, .gltf, Gerber PCB</span>
              </div>
            </div>
          )}

          {/* SECTION 3: LMS & Academic Research */}
          {activeSection === 'academy' && (
            <div className="space-y-4">
              <div className="p-4 bg-emerald-50 border border-emerald-200 rounded-xl space-y-1 text-emerald-950">
                <span className="font-bold text-emerald-900">Академічний хаб: Autograder & Office Hours Queue</span>
                <p className="text-[11px]">
                  Автоматичний прогін прихованих unit-тестів та черга на захист дипломів із таймером консультації.
                </p>
              </div>

              <div className="space-y-2.5">
                <div className="p-3.5 bg-white border border-[#E5DEC9] rounded-xl flex justify-between items-center shadow-2xs">
                  <div className="space-y-0.5">
                    <h5 className="font-bold text-[#21261F]">Autograder: Лабораторна робота №4 (Mesh Routing)</h5>
                    <span className="text-[#6E7568] text-[11px]">Тести: 12/12 пройдено · Valgrind: 0 memory leaks</span>
                  </div>
                  <span className="px-2.5 py-1 bg-emerald-100 text-emerald-800 rounded-full font-bold text-[11px]">
                    100 / 100 Балів ✓
                  </span>
                </div>

                <div className="p-3.5 bg-white border border-[#E5DEC9] rounded-xl flex justify-between items-center shadow-2xs">
                  <div className="space-y-0.5">
                    <h5 className="font-bold text-[#21261F]">Жива черга (Office Hours): Захист курсового проекту</h5>
                    <span className="text-[#6E7568] text-[11px]">Поточний студент: @Саня · Залишилось: 6:40 хв</span>
                  </div>
                  <span className="px-2.5 py-1 bg-indigo-50 border border-indigo-200 text-indigo-800 rounded-full font-bold text-[11px]">
                    Ви наступний у черзі
                  </span>
                </div>
              </div>
            </div>
          )}

          {/* SECTION 4: Local ERP & Escrow */}
          {activeSection === 'erp' && (
            <div className="space-y-4">
              <div className="p-4 bg-amber-50 border border-amber-200 rounded-xl space-y-1 text-amber-950">
                <span className="font-bold text-amber-900">Local ERP & Смарт-Ескроу Угоди</span>
                <p className="text-[11px]">
                  Каталог із 3D-прев'ю, автосписання зі складу при зміні статусу та децентралізований арбітраж.
                </p>
              </div>

              <div className="p-4 bg-white border border-[#E5DEC9] rounded-xl space-y-2 shadow-2xs">
                <h5 className="font-bold text-[#21261F]">Локальний IFTTT Automations Engine</h5>
                <div className="p-3 bg-[#FAF8F5] border border-[#E8E1D3] rounded-lg font-mono text-[11px] text-[#21261F]">
                  IF [Статус оплати == True] → [Генерувати ліцензійний ключ] → [Створити приватний простір клієнта]
                </div>
              </div>
            </div>
          )}

          {/* SECTION 5: Multi-Hop Mesh & Zero-Trust */}
          {activeSection === 'mesh' && (
            <div className="space-y-4">
              <div className="p-4 bg-[#21261F] text-white rounded-xl space-y-2 shadow-2xs">
                <span className="font-bold text-emerald-400">Multi-Hop Mesh Networking Stack</span>
                <div className="font-mono text-[11px] space-y-1 text-[#8A9186]">
                  <div>[Global Internet / P2P WebRTC / STUN]</div>
                  <div className="text-emerald-400">  ↓ (якщо втрачено зв'язок)</div>
                  <div>[Local LAN / Wi-Fi Direct Mesh]</div>
                  <div className="text-emerald-400">  ↓ (якщо знеструмлено роутери)</div>
                  <div>[Bluetooth LE 5.0 Long-Range Flooding]</div>
                  <div className="text-emerald-400">  ↓ (на великих дистанціях)</div>
                  <div>[LoRa 868/915 MHz Hardware Packet Radio]</div>
                </div>
              </div>

              {/* DLP Analyzer Preview */}
              <div className="p-4 bg-white border border-[#E5DEC9] rounded-xl space-y-2 shadow-2xs">
                <div className="flex justify-between items-center">
                  <span className="font-bold text-[#21261F]">DLP Engine: Захист від витоку секретів</span>
                  <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${isDlpBlocked ? 'bg-red-100 text-red-800' : 'bg-emerald-100 text-emerald-800'}`}>
                    {isDlpBlocked ? 'Витік заблоковано 🛡️' : 'Безпечно'}
                  </span>
                </div>
                <input
                  type="text"
                  value={simulatedDlpText}
                  onChange={(e) => {
                    setSimulatedDlpText(e.target.value);
                    setIsDlpBlocked(e.target.value.includes('KEY') || e.target.value.includes('AKIA'));
                  }}
                  className="w-full p-2 bg-[#FAF8F5] border border-[#E8E1D3] rounded-lg font-mono text-xs text-[#21261F]"
                />
                <span className="text-[10px] text-[#6E7568]">
                  Автоматично перевіряє буфер обміну на наявність API-ключів, id_rsa та токенів.
                </span>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-2.5 bg-[#FAF8F5] border-t border-[#E8E1D3] flex items-center justify-between text-[11px] text-[#8A9186]">
          <span>Phantom OS Meta-System Specification</span>
          <span className="font-mono">Specification Core v3.0</span>
        </div>
      </div>
    </div>
  );
};

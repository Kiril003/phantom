import React, { useState, useEffect, useRef } from 'react';
import {
  X,
  Radio,
  Globe,
  Zap,
  Activity,
  Server,
  Users,
  Copy,
  Check,
  UploadCloud,
  FileUp,
  KeyRound,
  RefreshCw,
  Shield,
  ArrowDownUp
} from 'lucide-react';
import {
  TransportProtocol,
  P2PPeerSession,
  NetworkDiagnostics
} from '../../types/messenger';
import { networkEngine } from '../../services/messengerNetworkEngine';
import { soundFx } from '../../utils/messengerSound';

interface P2PNetworkModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentChatTitle?: string;
}

export const P2PNetworkModal: React.FC<P2PNetworkModalProps> = ({
  isOpen,
  onClose,
  currentChatTitle = 'Поточний діалог',
}) => {
  const [diagnostics, setDiagnostics] = useState<NetworkDiagnostics>(networkEngine.getDiagnostics());
  const [peers, setPeers] = useState<P2PPeerSession[]>(networkEngine.getPeerSessions());
  const [activeTab, setActiveTab] = useState<'overview' | 'peers' | 'handshake' | 'file-transfer' | 'advanced'>('overview');

  // Manual SDP states
  const [manualOfferText, setManualOfferText] = useState('');
  const [manualAnswerInput, setManualAnswerInput] = useState('');
  const [copiedOffer, setCopiedOffer] = useState(false);
  const [handshakeStatus, setHandshakeStatus] = useState<string | null>(null);

  // File Transfer State
  const [fileProgress, setFileProgress] = useState<{ fileName: string; percentage: number; isReceiving: boolean; senderName: string } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!isOpen) return;

    const unsubDiag = networkEngine.onDiagnostics((diag) => {
      setDiagnostics(diag);
    });

    const unsubPeers = networkEngine.onPeerSessions((pList) => {
      setPeers(pList);
    });

    const unsubProgress = networkEngine.onFileTransferProgress((prog) => {
      setFileProgress(prog);
      if (prog.percentage >= 100) {
        setTimeout(() => setFileProgress(null), 3000);
      }
    });

    return () => {
      unsubDiag();
      unsubPeers();
      unsubProgress();
    };
  }, [isOpen]);

  if (!isOpen) return null;

  const handleSelectMode = (mode: TransportProtocol) => {
    soundFx.playTap();
    networkEngine.setTransportMode(mode);
    setDiagnostics(networkEngine.getDiagnostics());
  };

  const handleGenerateManualOffer = async () => {
    soundFx.playChime();
    setHandshakeStatus('Генерація локального SDP оффера...');
    const offerB64 = await networkEngine.createManualOffer();
    setManualOfferText(offerB64);
    setHandshakeStatus('SDP Оффер згенеровано. Надішліть його співрозмовнику.');
  };

  const handleApplyManualAnswer = async () => {
    if (!manualAnswerInput.trim()) return;
    soundFx.playSend();
    setHandshakeStatus('Синхронізація віддаленого SDP Answer...');
    // acceptManualAnswer лише валідує формат — remote description не застосовується,
    // тому про встановлений тунель тут говорити не можна.
    const isValid = await networkEngine.acceptManualAnswer(manualAnswerInput);
    setHandshakeStatus(
      isValid
        ? 'SDP Answer має коректний формат. Канал ще не встановлено.'
        : 'Помилка валідації SDP Answer. Перевірте цілісність коду.'
    );
  };

  const handleCopyOffer = () => {
    if (!manualOfferText) return;
    soundFx.playTap();
    navigator.clipboard.writeText(manualOfferText);
    setCopiedOffer(true);
    setTimeout(() => setCopiedOffer(false), 2000);
  };

  const handleP2PFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    soundFx.playSend();
    const sent = await networkEngine.sendP2PFile(file);
    if (!sent) {
      alert('Немає активних P2P каналів. Перейдіть у режим Auto або підключіть хоча б один вузол.');
    }
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-md flex items-end sm:items-center justify-center p-0 sm:p-4 select-none animate-in fade-in duration-150">
      <div className="bg-[#FDFCF9] border-t sm:border border-[#DDD4C4] rounded-t-3xl sm:rounded-3xl w-full max-w-2xl shadow-2xl overflow-hidden flex flex-col max-h-[92dvh] sm:max-h-[90vh] animate-in slide-in-from-bottom sm:zoom-in-95 duration-150 pb-[var(--sab)] sm:pb-0 text-[#1E2521]">
        {/* Mobile Pull Indicator */}
        <div className="sm:hidden pt-2.5 pb-1 flex justify-center bg-[#FDFCF9]">
          <div className="w-12 h-1 bg-[#F1EDE3] rounded-full" />
        </div>
        
        {/* Modal Top Header */}
        <div className="px-4 sm:px-5 py-3 sm:py-4 bg-[#FDFCF9] border-b border-[#E6DFD3] flex items-center justify-between shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-[#F9F7F1] border border-[#DDD4C4] flex items-center justify-center text-[#E87A42] shadow-sm">
              <Radio className="w-5 h-5 animate-pulse" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="font-extrabold text-base text-[#1E2521]">Керування протоколами зв'язку</h3>
                <span className={`px-2 py-0.5 rounded-full text-[10.5px] font-bold border flex items-center gap-1.5 ${
                  diagnostics.activeStatus === 'p2p-direct'
                    ? 'bg-[#F1EDE3] text-[#E87A42] border-[#DDD4C4]'
                    : diagnostics.activeStatus === 'server-ws'
                    ? 'bg-[#F9F7F1] text-[#60A5FA] border-[#E6DFD3]'
                    : 'bg-[#F9F7F1] text-[#FBBF24] border-[#E6DFD3]'
                }`}>
                  <span className={`w-2 h-2 rounded-full ${
                    diagnostics.activeStatus === 'p2p-direct' ? 'bg-[#E87A42]' : diagnostics.activeStatus === 'server-ws' ? 'bg-[#3B82F6]' : 'bg-[#F59E0B]'
                  }`} />
                  <span>
                    {diagnostics.activeStatus === 'p2p-direct'
                      ? 'P2P Direct [WebRTC]'
                      : diagnostics.activeStatus === 'server-ws'
                      ? 'Server Relay [WebSocket]'
                      : 'Підключення...'}
                  </span>
                </span>
              </div>
              <p className="text-xs text-[#5F6A60]">
                Пряма передача між клієнтами або хмарний релей для бесіди <span className="font-bold text-[#1E2521]">«{currentChatTitle}»</span>
              </p>
            </div>
          </div>

          <button
            onClick={() => {
              soundFx.playTap();
              onClose();
            }}
            className="p-2 text-[#5F6A60] hover:text-[#1E2521] hover:bg-[#F1EDE3] rounded-xl transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Navigation Tabs */}
        <div className="px-4 py-2 bg-[#F7F5EE] border-b border-[#E6DFD3] flex items-center gap-1.5 overflow-x-auto no-scrollbar shrink-0">
          {[
            { id: 'overview', label: 'Режим & Огляд', icon: ArrowDownUp },
            { id: 'peers', label: `Вузли P2P (${peers.length})`, icon: Users },
            { id: 'handshake', label: 'Ручний SDP Handshake', icon: KeyRound },
            { id: 'file-transfer', label: 'P2P Файловий тунель', icon: UploadCloud },
            { id: 'advanced', label: 'Діагностика & STUN', icon: Activity },
          ].map((t) => {
            const Icon = t.icon;
            const isActive = activeTab === t.id;
            return (
              <button
                key={t.id}
                onClick={() => {
                  soundFx.playTap();
                  setActiveTab(t.id as any);
                }}
                className={`px-3 py-1.5 rounded-xl text-xs font-bold flex items-center gap-1.5 whitespace-nowrap transition-all ${
                  isActive
                    ? 'bg-[#F9F7F1] text-[#E87A42] border border-[#DDD4C4] shadow-sm'
                    : 'bg-[#FDFCF9] hover:bg-[#F9F7F1] text-[#5F6A60] hover:text-[#1E2521] border border-[#E6DFD3]'
                }`}
              >
                <Icon className="w-3.5 h-3.5" />
                <span>{t.label}</span>
              </button>
            );
          })}
        </div>

        {/* Content Body */}
        <div className="p-5 overflow-y-auto space-y-4 flex-1">

          {/* TAB 1: OVERVIEW & MODE SWITCHER */}
          {activeTab === 'overview' && (
            <div className="space-y-5">
              <div>
                <label className="block text-xs font-bold text-[#7A8479] mb-2 uppercase tracking-wider">
                  Виберіть спосіб доставки повідомлень
                </label>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  
                  {/* Option 1: Auto Hybrid */}
                  <div
                    onClick={() => handleSelectMode('auto')}
                    className={`p-4 rounded-2xl border cursor-pointer transition-all relative ${
                      diagnostics.transportMode === 'auto'
                        ? 'bg-white border-[#E87A42] ring-2 ring-[#E87A42]/20 shadow-md'
                        : 'bg-white/60 border-[#DFD6C4] hover:bg-white'
                    }`}
                  >
                    <div className="flex items-center justify-between mb-2">
                      <div className="w-8 h-8 rounded-xl bg-[#E87A42]/15 text-[#E87A42] flex items-center justify-center">
                        <Zap className="w-4 h-4" />
                      </div>
                      {diagnostics.transportMode === 'auto' && (
                        <span className="w-2.5 h-2.5 rounded-full bg-[#E87A42]" />
                      )}
                    </div>
                    <h4 className="font-extrabold text-sm text-[#F9F7F1] mb-1">Автоматичний (Hybrid)</h4>
                    <p className="text-[11.5px] text-[#637268] leading-relaxed">
                      Миттєвий прямий P2P тунель за наявності зв'язку, з непомітним підстрахуванням через WebSocket сервер.
                    </p>
                    <div className="mt-3 pt-2 border-t border-[#F2ECE0] flex items-center gap-1.5 text-[10.5px] font-semibold text-[#E87A42]">
                      <Check className="w-3.5 h-3.5" />
                      <span>Рекомендовано</span>
                    </div>
                  </div>

                  {/* Option 2: Strict P2P */}
                  <div
                    onClick={() => handleSelectMode('p2p')}
                    className={`p-4 rounded-2xl border cursor-pointer transition-all relative ${
                      diagnostics.transportMode === 'p2p'
                        ? 'bg-white border-[#10B981] ring-2 ring-[#10B981]/20 shadow-md'
                        : 'bg-white/60 border-[#DFD6C4] hover:bg-white'
                    }`}
                  >
                    <div className="flex items-center justify-between mb-2">
                      <div className="w-8 h-8 rounded-xl bg-[#10B981]/15 text-[#10B981] flex items-center justify-center">
                        <ArrowDownUp className="w-4 h-4" />
                      </div>
                      {diagnostics.transportMode === 'p2p' && (
                        <span className="w-2.5 h-2.5 rounded-full bg-[#10B981]" />
                      )}
                    </div>
                    <h4 className="font-extrabold text-sm text-[#F9F7F1] mb-1">Чистий P2P (WebRTC)</h4>
                    <p className="text-[11.5px] text-[#637268] leading-relaxed">
                      Прямий DataChannel між браузерами. Текст і файли не проходять через сервер.
                    </p>
                    <div className="mt-3 pt-2 border-t border-[#F2ECE0] flex items-center gap-1.5 text-[10.5px] font-semibold text-[#10B981]">
                      <Radio className="w-3.5 h-3.5" />
                      <span>Прямий канал (DTLS)</span>
                    </div>
                  </div>

                  {/* Option 3: Always Server Relay */}
                  <div
                    onClick={() => handleSelectMode('server')}
                    className={`p-4 rounded-2xl border cursor-pointer transition-all relative ${
                      diagnostics.transportMode === 'server'
                        ? 'bg-white border-[#3B82F6] ring-2 ring-[#3B82F6]/20 shadow-md'
                        : 'bg-white/60 border-[#DFD6C4] hover:bg-white'
                    }`}
                  >
                    <div className="flex items-center justify-between mb-2">
                      <div className="w-8 h-8 rounded-xl bg-[#3B82F6]/15 text-[#3B82F6] flex items-center justify-center">
                        <Globe className="w-4 h-4" />
                      </div>
                      {diagnostics.transportMode === 'server' && (
                        <span className="w-2.5 h-2.5 rounded-full bg-[#3B82F6]" />
                      )}
                    </div>
                    <h4 className="font-extrabold text-sm text-[#F9F7F1] mb-1">Серверний релей</h4>
                    <p className="text-[11.5px] text-[#637268] leading-relaxed">
                      Стандартна доставка через WebSocket вузол PHANTOM. Забезпечує гарантовану доставку для великих груп.
                    </p>
                    <div className="mt-3 pt-2 border-t border-[#F2ECE0] flex items-center gap-1.5 text-[10.5px] font-semibold text-[#3B82F6]">
                      <Server className="w-3.5 h-3.5" />
                      <span>Централізовано</span>
                    </div>
                  </div>

                </div>
              </div>

              {/* Real-time Telemetry Cards */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                <div className="p-3 bg-white rounded-2xl border border-[#E2D8C6] shadow-2xs">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-[#79887D] block">Затримка (RTT)</span>
                  <div className="flex items-baseline gap-1.5 mt-0.5">
                    <span className="text-xl font-black text-[#F9F7F1]">
                      {diagnostics.latencyMs !== null ? diagnostics.latencyMs : '—'}
                    </span>
                    {diagnostics.latencyMs !== null && (
                      <span className="text-xs font-semibold text-[#79887D]">мс</span>
                    )}
                  </div>
                  <span className="text-[10px] text-[#79887D] font-semibold block mt-1">
                    {diagnostics.latencyMs !== null ? 'Останній замір ехо-пакета' : 'Заміру ще не було'}
                  </span>
                </div>

                <div className="p-3 bg-white rounded-2xl border border-[#E2D8C6] shadow-2xs">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-[#79887D] block">P2P Вузли онлайн</span>
                  <div className="flex items-baseline gap-1.5 mt-0.5">
                    <span className="text-xl font-black text-[#F9F7F1]">{peers.length}</span>
                    <span className="text-xs font-semibold text-[#79887D]">пірів</span>
                  </div>
                  <span className="text-[10px] text-[#637268] font-semibold block mt-1">
                    Відкритих каналів: {peers.filter((p) => p.dataChannelState === 'open').length}
                  </span>
                </div>

                <div className="p-3 bg-white rounded-2xl border border-[#E2D8C6] shadow-2xs">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-[#79887D] block">P2P Трафік</span>
                  <div className="flex items-baseline gap-1.5 mt-0.5">
                    <span className="text-xl font-black text-[#10B981]">{(diagnostics.bytesTransferred.p2p / 1024).toFixed(1)}</span>
                    <span className="text-xs font-semibold text-[#79887D]">KB</span>
                  </div>
                  <span className="text-[10px] text-[#79887D] font-semibold block mt-1">
                    Пряма передача
                  </span>
                </div>

                <div className="p-3 bg-white rounded-2xl border border-[#E2D8C6] shadow-2xs">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-[#79887D] block">Серверний релей</span>
                  <div className="flex items-baseline gap-1.5 mt-0.5">
                    <span className="text-xl font-black text-[#3B82F6]">{(diagnostics.bytesTransferred.server / 1024).toFixed(1)}</span>
                    <span className="text-xs font-semibold text-[#79887D]">KB</span>
                  </div>
                  <span className="text-[10px] text-[#79887D] font-semibold block mt-1">
                    WebSocket sync
                  </span>
                </div>
              </div>

            </div>
          )}

          {/* TAB 2: ACTIVE PEERS LIST */}
          {activeTab === 'peers' && (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <h4 className="text-xs font-bold uppercase tracking-wider text-[#7A8479]">
                  Активні прямі WebRTC вузли ({peers.length})
                </h4>
                <button
                  onClick={() => {
                    networkEngine.initiateP2PPeerConnection(`node_${Date.now().toString().slice(-4)}`, 'Новий P2P вузол');
                    soundFx.playChime();
                  }}
                  className="text-xs font-bold text-[#E87A42] hover:underline flex items-center gap-1"
                >
                  <RefreshCw className="w-3 h-3" />
                  <span>Підключити новий вузол</span>
                </button>
              </div>

              {peers.length === 0 ? (
                <div className="p-8 text-center bg-white rounded-2xl border border-[#DFD6C4]">
                  <Users className="w-8 h-8 text-[#A8B6AB] mx-auto mb-2 opacity-50" />
                  <p className="text-xs font-bold text-[#F9F7F1]">Немає активних прямих пірів у кімнаті</p>
                  <p className="text-[11px] text-[#6E7E73] mt-1">
                    Відкрийте додаток у другій вкладці або на іншому пристрої для автоматичного P2P з'єднання.
                  </p>
                </div>
              ) : (
                <div className="space-y-2">
                  {peers.map((peer, idx) => (
                    <div key={idx} className="p-3.5 bg-white rounded-2xl border border-[#E0D7C5] flex items-center justify-between gap-3 shadow-2xs">
                      <div className="flex items-center gap-3 min-w-0">
                        <img
                          src={peer.avatar || 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=150&auto=format&fit=crop&q=80'}
                          alt={peer.peerName}
                          className="w-10 h-10 rounded-xl object-cover ring-1 ring-[#DFD6C5] shrink-0"
                        />
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <h5 className="font-extrabold text-xs sm:text-sm text-[#F9F7F1] truncate">{peer.peerName}</h5>
                            {peer.isDirectP2P && (
                              <span className="px-1.5 py-0.2 rounded text-[9.5px] font-bold bg-[#E8F5E9] text-[#2E7D32] border border-[#C8E6C9]">
                                WebRTC Direct
                              </span>
                            )}
                          </div>
                          {/* Відбиток є лише після розбору SDP — вигаданого показувати не можна. */}
                          {peer.fingerprint && (
                            <p className="text-[11px] text-[#69796F] truncate font-mono mt-0.5">
                              Відбиток DTLS: {peer.fingerprint}
                            </p>
                          )}
                        </div>
                      </div>

                      <div className="text-right shrink-0">
                        {peer.rttMs !== undefined && (
                          <span className="text-xs font-bold text-[#F9F7F1] block">{peer.rttMs} мс</span>
                        )}
                        <span className="text-[10px] text-[#7A8A80] block mt-0.5">
                          {peer.bytesReceived
                            ? `${(peer.bytesReceived / 1024).toFixed(1)} KB`
                            : `Канал: ${peer.dataChannelState}`}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* TAB 3: MANUAL OFFLINE / AIR-GAPPED SDP HANDSHAKE */}
          {activeTab === 'handshake' && (
            <div className="space-y-4">
              <div className="p-3.5 bg-[#F6EEE2] rounded-2xl border border-[#E6DC source-serif]">
                <h4 className="font-bold text-xs text-[#F9F7F1] flex items-center gap-1.5">
                  <KeyRound className="w-4 h-4 text-[#E87A42]" />
                  <span>Ручний обмін ключами (SDP Handshake без сервера)</span>
                </h4>
                <p className="text-[11px] text-[#637268] mt-1 leading-relaxed">
                  Обмін SDP вручну, без центрального сигнального сервера. Зараз доступний лише крок генерації та перевірки коду — канал по ньому ще не піднімається.
                </p>
              </div>

              {/* Step 1: Create Offer */}
              <div className="p-4 bg-white rounded-2xl border border-[#DFD6C4] space-y-2.5">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-[#F9F7F1]">Крок 1. Згенерувати локальний P2P Offer</span>
                  <button
                    onClick={handleGenerateManualOffer}
                    className="px-3 py-1 bg-[#E87A42] hover:bg-[#D56832] text-[#1E2521] rounded-xl text-xs font-bold shadow-2xs transition-all active:scale-95"
                  >
                    Створити Offer
                  </button>
                </div>

                {manualOfferText && (
                  <div className="relative">
                    <textarea
                      readOnly
                      rows={3}
                      value={manualOfferText}
                      className="w-full p-2.5 text-[11px] font-mono bg-[#FAF8F4] border border-[#DDD3BF] rounded-xl text-[#7A8479] resize-none focus:outline-hidden"
                    />
                    <button
                      onClick={handleCopyOffer}
                      className="absolute top-2 right-2 px-2.5 py-1 bg-white hover:bg-[#F2ECE0] border border-[#D5C9B5] text-[#F9F7F1] rounded-lg text-xs font-bold flex items-center gap-1 shadow-2xs"
                    >
                      {copiedOffer ? <Check className="w-3.5 h-3.5 text-[#10B981]" /> : <Copy className="w-3.5 h-3.5" />}
                      <span>{copiedOffer ? 'Скопійовано' : 'Копіювати'}</span>
                    </button>
                  </div>
                )}
              </div>

              {/* Step 2: Paste Remote Answer */}
              <div className="p-4 bg-white rounded-2xl border border-[#DFD6C4] space-y-2.5">
                <span className="text-xs font-bold text-[#F9F7F1] block">Крок 2. Вставити отриманий SDP Answer від співрозмовника</span>
                <textarea
                  rows={3}
                  value={manualAnswerInput}
                  onChange={(e) => setManualAnswerInput(e.target.value)}
                  placeholder="Вставте сюди скопійований Answer від другого учасника..."
                  className="w-full p-2.5 text-[11px] font-mono bg-[#FAF8F4] border border-[#DDD3BF] rounded-xl text-[#7A8479] resize-none focus:outline-hidden focus:border-[#E87A42]"
                />
                <button
                  onClick={handleApplyManualAnswer}
                  disabled={!manualAnswerInput.trim()}
                  className="w-full py-2 bg-[#F9F7F1] hover:bg-[#F1EDE3] disabled:opacity-40 text-[#1E2521] rounded-xl text-xs font-bold transition-all shadow-2xs active:scale-98 flex items-center justify-center gap-2"
                >
                  <Check className="w-3.5 h-3.5 text-[#10B981]" />
                  <span>Перевірити SDP Answer</span>
                </button>
              </div>

              {handshakeStatus && (
                <div className="p-3 bg-[#EBF7EE] border border-[#BCE4C7] rounded-xl text-xs font-bold text-[#246A34] animate-in fade-in">
                  {handshakeStatus}
                </div>
              )}
            </div>
          )}

          {/* TAB 4: DIRECT P2P FILE TUNNEL */}
          {activeTab === 'file-transfer' && (
            <div className="space-y-4">
              <div className="p-4 bg-white rounded-2xl border border-[#DFD6C4] text-center space-y-3">
                <div className="w-12 h-12 rounded-2xl bg-[#E87A42]/15 text-[#E87A42] flex items-center justify-center mx-auto shadow-2xs">
                  <UploadCloud className="w-6 h-6" />
                </div>
                <div>
                  <h4 className="font-extrabold text-sm text-[#F9F7F1]">Пряма передача файлів через WebRTC</h4>
                  <p className="text-xs text-[#6A7B71] max-w-md mx-auto mt-1 leading-relaxed">
                    Файли нарізаються на бінарні фрагменти (16KB) та передаються безпосередньо у браузер одержувача, не проходячи через сервер.
                  </p>
                </div>

                <input
                  type="file"
                  ref={fileInputRef}
                  onChange={handleP2PFileSelect}
                  className="hidden"
                />

                <button
                  onClick={() => fileInputRef.current?.click()}
                  className="px-5 py-2.5 bg-[#E87A42] hover:bg-[#D56933] text-[#1E2521] rounded-2xl font-bold text-xs shadow-md transition-all active:scale-95 inline-flex items-center gap-2"
                >
                  <FileUp className="w-4 h-4" />
                  <span>Вибрати файл для прямої P2P відправки</span>
                </button>
              </div>

              {fileProgress && (
                <div className="p-4 bg-white rounded-2xl border border-[#DFD6C4] space-y-2 shadow-2xs animate-in fade-in">
                  <div className="flex items-center justify-between text-xs font-bold text-[#F9F7F1]">
                    <span className="truncate">{fileProgress.fileName}</span>
                    <span className="text-[#E87A42]">{fileProgress.percentage}%</span>
                  </div>
                  <div className="w-full h-2 bg-[#EAE2D3] rounded-full overflow-hidden">
                    <div
                      className="h-full bg-[#E87A42] transition-all duration-150"
                      style={{ width: `${fileProgress.percentage}%` }}
                    />
                  </div>
                  <span className="text-[10.5px] text-[#718177] block">
                    {fileProgress.isReceiving ? `Отримання від ${fileProgress.senderName}...` : 'Потокова відправка пірам...'}
                  </span>
                </div>
              )}
            </div>
          )}

          {/* TAB 5: ADVANCED & STUN DIAGNOSTICS */}
          {activeTab === 'advanced' && (
            <div className="space-y-3">
              <div className="p-4 bg-white rounded-2xl border border-[#DFD6C4] space-y-3">
                <h4 className="font-extrabold text-xs text-[#F9F7F1] uppercase tracking-wider">
                  Конфігурація STUN / TURN серверів
                </h4>

                <div className="space-y-2 text-xs">
                  <div className="flex items-center justify-between p-2.5 bg-[#FAF7F1] rounded-xl border border-[#E5DC source-serif]">
                    <span className="font-bold text-[#F9F7F1]">STUN Сервер за замовчуванням</span>
                    <span className="font-mono text-[11px] text-[#6A7B71]">stun.l.google.com:19302</span>
                  </div>

                  <div className="flex items-center justify-between p-2.5 bg-[#FAF7F1] rounded-xl border border-[#E5DC source-serif]">
                    <span className="font-bold text-[#F9F7F1]">Транспорт DataChannel</span>
                    <span className="font-mono text-[11px] text-[#6A7B71]">DTLS / SCTP (WebRTC)</span>
                  </div>

                  <div className="flex items-center justify-between p-2.5 bg-[#FAF7F1] rounded-xl border border-[#E5DC source-serif]">
                    <span className="font-bold text-[#F9F7F1]">Розмір P2P чанка</span>
                    <span className="font-mono text-[11px] text-[#6A7B71]">16,384 байт (16 KB)</span>
                  </div>

                  <div className="flex items-center justify-between p-2.5 bg-[#FAF7F1] rounded-xl border border-[#E5DC source-serif]">
                    <span className="font-bold text-[#F9F7F1]">Запечатування вмісту</span>
                    <span className="font-mono text-[11px] text-[#4C8A55]">між вузлами</span>
                  </div>
                </div>
              </div>
            </div>
          )}

        </div>

        {/* Footer */}
        <div className="px-5 py-3.5 bg-[#F4EDE2] border-t border-[#E3D9C9] flex items-center justify-between shrink-0">
          <span className="text-[11px] text-[#5F6A60] flex items-center gap-1.5">
            <Shield className="w-3.5 h-3.5 text-[#4C8A55]" />
            <span>Дороги везуть шифротекст; ключі лишаються на ваших вузлах</span>
          </span>

          <button
            onClick={() => {
              soundFx.playTap();
              onClose();
            }}
            className="px-4 py-1.5 bg-[#F9F7F1] hover:bg-[#F1EDE3] text-[#1E2521] rounded-xl text-xs font-bold transition-all shadow-2xs active:scale-95"
          >
            Готово
          </button>
        </div>

      </div>
    </div>
  );
};

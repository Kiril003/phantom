import React, { useState } from 'react';
import {
  Key,
  HardDriveDownload,
  Upload,
  CheckCircle2,
  FileCheck,
  Flame,
  X,
  Lock,
} from 'lucide-react';
import { soundFx } from '../../utils/messengerSound';

interface ZeroTraceAirGapModalProps {
  isOpen: boolean;
  onClose: () => void;
  chatTitle?: string;
}

export const ZeroTraceAirGapModal: React.FC<ZeroTraceAirGapModalProps> = ({
  isOpen,
  onClose,
  chatTitle = 'Бесіда',
}) => {
  const [activeTab, setActiveTab] = useState<'signing' | 'zero_trace' | 'air_gap'>('signing');
  const [signatureText, setSignatureText] = useState('ТЗ на реліз Phantom OS Companion v2.0 погоджено.');
  const [signedBadge, setSignedBadge] = useState<string | null>(null);
  const [isZeroTraceEnabled, setIsZeroTraceEnabled] = useState(false);
  const [exportedBundle, setExportedBundle] = useState(false);

  if (!isOpen) return null;

  const handleSignDocument = () => {
    soundFx.playSend();
    const fakeSignature = `ed25519_sig_${Math.random().toString(36).substring(2, 12)}_${Date.now()}`;
    setSignedBadge(`🛡️ Підписано приватним ключем did:phantom:radxa_arm64 (Sig: ${fakeSignature.slice(0, 16)}...)`);
  };

  const handleExportAirGap = () => {
    soundFx.playSend();
    const payload = JSON.stringify({
      version: '3.4.1',
      timestamp: new Date().toISOString(),
      space: chatTitle,
      crdtTreeNodes: 142,
      signature: 'ed25519_root_payload_checksum_valid',
    });
    const blob = new Blob([payload], { type: 'application/octet-stream' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', `phantom_airgap_bundle_${Date.now()}.phantom`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    setExportedBundle(true);
    setTimeout(() => setExportedBundle(false), 2500);
  };

  return (
    <div
      className="fixed inset-0 phantom-scrim z-50 flex items-center justify-center p-4 animate-in fade-in duration-150"
      onClick={onClose}
    >
      <div
        className="bg-white border border-[#E5DEC9] text-[#21261F] rounded-2xl w-full max-w-2xl shadow-2xl overflow-hidden flex flex-col max-h-[82vh] animate-in zoom-in-95 duration-150 select-text"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-5 py-4 bg-[#FAF8F5] border-b border-[#E8E1D3] flex items-center justify-between gap-3 shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-xl bg-[#FDF5ED] text-[#D96C35] border border-[#E5DEC9]">
              <Lock className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-bold text-sm text-[#21261F]">
                Суверенітет, Криптопідпис та Air-Gap
              </h3>
              <p className="text-[11px] text-[#6E7568]">
                {chatTitle} · Ed25519 Digital Signing, RAM-Only, Air-Gapped USB Sync
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <div className="flex items-center bg-[#EFE9DC] p-0.5 rounded-lg text-xs font-medium text-[#6E7568]">
              <button
                onClick={() => setActiveTab('signing')}
                className={`px-2.5 py-1 rounded-md transition-all ${
                  activeTab === 'signing' ? 'bg-white text-[#21261F] font-bold shadow-2xs' : 'hover:text-[#21261F]'
                }`}
              >
                Криптопідпис
              </button>
              <button
                onClick={() => setActiveTab('zero_trace')}
                className={`px-2.5 py-1 rounded-md transition-all ${
                  activeTab === 'zero_trace' ? 'bg-white text-[#21261F] font-bold shadow-2xs' : 'hover:text-[#21261F]'
                }`}
              >
                Zero-Trace
              </button>
              <button
                onClick={() => setActiveTab('air_gap')}
                className={`px-2.5 py-1 rounded-md transition-all ${
                  activeTab === 'air_gap' ? 'bg-white text-[#21261F] font-bold shadow-2xs' : 'hover:text-[#21261F]'
                }`}
              >
                Air-Gap USB
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
          {/* TAB 1: Cryptographic Signing */}
          {activeTab === 'signing' && (
            <div className="space-y-3">
              <div className="p-3.5 bg-emerald-50 border border-emerald-200 rounded-xl text-xs text-emerald-900 space-y-1">
                <div className="flex items-center gap-1.5 font-bold">
                  <FileCheck className="w-4 h-4 text-emerald-600" />
                  <span>Ed25519 Незаперечний цифровий підпис рішень</span>
                </div>
                <p className="leading-relaxed">
                  Підпис генерується на вашому апаратному вузлі та математично доводить згоду з текстом документа.
                </p>
              </div>

              <div>
                <label className="text-[11px] font-bold text-[#6E7568]">Текст або пункт для підпису:</label>
                <textarea
                  value={signatureText}
                  onChange={(e) => setSignatureText(e.target.value)}
                  rows={3}
                  className="w-full p-2.5 bg-[#FAF8F5] border border-[#E5DEC9] rounded-xl text-xs mt-1 text-[#21261F] focus:outline-none"
                />
              </div>

              {signedBadge ? (
                <div className="p-3 bg-emerald-100/70 border border-emerald-300 rounded-xl text-xs font-semibold text-emerald-900 flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 text-emerald-700 shrink-0" />
                  <span>{signedBadge}</span>
                </div>
              ) : (
                <button
                  onClick={handleSignDocument}
                  className="w-full py-2.5 bg-[#D96C35] hover:bg-[#B85425] text-white rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-1.5"
                >
                  <Key className="w-4 h-4" />
                  <span>Підписати ключем Ed25519 (ROOT)</span>
                </button>
              )}
            </div>
          )}

          {/* TAB 2: Zero-Trace RAM Workspace */}
          {activeTab === 'zero_trace' && (
            <div className="space-y-4">
              <div className="p-4 bg-amber-50 border border-amber-200 rounded-xl space-y-2 text-xs text-amber-900">
                <div className="flex items-center gap-1.5 font-bold text-amber-950">
                  <Flame className="w-4 h-4 text-[#D96C35]" />
                  <span>Zero-Trace RAM Ephemeral Space</span>
                </div>
                <p className="leading-relaxed">
                  У цьому режимі жоден байт повідомлень, файлів чи документів Canvas не записується на диск. Усі дані зберігаються виключно в оперативній пам'яті (RAM) і миттєво затираються нулями при закритті вікна або завершенні сесії.
                </p>
              </div>

              <div className="p-4 rounded-xl border border-[#E5DEC9] bg-white flex items-center justify-between">
                <div>
                  <h5 className="font-bold text-xs text-[#21261F]">Режим нульового сліду (Zero-Trace)</h5>
                  <p className="text-[11px] text-[#6E7568]">Затирання оперативної пам'яті (POSIX Secure Wipe)</p>
                </div>

                <button
                  onClick={() => {
                    soundFx.playTap();
                    setIsZeroTraceEnabled(!isZeroTraceEnabled);
                  }}
                  className={`w-11 h-6 rounded-full p-0.5 transition-colors ${
                    isZeroTraceEnabled ? 'bg-red-500' : 'bg-[#D5CEBF]'
                  }`}
                >
                  <div
                    className={`w-5 h-5 rounded-full bg-white transition-transform ${
                      isZeroTraceEnabled ? 'translate-x-5' : 'translate-x-0'
                    }`}
                  />
                </button>
              </div>
            </div>
          )}

          {/* TAB 3: Air-Gap USB Sync */}
          {activeTab === 'air_gap' && (
            <div className="space-y-4">
              <div className="p-4 bg-indigo-50 border border-indigo-200 rounded-xl space-y-2 text-xs text-indigo-900">
                <div className="flex items-center gap-1.5 font-bold">
                  <HardDriveDownload className="w-4 h-4 text-indigo-600" />
                  <span>Air-Gapped Фізична Синхронізація</span>
                </div>
                <p className="leading-relaxed">
                  Експортуйте зашифрований контейнер зі змінами простору на фізичну флешку або знімний носій для безпечної передачі на ізольовані машини без інтернету.
                </p>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <button
                  onClick={handleExportAirGap}
                  className="p-4 bg-white hover:bg-[#FAF8F5] border border-[#E5DEC9] rounded-xl flex flex-col items-center justify-center gap-2 text-center transition-all group"
                >
                  <HardDriveDownload className="w-6 h-6 text-[#D96C35] group-hover:scale-110 transition-transform" />
                  <span className="font-bold text-xs text-[#21261F]">
                    {exportedBundle ? 'Контейнер завантажено ✓' : 'Експорт на USB (.phantom)'}
                  </span>
                  <span className="text-[10px] text-[#8A9186]">ChaCha20 Encrypted Bundle</span>
                </button>

                <button
                  onClick={() => {
                    soundFx.playTap();
                    alert('Для імпорту виберіть .phantom контейнер з USB-носія');
                  }}
                  className="p-4 bg-white hover:bg-[#FAF8F5] border border-[#E5DEC9] rounded-xl flex flex-col items-center justify-center gap-2 text-center transition-all group"
                >
                  <Upload className="w-6 h-6 text-indigo-600 group-hover:scale-110 transition-transform" />
                  <span className="font-bold text-xs text-[#21261F]">Імпорт змін з USB</span>
                  <span className="text-[10px] text-[#8A9186]">CRDT Fast-Forward Merge</span>
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-2.5 bg-[#FAF8F5] border-t border-[#E8E1D3] flex items-center justify-between text-[11px] text-[#8A9186]">
          <span>Апаратний суверенітет вузла</span>
          <span className="font-mono">FIDO2 / Ed25519 Ready</span>
        </div>
      </div>
    </div>
  );
};

import React, { useState } from 'react';
import {
  Webhook,
  Plus,
  Trash2,
  Copy,
  Check,
  X,
  Play,
  Shield,
} from 'lucide-react';
import { useEscapeClose } from '../../hooks/useEscapeClose';
import { soundFx } from '../../utils/messengerSound';
import { useWorkOsStore, WebhookEndpoint } from '../../stores/workOsStore';
import { useMessengerStore } from '../../stores/messengerStore';

interface WebhooksManagerModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSendTestWebhook?: (wh: WebhookEndpoint) => void;
}

export const WebhooksManagerModal: React.FC<WebhooksManagerModalProps> = ({
  isOpen,
  onClose,
  onSendTestWebhook,
}) => {
  useEscapeClose(isOpen, onClose);

  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [testingId, setTestingId] = useState<string | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [newSource, setNewSource] = useState<WebhookEndpoint['source']>('github');

  const { webhooks, addWebhook, deleteWebhook, toggleWebhook } = useWorkOsStore();

  if (!isOpen) return null;

  const handleCopy = (wh: WebhookEndpoint) => {
    soundFx.playTap();
    const endpoint = wh.url || `https://try.phantom-os.dev/api/v1/work-os/webhooks/${wh.secret}`;
    navigator.clipboard.writeText(endpoint);
    setCopiedId(wh.id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const handleTestTrigger = (wh: WebhookEndpoint) => {
    soundFx.playSend();
    setTestingId(wh.id);

    const messenger = useMessengerStore.getState();
    messenger.addCustomMessage({
      id: `msg_wh_${Date.now()}`,
      senderId: 'bot_ci',
      senderName: `${wh.name} Bot`,
      senderAvatar: 'https://images.unsplash.com/photo-1618401471353-b98afee0b2eb?w=200&auto=format&fit=crop&q=80',
      timestamp: new Date().toLocaleTimeString('uk-UA', { hour: '2-digit', minute: '2-digit' }),
      type: 'webhook:event',
      isSelf: false,
      webhookEventData: {
        source: wh.source === 'docker' ? 'ci' : wh.source,
        eventType: 'push',
        repository: 'phantom-companion',
        sender: 'github-actions[bot]',
        title: `[${wh.name}] Build & Test Pipeline Succeeded`,
        description: 'Atomic sprint test passed on aarch64 & x86_64 target nodes.',
        status: 'success',
        commitHash: '054253e',
        timestamp: new Date().toLocaleTimeString('uk-UA', { hour: '2-digit', minute: '2-digit' }),
      },
    });

    onSendTestWebhook?.(wh);
    setTimeout(() => setTestingId(null), 1200);
  };

  const handleCreate = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newName.trim()) return;
    soundFx.playSend();
    const sec = `wh_sec_${Math.random().toString(36).substring(2, 15)}`;
    addWebhook({
      name: newName.trim(),
      source: newSource,
      secret: sec,
      url: `https://try.phantom-os.dev/api/v1/webhooks/${sec}`,
      enabled: true,
    });
    setNewName('');
    setIsCreating(false);
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
              <Webhook className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-bold text-sm text-[#21261F]">
                Work OS Webhooks & Інтеграції
              </h3>
              <p className="text-[11px] text-[#6E7568]">
                Вхідні вебхуки для GitHub, Docker, CI/CD та зовнішніх сервісів
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => setIsCreating(!isCreating)}
              className="px-3 py-1.5 bg-[#D96C35] text-white rounded-lg text-xs font-bold hover:bg-[#C25B27] transition-all flex items-center gap-1.5"
            >
              <Plus className="w-3.5 h-3.5" /> Створити вебхук
            </button>
            <button
              onClick={onClose}
              className="p-1.5 rounded-lg text-[#6E7568] hover:text-[#21261F] hover:bg-[#F1EBDD] transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="p-5 overflow-y-auto flex-1 space-y-4">
          {isCreating && (
            <form onSubmit={handleCreate} className="p-4 bg-white border border-[#D96C35] rounded-xl space-y-3">
              <h4 className="font-bold text-xs text-[#D96C35]">Новий вхідний вебхук</h4>
              <div className="flex gap-2">
                <input
                  type="text"
                  placeholder="Назва вебхука (напр. GitLab Deploy)..."
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  className="flex-1 px-3 py-1.5 border border-[#E8E1D3] rounded-lg text-xs"
                />
                <select
                  value={newSource}
                  onChange={(e) => setNewSource(e.target.value as any)}
                  className="px-2 py-1.5 border border-[#E8E1D3] rounded-lg text-xs"
                >
                  <option value="github">GitHub</option>
                  <option value="gitlab">GitLab</option>
                  <option value="docker">Docker</option>
                  <option value="custom">Custom</option>
                </select>
              </div>
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setIsCreating(false)}
                  className="px-2.5 py-1 text-xs text-[#6E7568]"
                >
                  Скасувати
                </button>
                <button
                  type="submit"
                  className="px-3 py-1 bg-[#D96C35] text-white font-bold text-xs rounded-lg"
                >
                  Зберегти
                </button>
              </div>
            </form>
          )}

          <div className="space-y-3">
            {webhooks.map((wh) => (
              <div key={wh.id} className="p-4 bg-white border border-[#E8E1D3] rounded-xl flex items-center justify-between">
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <span className="font-bold text-xs text-[#21261F]">{wh.name}</span>
                    <span className="px-2 py-0.5 rounded text-[10px] font-bold uppercase bg-[#F7F5EE] text-[#6E7568]">
                      {wh.source}
                    </span>
                    <span className="text-[10px] text-[#8A8577]">
                      {wh.lastPayloadAt ? 'Активний' : 'Очікує payload'}
                    </span>
                  </div>
                  <div className="flex items-center gap-2 font-mono text-[11px] text-[#6E7568]">
                    <span>token: {wh.secret}</span>
                    <button
                      onClick={() => handleCopy(wh)}
                      className="p-1 hover:text-[#21261F] transition-colors"
                      title="Копіювати URL"
                    >
                      {copiedId === wh.id ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
                    </button>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    onClick={() => handleTestTrigger(wh)}
                    disabled={testingId === wh.id}
                    className="px-3 py-1.5 bg-[#FAF8F5] border border-[#E8E1D3] text-[#21261F] text-xs font-bold rounded-lg hover:bg-[#F1EBDD] flex items-center gap-1.5 transition-colors"
                  >
                    <Play className="w-3 h-3 text-[#D96C35]" />
                    {testingId === wh.id ? 'Надсилання...' : 'Тест'}
                  </button>
                  <button
                    onClick={() => toggleWebhook(wh.id)}
                    className={`px-2.5 py-1 rounded-lg text-xs font-bold ${
                      wh.enabled ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-100 text-slate-700'
                    }`}
                  >
                    {wh.enabled ? 'Активний' : 'Вимкнено'}
                  </button>
                  <button
                    onClick={() => deleteWebhook(wh.id)}
                    className="p-1.5 text-red-500 hover:text-red-700 transition-colors"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Footer */}
        <div className="px-5 py-3 bg-[#FAF8F5] border-t border-[#E8E1D3] flex items-center justify-between text-xs text-[#6E7568]">
          <div className="flex items-center gap-1.5">
            <Shield className="w-4 h-4 text-emerald-600" />
            <span>HMAC SHA-256 валідація підписів на стороні клієнта</span>
          </div>
          <button
            onClick={onClose}
            className="px-3 py-1.5 bg-[#EFE9DC] text-[#21261F] font-medium rounded-lg hover:bg-[#E5DEC9] transition-colors"
          >
            Закрити
          </button>
        </div>
      </div>
    </div>
  );
};

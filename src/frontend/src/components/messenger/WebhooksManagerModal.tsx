import React, { useState } from 'react';
import {
  Webhook,
  Plus,
  Trash2,
  Copy,
  Check,
  X,
  Play,
  Code,
  Shield,
} from 'lucide-react';
import { useEscapeClose } from '../../hooks/useEscapeClose';
import { soundFx } from '../../utils/messengerSound';

interface WebhookItem {
  id: string;
  name: string;
  source: 'github' | 'gitlab' | 'docker' | 'ci' | 'custom';
  secretToken: string;
  channelId: string;
  channelName: string;
  eventsCount: number;
  lastEventAt?: string;
  isActive: boolean;
}

interface WebhooksManagerModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSendTestWebhook?: (wh: WebhookItem) => void;
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
  const [newSource] = useState<WebhookItem['source']>('github');

  const [webhooks, setWebhooks] = useState<WebhookItem[]>([
    {
      id: 'wh_gh_1',
      name: 'GitHub CI/CD Main Branch',
      source: 'github',
      secretToken: 'wh_sec_99a8b7c6d5e4f3a2b1c0',
      channelId: 'chat_dev',
      channelName: 'Dev Stream',
      eventsCount: 142,
      lastEventAt: '12 хв тому',
      isActive: true,
    },
    {
      id: 'wh_doc_2',
      name: 'Docker Build & Deploy Bot',
      source: 'docker',
      secretToken: 'wh_sec_4f3e2d1c0b9a8f7e6d5c',
      channelId: 'chat_general',
      channelName: 'General',
      eventsCount: 38,
      lastEventAt: 'Вчора, 19:40',
      isActive: true,
    },
  ]);

  if (!isOpen) return null;

  const handleCopy = (wh: WebhookItem) => {
    soundFx.playTap();
    const endpoint = `https://try.phantom-os.dev/api/v1/work-os/webhooks/${wh.secretToken}`;
    navigator.clipboard.writeText(endpoint);
    setCopiedId(wh.id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const handleTestTrigger = (wh: WebhookItem) => {
    soundFx.playSend();
    setTestingId(wh.id);
    onSendTestWebhook?.(wh);
    setTimeout(() => setTestingId(null), 1200);
  };

  const handleCreate = () => {
    if (!newName.trim()) return;
    soundFx.playSend();
    const newWh: WebhookItem = {
      id: `wh_${Date.now()}`,
      name: newName.trim(),
      source: newSource,
      secretToken: `wh_sec_${Math.random().toString(36).substring(2, 15)}`,
      channelId: 'chat_current',
      channelName: 'Поточний канал',
      eventsCount: 0,
      isActive: true,
    };
    setWebhooks([...webhooks, newWh]);
    setNewName('');
    setIsCreating(false);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm animate-in fade-in duration-150"
      onClick={onClose}
    >
      <div
        className="w-full max-w-2xl bg-[#FDFCF9] border border-[#E5DEC9] rounded-3xl shadow-2xl overflow-hidden animate-in zoom-in-95 duration-150 text-[#21261F]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="p-5 bg-[#F7F4EC] border-b border-[#E5DEC9] flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-[#FDF5ED] border border-[#EADCC8] flex items-center justify-center text-[#D96C35] shadow-sm">
              <Webhook className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-bold text-[#21261F]">
                Локальні Webhook-хаби та інтеграції
              </h3>
              <p className="text-xs text-[#6E7568] mt-0.5">
                Пряма трансляція подій з GitHub, GitLab, CI/CD та Prometheus у робочі чати
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="p-1.5 hover:bg-[#EAE4D7] rounded-xl text-[#6E7568] transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5 space-y-4 max-h-[440px] overflow-y-auto custom-scrollbar">
          {webhooks.map((wh) => (
            <div
              key={wh.id}
              className="p-4 rounded-2xl bg-[#FAF7F0] border border-[#E5DEC9] space-y-3 hover:border-[#D96C35]/50 transition-all"
            >
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-2.5">
                  <div className="p-2 rounded-xl bg-white border border-[#E5DEC9] text-[#D96C35]">
                    <Code className="w-4 h-4" />
                  </div>
                  <div>
                    <h4 className="text-[13.5px] font-bold text-[#21261F]">{wh.name}</h4>
                    <p className="text-[11px] text-[#6E7568]">
                      Цільовий чат: <b>{wh.channelName}</b> • Оброблено подій: {wh.eventsCount}
                    </p>
                  </div>
                </div>

                <span className="text-[10.5px] font-bold uppercase tracking-wider px-2.5 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-300">
                  Активний
                </span>
              </div>

              <div className="flex items-center justify-between p-2.5 rounded-xl bg-white border border-[#E5DEC9] text-xs font-mono">
                <span className="truncate text-[#6E7568] text-[11px]">
                  https://try.phantom-os.dev/api/v1/work-os/webhooks/{wh.secretToken}
                </span>

                <button
                  onClick={() => handleCopy(wh)}
                  className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-[#FAF7F0] hover:bg-[#FDF5ED] border border-[#E5DEC9] text-[11px] font-sans font-bold text-[#D96C35] shrink-0 ml-2"
                >
                  {copiedId === wh.id ? (
                    <>
                      <Check className="w-3.5 h-3.5" /> Скопійовано!
                    </>
                  ) : (
                    <>
                      <Copy className="w-3.5 h-3.5" /> Копіювати URL
                    </>
                  )}
                </button>
              </div>

              <div className="flex items-center justify-between pt-1 border-t border-[#EAE4D7] text-xs">
                <span className="text-[11px] text-[#8A9186]">
                  {wh.lastEventAt ? `Остання подія: ${wh.lastEventAt}` : 'Очікує першої події'}
                </span>

                <div className="flex items-center gap-2">
                  <button
                    onClick={() => handleTestTrigger(wh)}
                    disabled={testingId === wh.id}
                    className="flex items-center gap-1 px-3 py-1 rounded-lg bg-white hover:bg-[#FDF5ED] border border-[#E5DEC9] text-[#21261F] text-xs font-semibold"
                  >
                    <Play className="w-3 h-3 text-emerald-600" />
                    <span>{testingId === wh.id ? 'Надсилаю…' : 'Тест подія'}</span>
                  </button>
                  <button
                    onClick={() => setWebhooks(webhooks.filter((w) => w.id !== wh.id))}
                    className="p-1 hover:bg-red-50 text-red-500 rounded-lg"
                    title="Видалити вебхук"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            </div>
          ))}

          {isCreating ? (
            <div className="p-4 rounded-2xl border border-[#D96C35] bg-[#FDF9F3] space-y-3">
              <h5 className="text-xs font-bold text-[#21261F]">Нова Webhook інтеграція</h5>
              <input
                type="text"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="Назва вебхука (напр. Sentry Alerts, GitLab CI)..."
                className="w-full p-2.5 bg-white border border-[#E5DEC9] rounded-xl text-xs text-[#21261F] focus:outline-none focus:border-[#D96C35]"
                autoFocus
              />
              <div className="flex items-center justify-end gap-2">
                <button
                  onClick={() => setIsCreating(false)}
                  className="px-3 py-1.5 text-xs text-[#6E7568]"
                >
                  Скасувати
                </button>
                <button
                  onClick={handleCreate}
                  className="px-4 py-1.5 rounded-xl bg-[#D96C35] hover:bg-[#B85425] text-white text-xs font-bold shadow-sm"
                >
                  Створити інбокс
                </button>
              </div>
            </div>
          ) : (
            <button
              onClick={() => setIsCreating(true)}
              className="w-full py-3 border-2 border-dashed border-[#E5DEC9] hover:border-[#D96C35] rounded-2xl text-xs font-semibold text-[#6E7568] hover:text-[#D96C35] hover:bg-[#FDF5ED] transition-all flex items-center justify-center gap-2"
            >
              <Plus className="w-4 h-4" />
              <span>Додати новий вхідний Webhook</span>
            </button>
          )}
        </div>

        <div className="p-4 bg-[#F7F4EC] border-t border-[#E5DEC9] flex items-center justify-between text-xs text-[#6E7568]">
          <span className="flex items-center gap-1.5">
            <Shield className="w-4 h-4 text-[#D96C35]" />
            Автоматична перевірка HMAC SHA256 підписів
          </span>
          <button
            onClick={onClose}
            className="px-4 py-1.5 rounded-xl bg-[#FAF7F0] border border-[#E5DEC9] hover:bg-white text-xs font-bold text-[#21261F]"
          >
            Закрити
          </button>
        </div>
      </div>
    </div>
  );
};

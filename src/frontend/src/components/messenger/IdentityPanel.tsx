import React, { useEffect, useState } from 'react';
import { AlertTriangle, Check, Copy, ShieldCheck, UserPlus } from 'lucide-react';
import { messengerApi } from '../../services/messengerApi';
import type { NodeContact, NodeIdentity } from '../../services/messengerApi';
import { soundFx } from '../../utils/messengerSound';

// Ключі вузла і звірка співрозмовника. Замок тут зʼявляється тільки після
// того, як двоє прочитали одне одному число вголос — підпис у ключі цього
// не замінює: зловмисник підпише власний ключ не гірше.
export const IdentityPanel: React.FC = () => {
  const [identity, setIdentity] = useState<NodeIdentity | null>(null);
  const [contacts, setContacts] = useState<NodeContact[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [bundleText, setBundleText] = useState('');
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    void (async () => {
      try {
        setIdentity(await messengerApi.identity());
        setContacts(await messengerApi.listContacts());
      } catch {
        setError('Вузол не відповів — ключі й контакти недоступні.');
      }
    })();
  }, []);

  const copyBundle = async () => {
    if (!identity) return;
    await navigator.clipboard.writeText(JSON.stringify(identity.bundle));
    soundFx.playTap();
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const submitContact = async () => {
    setError(null);
    try {
      const parsed = JSON.parse(bundleText);
      const contact = await messengerApi.addContact(name.trim() || 'Без імені', parsed);
      setContacts((prev) => (prev.some((c) => c.id === contact.id) ? prev : [...prev, contact]));
      setAdding(false);
      setName('');
      setBundleText('');
    } catch (err) {
      setError(
        err instanceof SyntaxError
          ? 'Це не схоже на ключ: очікується JSON, скопійований у співрозмовника.'
          : 'Вузол не прийняв ключ — підпис не збігається.',
      );
    }
  };

  const markVerified = async (id: string) => {
    const updated = await messengerApi.verifyContact(id);
    setContacts((prev) => prev.map((c) => (c.id === id ? updated : c)));
    soundFx.playTap();
  };

  return (
    <div className="space-y-3">
      <div className="p-3 bg-[#F9F7F1] rounded-2xl border border-[#E6DFD3] space-y-2">
        <span className="text-[11px] font-bold text-[#4B584F] uppercase tracking-wider">
          Ключ цього вузла
        </span>
        {identity ? (
          <>
            <code className="block text-[10.5px] font-mono text-[#5F6A60] break-all">
              {identity.node_id}
            </code>
            <button
              onClick={copyBundle}
              className="flex items-center gap-1.5 text-[11px] font-bold text-[#C25925] active:scale-95 transition-transform"
            >
              {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
              <span>{copied ? 'Скопійовано' : 'Скопіювати для співрозмовника'}</span>
            </button>
          </>
        ) : (
          <span className="text-[10.5px] text-[#7A6A55]">Читаю ключі вузла…</span>
        )}
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-[11px] font-bold text-[#4B584F] uppercase tracking-wider">
            Співрозмовники
          </span>
          <button
            onClick={() => setAdding((v) => !v)}
            className="flex items-center gap-1 text-[11px] font-bold text-[#C25925] active:scale-95 transition-transform"
          >
            <UserPlus className="w-3.5 h-3.5" />
            <span>Додати</span>
          </button>
        </div>

        {adding && (
          <div className="p-3 bg-[#F9F7F1] rounded-2xl border border-[#E6DFD3] space-y-2">
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Імʼя"
              className="w-full px-2.5 py-1.5 text-[12px] rounded-xl border border-[#E6DFD3] bg-white"
            />
            <textarea
              value={bundleText}
              onChange={(e) => setBundleText(e.target.value)}
              placeholder="Ключ, який дав співрозмовник"
              rows={3}
              className="w-full px-2.5 py-1.5 text-[11px] font-mono rounded-xl border border-[#E6DFD3] bg-white"
            />
            <button
              onClick={submitContact}
              className="px-3 py-1.5 rounded-xl bg-[#E87A42] text-white text-[11px] font-bold active:scale-95 transition-transform"
            >
              Звести сесію
            </button>
          </div>
        )}

        {contacts.length === 0 && !adding && (
          <span className="text-[10.5px] text-[#7A6A55] block">
            Ще нікого. Обміняйтеся ключами з рук у руки — і зможете писати одне одному.
          </span>
        )}

        {contacts.map((c) => (
          <div
            key={c.id}
            className="p-3 bg-[#F9F7F1] rounded-2xl border border-[#E6DFD3] space-y-1.5"
          >
            <div className="flex items-center justify-between gap-2">
              <span className="text-[12px] font-bold text-[#1E2521]">{c.display_name}</span>
              {c.verified ? (
                <span className="flex items-center gap-1 text-[10px] font-bold text-[#3F7A4B]">
                  <ShieldCheck className="w-3.5 h-3.5" />
                  Звірено
                </span>
              ) : (
                <span className="flex items-center gap-1 text-[10px] font-bold text-[#B45309]">
                  <AlertTriangle className="w-3.5 h-3.5" />
                  Не звірено
                </span>
              )}
            </div>
            <code className="block text-[10.5px] font-mono text-[#5F6A60] leading-relaxed">
              {c.safety_number_pretty}
            </code>
            {!c.verified && (
              <>
                <span className="text-[10px] text-[#7A6A55] block leading-relaxed">
                  Прочитайте це число одне одному голосом. Збіглося — натисніть нижче.
                  Розійшлося — між вами хтось є.
                </span>
                <button
                  onClick={() => markVerified(c.id)}
                  className="text-[11px] font-bold text-[#C25925] active:scale-95 transition-transform"
                >
                  Число збіглося
                </button>
              </>
            )}
          </div>
        ))}
      </div>

      {error && (
        <div className="p-2.5 bg-[#FDF6EC] rounded-xl border border-[#EBD9BE]">
          <span className="text-[10.5px] text-[#8C5A1A]">{error}</span>
        </div>
      )}
    </div>
  );
};

export default IdentityPanel;

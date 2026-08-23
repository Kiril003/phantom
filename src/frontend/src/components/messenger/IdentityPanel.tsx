import React, { useEffect, useState } from 'react';
import { AlertTriangle, Check, Copy, QrCode, ShieldCheck, UserPlus } from 'lucide-react';
import QRCode from 'qrcode';
import { QrScanner } from './QrScanner';
import { InviteCard } from './InviteCard';
import { messengerApi } from '../../services/messengerApi';
import type { NodeContact, NodeIdentity } from '../../services/messengerApi';
import { soundFx } from '../../utils/messengerSound';
import { parseInvite } from '../../utils/messengerInvite';
import { SafetyVerifyBlock } from './VerifyContact';

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
  const [address, setAddress] = useState('');
  const [copied, setCopied] = useState(false);
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [showQr, setShowQr] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [inviting, setInviting] = useState(false);

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

  // Малюємо справжній QR із стислого ключа. Той, що стояв тут раніше в іншому
  // місці застосунку, був сіткою 6×6 за формулою i % 2 === 0 && i % 3 === 0 —
  // його неможливо було відсканувати в принципі.
  useEffect(() => {
    if (!identity || !showQr) return;
    void QRCode.toDataURL(identity.compact, {
      errorCorrectionLevel: 'M',
      margin: 1,
      width: 260,
      color: { dark: '#1E2521', light: '#F9F7F1' },
    })
      .then(setQrDataUrl)
      .catch(() => setQrDataUrl(null));
  }, [identity, showQr]);

  const copyBundle = async () => {
    if (!identity) return;
    await navigator.clipboard.writeText(identity.compact);
    soundFx.playTap();
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const submitContact = async () => {
    setError(null);
    try {
      // Приймаємо і запрошення одним рядком, і голий ключ, і давній JSON.
      const found = parseInvite(bundleText);
      if (!found) throw new SyntaxError('не запрошення');
      const key = found.kind === 'bundle' ? { bundle: found.bundle } : { compact: found.compact };
      const contact = await messengerApi.addContact(
        name.trim() || (found.kind === 'invite' && found.name.trim()) || 'Без імені',
        key,
        (found.kind === 'invite' && found.address) || address.trim(),
      );
      setContacts((prev) => (prev.some((c) => c.id === contact.id) ? prev : [...prev, contact]));
      setAdding(false);
      setName('');
      setBundleText('');
      setAddress('');
    } catch (err) {
      setError(
        err instanceof SyntaxError
          ? 'Це не схоже на запрошення чи ключ — вставте рядок цілком, як прийшов.'
          : 'Вузол не прийняв ключ — підпис не збігається.',
      );
    }
  };

  return (
    <div className="space-y-3">
      {inviting ? (
        <InviteCard onClose={() => setInviting(false)} />
      ) : (
        <button
          onClick={() => {
            soundFx.playTap();
            setInviting(true);
          }}
          data-testid="identity-make-invite"
          className="w-full px-3.5 py-3 rounded-2xl bg-[#F9F7F1] border border-[#DDD4C4] flex items-center gap-2.5 text-left hover:bg-[#FAF6EE] transition-colors active:scale-98"
        >
          <UserPlus className="w-4.5 h-4.5 text-[#C25925] shrink-0" strokeWidth={2} />
          <span className="flex-1 min-w-0">
            <span className="text-[13px] font-extrabold text-[#1E2521] block leading-tight">
              Запросити людину
            </span>
            <span className="text-[12px] text-[#5F6A60] block leading-tight mt-0.5">
              Один рядок із ключем, адресою та вашим імʼям
            </span>
          </span>
        </button>
      )}

      <div className="p-3 bg-[#F9F7F1] rounded-2xl border border-[#E6DFD3] space-y-2">
        <span className="text-[11px] font-bold text-[#7A8479] uppercase tracking-wider">
          Ключ цього вузла
        </span>
        {identity ? (
          <>
            <code className="block text-[10.5px] font-mono text-[#5F6A60] break-all">
              {identity.node_id}
            </code>
            <div className="flex items-center gap-3">
              <button
                onClick={copyBundle}
                className="flex items-center gap-1.5 text-[11px] font-bold text-[#C25925] active:scale-95 transition-transform"
              >
                {copied ? <Check className="w-3.5 h-3.5" strokeWidth={1.75} /> : <Copy className="w-3.5 h-3.5" strokeWidth={1.75} />}
                <span>{copied ? 'Скопійовано' : 'Скопіювати'}</span>
              </button>
              <button
                onClick={() => setShowQr((v) => !v)}
                className="flex items-center gap-1.5 text-[11px] font-bold text-[#C25925] active:scale-95 transition-transform"
              >
                <QrCode className="w-3.5 h-3.5" strokeWidth={1.75} />
                <span>{showQr ? 'Сховати код' : 'Показати код'}</span>
              </button>
            </div>
            {showQr && (
              <div className="pt-1">
                {qrDataUrl ? (
                  <>
                    <img
                      src={qrDataUrl}
                      alt="Ключ вузла у вигляді QR"
                      className="rounded-xl border border-[#E6DFD3]"
                      width={200}
                      height={200}
                    />
                    <span className="text-[10px] text-[#7A6A55] block mt-1.5 leading-relaxed">
                      Дайте співрозмовнику відсканувати. Це лише публічна частина —
                      нею можна ділитися відкрито.
                    </span>
                  </>
                ) : (
                  <span className="text-[10.5px] text-[#7A6A55]">Малюю код…</span>
                )}
              </div>
            )}
          </>
        ) : (
          <span className="text-[10.5px] text-[#7A6A55]">Читаю ключі вузла…</span>
        )}
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-[11px] font-bold text-[#7A8479] uppercase tracking-wider">
            Співрозмовники
          </span>
          <button
            onClick={() => setAdding((v) => !v)}
            className="flex items-center gap-1 text-[11px] font-bold text-[#C25925] active:scale-95 transition-transform"
          >
            <UserPlus className="w-3.5 h-3.5" strokeWidth={1.75} />
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
            {scanning ? (
              <QrScanner
                onFound={(text) => {
                  setBundleText(text);
                  setScanning(false);
                }}
                onCancel={() => setScanning(false)}
              />
            ) : (
              <button
                onClick={() => setScanning(true)}
                className="flex items-center gap-1.5 text-[11px] font-bold text-[#C25925] active:scale-95 transition-transform"
              >
                <QrCode className="w-3.5 h-3.5" strokeWidth={1.75} />
                <span>Відсканувати код співрозмовника</span>
              </button>
            )}
            <input
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              placeholder="Адреса вузла, якщо відома (напр. 192.168.1.5:8000)"
              className="w-full px-2.5 py-1.5 text-[12px] rounded-xl border border-[#E6DFD3] bg-white"
            />
            <textarea
              value={bundleText}
              onChange={(e) => setBundleText(e.target.value)}
              placeholder="Запрошення або ключ — вставте рядок цілком"
              rows={3}
              className="w-full px-2.5 py-1.5 text-[11px] font-mono rounded-xl border border-[#E6DFD3] bg-white"
            />
            <button
              onClick={submitContact}
              className="px-3 py-1.5 rounded-xl bg-[#E87A42] text-[#1E2521] text-[11px] font-bold active:scale-95 transition-transform"
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
                  <ShieldCheck className="w-3.5 h-3.5" strokeWidth={1.75} />
                  Звірено
                </span>
              ) : (
                <span className="flex items-center gap-1 text-[10px] font-bold text-[#B45309]">
                  <AlertTriangle className="w-3.5 h-3.5" strokeWidth={1.75} />
                  Не звірено
                </span>
              )}
            </div>
            <span className="text-[10px] text-[#7A6A55] block">
              {c.peer_address
                ? `Пряма адреса: ${c.peer_address}`
                : 'Прямої адреси немає — повідомлення чекатимуть на ретранслятор.'}
            </span>
            <SafetyVerifyBlock
              contact={c}
              onVerified={(updated) =>
                setContacts((prev) => prev.map((x) => (x.id === updated.id ? updated : x)))
              }
            />
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

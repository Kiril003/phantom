import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  ShieldCheck,
  ShieldAlert,
  AlertTriangle,
  ChevronDown,
  ChevronUp,
  Pencil,
  Eraser,
  QrCode,
  ScanLine,
  Trash2,
  X,
  Check,
} from 'lucide-react';
import QRCode from 'qrcode';
import { QrScanner } from './QrScanner';
import { messengerApi } from '../../services/messengerApi';
import type { NodeContact } from '../../services/messengerApi';
import { soundFx } from '../../utils/messengerSound';

// У код кладемо число звірки, а не ключ: звіряються саме числа. Префікс
// потрібен, щоб відрізнити його від QR з ключовим бандлом у панелі ідентичності.
const SAFETY_QR_PREFIX = 'phantom-safety:';

// Порівнюємо голі цифри: пробіли, префікс і переноси в різних збірках можуть
// відрізнятись, а число — ні.
const digitsOf = (text: string): string => text.replace(/\D/g, '');

type CompareResult = 'match' | 'mismatch' | 'unreadable';

// Вузол приходить сирим хексом — людині показуємо короткий людяний ярлик,
// повний ключ лишається в title для наведення.
const humanNode = (hex?: string | null): string =>
  hex ? `Вузол ${hex.slice(0, 8)}…` : 'Вузол ще невідомий';

// Звірка одного контакту: число 12×5, підказка і кнопка підтвердження.
// Живе тут, щоб і панель ідентичності, і шапка чату звіряли однаково.
export const SafetyVerifyBlock: React.FC<{
  contact: NodeContact;
  onVerified: (contact: NodeContact) => void;
  onDismiss?: () => void;
}> = ({ contact, onVerified, onDismiss }) => {
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const [panel, setPanel] = useState<'none' | 'qr' | 'scan'>('none');
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [compared, setCompared] = useState<CompareResult | null>(null);
  const [typed, setTyped] = useState('');
  const [helpOpen, setHelpOpen] = useState(false);

  const mine = digitsOf(contact.safety_number);

  useEffect(() => {
    if (panel !== 'qr') return;
    void QRCode.toDataURL(`${SAFETY_QR_PREFIX}${mine}`, {
      errorCorrectionLevel: 'M',
      margin: 1,
      width: 220,
      color: { dark: '#1E2521', light: '#F9F7F1' },
    })
      .then(setQrDataUrl)
      .catch(() => setQrDataUrl(null));
  }, [panel, mine]);

  const confirm = async () => {
    setBusy(true);
    setFailed(false);
    try {
      const updated = await messengerApi.verifyContact(contact.id);
      soundFx.playTap();
      onVerified(updated);
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  };

  // Скан і вставлене руками число йдуть однією дорогою. Чужий QR (наприклад,
  // ключовий бандл) — це не «числа різні», а «це не число»: плутати ці два
  // стани не можна, бо перший означає посередника, а другий — не той код.
  const compareWith = (raw: string) => {
    const seen = digitsOf(raw);
    if (!seen || seen.length !== mine.length) {
      setCompared('unreadable');
      return;
    }
    if (seen !== mine) {
      setCompared('mismatch');
      return;
    }
    setCompared('match');
    void confirm();
  };

  return (
    <div className="space-y-1.5">
      <code className="block text-[10.5px] font-mono text-[#5F6A60] leading-relaxed break-words">
        {contact.safety_number_pretty}
      </code>
      {contact.verified ? (
        <span className="inline-flex items-center gap-1 text-[10px] font-bold text-[#3F7A4B]">
          <ShieldCheck className="w-3.5 h-3.5" />
          Звірено голосом
        </span>
      ) : (
        <>
          <span className="text-[10px] text-[#7A6A55] block leading-relaxed">
            Прочитайте це число одне одному голосом. Збіглося — підтвердьте.
            Розійшлося — між вами хтось є.
          </span>

          {/* Читати вголос 60 цифр здатні не всі й не завжди — той самий
              результат дає звірка кодом, і вона ще й порівнює за вас. */}
          <div className="pt-0.5 space-y-1.5" data-safety-qr>
            <button
              onClick={() => {
                setPanel((v) => (v === 'none' ? 'qr' : 'none'));
                setCompared(null);
              }}
              className="flex items-center gap-1.5 text-[11px] font-bold text-[#C25925] active:scale-95 transition-transform"
            >
              <QrCode className="w-3.5 h-3.5" />
              <span>Порівняти QR-кодом</span>
              {panel === 'none' ? (
                <ChevronDown className="w-3 h-3" />
              ) : (
                <ChevronUp className="w-3 h-3" />
              )}
            </button>

            {panel === 'qr' && (
              <div className="space-y-1.5" data-safety-qr-open>
                <div className="p-2 bg-[#F9F7F1] rounded-xl border border-[#E6DFD3] flex flex-col items-center gap-1.5">
                  {qrDataUrl ? (
                    <img
                      src={qrDataUrl}
                      alt="QR власного числа безпеки"
                      className="w-full max-w-[190px] rounded-lg"
                    />
                  ) : (
                    <span className="text-[10px] text-[#7A6A55] py-6">Малюю код…</span>
                  )}
                  <span className="text-[10px] text-[#7A6A55] leading-relaxed text-center">
                    Це ваше число цієї розмови. Покажіть екран співрозмовнику —
                    хай наведе камеру.
                  </span>
                </div>
                <button
                  onClick={() => {
                    setPanel('scan');
                    setCompared(null);
                  }}
                  className="flex items-center gap-1.5 text-[11px] font-bold text-[#C25925] active:scale-95 transition-transform"
                >
                  <ScanLine className="w-3.5 h-3.5" />
                  <span>Сканувати код співрозмовника</span>
                </button>
              </div>
            )}

            {panel === 'scan' && (
              <div className="space-y-1.5" data-safety-scan-open>
                <QrScanner onFound={compareWith} onCancel={() => setPanel('qr')} />
                {/* Камери може не бути — тоді число вводять руками, як і диктували б голосом. */}
                <div className="flex items-center gap-1.5">
                  <input
                    value={typed}
                    onChange={(e) => setTyped(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') compareWith(typed);
                    }}
                    placeholder="…або впишіть число співрозмовника"
                    data-safety-manual
                    className="flex-1 min-w-0 px-2 py-1 text-[11px] rounded-lg border border-[#E6DFD3] bg-white focus:outline-none focus:border-[#E87A42]"
                  />
                  <button
                    onClick={() => compareWith(typed)}
                    data-safety-compare-btn
                    className="shrink-0 text-[11px] font-bold text-[#C25925] active:scale-95 transition-transform"
                  >
                    Порівняти
                  </button>
                </div>
              </div>
            )}

            {compared === 'match' && (
              <div
                data-safety-compare="match"
                className="p-2 bg-[#F0F5EE] rounded-xl border border-[#CBDDC4] flex items-start gap-1.5"
              >
                <ShieldCheck className="w-3.5 h-3.5 text-[#3F7A4B] mt-0.5 shrink-0" />
                <span className="text-[10.5px] text-[#3F5F3B] leading-relaxed font-semibold">
                  Числа збіглися — це справді ваш співрозмовник. Позначаю звірку.
                </span>
              </div>
            )}

            {compared === 'mismatch' && (
              <div
                data-safety-compare="mismatch"
                className="p-2.5 bg-[#F7ECE7] rounded-xl border border-[#E0B4A6] flex items-start gap-1.5"
              >
                <ShieldAlert className="w-4 h-4 text-[#B4432E] mt-0.5 shrink-0" />
                <span className="text-[10.5px] text-[#8E3520] leading-relaxed">
                  <b className="font-bold">ЧИСЛА РІЗНІ — між вами хтось є.</b> Не
                  підтверджуйте. Спробуйте інший канал звʼязку (особисто/телефоном) і
                  порівняйте ще раз.
                </span>
              </div>
            )}

            {compared === 'unreadable' && (
              <div
                data-safety-compare="unreadable"
                className="p-2 bg-[#FDF6EC] rounded-xl border border-[#EBD9BE] flex items-start gap-1.5"
              >
                <AlertTriangle className="w-3.5 h-3.5 text-[#B45309] mt-0.5 shrink-0" />
                <span className="text-[10.5px] text-[#8C5A1A] leading-relaxed">
                  Це не число безпеки — код не з тієї картки. Нічого не сталося:
                  наведіть камеру на екран звірки співрозмовника.
                </span>
              </div>
            )}
          </div>

          <div className="flex items-center gap-3 pt-0.5">
            <button
              onClick={confirm}
              disabled={busy}
              className="text-[11px] font-bold text-[#C25925] active:scale-95 transition-transform disabled:opacity-50"
            >
              {busy ? 'Звіряю…' : 'Підтвердити'}
            </button>
            {onDismiss && (
              <button
                onClick={onDismiss}
                className="text-[11px] font-semibold text-[#8A9186] hover:text-[#5F6A60] active:scale-95 transition-transform"
              >
                Ще ні
              </button>
            )}
          </div>
          {failed && (
            <span className="text-[10px] text-[#B4432E] block">
              Вузол не прийняв звірку — спробуйте ще раз.
            </span>
          )}
        </>
      )}

      {/* Стоїть завжди: людина має знати відповідь до того, як побачить
          розбіжність, а не шукати її в паніці. */}
      <div className="pt-1 border-t border-[#E8E1D3]">
        <button
          onClick={() => setHelpOpen((v) => !v)}
          data-safety-help
          className="flex items-center gap-1 text-[10px] font-semibold text-[#7A6A55] hover:text-[#5F6A60] transition-colors"
        >
          <span>Що робити, якщо розійшлося?</span>
          {helpOpen ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
        </button>
        {helpOpen && (
          <p className="mt-1 text-[10px] text-[#7A6A55] leading-relaxed">
            Різні числа означають, що ключ, який ви бачите, — не ключ вашого
            співрозмовника. Так виглядає посередник: він читає й переписує все, що
            ви одне одному пишете. Не підтверджуйте звірку і не надсилайте нічого
            важливого. Звʼяжіться інакше — особисто або дзвінком на відомий вам
            номер — і продиктуйте число ще раз. Якщо і там воно різне, видаліть
            контакт і обміняйтеся ключами наново, краще при зустрічі.
          </p>
        )}
      </div>
    </div>
  );
};

export interface SheetChat {
  id: string;
  title: string;
  peerNodeId?: string;
  isGroup?: boolean;
}

interface ContactSheetProps {
  chat: SheetChat;
  anchor: { top: number; left: number };
  onClose: () => void;
  onVerified?: (verified: boolean) => void;
  onRenamed?: (title: string) => void;
  onCleared?: () => void;
  onDeleted?: () => void;
}

const SHEET_ACTION =
  'w-full h-[34px] px-2.5 rounded-[10px] text-left text-[12px] font-semibold flex items-center gap-2 transition-colors';

// Лист контакту з шапки: усе про співрозмовника й дії з розмовою за 1 клік.
export const ContactSheet: React.FC<ContactSheetProps> = ({
  chat,
  anchor,
  onClose,
  onVerified,
  onRenamed,
  onCleared,
  onDeleted,
}) => {
  const [state, setState] = useState<'loading' | 'none' | 'ready'>('loading');
  const [contact, setContact] = useState<NodeContact | null>(null);
  const [renaming, setRenaming] = useState(false);
  const [nameDraft, setNameDraft] = useState(chat.title);
  const [confirmKind, setConfirmKind] = useState<'clear' | 'delete' | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    void (async () => {
      // Групі й розмові без ключа звіряти нема кого — чесний стан замість порожнечі.
      if (chat.isGroup || !chat.peerNodeId) {
        if (alive) setState('none');
        return;
      }
      try {
        const list = await messengerApi.listContacts();
        const found = list.find((c) => c.peer_node_id === chat.peerNodeId) ?? null;
        if (!alive) return;
        setContact(found);
        setState(found ? 'ready' : 'none');
      } catch {
        if (alive) setState('none');
      }
    })();
    return () => {
      alive = false;
    };
  }, [chat.peerNodeId, chat.isGroup]);

  const saveRename = async () => {
    const trimmed = nameDraft.trim();
    if (!trimmed || trimmed === chat.title) {
      setRenaming(false);
      return;
    }
    setBusy(true);
    try {
      await messengerApi.renameConversation(chat.id, trimmed);
      onRenamed?.(trimmed);
      soundFx.playTap();
      setRenaming(false);
    } catch {
      setNote('Вузол не прийняв нову назву');
    } finally {
      setBusy(false);
    }
  };

  const doClear = async () => {
    setBusy(true);
    try {
      await messengerApi.clearConversation(chat.id);
      soundFx.playTap();
      onCleared?.();
      onClose();
    } catch {
      setNote('Не вдалося очистити історію');
    } finally {
      setBusy(false);
    }
  };

  const doDelete = async () => {
    setBusy(true);
    try {
      await messengerApi.deleteConversation(chat.id);
      soundFx.playTap();
      onDeleted?.();
      onClose();
    } catch {
      setNote('Не вдалося видалити розмову');
    } finally {
      setBusy(false);
    }
  };

  return createPortal(
    <>
      <div className="fixed inset-0 z-[900]" onClick={onClose} />
      <div
        role="dialog"
        aria-label="Картка співрозмовника"
        className="fixed z-[901] w-[300px] max-w-[calc(100vw-16px)] bg-[#FDFCF9] border border-[#DDD4C4] rounded-2xl shadow-[0_16px_40px_rgba(30,37,33,0.18)] p-3 space-y-2.5 text-[#1E2521]"
        style={{ top: anchor.top, left: anchor.left }}
      >
        {/* Заголовок: назва (з інлайн-перейменуванням) + закриття */}
        <div className="flex items-start justify-between gap-2">
          {renaming ? (
            <div className="flex-1 flex items-center gap-1.5">
              <input
                autoFocus
                value={nameDraft}
                onChange={(e) => setNameDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void saveRename();
                  if (e.key === 'Escape') setRenaming(false);
                }}
                className="flex-1 min-w-0 px-2 py-1 text-[13px] rounded-lg border border-[#E0D5C2] bg-white focus:outline-none focus:border-[#E87A42]"
              />
              <button
                onClick={() => void saveRename()}
                disabled={busy}
                className="shrink-0 text-[#3F7A4B] hover:scale-110 active:scale-95 transition-transform disabled:opacity-50"
                title="Зберегти назву"
              >
                <Check className="w-4 h-4" />
              </button>
            </div>
          ) : (
            <div className="min-w-0">
              <div className="text-[14px] font-bold text-[#1E2521] truncate">{chat.title}</div>
              <div
                className="text-[11px] text-[#8A9186] truncate"
                title={chat.peerNodeId || undefined}
              >
                {chat.isGroup ? 'Груповий простір' : humanNode(chat.peerNodeId)}
              </div>
            </div>
          )}
          <button
            onClick={onClose}
            className="shrink-0 text-[#8A9186] hover:text-[#1E2521]"
            aria-label="Закрити"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {state === 'loading' && (
          <span className="text-[11px] text-[#7A6A55] block">Читаю картку співрозмовника…</span>
        )}

        {state === 'none' && (
          <div className="p-2.5 bg-[#F9F7F1] rounded-xl border border-[#E6DFD3]">
            <span className="text-[11px] text-[#7A6A55] leading-relaxed block">
              {chat.isGroup
                ? 'Це груповий простір — число безпеки звіряється з кожним окремо.'
                : 'Ключа співрозмовника ще немає. Обміняйтеся ключами, щоб звірити число.'}
            </span>
          </div>
        )}

        {state === 'ready' && contact && (
          <div className="p-2.5 bg-[#F9F7F1] rounded-xl border border-[#E6DFD3] space-y-1.5">
            <div className="flex items-center gap-1.5">
              {contact.verified ? (
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
              <span className="text-[10px] text-[#98A092]">·</span>
              <span className="text-[10px] text-[#7A6A55] truncate">
                {contact.peer_address ? 'прямий звʼязок: є' : 'прямого звʼязку немає — листи підуть через скриньку'}
              </span>
            </div>
            <SafetyVerifyBlock
              contact={contact}
              onVerified={(updated) => {
                setContact(updated);
                onVerified?.(updated.verified);
              }}
              onDismiss={onClose}
            />
          </div>
        )}

        {/* Дії з розмовою — деструктивні лише через підтвердження */}
        {confirmKind === null ? (
          <div className="space-y-0.5 mt-2 pt-2 border-t border-[#E8E1D3]">
            <button
              onClick={() => {
                setNameDraft(chat.title);
                setRenaming(true);
              }}
              className={`${SHEET_ACTION} hover:bg-[#F4F1E8]`}
            >
              <Pencil className="w-3.5 h-3.5 text-[#C25925] shrink-0" />
              <span>Перейменувати</span>
            </button>
            <button
              onClick={() => setConfirmKind('clear')}
              className={`${SHEET_ACTION} hover:bg-[#F4F1E8]`}
            >
              <Eraser className="w-3.5 h-3.5 text-[#8A9186] shrink-0" />
              <span>Очистити історію</span>
            </button>
            <button
              onClick={() => setConfirmKind('delete')}
              className={`${SHEET_ACTION} text-[#B4432E] hover:bg-[#F7ECE7]`}
            >
              <Trash2 className="w-3.5 h-3.5 shrink-0" />
              <span>Видалити розмову</span>
            </button>
          </div>
        ) : (
          <div className="p-2.5 bg-[#F9F7F1] rounded-xl border border-[#E6DFD3] space-y-2">
            <span className="text-[11px] text-[#5F6A60] leading-relaxed block">
              {confirmKind === 'clear'
                ? 'Історія зникне з цього вузла. Копію співрозмовника ми не чіпаємо.'
                : 'Розмова зникне з цього вузла; копію співрозмовника не чіпаємо.'}
            </span>
            <div className="flex items-center gap-2">
              <button
                onClick={() => (confirmKind === 'clear' ? void doClear() : void doDelete())}
                disabled={busy}
                className="px-3 py-1.5 rounded-lg bg-[#B4432E] text-[#FDFCF9] text-[11px] font-bold active:scale-95 transition-transform disabled:opacity-50"
              >
                {busy ? 'Виконую…' : confirmKind === 'clear' ? 'Очистити' : 'Видалити'}
              </button>
              <button
                onClick={() => setConfirmKind(null)}
                className="px-3 py-1.5 rounded-lg text-[11px] font-semibold text-[#5F6A60] hover:bg-[#F1EBDD] transition-colors"
              >
                Скасувати
              </button>
            </div>
          </div>
        )}

        {note && <span className="text-[10px] text-[#B4432E] block">{note}</span>}
      </div>
    </>,
    document.body,
  );
};

export default ContactSheet;

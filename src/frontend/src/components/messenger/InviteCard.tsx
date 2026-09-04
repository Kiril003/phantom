import React, { useEffect, useState } from 'react';
import { Check, Copy, QrCode, Share2, X } from 'lucide-react';
import QRCode from 'qrcode';
import { messengerApi } from '../../services/messengerApi';
import { soundFx } from '../../utils/messengerSound';
import { copyText, encodeInvite, selfAddress, selfAddressGuess } from '../../utils/messengerInvite';

const NAME_KEY = 'phantom_invite_name';
const ADDR_KEY = 'phantom_invite_address';

interface InviteCardProps {
  /** Хрестик показуємо лише там, де картку можна згорнути. */
  onClose?: () => void;
}

/**
 * Одне запрошення — один рядок, і три способи його віддати.
 *
 * До цього, щоб покликати людину, треба було передати їй окремо адресу вузла
 * і окремо ключ, і вона мусила вкласти їх у два різні поля. Тут усе разом:
 * що скопіював — те й працює.
 */
export const InviteCard: React.FC<InviteCardProps> = ({ onClose }) => {
  const [name, setName] = useState(() => localStorage.getItem(NAME_KEY) ?? '');
  const [address, setAddress] = useState(
    () => localStorage.getItem(ADDR_KEY) ?? selfAddressGuess(),
  );
  const [compact, setCompact] = useState<string | null>(null);
  /** true — адресу назвав сам вузол; false — це наш здогад із браузера. */
  const [addressFromNode, setAddressFromNode] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [shared, setShared] = useState(false);
  const [showQr, setShowQr] = useState(false);
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);

  // Адресу питаємо у вузла: браузерний origin у розробці — петля, а в
  // пакунку — asset-протокол Tauri; ні те, ні те телефон не відкриє.
  // Людину не перебиваємо: якщо вона вже правила поле руками (адреса
  // збережена), лишаємо її вибір.
  useEffect(() => {
    if (localStorage.getItem(ADDR_KEY)) return;
    let alive = true;
    void selfAddress().then((addr) => {
      if (!alive || !addr) return;
      setAddress(addr);
      setAddressFromNode(true);
    });
    return () => {
      alive = false;
    };
  }, []);

  // Ключ беремо один раз: кожен виклик /identity витрачає одноразовий prekey,
  // а запас у вузла скінченний — смикати його на кожен рух пальця не можна.
  useEffect(() => {
    void (async () => {
      try {
        setCompact((await messengerApi.identity()).compact);
      } catch {
        setError('Вузол не віддав ключ — запрошення зараз не зробити.');
      }
    })();
  }, []);

  const invite = compact ? encodeInvite({ compact, address, name }) : '';

  useEffect(() => {
    localStorage.setItem(NAME_KEY, name);
  }, [name]);
  useEffect(() => {
    localStorage.setItem(ADDR_KEY, address);
  }, [address]);

  // Рівень корекції L, бо в коді лежать усі 400+ символів: із «M» модулі
  // дрібнішають так, що камера телефона бере код через раз.
  useEffect(() => {
    if (!invite || !showQr) return;
    void QRCode.toDataURL(invite, {
      errorCorrectionLevel: 'L',
      margin: 2,
      width: 640,
      color: { dark: '#1E2521', light: '#FFFFFF' },
    })
      .then(setQrDataUrl)
      .catch(() => setQrDataUrl(null));
  }, [invite, showQr]);

  const onCopy = async () => {
    if (!invite) return;
    const ok = await copyText(invite);
    soundFx.playTap();
    if (!ok) {
      setError('Буфер обміну недоступний — виділіть рядок нижче і скопіюйте вручну.');
      return;
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2200);
  };

  const onShare = async () => {
    if (!invite) return;
    try {
      await navigator.share({ text: invite });
      soundFx.playTap();
      setShared(true);
      setTimeout(() => setShared(false), 2200);
    } catch {
      /* людина передумала або застосунок не вибрано — це не помилка */
    }
  };

  const canShare = typeof navigator !== 'undefined' && typeof navigator.share === 'function';

  return (
    <div
      data-testid="invite-card"
      className="p-3.5 bg-[#F9F7F1] rounded-3xl border border-[#E6DFD3] space-y-3"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h4 className="text-[14px] font-extrabold text-[#1E2521] leading-tight">
            Ваше запрошення
          </h4>
          <p className="text-[12px] text-[#5F6A60] leading-snug mt-0.5">
            Один рядок. Хто його отримає — зможе вам написати.
          </p>
        </div>
        {onClose && (
          <button
            onClick={onClose}
            className="p-1 text-[#5F6A60] hover:text-[#1E2521] rounded-lg shrink-0"
            aria-label="Згорнути запрошення"
          >
            <X className="w-4 h-4" strokeWidth={1.75} />
          </button>
        )}
      </div>

      <div className="space-y-2">
        <label className="block">
          <span className="text-[11.5px] font-bold text-[#6E7568]">Як вас підписати</span>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Ваше імʼя"
            data-testid="invite-name"
            className="mt-1 w-full px-3 py-2 text-[13px] rounded-xl border border-[#E6DFD3] bg-white focus:outline-none focus:border-[#E87A42]"
          />
        </label>
        <label className="block">
          <span className="text-[11.5px] font-bold text-[#6E7568]">Адреса вашого вузла</span>
          <input
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            placeholder="http://192.168.1.5:8000"
            data-testid="invite-address"
            className="mt-1 w-full px-3 py-2 text-[13px] font-mono rounded-xl border border-[#E6DFD3] bg-white focus:outline-none focus:border-[#E87A42]"
          />
          <span className="text-[11px] text-[#7A6A55] block mt-1 leading-snug">
            {addressFromNode
              ? 'Адресу назвав сам вузол — це той інтерфейс і порт, на яких стоїть його слухач. Якщо ззовні його видно під іншою адресою, впишіть її.'
              : 'Це ЗДОГАД із адреси, за якою ви відкрили цю сторінку, — вузол своєї не назвав. Для іншого пристрою вона може нічого не означати: перевірте її, інакше листи до вас чекатимуть.'}
          </span>
        </label>
      </div>

      {invite ? (
        <>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onCopy}
              data-testid="invite-copy"
              className="flex-1 py-2.5 rounded-2xl bg-[#E87A42] hover:bg-[#C25925] text-[#FFF8F2] text-[13px] font-extrabold flex items-center justify-center gap-1.5 transition-colors active:scale-98"
            >
              {copied ? (
                <Check className="w-4 h-4" strokeWidth={2} />
              ) : (
                <Copy className="w-4 h-4" strokeWidth={2} />
              )}
              <span>{copied ? 'Скопійовано' : 'Копіювати'}</span>
            </button>
            <button
              type="button"
              onClick={() => {
                soundFx.playTap();
                setShowQr((v) => !v);
              }}
              data-testid="invite-qr"
              className="flex-1 py-2.5 rounded-2xl bg-white border border-[#DDD4C4] text-[#C25925] text-[13px] font-extrabold flex items-center justify-center gap-1.5 hover:bg-[#FAF6EE] transition-colors active:scale-98"
            >
              <QrCode className="w-4 h-4" strokeWidth={2} />
              <span>{showQr ? 'Сховати QR' : 'QR'}</span>
            </button>
            {canShare && (
              <button
                type="button"
                onClick={onShare}
                data-testid="invite-share"
                className="flex-1 py-2.5 rounded-2xl bg-white border border-[#DDD4C4] text-[#C25925] text-[13px] font-extrabold flex items-center justify-center gap-1.5 hover:bg-[#FAF6EE] transition-colors active:scale-98"
              >
                <Share2 className="w-4 h-4" strokeWidth={2} />
                <span>{shared ? 'Віддано' : 'Поділитися'}</span>
              </button>
            )}
          </div>

          {showQr && (
            <div className="flex flex-col items-center gap-2 pt-1" data-testid="invite-qr-view">
              {qrDataUrl ? (
                <>
                  <img
                    src={qrDataUrl}
                    alt="Запрошення у вигляді QR"
                    className="w-full max-w-[320px] rounded-2xl border border-[#E6DFD3] bg-white"
                  />
                  <span className="text-[12px] text-[#5F6A60] text-center leading-snug">
                    Хай наведе камеру. Код несе те саме, що й рядок.
                  </span>
                </>
              ) : (
                <span className="text-[12px] text-[#7A6A55]">Малюю код…</span>
              )}
            </div>
          )}

          <textarea
            readOnly
            value={invite}
            data-testid="invite-string"
            rows={3}
            onFocus={(e) => e.currentTarget.select()}
            className="w-full px-3 py-2 text-[11px] font-mono rounded-xl border border-[#E6DFD3] bg-white text-[#5F6A60] resize-none"
          />

          <p className="text-[12px] text-[#7A6A55] leading-snug">
            У рядку лише публічна частина ключа — це не пароль, його можна слати
            звичайним месенджером. Але імʼя в ньому — просто напис: людина по той бік
            звірить вас числом безпеки, а не ним.
          </p>
        </>
      ) : (
        <span className="text-[12px] text-[#7A6A55]">
          {error ?? 'Беру ключ у вузла…'}
        </span>
      )}

      {error && invite && (
        <div className="p-2.5 bg-[#FDF6EC] rounded-xl border border-[#EBD9BE]">
          <span className="text-[12px] text-[#8C5A1A]">{error}</span>
        </div>
      )}
    </div>
  );
};

export default InviteCard;

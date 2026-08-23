/**
 * Фото і файли в стрічці — з розшифруванням тут, у вкладці.
 *
 * Байти лежать на вузлі шифротекстом, ключ приїхав у тілі повідомлення. Тож
 * бульбашка має чотири чесні стани і жодного вигаданого:
 *   чекаємо  — байти ще не доїхали на цей вузол («Запитати ще раз»);
 *   читаємо  — фетч і розшифрування триває;
 *   готово   — відбиток зійшовся, показуємо вміст;
 *   помилка  — відбиток НЕ зійшовся або тег AEAD не зійшовся; кажемо прямо.
 *
 * Смуги прогресу тут немає навмисне: вузол не повідомляє, скільки байтів
 * вкладення вже приїхало від співрозмовника, тож малювати її було б вигадкою.
 */

import React, { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, Download, FileText, RefreshCw } from 'lucide-react';
import type { Message } from '../../types/messenger';
import { messengerApi } from '../../services/messengerApi';
import {
  MediaNotArrived,
  MediaTampered,
  cachedMediaUrl,
  extensionOf,
  forgetMedia,
  humanSize,
  loadMedia,
} from '../../services/messengerMedia';
import { soundFx } from '../../utils/messengerSound';

type Phase = 'reading' | 'ready' | 'waiting' | 'tampered' | 'error';

interface Props {
  msg: Message;
  isSelf: boolean;
  onOpenLightbox?: (url: string, title?: string) => void;
}

export const SecureMediaBubble: React.FC<Props> = ({ msg, isSelf, onOpenLightbox }) => {
  const media = msg.media!;
  // Якщо браузер таки не намалював те, що ми вважали фото, — падаємо в картку
  // файла. Бита іконка не дає дістати файл, картка дає.
  const [imgBroken, setImgBroken] = useState(false);
  const isImage = msg.type === 'image' && !imgBroken;
  const caption = (msg.text || '').trim();

  const [url, setUrl] = useState<string | undefined>(() => cachedMediaUrl(media.blobId));
  const [phase, setPhase] = useState<Phase>(() =>
    cachedMediaUrl(media.blobId) ? 'ready' : 'reading',
  );
  const [detail, setDetail] = useState('');
  const [asking, setAsking] = useState(false);
  /** Стан ПЕРЕВЕЗЕННЯ свого вкладення: доїхало до співрозмовника чи ще ні. */
  const [outState, setOutState] = useState<string | null>(null);

  const open = useCallback(async () => {
    setPhase('reading');
    try {
      setUrl(await loadMedia(media));
      setPhase('ready');
    } catch (err) {
      if (err instanceof MediaNotArrived) {
        setPhase('waiting');
      } else if (err instanceof MediaTampered) {
        setPhase('tampered');
      } else {
        setPhase('error');
        setDetail(err instanceof Error ? err.message : 'не вдалося прочитати вкладення');
      }
    }
  }, [media]);

  useEffect(() => {
    if (!cachedMediaUrl(media.blobId)) void open();
  }, [media.blobId, open]);

  // Своє вкладення: питаємо вузол, чи воно вже в співрозмовника. Це єдине
  // місце, де «очікує передачі» має вимірене підґрунтя, а не здогад.
  useEffect(() => {
    if (!isSelf) return;
    let alive = true;
    const ask = () => {
      messengerApi
        .blobStatus(media.blobId)
        .then((s) => alive && setOutState(s.state))
        .catch(() => undefined);
    };
    ask();
    const timer = window.setInterval(ask, 15000);
    return () => {
      alive = false;
      window.clearInterval(timer);
    };
  }, [isSelf, media.blobId]);

  const askAgain = async () => {
    soundFx.playTap();
    setAsking(true);
    try {
      await messengerApi.requestBlob(media.blobId);
      forgetMedia(media.blobId);
      await open();
    } catch (err) {
      setPhase('waiting');
      setDetail(err instanceof Error ? err.message : 'вузол співрозмовника не відгукнувся');
    } finally {
      setAsking(false);
    }
  };

  const save = () => {
    if (!url) return;
    soundFx.playTap();
    const a = document.createElement('a');
    a.href = url;
    a.download = media.name;
    a.click();
  };

  /** Підпис живе під превʼю — він пояснює те, що вже видно вище. */
  const captionLine = caption ? (
    <p className="text-[12.5px] leading-snug text-[#21261F] whitespace-pre-wrap break-words">
      {caption}
    </p>
  ) : null;

  const label = isImage ? 'Фото' : 'Файл';
  const shell = isSelf
    ? 'bg-[#FDF4EC] border-[#EBC7AE]'
    : 'bg-[#FDFCF9] border-[#DFD6C5]';

  // ── Байти ще не доїхали ────────────────────────────────────────────────────
  if (phase === 'waiting') {
    return (
      <div className={`mt-1 p-3 rounded-2xl border ${shell}`} data-testid="media-waiting">
        <div className="flex items-center gap-2">
          <span className="w-1.5 h-1.5 rounded-full bg-[#C9A227] shrink-0" />
          <span className="text-xs font-semibold text-[#21261F]">
            {label} · очікує передачі
          </span>
        </div>
        <p className="mt-1 text-[11px] text-[#6E7568] truncate">
          {media.name} · {humanSize(media.size)}
        </p>
        {detail && <p className="mt-1 text-[11px] text-[#8C3B22]">{detail}</p>}
        <button
          type="button"
          onClick={askAgain}
          disabled={asking}
          className="mt-2 flex items-center gap-1.5 px-2.5 py-1 rounded-xl bg-[#F2EDE4] hover:bg-[#E8DFC8] disabled:opacity-60 text-[11px] font-semibold text-[#1E2521] transition-colors"
        >
          <RefreshCw className={`w-3 h-3 ${asking ? 'animate-spin' : ''}`} />
          {asking ? 'Запитуємо…' : 'Запитати ще раз'}
        </button>
        {caption && <div className="mt-2">{captionLine}</div>}
      </div>
    );
  }

  // ── Відбиток не зійшовся ───────────────────────────────────────────────────
  if (phase === 'tampered' || phase === 'error') {
    const tampered = phase === 'tampered';
    return (
      <div
        className="mt-1 p-3 rounded-2xl border bg-[#FBEBE6] border-[#E9BFAE]"
        data-testid="media-error"
      >
        <div className="flex items-center gap-2">
          <AlertTriangle className="w-3.5 h-3.5 text-[#8C3B22] shrink-0" />
          {/* Формулювання без роду: «Фото» середнього, «Файл» чоловічого,
              а однакова фраза мусить читатись природно для обох. */}
          <span className="text-xs font-bold text-[#8C3B22]">
            {label} · {tampered ? 'відбиток не збігся' : 'не прочиталось'}
          </span>
        </div>
        <p className="mt-1 text-[11px] text-[#8C3B22]/85">
          {tampered
            ? 'Байти на вузлі не ті, що надсилав співрозмовник. Показувати їх не будемо.'
            : detail}
        </p>
        <p className="mt-1 text-[11px] text-[#6E7568] truncate">{media.name}</p>
      </div>
    );
  }

  // ── Читаємо ────────────────────────────────────────────────────────────────
  if (phase === 'reading' || !url) {
    return (
      <div className={`mt-1 p-3 rounded-2xl border ${shell}`} data-testid="media-reading">
        <div className="flex items-center gap-2">
          <span className="w-1.5 h-1.5 rounded-full bg-[var(--msg-meta)] animate-pulse shrink-0" />
          <span className="text-xs text-[#6E7568]">{label} · розшифровуємо…</span>
        </div>
      </div>
    );
  }

  // ── Готово ─────────────────────────────────────────────────────────────────
  const transferBadge =
    isSelf && outState === 'queued' ? (
      <span className="flex items-center gap-1 text-[10.5px] text-[#8A7A5C]">
        <span className="w-1.5 h-1.5 rounded-full bg-[#C9A227]" />
        очікує передачі
      </span>
    ) : null;

  if (isImage) {
    return (
      <div className="space-y-1 pt-1" data-testid="media-image">
        {/* Фото — теж файл, тож «Зберегти» мусить бути і тут. На дотику
            кнопка видима завжди, на миші зʼявляється під курсором. */}
        <div className="relative group/photo w-fit">
          <img
            src={url}
            alt={media.name}
            onError={() => setImgBroken(true)}
            onClick={() => {
              soundFx.playTap();
              onOpenLightbox?.(url, media.name);
            }}
            className="rounded-2xl max-w-[360px] max-h-[360px] w-auto object-contain cursor-pointer hover:opacity-95 transition-opacity"
          />
          <button
            type="button"
            onClick={save}
            data-testid="media-photo-save"
            className="absolute top-2 right-2 p-1.5 rounded-xl bg-[#FDFCF9]/90 hover:bg-[#FDFCF9] text-[#1E2521] border border-[#E8E1D3] shadow-[0_1px_2px_rgba(60,44,24,0.08)] transition-opacity sm:opacity-0 sm:group-hover/photo:opacity-100 focus:opacity-100"
            title="Зберегти"
            aria-label="Зберегти"
          >
            <Download className="w-3.5 h-3.5" />
          </button>
        </div>
        {captionLine}
        <div className="flex items-center justify-between gap-2">
          <span className="text-[10.5px] text-[#6E7568] truncate">
            {media.name} · {humanSize(media.size)}
          </span>
          {transferBadge}
        </div>
      </div>
    );
  }

  return (
    <div className="mt-1 space-y-1" data-testid="media-file">
      <div
        className={`p-3 rounded-2xl border flex items-center justify-between gap-3 ${shell}`}
      >
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="p-2 bg-[#FCE7D8] text-[#E87A42] rounded-xl shrink-0">
            <FileText className="w-4 h-4" />
          </div>
          <div className="min-w-0">
            <p className="font-bold text-xs truncate text-[#21261F]">{media.name}</p>
            <p className="text-[10px] text-[#6E7568]">
              {humanSize(media.size)} · {extensionOf(media.name)}
            </p>
            {transferBadge}
          </div>
        </div>
        <button
          onClick={save}
          className={`p-2 rounded-xl transition-colors shrink-0 ${
            isSelf
              ? 'bg-[#F6DCC9] hover:bg-[#F0CDB4] text-[#1E2521]'
              : 'bg-[#F2EDE4] hover:bg-[#E8DFC8] text-[#1E2521]'
          }`}
          title="Зберегти"
          aria-label="Зберегти"
        >
          <Download className="w-4 h-4" />
        </button>
      </div>
      {captionLine}
    </div>
  );
};

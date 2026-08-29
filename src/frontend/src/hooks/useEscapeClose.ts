import { useEffect } from 'react';

/**
 * Escape закриває відкритий шар.
 *
 * Сімнадцять модалок месенджера ловили лише клік по заслінці або по хрестику —
 * клавіша, якою людина рефлекторно виходить звідусіль, не робила нічого.
 * Слухаємо у фазі спливання, щоб поле вводу всередині шару могло перехопити
 * Escape для себе (скасувати перейменування, згорнути підказку) і не пустити
 * далі; слухач живий тільки поки шар відкритий.
 */
export function useEscapeClose(isOpen: boolean, onClose: () => void): void {
  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [isOpen, onClose]);
}

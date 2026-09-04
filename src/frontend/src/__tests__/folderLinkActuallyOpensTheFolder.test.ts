/**
 * Посилання на простір мусить його відкривати.
 *
 * «Копіювати посилання» в бічній смузі клало в буфер `…?folder=<id>` і
 * писало «🔗 Deep Link на «X» скопійовано!». Той параметр не читав НІХТО:
 * людина відкривала посилання й потрапляла у звичайний список, як і без
 * нього. Обіцянка без механізму — знайдено штабом 04.09.2026.
 *
 * Механізм тепер у `MessengerRoot` (один `useEffect` на монтуванні). Тут
 * стережемо саму домовленість: активним стає простір із запиту, а
 * неіснуючий id мовчки ігнорується — посилання на видалений простір не
 * має ні падати, ні вдавати перехід.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { useMessengerStore } from '../stores/messengerStore';

/** Те, що робить ефект у MessengerRoot — без монтування всього месенджера. */
function applyFolderFromQuery(search: string): void {
  const wanted = new URLSearchParams(search).get('folder');
  if (!wanted) return;
  const exists = useMessengerStore.getState().smartFolders?.some((f) => f.id === wanted);
  if (exists) useMessengerStore.getState().setActiveFolder(wanted);
}

describe('посилання на простір', () => {
  beforeEach(() => {
    useMessengerStore.getState().setActiveFolder(null);
  });

  it('відкриває САМЕ той простір, що в посиланні', () => {
    const folders = useMessengerStore.getState().smartFolders;
    expect(folders.length, 'у сторі мають бути простори за замовчуванням').toBeGreaterThan(0);
    const target = folders[folders.length - 1];

    applyFolderFromQuery(`?folder=${encodeURIComponent(target.id)}`);

    expect(useMessengerStore.getState().activeFolderId).toBe(target.id);
  });

  it('посилання на видалений простір нічого не ламає й нічого не вдає', () => {
    applyFolderFromQuery('?folder=folder-that-is-gone');

    expect(useMessengerStore.getState().activeFolderId).toBeNull();
  });

  it('без параметра нічого не чіпаємо', () => {
    applyFolderFromQuery('?u=kyrylo');

    expect(useMessengerStore.getState().activeFolderId).toBeNull();
  });
});

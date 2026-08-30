/**
 * Кожні двері або зачинені, або названі поіменно.
 *
 * Перша хвиля замка накрила 50 дверей із 57, і причина не в судженні, а в
 * **шаблоні**: ключі я витягав як `shownModal === '...' && <Компонент`, а сім
 * модалок написані у формі `&& (` з переносом рядка. Вони не потрапили ні в
 * замок, ні в перелік розглянутих — тобто не були **навіть розглянуті**, і
 * ніщо про це не сказало.
 *
 * Тому цей сторож не судить про зміст. Він робить інше: бере ВСІ ключі з
 * `ModalHost` і вимагає, щоб кожен був або в `HIDDEN_UNTIL_WIRED`, або в
 * явному переліку відкритих нижче. Третього стану — «я його не побачив» —
 * більше не існує.
 *
 * Це та сама відмінність, що між «тест ловить дефект» і «тест доводить, що
 * дефекту немає де сховатись».
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

import { HIDDEN_UNTIL_WIRED } from '../components/messenger/modals/hiddenModals';

const SRC = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const HOST = readFileSync(
  resolve(SRC, 'components/messenger/modals/ModalHost.tsx'),
  'utf8',
);

/** Двері, відкриті СВІДОМО. Кожен запис — із причиною, і причина мусить бути
 *  про джерело даних, а не про зручність. */
const OPEN_ON_PURPOSE = new Map<string, string>([
  [
    'commandPalette',
    'перелік команд, а не даних: його 58 записів — це дії, і кожна діє на ' +
      'справжній `useMessengerStore`, а не малює вигаданий стан',
  ],
  [
    'interactiveVis3D',
    'переглядач: малює те, що йому передали, власних записів і випадковості ' +
      'не має',
  ],
]);

const keysInHost = [...HOST.matchAll(/shownModal === '([a-zA-Z0-9-]+)'/g)].map((m) => m[1]);

describe('облік дверей', () => {
  it('у ModalHost узагалі є двері — інакше решта тестів ні про що', () => {
    expect(keysInHost.length).toBeGreaterThan(40);
  });

  it('кожен ключ або зачинений, або названий відкритим із причиною', () => {
    const unaccounted = keysInHost.filter(
      (k) => !HIDDEN_UNTIL_WIRED.has(k) && !OPEN_ON_PURPOSE.has(k),
    );

    expect(unaccounted).toEqual([]);
  });

  it('перелік відкритих не порожній — інакше замок нічим не перевірити', () => {
    // Якщо тут стане порожньо, тест «замок не накрив зайвого» втратить
    // контрольний випадок і почне доводити лише половину — причому лишиться
    // зеленим, і ніхто цього не помітить.
    expect(OPEN_ON_PURPOSE.size).toBeGreaterThan(0);
  });

  it('жоден ключ не значиться і зачиненим, і відкритим', () => {
    const both = [...OPEN_ON_PURPOSE.keys()].filter((k) => HIDDEN_UNTIL_WIRED.has(k));
    expect(both).toEqual([]);
  });
});

/**
 * Меню вкладень не публікує вигаданого.
 *
 * Дев'ять пунктів меню «＋» вставляють віджети в бесіду. Шість із них
 * приходили з ВИГАДАНИМ ВМІСТОМ, і це не приклади в документації — один
 * дотик клав їх у справжню розмову:
 *
 *   • таймлайн — «План розгортання Work OS v1.0» з чотирьох віх, з
 *     відсотками виконання і іменами ЖИВИХ людей у полі виконавця;
 *   • опитування — питання «Затвердити та викотити у продакшн» **із уже
 *     відданим голосом від імені відправника** (`votes: 1`, `voters:
 *     [currentUser.id]`, `winningOptionId`). Вигадана не лише тема, а й
 *     ВЧИНОК людини;
 *   • асинхронний запис — голосове на 145 секунд, підписане ІМЕНЕМ
 *     КОРИСТУВАЧА, з розшифровкою трьох реплік, яких він не казав;
 *   • канбан і RACI — вигадані завдання й розподіл відповідальності.
 *
 * Каркас (колонки дошки, ролі матриці) лишається — його заповнює людина.
 * Зміст прибрано: ми його не знаємо.
 *
 * ЧОГО СТОРОЖ НЕ ДОВОДИТЬ: що всі дев'ять пунктів досяжні з інтерфейсу.
 * Він читає джерело й тримає межу «жодних вигаданих даних у корисному
 * навантаженні» — досяжність окремим питанням.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const SRC = readFileSync(
  resolve(__dirname, '../components/messenger/MessageComposer.tsx'),
  'utf8',
);

/** Тіла функцій-відправників, без коментарів: коментар пояснює прибране
 *  й НЕ є вигадкою — інакше сторож падав би на власному поясненні. */
function senderBodies(): [string, string][] {
  const out: [string, string][] = [];
  const re = /const (send[A-Za-z]+) = \(\) => \{([\s\S]*?)\n  \};/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(SRC))) {
    const body = m[2]
      .split('\n')
      .filter((l) => !l.trim().startsWith('//'))
      .join('\n');
    out.push([m[1], body]);
  }
  return out;
}

describe('меню вкладень не вигадує', () => {
  it('жодне ім’я живої людини не їде у віджеті', () => {
    for (const [name, body] of senderBodies()) {
      for (const person of ['Кирило', 'Саня', 'Марина', 'Марта']) {
        expect(body, `${name} несе ім’я «${person}»`).not.toContain(person);
      }
    }
  });

  it('опитування не приходить із уже відданим голосом', () => {
    const voting = senderBodies().find(([n]) => n === 'sendVotingWidget');
    expect(voting, 'sendVotingWidget зник').toBeTruthy();
    const [, body] = voting!;
    expect(body, 'голос відданий за людину').not.toMatch(/votes:\s*[1-9]/);
    expect(body, 'виборця вписано за людину').not.toMatch(/voters:\s*\[\s*currentUser/);
    expect(body, 'переможця оголошено наперед').not.toContain('winningOptionId');
  });

  it('асинхронний запис не приписує людині слів і тривалості', () => {
    const snip = senderBodies().find(([n]) => n === 'sendAsyncSnippetWidget');
    expect(snip).toBeTruthy();
    const [, body] = snip!;
    expect(body, 'вигадана тривалість запису').not.toMatch(/durationSeconds:\s*[1-9]/);
    expect(body, 'вигадана розшифровка').not.toMatch(/text:\s*'[^']{10,}'/);
  });

  it('каркас лишається — прибрано зміст, а не структуру', () => {
    const kanban = senderBodies().find(([n]) => n === 'sendKanbanWidget')![1];
    expect(kanban, 'колонки дошки — це каркас, вони мусять лишитись').toContain('Черга');
    const raci = senderBodies().find(([n]) => n === 'sendRACIWidget')![1];
    expect(raci, 'ролі матриці — теж каркас').toContain('Тімлід');
  });
});

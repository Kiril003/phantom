/**
 * Лист у групу показує свій стан доставки.
 *
 * Стан рахувався умовою `peerNodeId && row.author_id !== peerNodeId`, тобто
 * лише для розмови один-на-один. **У групи `peerNodeId` немає за побудовою**:
 * віяр робить окремий кадр кожному учаснику його попарною сесією, тож єдиного
 * співрозмовника не існує.
 *
 * Виміряно на живому вузлі 30.08.2026: лист у групу з двома учасниками за
 * мертвою адресою повернувся з `delivery_state: "queued"` — вузол знав правду
 * й казав її, — а бульбашка малювалась **без жодного значка**, бо значок
 * вимагає `msg.status`. Від доставленого вона не відрізнялась нічим.
 *
 * Це третій випадок того самого класу за добу: правду несуть усі шари, крім
 * останнього. Спершу `is_demo` (позначку несли база, міграція, схема,
 * відповідь вузла, стор — і жодного малювання), потім голосове (немає типу на
 * дроті й немає статусу), тепер групова доставка.
 */
import { describe, expect, it } from 'vitest';

import { messageFromNode } from '../services/messengerApi';
import type { NodeMessage } from '../services/messengerApi';

const ME = 'node_me';

const row = (over: Partial<NodeMessage> = {}): NodeMessage =>
  ({
    id: 'm1',
    conversation_id: 'c1',
    client_id: 'c_1',
    seq: 1,
    author_id: ME,
    author_name: 'Я',
    kind: 'text',
    body: 'зустріч о 19:00',
    delivery_state: 'queued',
    sent_at: '2026-08-30T10:00:00',
    ...over,
  }) as NodeMessage;

describe('стан доставки в групі', () => {
  it('лист у групу, який ще не поїхав, має стан «у черзі»', () => {
    // Групу впізнаємо саме за ВІДСУТНІСТЮ peerNodeId — так її бачить клієнт.
    const msg = messageFromNode(row(), ME, undefined);

    expect(msg.isSelf).toBe(true);
    expect(msg.status).toBe('queued');
  });

  it('лист у групу, який поїхав, має стан «надіслано»', () => {
    const msg = messageFromNode(row({ delivery_state: 'sent' }), ME, undefined);

    expect(msg.status).toBe('sent');
  });

  it('невдача в групі не мовчить', () => {
    const msg = messageFromNode(row({ delivery_state: 'failed' }), ME, undefined);

    expect(msg.status).toBe('failed');
  });

  it('чужий лист у групі стану не має — це не наша доставка', () => {
    const msg = messageFromNode(row({ author_id: 'node_marta' }), ME, undefined);

    expect(msg.isSelf).toBe(false);
    expect(msg.status).toBeUndefined();
  });

  it('розмова один-на-один поводиться як раніше', () => {
    const peer = 'node_oleh';
    const mine = messageFromNode(row(), ME, peer);
    const theirs = messageFromNode(row({ author_id: peer }), ME, peer);

    expect(mine.status).toBe('queued');
    expect(theirs.status).toBeUndefined();
  });

  it('застрягле вкладення перебиває стан листа', () => {
    // Кадр міг поїхати, а байти — ні. Поки файла в людини немає, лист не
    // надісланий, хоч би що казав `delivery_state`.
    const msg = messageFromNode(
      row({ delivery_state: 'sent', attachment_state: 'parked' }),
      ME,
      undefined,
    );

    expect(msg.status).toBe('queued');
    expect(msg.attachmentState).toBe('parked');
  });
});

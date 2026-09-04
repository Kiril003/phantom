/**
 * Код із телефона — не ключ вузла ПК, і скло мусить це сказати.
 *
 * Телефонне запрошення має вигляд `PH2:<base64url>:<6 hex>`. Його payload —
 * теж base64url, і за першим байтом він проходив у `parseInvite` як
 * «стислий ключ» вузла: людина вставляла код зі свого телефона, ПК слав
 * його в ядро, а ядро відповідало 400 «неприйнятний bundle». Тобто двері
 * приймали те, що не могло спрацювати НІКОЛИ — вузли рахують різні
 * простори імен (телефон адресує по `peer.id` з `PeerInvite`, ПК —
 * `node_id = sha256(identity_ed)[:32]`).
 *
 * Тут стережемо саме розпізнавання: PH2 має ставати окремим різновидом, а
 * не «стислим ключем». Слова й двері на склі — у CreateChatModal та
 * IdentityPanel (обидва тепер зобовʼязані обробити цей різновид, бо тип
 * без нього не компілюється).
 */
import { describe, it, expect } from 'vitest';
import { parseInvite } from '../utils/messengerInvite';

/** Схожий на справжній: PH2 + довгий base64url + шість hex. */
const PHONE =
  'PH2:cGVlcjEyM3xLeXJ5bG98a2V5QkFTRTY0fGRoS2V5QkFTRTY0fDE5Mi4xNjguMS41fDg0NDM:a1b2c3';

describe('телефонне запрошення в полі ПК', () => {
  it('розпізнається як телефонне, а не як ключ вузла', () => {
    const parsed = parseInvite(PHONE);
    expect(parsed?.kind, 'PH2 не має ставати «compact»').toBe('phone');
  });

  it('розпізнається і всередині посилання, і серед слів у чаті', () => {
    expect(parseInvite(`phantom://invite/${PHONE}`)?.kind).toBe('phone');
    expect(parseInvite(`привіт, ось воно: ${PHONE} — додай мене`)?.kind).toBe('phone');
  });

  it('несе токен назад, щоб екран міг його показати', () => {
    const parsed = parseInvite(PHONE);
    expect(parsed && parsed.kind === 'phone' && parsed.token).toBe(PHONE);
  });

  it('справжній ключ вузла телефонним не стає', () => {
    // Перший байт 1 — версія стислого ключа з crypto/keys.py; довжина з
    // запасом понад COMPACT_MIN_BYTES (230 байтів у messengerInvite.ts).
    const bytes = new Uint8Array(256);
    bytes[0] = 1;
    for (let i = 1; i < bytes.length; i++) bytes[i] = (i * 7) % 251;
    let bin = '';
    bytes.forEach((b) => (bin += String.fromCharCode(b)));
    const b64url = btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

    const parsed = parseInvite(b64url);
    expect(parsed?.kind, 'ключ вузла має лишатись «compact»').toBe('compact');
  });

  it('порожнє й сміття — як були, без вигадок', () => {
    expect(parseInvite('')).toBeNull();
    expect(parseInvite('   ')).toBeNull();
    expect(parseInvite('привіт')).toBeNull();
  });
});

/**
 * Хребет месенджера: ПРОСТІР → ТОПІК → ГІЛКА.
 *
 * Спільний файл: телефон і ПК беруть звідси однакові назви полів.
 *
 * Чому це замінює 55 модалок: інструмент перестає бути вікном «зверху» і
 * стає тим, що простір УВІМКНУВ. Простір показує три-пʼять, а не півсотні —
 * можливостей стільки ж, але їх стає можливо знайти.
 */

/** Робочий, навчальний, бізнесовий — це НЕ типи в коді, а різні набори
 *  увімкнених інструментів у одній механіці. Підказка лише для першого
 *  набору при створенні; далі простір живе своїм переліком. */
export type SpacePreset = 'blank' | 'work' | 'study' | 'business' | 'family' | 'notes';

/** Ідентифікатор інструмента. Рядок, а не enum: набір росте, і простір,
 *  створений старою збіркою, не має ламатись об незнайоме ім'я. */
export type ToolId = string;

export type SpaceRole = 'owner' | 'admin' | 'member' | 'guest';

export interface SpaceMember {
  userId: string;
  role: SpaceRole;
  joinedAt: string;
  /** Ім'я в межах цього простору, якщо людина захотіла інше. */
  displayName?: string;
}

export interface Space {
  id: string;
  title: string;
  /** Порожньо — простір без опису; не вигадуємо за людину. */
  description?: string;
  iconEmoji?: string;
  createdAt: string;
  createdBy: string;
  members: SpaceMember[];
  /** Що цей простір уміє. Порожній перелік — простір без інструментів,
   *  і це дозволений стан. */
  tools: ToolId[];
  preset: SpacePreset;
  /** Нотатки — простір з одним учасником. Окремої сутності немає навмисно:
   *  інакше довелось би тримати дві механіки замість однієї. */
  personal: boolean;
}

export interface Topic {
  id: string;
  spaceId: string;
  title: string;
  iconEmoji?: string;
  createdAt: string;
  createdBy: string;
  /** Порядок у списку простору; менше — вище. */
  position: number;
  archived: boolean;
}

/** Гілка росте від конкретного повідомлення й має ВЛАСНЕ непрочитане. */
export interface Thread {
  id: string;
  topicId: string;
  /** Повідомлення, від якого гілка почалась. */
  rootMessageId: string;
  createdAt: string;
  createdBy: string;
  /** Скільки листів у гілці — щоб список не рахував їх щоразу. */
  messageCount: number;
  lastMessageAt?: string;
}

/**
 * Непрочитане тримається окремо від самих сутностей: у топіка й гілки воно
 * СВОЄ, і воно про конкретну людину, а не про об'єкт. Спільна структура —
 * щоб телефон і ПК рахували однаково.
 */
export interface UnreadMark {
  /** `topic:<id>` або `thread:<id>` — один лічильник на одну поверхню. */
  scope: string;
  count: number;
  /** Останній прочитаний лист; від нього рахується решта. */
  lastReadMessageId?: string;
  mentioned: boolean;
}

/** Один рядок списку зліва. Список показує ЛИШЕ людей і простори —
 *  жодних «розділів»: розділ не має учасників і не має що відкрити. */
export type ListEntry =
  | { kind: 'person'; contactId: string; unread: number }
  | { kind: 'space'; spaceId: string; unread: number };

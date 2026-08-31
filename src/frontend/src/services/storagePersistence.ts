import type { SmartFolder } from '../types/messenger';
/**
 * PHANTOM OS — Unified Local Storage & IndexedDB Persistence Layer
 * Забезпечує збереження чатів, повідомлень, профілів та налаштувань між сесіями.
 */

import { Chat, Message, UserProfile, ScheduledMessage } from '../types/messenger';

/** Лист, якого вузол не взяв, і чат, до якого він належить. */
export interface OutboxEntry {
  /** `client_id` листа — він же ключ ідемпотентності на сервері. */
  id: string;
  chatId: string;
  message: Message;
  savedAt: number;
  attempts: number;
}

/**
 * Сказати вголос, що сховище відмовило — і що саме через це не сталось.
 *
 * Тут було шість блоків `} catch {}`. Поведінку вони давали правильну
 * (читання повертає запасне значення, а не валить екран), але **відмову
 * не чув ніхто**: зіпсований запис і його відсутність виглядали однаково,
 * а невдалий ЗАПИС узагалі минав без сліду — інтерфейс вважав, що зберіг.
 *
 * Це той самий механізм, що сьогодні в домі ховав `ImportError` у скані
 * радіо й телеметрію Chroma: відмова, якої ніхто не чує. У сусідній сесії
 * така сама трійка в полотні **втрачала написане людиною**.
 *
 * Навмисно не кидаємо далі: запасне значення — правильна поведінка для
 * читання, і ламати екран через недоступний localStorage (приватний режим,
 * переповнена квота) було б гірше. Але тиша перестала бути безкоштовною.
 */
function noteStorageFailure(what: string, err: unknown): void {
  const reason = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
  console.warn(`[сховище] ${what} не вдалось — ${reason}`);
}

const DB_NAME = 'phantom_messenger_vault';
const DB_VERSION = 2;

export interface ChatFlags {
  pinned?: boolean;
  muted?: boolean;
  archived?: boolean;
}

class StoragePersistence {
  private db: IDBDatabase | null = null;
  private isInitPromise: Promise<void> | null = null;

  constructor() {
    if (typeof window !== 'undefined' && 'indexedDB' in window) {
      this.isInitPromise = this.initDB();
    }
  }

  private async initDB(): Promise<void> {
    return new Promise((resolve) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onupgradeneeded = (event: IDBVersionChangeEvent) => {
        const db = (event.target as IDBOpenDBRequest).result;
        if (!db.objectStoreNames.contains('chats')) {
          db.createObjectStore('chats', { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains('messages')) {
          const msgStore = db.createObjectStore('messages', { keyPath: 'id' });
          msgStore.createIndex('chatId', 'chatId', { unique: false });
        }
        if (!db.objectStoreNames.contains('user_profile')) {
          db.createObjectStore('user_profile', { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains('scheduled')) {
          db.createObjectStore('scheduled', { keyPath: 'id' });
        }
        // Скринька вихідних: листи, яких вузол не взяв. Головна вимога до
        // месенджера — написане не зникає, тож вони мусять пережити
        // перезапуск, а не жити лише в пам'яті вкладки.
        if (!db.objectStoreNames.contains('outbox')) {
          db.createObjectStore('outbox', { keyPath: 'id' });
        }
      };

      request.onsuccess = (event) => {
        this.db = (event.target as IDBOpenDBRequest).result;
        resolve();
      };

      request.onerror = (event) => {
        console.warn('[Storage] IndexedDB open error, falling back to LocalStorage:', event);
        resolve();
      };
    });
  }

  public async ensureReady(): Promise<void> {
    if (this.isInitPromise) {
      await this.isInitPromise;
    }
  }

  /* ─── Чати ─────────────────────────────────────────────────────────────── */

  public async saveChats(chats: Chat[]): Promise<void> {
    try {
      localStorage.setItem('phantom_chats_backup', JSON.stringify(chats));
      await this.ensureReady();
      if (!this.db) return;

      const tx = this.db.transaction('chats', 'readwrite');
      const store = tx.objectStore('chats');
      for (const chat of chats) {
        store.put(chat);
      }
    } catch (e) {
      console.warn('[Storage] Save chats error:', e);
    }
  }

  public async loadChats(): Promise<Chat[] | null> {
    try {
      await this.ensureReady();
      if (this.db) {
        return new Promise((resolve) => {
          const tx = this.db!.transaction('chats', 'readonly');
          const store = tx.objectStore('chats');
          const request = store.getAll();
          request.onsuccess = () => {
            if (request.result && request.result.length > 0) {
              resolve(request.result);
            } else {
              resolve(this.loadChatsFromLocalStorage());
            }
          };
          request.onerror = () => resolve(this.loadChatsFromLocalStorage());
        });
      }
      return this.loadChatsFromLocalStorage();
    } catch {
      return this.loadChatsFromLocalStorage();
    }
  }

  private loadChatsFromLocalStorage(): Chat[] | null {
    try {
      const raw = localStorage.getItem('phantom_chats_backup');
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed) && parsed.length > 0) return parsed;
      }
    } catch (err) {
      noteStorageFailure('читання резервної копії чатів', err);
    }
    return null;
  }

  public clearStorage(): void {
    try {
      localStorage.removeItem('phantom_chats_backup');
      localStorage.removeItem('phantom_user_profile');
      if (this.db) {
        const tx = this.db.transaction(['chats', 'messages'], 'readwrite');
        tx.objectStore('chats').clear();
        tx.objectStore('messages').clear();
      }
    } catch (err) {
      noteStorageFailure('очищення локального сховища', err);
    }
  }

  /* ─── Профіль користувача ─────────────────────────────────────────────── */

  public async saveUserProfile(user: UserProfile): Promise<void> {
    try {
      localStorage.setItem('phantom_user_profile', JSON.stringify(user));
      await this.ensureReady();
      if (!this.db) return;

      const tx = this.db.transaction('user_profile', 'readwrite');
      const store = tx.objectStore('user_profile');
      store.put(user);
    } catch (e) {
      console.warn('[Storage] Save user profile error:', e);
    }
  }

  public getUserProfileSync(): UserProfile | null {
    try {
      const raw = localStorage.getItem('phantom_user_profile');
      if (raw) return JSON.parse(raw);
    } catch (err) {
      noteStorageFailure('читання профілю власника', err);
    }
    return null;
  }

  public async loadUserProfile(): Promise<UserProfile | null> {
    return this.getUserProfileSync();
  }

  /* ─── Заплановані повідомлення ────────────────────────────────────────── */

  public async saveScheduledMessages(list: ScheduledMessage[]): Promise<void> {
    try {
      localStorage.setItem('phantom_scheduled_messages', JSON.stringify(list));
      await this.ensureReady();
      if (!this.db) return;

      const tx = this.db.transaction('scheduled', 'readwrite');
      const store = tx.objectStore('scheduled');
      store.clear();
      for (const item of list) {
        store.put(item);
      }
    } catch (e) {
      console.warn('[Storage] Save scheduled error:', e);
    }
  }

  public async loadScheduledMessages(): Promise<ScheduledMessage[] | null> {
    try {
      const raw = localStorage.getItem('phantom_scheduled_messages');
      if (raw) return JSON.parse(raw);
    } catch (err) {
      noteStorageFailure('читання відкладених листів', err);
    }
    return null;
  }

  /* ─── Розумні теки ─────────────────────────────────────────────────────── */
  //
  // Теки жили ЛИШЕ в памʼяті вкладки: `createFolder`, `updateFolder`,
  // `addChatToFolder`, `removeChatFromFolder` не зберігали нічого. Людина
  // розкладала розмови по теках, закривала вікно — і поверталась до жодної.
  //
  // Найгірше було не це, а розбіжність: `deleteFolder` теж нічого не зберігав,
  // тож після перезавантаження поверталися СТАРІ теки з початкового набору —
  // тобто видалена тека «воскресала», а створена зникала. Дві протилежні
  // несподіванки з однієї причини.
  //
  // Теки — стан ЦЬОГО пристрою: у вузла для них немає ані таблиці, ані
  // маршруту, і обіцяти спільність між ПК і телефоном ми не будемо.

  public async saveSmartFolders(folders: SmartFolder[]): Promise<void> {
    try {
      localStorage.setItem('phantom_smart_folders', JSON.stringify(folders));
    } catch (err) {
      noteStorageFailure('збереження тек', err);
    }
  }

  public loadSmartFolders(): SmartFolder[] | null {
    try {
      const raw = localStorage.getItem('phantom_smart_folders');
      if (raw) return JSON.parse(raw) as SmartFolder[];
    } catch (err) {
      noteStorageFailure('читання тек', err);
    }
    return null;
  }

  /* ─── Закріплено / тиша / архів ───────────────────────────────────────── */
  //
  // Ці три прапорці жили ЛИШЕ в пам'яті вкладки: жоден із перемикачів не
  // зберігав нічого, а `loadChats` не викликався взагалі. Тобто людина
  // закріплювала розмову, закривала вкладку — і закріплення зникало.
  //
  // Тримаємо їх окремою мапою, а не всередині розмов, бо список розмов
  // приходить із вузла й перебудовується: прапорці мусять пережити цю
  // перебудову й прикластись назад за ідентифікатором.
  //
  // Пристрій свій. У вузла для них немає полів узагалі, тож закріплене на ПК
  // на телефоні не з'явиться — і вдавати протилежне ми не будемо.

  public async saveChatFlags(flags: Record<string, ChatFlags>): Promise<void> {
    try {
      localStorage.setItem('phantom_chat_flags', JSON.stringify(flags));
    } catch (err) {
      noteStorageFailure('збереження прапорців розмов', err);
    }
  }

  public loadChatFlags(): Record<string, ChatFlags> {
    try {
      const raw = localStorage.getItem('phantom_chat_flags');
      if (raw) return JSON.parse(raw) as Record<string, ChatFlags>;
    } catch (err) {
      noteStorageFailure('читання прапорців розмов', err);
    }
    return {};
  }

  /* ─── Скринька вихідних ───────────────────────────────────────────────── */
  //
  // Сюди лягає лист, якого сервер НЕ взяв. Доти він жив лише в пам'яті вкладки:
  // людина бачила «не пішло» (це вже чесно), але після перезапуску написане
  // зникало — а месенджер від іграшки відрізняє саме те, що написане не
  // зникає.
  //
  // Дзеркало в localStorage навмисне: IndexedDB відкривається асинхронно, і
  // перший кадр після запуску має показати чергу ВІДРАЗУ, а не за мить.

  public async saveOutbox(entry: OutboxEntry): Promise<void> {
    try {
      const list = this.loadOutboxSync().filter((e) => e.id !== entry.id);
      list.push(entry);
      localStorage.setItem('phantom_outbox', JSON.stringify(list));
      await this.ensureReady();
      if (!this.db) return;
      this.db.transaction('outbox', 'readwrite').objectStore('outbox').put(entry);
    } catch (e) {
      console.warn('[Storage] Не вдалося зберегти лист у черзі:', e);
    }
  }

  public async dropOutbox(id: string): Promise<void> {
    try {
      const list = this.loadOutboxSync().filter((e) => e.id !== id);
      localStorage.setItem('phantom_outbox', JSON.stringify(list));
      await this.ensureReady();
      if (!this.db) return;
      this.db.transaction('outbox', 'readwrite').objectStore('outbox').delete(id);
    } catch (e) {
      console.warn('[Storage] Не вдалося прибрати лист із черги:', e);
    }
  }

  /** Синхронно — щоб перший кадр уже знав про чергу. */
  public loadOutboxSync(): OutboxEntry[] {
    try {
      const raw = localStorage.getItem('phantom_outbox');
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  /* ─── Загальні налаштування ────────────────────────────────────────────── */

  public saveSetting(key: string, value: any): void {
    try {
      localStorage.setItem(`phantom_setting_${key}`, JSON.stringify(value));
    } catch (err) {
      noteStorageFailure('запис налаштування', err);
    }
  }

  public loadSetting<T>(key: string, defaultValue: T): T {
    try {
      const raw = localStorage.getItem(`phantom_setting_${key}`);
      if (raw !== null) return JSON.parse(raw);
    } catch (err) {
      noteStorageFailure('читання налаштування', err);
    }
    return defaultValue;
  }
}

export const storagePersistence = new StoragePersistence();

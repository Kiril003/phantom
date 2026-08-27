/**
 * PHANTOM OS — Unified Local Storage & IndexedDB Persistence Layer
 * Забезпечує збереження чатів, повідомлень, профілів та налаштувань між сесіями.
 */

import { Chat, UserProfile, ScheduledMessage } from '../types/messenger';

const DB_NAME = 'phantom_messenger_vault';
const DB_VERSION = 1;

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
    } catch {}
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
    } catch {}
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
    } catch {}
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
    } catch {}
    return null;
  }

  /* ─── Загальні налаштування ────────────────────────────────────────────── */

  public saveSetting(key: string, value: any): void {
    try {
      localStorage.setItem(`phantom_setting_${key}`, JSON.stringify(value));
    } catch {}
  }

  public loadSetting<T>(key: string, defaultValue: T): T {
    try {
      const raw = localStorage.getItem(`phantom_setting_${key}`);
      if (raw !== null) return JSON.parse(raw);
    } catch {}
    return defaultValue;
  }
}

export const storagePersistence = new StoragePersistence();

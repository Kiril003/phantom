import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export interface DriveItem {
  id: string;
  name: string;
  type: 'file' | 'folder' | 'doc' | 'sheet' | 'canvas';
  sizeBytes: number;
  mimeType: string;
  updatedAt: string;
  parentId: string | null;
  content?: string;
  tags: string[];
  starred?: boolean;
}

export interface TaskItem {
  id: string;
  title: string;
  description?: string;
  status: 'backlog' | 'todo' | 'in_progress' | 'review' | 'done';
  priority: 'low' | 'medium' | 'high' | 'urgent';
  assigneeId?: string;
  assigneeName?: string;
  dueDate?: string;
  chatId?: string;
  tags: string[];
  createdAt: string;
  storyPoints?: number;
}

export interface AutomationRule {
  id: string;
  name: string;
  enabled: boolean;
  triggerType: 'on_message_keyword' | 'on_webhook' | 'cron_schedule' | 'on_task_status';
  triggerConfig: Record<string, any>;
  actionType: 'send_message' | 'create_task' | 'run_webhook' | 'summarize_chat';
  actionConfig: Record<string, any>;
  lastRunAt?: string;
  runCount: number;
}

export interface WebhookEndpoint {
  id: string;
  name: string;
  source: 'github' | 'gitlab' | 'docker' | 'sentry' | 'custom';
  secret: string;
  url: string;
  enabled: boolean;
  createdAt: string;
  lastPayloadAt?: string;
}

export interface DataGridTable {
  id: string;
  name: string;
  columns: Array<{ id: string; name: string; type: 'text' | 'number' | 'date' | 'select' | 'boolean' }>;
  rows: Array<Record<string, any>>;
  updatedAt: string;
}

interface WorkOsState {
  // Drive
  driveItems: DriveItem[];
  currentFolderId: string | null;
  addDriveItem: (item: Omit<DriveItem, 'id' | 'updatedAt'>) => DriveItem;
  updateDriveItem: (id: string, updates: Partial<DriveItem>) => void;
  deleteDriveItem: (id: string) => void;
  setCurrentFolderId: (folderId: string | null) => void;

  // Tasks
  tasks: TaskItem[];
  addTask: (task: Omit<TaskItem, 'id' | 'createdAt'>) => TaskItem;
  updateTask: (id: string, updates: Partial<TaskItem>) => void;
  deleteTask: (id: string) => void;
  moveTaskStatus: (id: string, status: TaskItem['status']) => void;

  // Automations
  automations: AutomationRule[];
  addAutomation: (rule: Omit<AutomationRule, 'id' | 'runCount'>) => AutomationRule;
  toggleAutomation: (id: string) => void;
  deleteAutomation: (id: string) => void;
  executeAutomation: (id: string, triggerPayload?: any) => Promise<void>;

  // Webhooks
  webhooks: WebhookEndpoint[];
  addWebhook: (wh: Omit<WebhookEndpoint, 'id' | 'createdAt'>) => WebhookEndpoint;
  deleteWebhook: (id: string) => void;

  // DataGrid
  tables: DataGridTable[];
  createTable: (name: string, columns: DataGridTable['columns']) => DataGridTable;
  updateTableRow: (tableId: string, rowIndex: number, rowData: Record<string, any>) => void;
  addTableRow: (tableId: string, rowData: Record<string, any>) => void;
  deleteTableRow: (tableId: string, rowIndex: number) => void;
}

const INITIAL_DRIVE: DriveItem[] = [
  {
    id: 'drive_root_1',
    name: 'Документація проєкту',
    type: 'folder',
    sizeBytes: 0,
    mimeType: 'inode/directory',
    updatedAt: new Date().toISOString(),
    parentId: null,
    tags: ['docs', 'phantom'],
  },
  {
    id: 'drive_file_1',
    name: 'phantom-architecture.md',
    type: 'doc',
    sizeBytes: 14520,
    mimeType: 'text/markdown',
    updatedAt: new Date().toISOString(),
    parentId: 'drive_root_1',
    content: '# PHANTOM Architecture Blueprint\n\n- P2P WebRTC Mesh\n- Air-gap Zero Trace\n- Local Neural Core',
    tags: ['architecture', 'blueprint'],
    starred: true,
  },
];

const INITIAL_TASKS: TaskItem[] = [
  {
    id: 'task_1',
    title: 'Інтеграція P2P Mesh каналу для дзвінків',
    description: 'Перевірити автоматичний fallback на Live Loopback та BroadcastChannel',
    status: 'done',
    priority: 'high',
    assigneeName: 'Kiril',
    createdAt: new Date().toISOString(),
    tags: ['webrtc', 'mesh'],
    storyPoints: 5,
  },
  {
    id: 'task_2',
    title: 'Модульна реорганізація Work OS компонентів',
    description: 'Винести всі суперапп-модалі в типізований lazy ModalHost та Zustand стори',
    status: 'in_progress',
    priority: 'urgent',
    assigneeName: 'Antigravity AI',
    createdAt: new Date().toISOString(),
    tags: ['refactor', 'workos'],
    storyPoints: 8,
  },
  {
    id: 'task_3',
    title: 'Підключення Supabase Realtime & R2 Object Storage',
    description: 'Реалізувати стійку синхронізацію медіафайлів через Cloudflare R2',
    status: 'todo',
    priority: 'high',
    assigneeName: 'Kiril',
    createdAt: new Date().toISOString(),
    tags: ['infra', 'cloud'],
    storyPoints: 5,
  },
];

const INITIAL_AUTOMATIONS: AutomationRule[] = [
  {
    id: 'auto_1',
    name: 'CI/CD Build Alert',
    enabled: true,
    triggerType: 'on_webhook',
    triggerConfig: { source: 'github', event: 'push' },
    actionType: 'send_message',
    actionConfig: { channel: 'devops', template: 'Збірку успішно зібрано!' },
    runCount: 14,
  },
  {
    id: 'auto_2',
    name: 'Нічний дайджест бесіди',
    enabled: true,
    triggerType: 'cron_schedule',
    triggerConfig: { cron: '0 23 * * *' },
    actionType: 'summarize_chat',
    actionConfig: { depth: 'full' },
    runCount: 3,
  },
];

export const useWorkOsStore = create<WorkOsState>()(
  persist(
    (set, get) => ({
      driveItems: INITIAL_DRIVE,
      currentFolderId: null,

      addDriveItem: (item) => {
        const newItem: DriveItem = {
          ...item,
          id: `item_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
          updatedAt: new Date().toISOString(),
        };
        set((s) => ({ driveItems: [...s.driveItems, newItem] }));
        return newItem;
      },

      updateDriveItem: (id, updates) => {
        set((s) => ({
          driveItems: s.driveItems.map((item) =>
            item.id === id ? { ...item, ...updates, updatedAt: new Date().toISOString() } : item
          ),
        }));
      },

      deleteDriveItem: (id) => {
        set((s) => ({
          driveItems: s.driveItems.filter((item) => item.id !== id && item.parentId !== id),
        }));
      },

      setCurrentFolderId: (folderId) => set({ currentFolderId: folderId }),

      tasks: INITIAL_TASKS,

      addTask: (task) => {
        const newTask: TaskItem = {
          ...task,
          id: `task_${Date.now()}`,
          createdAt: new Date().toISOString(),
        };
        set((s) => ({ tasks: [...s.tasks, newTask] }));
        return newTask;
      },

      updateTask: (id, updates) => {
        set((s) => ({
          tasks: s.tasks.map((t) => (t.id === id ? { ...t, ...updates } : t)),
        }));
      },

      deleteTask: (id) => {
        set((s) => ({
          tasks: s.tasks.filter((t) => t.id !== id),
        }));
      },

      moveTaskStatus: (id, status) => {
        set((s) => ({
          tasks: s.tasks.map((t) => (t.id === id ? { ...t, status } : t)),
        }));
      },

      automations: INITIAL_AUTOMATIONS,

      addAutomation: (rule) => {
        const newRule: AutomationRule = {
          ...rule,
          id: `rule_${Date.now()}`,
          runCount: 0,
        };
        set((s) => ({ automations: [...s.automations, newRule] }));
        return newRule;
      },

      toggleAutomation: (id) => {
        set((s) => ({
          automations: s.automations.map((a) => (a.id === id ? { ...a, enabled: !a.enabled } : a)),
        }));
      },

      deleteAutomation: (id) => {
        set((s) => ({
          automations: s.automations.filter((a) => a.id !== id),
        }));
      },

      executeAutomation: async (id) => {
        const rule = get().automations.find((a) => a.id === id);
        if (!rule || !rule.enabled) return;
        set((s) => ({
          automations: s.automations.map((a) =>
            a.id === id ? { ...a, lastRunAt: new Date().toISOString(), runCount: a.runCount + 1 } : a
          ),
        }));
      },

      webhooks: [
        {
          id: 'wh_1',
          name: 'GitHub Repository Push Webhook',
          source: 'github',
          secret: 'ph_sec_9938218',
          url: 'https://try.phantom-os.dev/api/v1/webhooks/github_inbound',
          enabled: true,
          createdAt: new Date().toISOString(),
          lastPayloadAt: new Date().toISOString(),
        },
      ],

      addWebhook: (wh) => {
        const newWh: WebhookEndpoint = {
          ...wh,
          id: `wh_${Date.now()}`,
          createdAt: new Date().toISOString(),
        };
        set((s) => ({ webhooks: [...s.webhooks, newWh] }));
        return newWh;
      },

      deleteWebhook: (id) => {
        set((s) => ({ webhooks: s.webhooks.filter((w) => w.id !== id) }));
      },

      tables: [
        {
          id: 'tbl_team',
          name: 'Команда & Доступи',
          columns: [
            { id: 'c1', name: 'Імʼя', type: 'text' },
            { id: 'c2', name: 'Роль', type: 'select' },
            { id: 'c3', name: 'Рівень безпеки', type: 'text' },
            { id: 'c4', name: 'Активний', type: 'boolean' },
          ],
          rows: [
            { c1: 'Kiril (Оператор)', c2: 'ROOT Architect', c3: 'GHOST L5 (Max)', c4: true },
            { c1: 'Antigravity AI', c2: 'System Symbiont', c3: 'AIRouter Autonomous', c4: true },
            { c1: 'Олександр (Lead)', c2: 'Core Developer', c3: 'SENTINEL L3', c4: true },
          ],
          updatedAt: new Date().toISOString(),
        },
      ],

      createTable: (name, columns) => {
        const newTable: DataGridTable = {
          id: `tbl_${Date.now()}`,
          name,
          columns,
          rows: [],
          updatedAt: new Date().toISOString(),
        };
        set((s) => ({ tables: [...s.tables, newTable] }));
        return newTable;
      },

      updateTableRow: (tableId, rowIndex, rowData) => {
        set((s) => ({
          tables: s.tables.map((tbl) => {
            if (tbl.id !== tableId) return tbl;
            const updatedRows = [...tbl.rows];
            updatedRows[rowIndex] = { ...updatedRows[rowIndex], ...rowData };
            return { ...tbl, rows: updatedRows, updatedAt: new Date().toISOString() };
          }),
        }));
      },

      addTableRow: (tableId, rowData) => {
        set((s) => ({
          tables: s.tables.map((tbl) =>
            tbl.id === tableId
              ? { ...tbl, rows: [...tbl.rows, rowData], updatedAt: new Date().toISOString() }
              : tbl
          ),
        }));
      },

      deleteTableRow: (tableId, rowIndex) => {
        set((s) => ({
          tables: s.tables.map((tbl) =>
            tbl.id === tableId
              ? {
                  ...tbl,
                  rows: tbl.rows.filter((_, idx) => idx !== rowIndex),
                  updatedAt: new Date().toISOString(),
                }
              : tbl
          ),
        }));
      },
    }),
    {
      name: 'phantom_work_os_store',
    }
  )
);

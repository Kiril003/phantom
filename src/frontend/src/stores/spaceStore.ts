import { create } from 'zustand';
import type { Space, SpaceMember, SpacePreset, Thread, ToolId, Topic } from '@shared/types';

/**
 * Простори, топіки, гілки — і навігація між ними.
 *
 * Сховище навмисно НЕ засіяне даними: порожній список означає «просторів
 * немає», а не «щось не завантажилось». Засіяні приклади — те, за що цей
 * дім платив цілий день.
 */

/** Набори інструментів на старті. Простір далі живе своїм переліком —
 *  пресет лише вибирає, з чого почати. */
const PRESET_TOOLS: Readonly<Record<SpacePreset, ToolId[]>> = {
  blank: [],
  work: ['tasks', 'files', 'calls'],
  study: ['notes', 'files', 'calendar'],
  business: ['tasks', 'files', 'contacts', 'calendar'],
  family: ['photos', 'location', 'calls'],
  notes: ['notes', 'files'],
};

interface SpaceState {
  spaces: Space[];
  topics: Topic[];
  threads: Thread[];

  /** Куди дивиться людина зараз. Порожньо — вона в списку. */
  activeSpaceId: string | null;
  activeTopicId: string | null;
  activeThreadId: string | null;

  createSpace: (title: string, preset: SpacePreset, me: string) => Space;
  createTopic: (spaceId: string, title: string, me: string) => Topic;
  createThread: (topicId: string, rootMessageId: string, me: string) => Thread;

  openSpace: (id: string | null) => void;
  openTopic: (id: string | null) => void;
  openThread: (id: string | null) => void;
  /** Крок назад по одному рівню: гілка → топік → простір → список. */
  goBack: () => void;

  toggleTool: (spaceId: string, tool: ToolId) => void;
  addMember: (spaceId: string, member: SpaceMember) => void;

  topicsOf: (spaceId: string) => Topic[];
  threadsOf: (topicId: string) => Thread[];
}

const now = () => new Date().toISOString();
const rid = (p: string) => `${p}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;

export const useSpaceStore = create<SpaceState>((set, get) => ({
  spaces: [],
  topics: [],
  threads: [],
  activeSpaceId: null,
  activeTopicId: null,
  activeThreadId: null,

  createSpace: (title, preset, me) => {
    const space: Space = {
      id: rid('sp'),
      title: title.trim(),
      createdAt: now(),
      createdBy: me,
      members: [{ userId: me, role: 'owner', joinedAt: now() }],
      tools: [...PRESET_TOOLS[preset]],
      preset,
      // Простір із одним учасником і є «нотатки» — окремої сутності немає.
      personal: preset === 'notes',
    };
    set((s) => ({ spaces: [...s.spaces, space] }));
    return space;
  },

  createTopic: (spaceId, title, me) => {
    const siblings = get().topics.filter((t) => t.spaceId === spaceId);
    const topic: Topic = {
      id: rid('tp'),
      spaceId,
      title: title.trim(),
      createdAt: now(),
      createdBy: me,
      position: siblings.length,
      archived: false,
    };
    set((s) => ({ topics: [...s.topics, topic] }));
    return topic;
  },

  createThread: (topicId, rootMessageId, me) => {
    const existing = get().threads.find((t) => t.rootMessageId === rootMessageId);
    // Гілка від одного листа буває одна: другий дотик відкриває ту саму.
    if (existing) return existing;
    const thread: Thread = {
      id: rid('th'),
      topicId,
      rootMessageId,
      createdAt: now(),
      createdBy: me,
      messageCount: 0,
    };
    set((s) => ({ threads: [...s.threads, thread] }));
    return thread;
  },

  // Відкриття рівня скидає рівні НИЖЧЕ: інакше можна опинитись у гілці
  // чужого топіка й не помітити.
  openSpace: (id) => set({ activeSpaceId: id, activeTopicId: null, activeThreadId: null }),
  openTopic: (id) => set({ activeTopicId: id, activeThreadId: null }),
  openThread: (id) => set({ activeThreadId: id }),

  goBack: () => {
    const { activeThreadId, activeTopicId } = get();
    if (activeThreadId) return set({ activeThreadId: null });
    if (activeTopicId) return set({ activeTopicId: null });
    return set({ activeSpaceId: null });
  },

  toggleTool: (spaceId, tool) =>
    set((s) => ({
      spaces: s.spaces.map((sp) =>
        sp.id === spaceId
          ? {
              ...sp,
              tools: sp.tools.includes(tool)
                ? sp.tools.filter((t) => t !== tool)
                : [...sp.tools, tool],
            }
          : sp,
      ),
    })),

  addMember: (spaceId, member) =>
    set((s) => ({
      spaces: s.spaces.map((sp) =>
        sp.id === spaceId && !sp.members.some((m) => m.userId === member.userId)
          ? { ...sp, members: [...sp.members, member] }
          : sp,
      ),
    })),

  topicsOf: (spaceId) =>
    get()
      .topics.filter((t) => t.spaceId === spaceId && !t.archived)
      .sort((a, b) => a.position - b.position),

  threadsOf: (topicId) => get().threads.filter((t) => t.topicId === topicId),
}));

export { PRESET_TOOLS };

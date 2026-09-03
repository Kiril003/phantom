import React, { useState } from 'react';
import { ChevronLeft, Hash, Plus, X } from 'lucide-react';
import type { SpacePreset } from '@shared/types';
import { useSpaceStore, PRESET_TOOLS } from '../../stores/spaceStore';
import { TOOL_CATALOGUE, toolDef } from './toolCatalogue';

/**
 * Простір → топік → гілка на склі.
 *
 * Замінює склад із 55 модалок: інструмент стає тим, що простір увімкнув,
 * а не вікном «зверху». Три-п'ять на простір замість півсотні на всіх.
 */

const PRESETS: { id: SpacePreset; label: string }[] = [
  { id: 'blank', label: 'Порожній' },
  { id: 'work', label: 'Робочий' },
  { id: 'study', label: 'Навчальний' },
  { id: 'business', label: 'Бізнес' },
  { id: 'family', label: 'Сімейний' },
  { id: 'notes', label: 'Нотатки' },
];

const RAIL = 'w-[68px] shrink-0 h-full flex flex-col items-center gap-1 py-3 bg-[#EFEBE0] border-r border-black/5';
const DOT =
  'w-11 h-11 min-w-[48px] min-h-[48px] rounded-2xl flex items-center justify-center text-sm font-bold transition-colors';

export const SpaceNavigator: React.FC<{ me: string }> = ({ me }) => {
  const spaces = useSpaceStore((s) => s.spaces);
  const activeSpaceId = useSpaceStore((s) => s.activeSpaceId);
  const activeTopicId = useSpaceStore((s) => s.activeTopicId);
  const openSpace = useSpaceStore((s) => s.openSpace);
  const openTopic = useSpaceStore((s) => s.openTopic);
  const goBack = useSpaceStore((s) => s.goBack);
  const createSpace = useSpaceStore((s) => s.createSpace);
  const createTopic = useSpaceStore((s) => s.createTopic);
  const toggleTool = useSpaceStore((s) => s.toggleTool);
  const topicsOf = useSpaceStore((s) => s.topicsOf);

  const [creating, setCreating] = useState(false);
  const [title, setTitle] = useState('');
  const [preset, setPreset] = useState<SpacePreset>('blank');
  const [newTopic, setNewTopic] = useState('');
  const [toolsOpen, setToolsOpen] = useState(false);

  // 68 (рейка) + 248 (панель) = 316 із 393px екрана: на телефон обидві
  // колонки не влазять. Показуємо одну — ту, у якій людина зараз.
  const narrow = typeof window !== 'undefined' && window.innerWidth < 640;

  const space = spaces.find((s) => s.id === activeSpaceId) ?? null;
  const topics = space ? topicsOf(space.id) : [];

  const submitSpace = () => {
    const t = title.trim();
    if (!t) return;
    const created = createSpace(t, preset, me);
    setTitle('');
    setCreating(false);
    openSpace(created.id);
  };

  return (
    <div className="flex h-full shrink-0" data-testid="space-navigator">
      <div
        className={`${RAIL} ${narrow && (space || creating) ? 'hidden' : 'flex'}`}
        data-testid="space-rail"
      >
        {spaces.map((s) => (
          <button
            key={s.id}
            onClick={() => openSpace(s.id === activeSpaceId ? null : s.id)}
            title={s.title}
            aria-label={`Простір ${s.title}`}
            aria-pressed={s.id === activeSpaceId}
            className={`${DOT} ${
              s.id === activeSpaceId
                ? 'bg-[#1E2521] text-[#F7F5EE]'
                : 'bg-white/70 text-[#1E2521] hover:bg-white'
            }`}
          >
            {s.iconEmoji || s.title.slice(0, 2).toUpperCase()}
          </button>
        ))}
        <button
          onClick={() => setCreating(true)}
          aria-label="Створити простір"
          title="Створити простір"
          className={`${DOT} bg-white/50 text-[#1E2521]/60 hover:bg-white hover:text-[#1E2521]`}
        >
          <Plus className="w-5 h-5" />
        </button>
      </div>

      {(space || creating) && (
        <div className="w-full sm:w-[248px] shrink-0 h-full flex flex-col bg-[#F2EFE6] border-r border-black/5">
          {creating ? (
            <div className="p-3 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-bold uppercase tracking-widest">Новий простір</span>
                <button onClick={() => setCreating(false)} aria-label="Скасувати" className="p-1">
                  <X className="w-4 h-4" />
                </button>
              </div>
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && submitSpace()}
                placeholder="Назва"
                aria-label="Назва простору"
                className="w-full min-h-[48px] px-3 rounded-xl bg-white border border-black/10 text-sm"
              />
              <div className="grid grid-cols-2 gap-1.5">
                {PRESETS.map((p) => (
                  <button
                    key={p.id}
                    onClick={() => setPreset(p.id)}
                    aria-pressed={preset === p.id}
                    className={`min-h-[48px] px-2 rounded-xl text-[11px] font-semibold border ${
                      preset === p.id
                        ? 'bg-[#1E2521] text-[#F7F5EE] border-transparent'
                        : 'bg-white/70 border-black/10'
                    }`}
                  >
                    {p.label}
                  </button>
                ))}
              </div>
              {/* Пресет не тип, а перший набір інструментів — кажемо це вголос,
                  щоб вибір не читався як незворотний. */}
              <p className="text-[10px] leading-relaxed text-[#1E2521]/55">
                {PRESET_TOOLS[preset].length
                  ? `Увімкне: ${PRESET_TOOLS[preset].join(', ')}. Змінюється будь-коли.`
                  : 'Без інструментів. Додасте потрібні всередині.'}
              </p>
              <button
                onClick={submitSpace}
                disabled={!title.trim()}
                className="w-full min-h-[48px] rounded-xl bg-[#1E2521] text-[#F7F5EE] text-sm font-bold disabled:opacity-40"
              >
                Створити
              </button>
            </div>
          ) : (
            space && (
              <>
                <div className="p-3 border-b border-black/5 flex items-center gap-2">
                  <button onClick={goBack} aria-label="Назад" className="p-1 -ml-1">
                    <ChevronLeft className="w-4 h-4" />
                  </button>
                  <div className="min-w-0">
                    <div className="text-sm font-bold truncate">{space.title}</div>
                    <div className="text-[10px] text-[#1E2521]/55">
                      {space.members.length === 1
                        ? 'лише ви'
                        : `учасників: ${space.members.length}`}
                      {space.tools.length
                        ? ` · ${space.tools.slice(0, 3).map((t) => toolDef(t)?.label ?? t).join(', ')}${space.tools.length > 3 ? '…' : ''}`
                        : ' · без інструментів'}
                    </div>
                  </div>
                </div>

                <div className="flex-1 overflow-y-auto p-2 space-y-0.5">
                  {topics.length === 0 ? (
                    <p className="px-2 py-6 text-[11px] leading-relaxed text-[#1E2521]/55">
                      Топіків ще немає. Топік — це названа розмова всередині
                      простору; створіть перший нижче.
                    </p>
                  ) : (
                    topics.map((t) => (
                      <button
                        key={t.id}
                        onClick={() => openTopic(t.id === activeTopicId ? null : t.id)}
                        aria-pressed={t.id === activeTopicId}
                        className={`w-full min-h-[48px] px-2 rounded-xl flex items-center gap-2 text-sm text-left ${
                          t.id === activeTopicId ? 'bg-[#1E2521] text-[#F7F5EE]' : 'hover:bg-white/70'
                        }`}
                      >
                        <Hash className="w-3.5 h-3.5 opacity-60 shrink-0" />
                        <span className="truncate">{t.title}</span>
                      </button>
                    ))
                  )}
                </div>

                <div className="border-t border-black/5">
                  <button
                    onClick={() => setToolsOpen((v) => !v)}
                    aria-expanded={toolsOpen}
                    aria-label="Інструменти простору"
                    className="w-full min-h-[48px] px-3 flex items-center justify-between text-[11px] font-bold uppercase tracking-widest text-[#1E2521]/70 hover:bg-white/60"
                  >
                    <span>Інструменти</span>
                    <span className="font-mono">{space.tools.length}</span>
                  </button>
                  {toolsOpen && (
                    <div className="px-2 pb-2 space-y-1" data-testid="space-tools">
                      {TOOL_CATALOGUE.map((t) => {
                        const on = space.tools.includes(t.id);
                        return (
                          <button
                            key={t.id}
                            onClick={() => toggleTool(space.id, t.id)}
                            aria-pressed={on}
                            aria-label={`Інструмент ${t.label}`}
                            className={`w-full min-h-[48px] px-2 rounded-xl text-left ${
                              on ? 'bg-[#1E2521] text-[#F7F5EE]' : 'bg-white/60 hover:bg-white'
                            }`}
                          >
                            <div className="text-xs font-semibold">{t.label}</div>
                            <div className={`text-[10px] ${on ? 'opacity-70' : 'opacity-55'}`}>
                              {t.hint}
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>

                <div className="p-2 border-t border-black/5">
                  <input
                    value={newTopic}
                    onChange={(e) => setNewTopic(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key !== 'Enter' || !newTopic.trim()) return;
                      const t = createTopic(space.id, newTopic, me);
                      setNewTopic('');
                      openTopic(t.id);
                    }}
                    placeholder="Новий топік"
                    aria-label="Новий топік"
                    className="w-full min-h-[48px] px-3 rounded-xl bg-white border border-black/10 text-sm"
                  />
                </div>
              </>
            )
          )}
        </div>
      )}
    </div>
  );
};

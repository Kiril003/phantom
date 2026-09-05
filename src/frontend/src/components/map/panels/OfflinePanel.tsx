import { useState } from 'react';
import { OfflineRegionManager } from '../hud/OfflineRegionManager';
import { RoadPackBaker } from '../hud/RoadPackBaker';
import { useBakeStore } from '../../../stores/bakeStore';
import { X } from 'lucide-react';

/**
 * Дороги живуть тут другим реєстром, а не окремою картою чи новим пейном, і
 * це вимір, а не смак: пейн мапи на столі «Театр» — 679×600, а картка
 * офлайну вже 320 px завширшки. Друга картка поруч не влазить по ширині,
 * дві одна під одною — по висоті. Шостого пункту навігації теж не буде:
 * вирок власника лишає стіл на пʼятьох пейнах.
 */

type Register = 'tiles' | 'roads';

export interface OfflinePanelProps {
  open: boolean;
  onClose: () => void;
}

export function OfflinePanel({ open, onClose }: OfflinePanelProps): JSX.Element | null {
  // Якщо піч має що сказати — відкриваємось на «Дорогах». Людина, яка йде сюди
  // з пульса стрічки, йде саме до печі; висадити її на «Тайлах» означало б
  // зробити зайвий клац на кожному поверненні до роботи, що триває годину.
  const bakeSnapshot = useBakeStore((s) => s.snapshot);
  const [register, setRegister] = useState<Register>(bakeSnapshot ? 'roads' : 'tiles');
  if (!open) return null;

  const tabs: Array<[Register, string]> = [
    ['tiles', 'Тайли'],
    ['roads', 'Дороги'],
  ];

  return (
    <div
      className="absolute inset-0 z-40 bg-black/40 backdrop-blur-[2px] flex justify-start pointer-events-none"
      onClick={onClose}
    >
      <div
        className="relative pointer-events-auto ml-[72px] mt-20 flex flex-col gap-2 animate-in zoom-in-95 duration-200"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          onClick={onClose}
          className="absolute -top-3 -right-3 z-10 p-2 rounded-full glass-elevated border border-black/10 text-[color:var(--ink-muted)] hover:text-[color:var(--ink-primary)] backdrop-blur-md shadow-xl transition-all active:scale-90"
        >
          <X size={14} />
        </button>

        <nav
          role="tablist"
          aria-label="офлайн"
          className="w-[320px] shrink-0 glass-card rounded-xl flex items-center gap-0.5 p-1 shadow-xl border border-black/10"
        >
          {tabs.map(([id, label]) => {
            const active = register === id;
            return (
              <button
                key={id}
                role="tab"
                aria-selected={active}
                onClick={() => setRegister(id)}
                data-testid={`offline-register-${id}`}
                className="flex-1 h-[30px] rounded-lg text-[11px] font-semibold uppercase tracking-wider transition-all active:scale-[0.96]"
                style={{
                  color: active ? 'var(--ink-inverse)' : 'var(--ink-muted)',
                  background: active ? 'var(--accent)' : 'transparent',
                }}
              >
                {label}
              </button>
            );
          })}
        </nav>

        {register === 'tiles' ? (
          <OfflineRegionManager className="shadow-2xl border border-black/10" />
        ) : (
          <RoadPackBaker className="shadow-2xl border border-black/10" />
        )}
      </div>
    </div>
  );
}

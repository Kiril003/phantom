import { OfflineRegionManager } from '../hud/OfflineRegionManager';
import { useDeskStore } from '../../../stores/deskStore';
import { useSettingsStore } from '../../../stores/settingsStore';
import { X } from 'lucide-react';

/**
 * Дороги живуть тут другим реєстром, а не окремою картою чи новим пейном, і
 * це вимір, а не смак: пейн мапи на столі «Театр» — 679×600, а картка
 * офлайну вже 320 px завширшки. Друга картка поруч не влазить по ширині,
 * дві одна під одною — по висоті. Шостого пункту навігації теж не буде:
 * вирок власника лишає стіл на пʼятьох пейнах.
 */


export interface OfflinePanelProps {
  open: boolean;
  onClose: () => void;
}

export function OfflinePanel({ open, onClose }: OfflinePanelProps): JSX.Element | null {
  // Якщо піч має що сказати — відкриваємось на «Дорогах». Людина, яка йде сюди
  // з пульса стрічки, йде саме до печі; висадити її на «Тайлах» означало б
  // зробити зайвий клац на кожному поверненні до роботи, що триває годину.
  const openPane = useDeskStore((s) => s.openPane);
  const requestCategory = useSettingsStore((s) => s.requestCategory);
  if (!open) return null;

  // Двері, а не другий дім. Піч живе в Налаштуваннях › Мапа › «Дорожні
  // пакети»: випікання — довга свідома дія, яку роблять сидячи, а HUD існує
  // для того, хто веде авто. Тримати картку в обох місцях означало б два
  // джерела правди про одну роботу.
  const toOven = () => {
    requestCategory('road_packs');
    openPane('settings');
  };

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


        <OfflineRegionManager className="shadow-2xl border border-black/10" />

        {/* Двері до печі. Один рядок, не друга картка: дім печі — Налаштування
            › Мапа › «Дорожні пакети». Тайли (підложка мапи ПК) і дорожні
            пакети (для телефона) — РІЗНІ артефакти, і склеювати їх у два
            реєстри однієї картки означало б натякати, що це одне й те саме. */}
        <button
          onClick={toOven}
          data-testid="offline-door-road-packs"
          className="w-[320px] glass-card rounded-xl px-3 py-2.5 text-left shadow-xl border border-black/10 transition-all active:scale-[0.98]"
        >
          <span className="block text-[11px] font-semibold uppercase tracking-wider"
                style={{ color: 'var(--ink-primary)' }}>
            Дорожні пакети для телефона →
          </span>
          <span className="block text-[10px] mt-0.5" style={{ color: 'var(--ink-muted)' }}>
            маршрути без інтернету — у Налаштуваннях › Мапа
          </span>
        </button>
      </div>
    </div>
  );
}

import { useCallback, useEffect, useRef, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import type { AgentTaskSummary } from '@shared/types';
import { SystemState } from '@shared/types';
import { agentApi } from '../../services/agentApi';
import { request } from '../../services/api';
import { useSystemStore } from '../../stores/systemStore';
import { ExecutionInspector } from '../foundry/ExecutionInspector';

/**
 * Пейн «Компанія» — єдиний вхід агентного світу (вердикт дизайн-дебати
 * агентської сесії, 23.08).
 *
 * Перша секунда: слово стану машини (клік → тихе меню з «Привид»),
 * рядок Волі з РЕАЛЬНИМ N з GET /agent/will/journal (фронт його раніше
 * ніколи не кликав), кількість активних прогонів. Нижче — список
 * прогонів як є, клік веде в наявний ExecutionInspector.
 *
 * Свіжість: Foundry не має ні polling, ні WS — тому «станом на HH:MM»
 * і явна кнопка оновити; слова «живий» тут нема (словник ATLAS v0.2:
 * вік — окремий маркер, не перефарбовування).
 *
 * Контролі — ОДНА смуга на рівні пейна: «Стоп усій Компанії» (чесно:
 * б'є по кожному активному слоту, бо POST /agent/stop без task_id
 * зупиняє лише передній) і «Втрутитись (дійде до активного слоту)».
 * Per-task контролів нема — шина глобальна, per-task стоп був би брехнею.
 *
 * Гонтлет Ф1, удар №2: при нулі активних прогонів обидва контролі
 * disabled зі словом причини поряд («нема активного прогону») — кнопка,
 * що клікається і мовчки нічого не робить, — найгірший клас дефекту.
 * Порожнеча скомпонована (що таке прогін, чому порожньо, одна первинна
 * дія «Дати перше завдання» — реальний POST /agent/task).
 *
 * НЕ малюється (доктрина, не побажання): витрати Волі (атрибуції origin
 * нема), хто запустив прогін (колонки origin нема), токени/гроші
 * (скрізь нулі), «Відкотити», метафори заліза.
 */

const STATE_WORD: Record<SystemState, string> = {
  [SystemState.SHADOW]: 'Тінь',
  [SystemState.FOCUS]: 'Фокус',
  [SystemState.DIALOGUE]: 'Діалог',
  [SystemState.SENTINEL]: 'Вартовий',
  [SystemState.GHOST]: 'Привид',
  [SystemState.DREAM]: 'Сон',
  [SystemState.OPERATOR]: 'Оператор',
};

/** Статус прогону — словом; невідомий статус показуємо як є, не брешемо. */
const STATUS_WORD: Record<string, string> = {
  planning: 'планує',
  running: 'виконує',
  paused: 'пауза',
  awaiting_user: 'чекає вас',
  blocked_quota: 'вперся в квоту',
  queued: 'у черзі',
  complete: 'завершено',
  completed: 'завершено',
  failed: 'провал',
  stopped: 'зупинено',
  cancelled: 'скасовано',
};

const ACTIVE_STATUSES = new Set(['planning', 'running', 'paused', 'awaiting_user', 'blocked_quota']);

interface WillEntry {
  ts: string;
  action: string;
  task_id: string | null;
  outcome: string | null;
  decision: Record<string, unknown>;
  budget_delta: Record<string, unknown>;
}

const WILL_SEEN_KEY = 'phantom.company.will-seen.v1';

function hhmm(d: Date): string {
  return d.toLocaleTimeString('uk-UA', { hour: '2-digit', minute: '2-digit' });
}

export default function CompanyPane() {
  const systemState = useSystemStore((s) => s.state);
  const previousState = useSystemStore((s) => s.previousState);
  const setSystemState = useSystemStore((s) => s.setState);

  const [tasks, setTasks] = useState<AgentTaskSummary[] | null>(null);
  const [tasksError, setTasksError] = useState(false);
  const [will, setWill] = useState<WillEntry[] | null>(null);
  const [willError, setWillError] = useState(false);
  const [loadedAt, setLoadedAt] = useState<Date | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const [journalOpen, setJournalOpen] = useState(false);
  const [selectedTask, setSelectedTask] = useState<AgentTaskSummary | null>(null);
  const [stateMenuOpen, setStateMenuOpen] = useState(false);
  /** Смуга контролів: null — кнопки; 'intervene' — інпут у слот; 'launch' — інпут нового завдання. */
  const [barMode, setBarMode] = useState<null | 'intervene' | 'launch'>(null);
  const [barText, setBarText] = useState('');
  const [controlWord, setControlWord] = useState<string | null>(null);
  const alive = useRef(true);

  const load = useCallback(async () => {
    setRefreshing(true);
    const [tasksRes, willRes] = await Promise.allSettled([
      agentApi.listTasks(undefined, 50),
      request<{ entries: WillEntry[] }>('GET', '/agent/will/journal?limit=100'),
    ]);
    if (!alive.current) return;
    if (tasksRes.status === 'fulfilled') {
      setTasks(tasksRes.value.tasks);
      setTasksError(false);
    } else {
      setTasksError(true);
    }
    if (willRes.status === 'fulfilled') {
      setWill(willRes.value.entries);
      setWillError(false);
    } else {
      setWillError(true);
    }
    setLoadedAt(new Date());
    setRefreshing(false);
  }, []);

  useEffect(() => {
    alive.current = true;
    void load();
    return () => {
      alive.current = false;
    };
  }, [load]);

  /* Воля: «поки вас не було» = записи, новіші за останній перегляд
   * журналу (localStorage). Немає позначки — рахуємо всі наявні. */
  const willSeenTs = ((): number => {
    try {
      const raw = localStorage.getItem(WILL_SEEN_KEY);
      return raw ? Number(raw) : 0;
    } catch {
      return 0;
    }
  })();
  const willUnseen = (will ?? []).filter((e) => {
    const t = Date.parse(e.ts);
    return Number.isFinite(t) ? t > willSeenTs : true;
  }).length;

  const activeCount = (tasks ?? []).filter((t) => ACTIVE_STATUSES.has(t.status)).length;

  /* Озброєність контролів: «Стоп» і «Втрутитись» мають сенс лише коли є
   * активний прогін. Інакше — disabled зі СЛОВОМ причини поряд, а не
   * клікабельна кнопка, що мовчки нічого не робить. */
  const controlReason = tasksError
    ? 'ядро не відповіло'
    : tasks === null
      ? 'читаю прогони…'
      : activeCount === 0
        ? 'нема активного прогону'
        : null;
  const armed = controlReason === null;

  const openJournal = () => {
    setJournalOpen(true);
    try {
      localStorage.setItem(WILL_SEEN_KEY, String(Date.now()));
    } catch {
      /* ignore */
    }
  };

  /** Чесний «Стоп усій Компанії»: б'є по КОЖНОМУ активному слоту. */
  const stopAll = async () => {
    try {
      const st = await agentApi.status();
      const ids = [st.foreground, st.background]
        .filter((slot) => slot.active && slot.task_id)
        .map((slot) => slot.task_id as string);
      if (ids.length === 0) {
        setControlWord('активних прогонів немає');
        return;
      }
      await Promise.allSettled(ids.map((id) => agentApi.stop(id)));
      setControlWord(`стоп надіслано: ${ids.length} слот(и)`);
      void load();
    } catch {
      setControlWord('ядро не відповіло');
    }
  };

  const sendIntervention = async () => {
    const text = barText.trim();
    if (!text) return;
    try {
      const st = await agentApi.status();
      const slot = st.foreground.active ? st.foreground : st.background.active ? st.background : null;
      if (!slot?.task_id) {
        setControlWord('активного слоту немає');
        return;
      }
      await agentApi.intervene(slot.task_id, text);
      setControlWord('передано в активний слот');
      setBarText('');
      setBarMode(null);
    } catch {
      setControlWord('ядро не відповіло');
    }
  };

  /** Нове завдання — реальний POST /agent/task, жодних симуляцій. */
  const sendLaunch = async () => {
    const goal = barText.trim();
    if (!goal) return;
    try {
      const res = await agentApi.startTask(goal);
      setControlWord(
        res.started
          ? 'прогін запущено'
          : res.queued
            ? 'поставлено в чергу — слот зайнятий'
            : (res.detail ?? 'ядро відмовило без пояснення'),
      );
      setBarText('');
      setBarMode(null);
      void load();
    } catch {
      setControlWord('ядро не відповіло');
    }
  };

  const ghostLabel =
    systemState === SystemState.GHOST ? 'Повернутись з Привида' : 'Привид';
  const toggleGhost = () => {
    setStateMenuOpen(false);
    const to =
      systemState === SystemState.GHOST ? (previousState ?? SystemState.SHADOW) : SystemState.GHOST;
    setSystemState(to, { trigger: 'company-state-menu', timestamp: Date.now(), auto: false });
  };

  /* ── Журнал рішень Волі на весь пейн ────────────────────────────────── */
  if (journalOpen) {
    return (
      <div className="flex flex-col w-full h-full min-h-0" style={{ background: 'var(--ph-color-surface)' }}>
        <div
          className="flex items-center shrink-0"
          style={{ height: 40, gap: 'var(--ph-space-3)', padding: '0 var(--ph-space-4)', borderBottom: 'var(--ph-stroke-hair) solid var(--ph-color-border)' }}
        >
          <button
            type="button"
            onClick={() => setJournalOpen(false)}
            style={{ fontSize: 'var(--ph-type-caption-size)', color: 'var(--ph-color-accent)' }}
          >
            ← Назад
          </button>
          <span style={{ fontSize: 'var(--ph-type-caption-size)', color: 'var(--ph-color-ink)' }}>
            Журнал рішень Волі
          </span>
          {loadedAt && (
            <span style={{ fontSize: 11, color: 'var(--ph-color-ink-muted)' }}>
              станом на {hhmm(loadedAt)}
            </span>
          )}
        </div>
        <div className="flex-1 min-h-0 overflow-y-auto" style={{ padding: 'var(--ph-space-4)' }}>
          {willError && <Word text="журнал недоступний — ядро не відповіло" />}
          {!willError && will !== null && will.length === 0 && <Word text="рішень ще не було" />}
          {!willError &&
            (will ?? []).map((e, i) => {
              const t = Date.parse(e.ts);
              return (
                <div
                  key={`${e.ts}-${i}`}
                  style={{
                    padding: 'var(--ph-space-3) 0',
                    borderBottom: 'var(--ph-stroke-hair) solid var(--ph-color-border)',
                  }}
                >
                  <div className="flex items-baseline" style={{ gap: 'var(--ph-space-3)' }}>
                    <span style={{ fontFamily: 'var(--ph-font-mono)', fontSize: 11, color: 'var(--ph-color-ink-muted)' }}>
                      {Number.isFinite(t)
                        ? new Date(t).toLocaleString('uk-UA', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
                        : e.ts}
                    </span>
                    <span style={{ fontSize: 'var(--ph-type-caption-size)', color: 'var(--ph-color-ink)' }}>
                      {e.action}
                    </span>
                    {e.outcome && (
                      <span style={{ fontSize: 11, color: 'var(--ph-color-ink-muted)' }}>{e.outcome}</span>
                    )}
                  </div>
                  {e.task_id && (
                    <div style={{ fontFamily: 'var(--ph-font-mono)', fontSize: 10, color: 'var(--ph-color-ink-faint)', marginTop: 2 }}>
                      прогін {e.task_id.slice(0, 8)}
                    </div>
                  )}
                </div>
              );
            })}
        </div>
      </div>
    );
  }

  /* ── Основний вид ───────────────────────────────────────────────────── */
  return (
    <div className="relative flex flex-col w-full h-full min-h-0" style={{ background: 'var(--ph-color-surface)' }}>
      {/* Перша секунда: стан, Воля, активні прогони */}
      <div
        className="shrink-0"
        style={{ padding: 'var(--ph-space-4) var(--ph-space-4) var(--ph-space-3)', borderBottom: 'var(--ph-stroke-hair) solid var(--ph-color-border)' }}
      >
        <div className="relative flex items-center" style={{ gap: 'var(--ph-space-4)' }}>
          <button
            type="button"
            title="Стан машини"
            onClick={() => setStateMenuOpen((v) => !v)}
            className="uppercase"
            style={{
              fontFamily: 'var(--ph-font-display)',
              fontSize: 'var(--ph-type-title-size)',
              fontWeight: 600,
              letterSpacing: '0.08em',
              color: 'var(--ph-color-ink)',
              background: 'transparent',
            }}
          >
            {STATE_WORD[systemState]}
          </button>
          {stateMenuOpen && (
            <div
              className="absolute"
              style={{
                top: '100%',
                left: 0,
                zIndex: 20,
                marginTop: 4,
                borderRadius: 'var(--ph-radius-s)',
                border: 'var(--ph-stroke-hair) solid var(--ph-color-border)',
                background: 'var(--ph-color-surface-raised)',
                boxShadow: 'var(--ph-shadow-2)',
              }}
            >
              <button
                type="button"
                onClick={toggleGhost}
                style={{
                  padding: 'var(--ph-space-2) var(--ph-space-4)',
                  fontSize: 'var(--ph-type-caption-size)',
                  color: 'var(--ph-color-ink)',
                  whiteSpace: 'nowrap',
                }}
              >
                {ghostLabel}
              </button>
            </div>
          )}
          <span className="flex-1" />
          {loadedAt && (
            <span style={{ fontSize: 11, color: 'var(--ph-color-ink-muted)' }}>
              План, станом на {hhmm(loadedAt)}
            </span>
          )}
          <button
            type="button"
            aria-label="Оновити"
            title="Оновити"
            onClick={() => void load()}
            className="flex items-center justify-center"
            style={{ width: 26, height: 26, borderRadius: 'var(--ph-radius-s)', color: 'var(--ph-color-ink-muted)' }}
          >
            <RefreshCw size={13} strokeWidth={1.75} className={refreshing ? 'animate-spin' : undefined} />
          </button>
        </div>

        <div className="flex items-center" style={{ gap: 'var(--ph-space-5)', marginTop: 'var(--ph-space-3)' }}>
          <button
            type="button"
            onClick={openJournal}
            style={{ fontSize: 'var(--ph-type-caption-size)', color: 'var(--ph-color-ink)', textAlign: 'left' }}
          >
            {willError
              ? 'Воля: журнал недоступний'
              : will === null
                ? 'Воля: читаю журнал…'
                : will.length === 0
                  ? 'Воля: рішень ще не було'
                  : `Поки вас не було: ${willUnseen === 100 ? '100 і більше' : willUnseen} рішень`}
            <span style={{ color: 'var(--ph-color-accent)', marginLeft: 6 }}>журнал →</span>
          </button>
          <span style={{ fontSize: 'var(--ph-type-caption-size)', color: 'var(--ph-color-ink-muted)' }}>
            {tasksError ? 'прогони: ядро не відповіло' : `активних прогонів: ${activeCount}`}
          </span>
        </div>
      </div>

      {/* Список прогонів як є */}
      <div className="flex-1 min-h-0 overflow-y-auto" style={{ padding: 'var(--ph-space-2) var(--ph-space-4)' }}>
        {tasksError && <Word text="ядро не відповіло — список прогонів недоступний" />}
        {/* Порожнеча — скомпонована: що це, чому порожньо, ОДНА первинна дія.
         * Не «сторінка не долоадилась», а спроєктована тиша. */}
        {!tasksError && tasks !== null && tasks.length === 0 && (
          <div
            className="h-full flex flex-col items-center justify-center text-center"
            style={{ gap: 'var(--ph-space-3)', padding: 'var(--ph-space-6) var(--ph-space-5)' }}
          >
            <span
              style={{
                fontSize: 'var(--ph-type-title-size)',
                fontWeight: 600,
                letterSpacing: '0.02em',
                color: 'var(--ph-color-ink)',
              }}
            >
              Прогонів ще не було
            </span>
            <span
              style={{
                maxWidth: 380,
                fontSize: 'var(--ph-type-caption-size)',
                lineHeight: 1.5,
                color: 'var(--ph-color-ink-muted)',
              }}
            >
              Прогін — це завдання, яке Компанія веде сама: планує кроки, діє
              і лишає слід у журналі Волі. Тут з&apos;явиться кожен — живий і
              завершений.
            </span>
            <button
              type="button"
              onClick={() => setBarMode('launch')}
              style={{
                marginTop: 'var(--ph-space-2)',
                height: 'var(--ph-touch-target, 44px)',
                minHeight: 44,
                padding: '0 var(--ph-space-5)',
                fontSize: 'var(--ph-type-caption-size)',
                fontWeight: 600,
                color: 'var(--ph-color-accent)',
                border: 'var(--ph-stroke-hair) solid var(--ph-color-accent)',
                borderRadius: 'var(--ph-radius-s)',
                background: 'transparent',
              }}
            >
              Дати перше завдання
            </button>
          </div>
        )}
        {!tasksError &&
          (tasks ?? []).map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setSelectedTask(t)}
              className="block w-full text-left"
              style={{
                padding: 'var(--ph-space-3) 0',
                borderBottom: 'var(--ph-stroke-hair) solid var(--ph-color-border)',
                background: 'transparent',
              }}
            >
              <div className="flex items-baseline" style={{ gap: 'var(--ph-space-3)' }}>
                <span
                  className="truncate"
                  style={{ flex: 1, fontSize: 'var(--ph-type-caption-size)', color: 'var(--ph-color-ink)' }}
                >
                  {t.goal}
                </span>
                <span
                  style={{
                    fontSize: 11,
                    color: ACTIVE_STATUSES.has(t.status)
                      ? 'var(--ph-color-accent)'
                      : 'var(--ph-color-ink-muted)',
                  }}
                >
                  {STATUS_WORD[t.status] ?? t.status}
                </span>
              </div>
              <div style={{ fontFamily: 'var(--ph-font-mono)', fontSize: 10, color: 'var(--ph-color-ink-faint)', marginTop: 2 }}>
                {new Date(t.created_at).toLocaleString('uk-UA', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
                {' · '}
                {t.track === 'background' ? 'тло' : 'передній план'}
              </div>
            </button>
          ))}
      </div>

      {/* ОДНА смуга контролів на рівні пейна */}
      <div
        className="shrink-0"
        style={{ borderTop: 'var(--ph-stroke-hair) solid var(--ph-color-border)', padding: 'var(--ph-space-3) var(--ph-space-4)' }}
      >
        {barMode !== null ? (
          <div className="flex items-center" style={{ gap: 'var(--ph-space-2)' }}>
            <input
              autoFocus
              value={barText}
              onChange={(e) => setBarText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void (barMode === 'launch' ? sendLaunch() : sendIntervention());
                if (e.key === 'Escape') {
                  setBarMode(null);
                  setBarText('');
                }
              }}
              placeholder={
                barMode === 'launch'
                  ? 'Що доручити Компанії — одним реченням…'
                  : 'Що передати активному слоту…'
              }
              className="flex-1"
              style={{
                height: 30,
                padding: '0 var(--ph-space-3)',
                fontSize: 'var(--ph-type-caption-size)',
                color: 'var(--ph-color-ink)',
                background: 'var(--ph-color-surface-raised)',
                border: 'var(--ph-stroke-hair) solid var(--ph-color-border)',
                borderRadius: 'var(--ph-radius-s)',
              }}
            />
            <ControlButton
              label={barMode === 'launch' ? 'Запустити' : 'Надіслати'}
              onClick={() => void (barMode === 'launch' ? sendLaunch() : sendIntervention())}
            />
            <ControlButton
              label="Скасувати"
              onClick={() => {
                setBarMode(null);
                setBarText('');
              }}
            />
          </div>
        ) : (
          <div className="flex items-center" style={{ gap: 'var(--ph-space-3)' }}>
            {tasks !== null && !tasksError && tasks.length > 0 && (
              <ControlButton label="Нове завдання" onClick={() => setBarMode('launch')} />
            )}
            <ControlButton
              label="Стоп усій Компанії"
              tone="danger"
              disabled={!armed}
              reason={controlReason}
              onClick={() => void stopAll()}
            />
            <ControlButton
              label="Втрутитись (дійде до активного слоту)"
              disabled={!armed}
              reason={controlReason}
              onClick={() => setBarMode('intervene')}
            />
            {/* Гонтлет Р2, Н4: причина роззброєння стоїть ВПРИТУЛ до своїх
             * кнопок (плюс тултіп на самій кнопці), а не через ~1500px
             * порожнечі футера в дальньому куті. */}
            {controlReason && (
              <span style={{ fontSize: 11, color: 'var(--ph-color-ink-muted)' }}>
                {controlReason}
              </span>
            )}
            <span className="flex-1" />
            {controlWord && (
              <span style={{ fontSize: 11, color: 'var(--ph-color-ink-muted)' }}>
                {controlWord}
              </span>
            )}
          </div>
        )}
      </div>

      {/* Наявний інспектор прогону — поверх пейна; per-task контролів тут нема */}
      {selectedTask && (
        <div className="absolute inset-0" style={{ zIndex: 30, background: 'var(--ph-color-surface)' }}>
          <ExecutionInspector
            task={selectedTask}
            onClose={() => setSelectedTask(null)}
            onChanged={() => void load()}
          />
        </div>
      )}
    </div>
  );
}

/** Стан несе слово. */
function Word({ text }: { text: string }) {
  return (
    <div style={{ padding: 'var(--ph-space-6) 0', textAlign: 'center' }}>
      <span style={{ fontSize: 12, letterSpacing: '0.06em', color: 'var(--ph-color-ink-muted)' }}>
        {text}
      </span>
    </div>
  );
}

function ControlButton({
  label,
  onClick,
  tone = 'default',
  disabled = false,
  reason,
}: {
  label: string;
  onClick: () => void;
  tone?: 'default' | 'danger';
  /** Роззброєна кнопка: не клікається, причина — словом поряд (reason). */
  disabled?: boolean;
  reason?: string | null;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-disabled={disabled}
      title={disabled ? (reason ?? undefined) : undefined}
      style={{
        height: 'var(--ph-control-min)',
        padding: '0 var(--ph-control-pad-x)',
        fontSize: 'var(--ph-type-caption-size)',
        color: disabled
          ? 'var(--ph-color-ink-faint)'
          : tone === 'danger'
            ? 'var(--ph-color-danger)'
            : 'var(--ph-color-ink)',
        border: `var(--ph-stroke-hair) solid ${
          disabled
            ? 'var(--ph-color-border)'
            : tone === 'danger'
              ? 'var(--ph-color-danger)'
              : 'var(--ph-color-border)'
        }`,
        borderRadius: 'var(--ph-radius-s)',
        background: 'transparent',
        whiteSpace: 'nowrap',
        cursor: disabled ? 'not-allowed' : undefined,
        opacity: disabled ? 0.55 : 1,
      }}
    >
      {label}
    </button>
  );
}

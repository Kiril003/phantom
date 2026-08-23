/**
 * Ф1.5 — «Небезпечна зона» Налаштувань.
 *
 * Дії, що стирають, живуть окремим підрозділом (розділ «Система»),
 * а не кнопкою в шапці поряд зі «Зберегти». Кожна дія вимагає
 * озброєння у стилі командної палітри: перший Enter/клік лише зводить
 * (кнопка міняє слово на «…ще раз»), другий — виконує. Esc або втрата
 * фокуса роззброюють.
 *
 * Тут ЛИШЕ дії, що реально існують у API: скидання налаштувань
 * (POST /settings/reset — розділ або все). Стирання памʼяті ШІ не має
 * ендпойнта — тож його тут чесно НЕМА, замість вигаданої кнопки.
 */
import { useCallback, useState } from 'react';
import type { SettingsCategory } from '@shared/types';
import { settingsApi } from '../../services/api';

type ArmedAction = 'reset-category' | 'reset-all' | null;

export interface DangerZonePanelProps {
  /** Справжні категорії з бекенда — лише ті, де є що скидати. */
  categories: SettingsCategory[];
  /** Після успішного скидання панель просить свіжі дані. */
  onAfterReset: () => Promise<unknown> | void;
}

export function DangerZonePanel({ categories, onAfterReset }: DangerZonePanelProps) {
  const resettable = categories.filter((c) => c.settings.length > 0);
  const [categoryId, setCategoryId] = useState<string>(resettable[0]?.id ?? '');
  const [armed, setArmed] = useState<ArmedAction>(null);
  const [status, setStatus] = useState<
    | { kind: 'idle' }
    | { kind: 'busy' }
    | { kind: 'done'; msg: string }
    | { kind: 'error'; msg: string }
  >({ kind: 'idle' });

  const run = useCallback(
    async (action: 'reset-category' | 'reset-all') => {
      // Перший виклик лише озброює; виконує тільки повторний по тій
      // самій дії (перемикання дії переозброює, не виконує).
      if (armed !== action) {
        setArmed(action);
        return;
      }
      setArmed(null);
      setStatus({ kind: 'busy' });
      try {
        const res =
          action === 'reset-all'
            ? await settingsApi.reset()
            : await settingsApi.reset(categoryId);
        await onAfterReset();
        setStatus({
          kind: 'done',
          msg: `Скинуто значень: ${res.reset_count}`,
        });
      } catch (err) {
        setStatus({
          kind: 'error',
          msg: err instanceof Error ? err.message : 'Скинути не вдалося',
        });
      }
    },
    [armed, categoryId, onAfterReset]
  );

  const disarm = useCallback(() => setArmed(null), []);

  const categoryLabel =
    resettable.find((c) => c.id === categoryId)?.label ?? categoryId;

  return (
    <div
      data-testid="danger-zone"
      onKeyDown={(e) => {
        if (e.key === 'Escape' && armed) {
          e.stopPropagation();
          disarm();
        }
      }}
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 'var(--ph-space-3, 12px)',
        padding: 'var(--ph-space-4, 16px)',
        borderRadius: 'var(--ph-radius-m, 10px)',
        border:
          'var(--ph-stroke-thin, 1px) solid color-mix(in srgb, var(--ph-color-danger, #C7373D) 45%, transparent)',
        background:
          'color-mix(in srgb, var(--ph-color-danger, #C7373D) 6%, transparent)',
      }}
    >
      <div
        style={{
          fontFamily: 'var(--ph-font-display, system-ui)',
          fontSize: 'var(--ph-type-caption-size, 12.5px)',
          fontWeight: 600,
          letterSpacing: '0.06em',
          textTransform: 'uppercase',
          color: 'var(--ph-color-danger, #C7373D)',
        }}
      >
        Небезпечна зона
      </div>
      <p
        style={{
          margin: 0,
          fontSize: 'var(--ph-type-caption-size, 12.5px)',
          color: 'var(--ph-color-ink-muted, #5A5F66)',
          maxWidth: '52ch',
        }}
      >
        Дії нижче стирають зроблені налаштування і повертають типові
        значення. Кожна вимагає двох натискань: перше зводить, друге
        виконує. Esc — відбій.
      </p>

      {/* ── Скинути один підрозділ ─────────────────────────────────── */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: 'var(--ph-space-2, 8px)',
        }}
      >
        <label
          htmlFor="danger-reset-category"
          style={{
            fontSize: 'var(--ph-type-caption-size, 12.5px)',
            color: 'var(--ph-color-ink, #1C1F23)',
          }}
        >
          Скинути підрозділ
        </label>
        <select
          id="danger-reset-category"
          value={categoryId}
          onChange={(e) => {
            setCategoryId(e.target.value);
            disarm();
          }}
          style={{
            minHeight: 'var(--ph-control-min, 28px)',
            padding: '0 var(--ph-space-2, 8px)',
            borderRadius: 'var(--ph-radius-s, 6px)',
            border: 'var(--ph-stroke-thin, 1px) solid var(--ph-color-border, #D8D2C6)',
            background: 'var(--ph-color-surface, #fff)',
            color: 'var(--ph-color-ink, #1C1F23)',
            fontSize: 'var(--ph-type-caption-size, 12.5px)',
          }}
        >
          {resettable.map((c) => (
            <option key={c.id} value={c.id}>
              {c.label}
            </option>
          ))}
        </select>
        <ArmableButton
          armed={armed === 'reset-category'}
          idleLabel={`Скинути «${categoryLabel}»`}
          armedLabel="Точно скинути — натисни ще раз"
          disabled={status.kind === 'busy' || resettable.length === 0}
          onActivate={() => void run('reset-category')}
          onDisarm={disarm}
        />
      </div>

      {/* ── Скинути все ────────────────────────────────────────────── */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: 'var(--ph-space-2, 8px)',
        }}
      >
        <span
          style={{
            fontSize: 'var(--ph-type-caption-size, 12.5px)',
            color: 'var(--ph-color-ink, #1C1F23)',
          }}
        >
          Скинути ВСІ налаштування до типових
        </span>
        <ArmableButton
          armed={armed === 'reset-all'}
          idleLabel="Скинути все"
          armedLabel="ВСЕ до типових — натисни ще раз"
          disabled={status.kind === 'busy'}
          onActivate={() => void run('reset-all')}
          onDisarm={disarm}
        />
      </div>

      {status.kind === 'busy' && (
        <span style={{ fontSize: 12, color: 'var(--ph-color-ink-muted, #5A5F66)' }}>
          Скидаю…
        </span>
      )}
      {status.kind === 'done' && (
        <span style={{ fontSize: 12, color: 'var(--ph-color-success, #1F9D62)' }}>
          {status.msg}
        </span>
      )}
      {status.kind === 'error' && (
        <span style={{ fontSize: 12, color: 'var(--ph-color-danger, #C7373D)' }}>
          {status.msg}
        </span>
      )}
    </div>
  );
}

/**
 * Кнопка з озброєнням: клік/Enter №1 зводить (слово міняється і фарба
 * стає небезпечною), №2 виконує; blur та Esc роззброюють.
 */
function ArmableButton({
  armed,
  idleLabel,
  armedLabel,
  disabled,
  onActivate,
  onDisarm,
}: {
  armed: boolean;
  idleLabel: string;
  armedLabel: string;
  disabled?: boolean;
  onActivate: () => void;
  onDisarm: () => void;
}) {
  return (
    <button
      type="button"
      data-armed={armed ? 'true' : undefined}
      disabled={disabled}
      onClick={onActivate}
      onBlur={onDisarm}
      style={{
        minHeight: 'var(--ph-control-min, 28px)',
        padding: '0 var(--ph-space-3, 12px)',
        borderRadius: 'var(--ph-radius-s, 6px)',
        cursor: disabled ? 'default' : 'pointer',
        fontFamily: 'var(--ph-font-ui, system-ui)',
        fontSize: 'var(--ph-type-caption-size, 12.5px)',
        fontWeight: 600,
        transition: 'background var(--ph-motion-fast, 120ms) var(--ph-ease-standard, ease)',
        border: `var(--ph-stroke-thin, 1px) solid ${
          armed
            ? 'var(--ph-color-danger, #C7373D)'
            : 'color-mix(in srgb, var(--ph-color-danger, #C7373D) 55%, transparent)'
        }`,
        background: armed
          ? 'var(--ph-color-danger, #C7373D)'
          : 'transparent',
        color: armed ? 'var(--ph-color-surface, #fff)' : 'var(--ph-color-danger, #C7373D)',
        opacity: disabled ? 0.5 : 1,
      }}
    >
      {armed ? armedLabel : idleLabel}
    </button>
  );
}

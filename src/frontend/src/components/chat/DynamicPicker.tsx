/**
 * Day-4 Wave-2 W-4 — `<DynamicPicker>` consumer (ADR-XC-007 +
 * `docs/architecture/chat-liveness.md` §402).
 *
 * Touch-friendly select that resolves its options from the backend
 * `GET /api/v1/dynamic_source/{source}` route (W-4 producer). Picks
 * mount-resolve once, cache via the backend's per-source ttl, and
 * re-fetch on `refreshKey` bumps so the operator can hit "I just
 * plugged a serial device" without remounting the parent.
 *
 * Day-4 ship contract:
 *  - 44×44 minimum tap target on the trigger.
 *  - Dropdown rows ≥ 44 px tall.
 *  - Empty resolver result → render the `placeholder` text (caller's
 *    responsibility to pick a sensible default like "no models found").
 *  - Network failure → log via console.warn, render placeholder.
 *  - The trigger button shows the *label* of the currently-selected
 *    option (matched by value) so the operator never sees a raw
 *    technical id.
 */
import { useCallback, useEffect, useState } from 'react';
import { ChevronDown, Loader2 } from 'lucide-react';
import type {
  DynamicPickerOption,
  DynamicPickerProps,
  DynamicPickerSource,
} from '@shared/types';

interface DynamicSourceResponse {
  source: DynamicPickerSource;
  options: DynamicPickerOption[];
  fetched_at: number;
  ttl_s: number;
}

const ENDPOINT = (source: DynamicPickerSource) =>
  `/api/v1/dynamic_source/${source}`;

async function fetchSource(
  source: DynamicPickerSource
): Promise<DynamicPickerOption[]> {
  try {
    const res = await fetch(ENDPOINT(source), {
      method: 'GET',
      headers: { 'Accept': 'application/json' },
    });
    if (!res.ok) {
      console.warn(
        `DynamicPicker: GET ${ENDPOINT(source)} → ${res.status}`
      );
      return [];
    }
    const body = (await res.json()) as DynamicSourceResponse;
    if (!body || !Array.isArray(body.options)) return [];
    return body.options.filter(
      (o): o is DynamicPickerOption =>
        typeof o === 'object' &&
        o !== null &&
        typeof (o as DynamicPickerOption).value === 'string' &&
        typeof (o as DynamicPickerOption).label === 'string'
    );
  } catch (exc) {
    console.warn(`DynamicPicker: ${ENDPOINT(source)} fetch failed`, exc);
    return [];
  }
}

export function DynamicPicker({
  source,
  value,
  onChange,
  placeholder,
  refreshKey = 0,
  disabled = false,
}: DynamicPickerProps) {
  const [options, setOptions] = useState<DynamicPickerOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);

  const resolve = useCallback(
    async (signal: AbortSignal) => {
      setLoading(true);
      const list = await fetchSource(source);
      if (signal.aborted) return;
      setOptions(list);
      setLoading(false);
    },
    [source]
  );

  useEffect(() => {
    const ctrl = new AbortController();
    void resolve(ctrl.signal);
    return () => ctrl.abort();
  }, [resolve, refreshKey]);

  const selected = options.find((o) => o.value === value) ?? null;
  const triggerLabel = selected?.label ?? value ?? placeholder ?? '—';
  const empty = !loading && options.length === 0;

  return (
    <div
      className="relative"
      data-testid="dynamic-picker"
      data-source={source}
      data-loading={loading ? '1' : '0'}
      data-empty={empty ? '1' : '0'}
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        disabled={disabled || loading}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={`Select ${source}`}
        data-testid="dynamic-picker-trigger"
        className="flex items-center gap-2 w-full text-left transition-colors"
        style={{
          minWidth: 44,
          minHeight: 44,
          padding: '8px 12px',
          borderRadius: 12,
          background: 'var(--glass-subtle)',
          border: `1px solid ${open ? 'var(--accent)' : 'var(--glass-border)'}`,
          color: empty ? 'var(--ink-muted)' : 'var(--ink-primary)',
          fontFamily: 'var(--font-display)',
          fontSize: 'var(--fs-sm)',
          opacity: disabled ? 0.5 : 1,
        }}
      >
        {loading ? (
          <Loader2
            size={14}
            strokeWidth={1.75}
            className="animate-spin"
            color="var(--accent)"
            aria-hidden
          />
        ) : (
          <ChevronDown
            size={14}
            strokeWidth={1.75}
            color="var(--ink-secondary)"
            aria-hidden
          />
        )}
        <span className="flex-1 truncate">{triggerLabel}</span>
        {selected?.meta?.size_mb !== undefined && (
          <span
            className="tabular-nums"
            style={{
              fontFamily: 'var(--font-mono)',
              fontSize: 'var(--fs-micro)',
              color: 'var(--ink-muted)',
            }}
          >
            {selected.meta.size_mb}MB
          </span>
        )}
      </button>

      {open && !disabled && !loading && (
        <ul
          role="listbox"
          className="absolute left-0 right-0 z-20 mt-1 glass-panel rounded-xl py-1"
          style={{
            maxHeight: 280,
            overflowY: 'auto',
            border: '1px solid var(--glass-border)',
            boxShadow:
              '0 8px 30px -8px color-mix(in srgb, var(--accent) 18%, transparent)',
          }}
          data-testid="dynamic-picker-list"
        >
          {empty && (
            <li
              className="px-3 py-2"
              style={{
                fontFamily: 'var(--font-display)',
                fontSize: 'var(--fs-micro)',
                color: 'var(--ink-muted)',
                letterSpacing: 'var(--tracking-wide)',
              }}
            >
              {placeholder ?? 'No options'}
            </li>
          )}
          {options.map((opt) => {
            const active = opt.value === value;
            return (
              <li key={opt.value} role="option" aria-selected={active}>
                <button
                  type="button"
                  onClick={() => {
                    onChange(opt.value);
                    setOpen(false);
                  }}
                  className="flex items-center gap-2 w-full text-left transition-colors"
                  style={{
                    minHeight: 44,
                    padding: '6px 10px',
                    background: active
                      ? 'color-mix(in srgb, var(--accent) 12%, transparent)'
                      : 'transparent',
                    color: 'var(--ink-primary)',
                    fontFamily: 'var(--font-display)',
                    fontSize: 'var(--fs-sm)',
                    border: 'none',
                  }}
                  data-active={active ? '1' : '0'}
                >
                  <span className="flex-1 truncate">{opt.label}</span>
                  {opt.meta?.provider && (
                    <span
                      style={{
                        fontFamily: 'var(--font-mono)',
                        fontSize: 'var(--fs-micro)',
                        color: 'var(--ink-muted)',
                      }}
                    >
                      {opt.meta.provider}
                    </span>
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {/* Refresh affordance is reserved for Day-5 (surfacing a button
          here triggers re-fetch even before the backend ttl expires —
          useful for serial_ports after plugging a device). Day-4 keeps
          the refresh path callable only via the parent's refreshKey
          prop bump. */}
    </div>
  );
}

/**
 * Phase 17a.5 — InfoNeedDialog.
 *
 * The agent's typed prompt to the operator. Variants:
 *   • text          → autosizing textarea
 *   • single_choice → grid of cards, tap-to-pick (with optional preview image)
 *   • multi_choice  → grid of cards, multi-toggle, “Готово” to submit
 *   • file_pick     → path text input + drag/drop hint (real picker tbd)
 *   • range         → slider with live readout
 *   • confirm       → big yes/no with explanation
 *   • visual_pick   → image grid, tap-to-pick
 *
 * Receives the InfoNeed via `useAgentStore.currentInfoNeed`. On submit it
 * calls `respondToInfoNeed(answer)` which POSTs to the BE and clears the
 * pending state.
 *
 * Sized to fit 1024×600 — auto-shrinks tile sizes to keep the dialog
 * within frame without scrolling the main screen.
 */
import { useEffect, useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Check, X, ArrowUpRight, ChevronRight, Image as ImageIcon } from 'lucide-react';
import type { AgentInfoNeed, AgentInfoNeedOption } from '@shared/types';

interface Props {
  infoNeed: AgentInfoNeed;
  busy?: boolean;
  onSubmit: (answer: unknown) => Promise<void> | void;
  onCancel?: () => void;
}

function Header({ infoNeed }: { infoNeed: AgentInfoNeed }) {
  return (
    <header
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 4,
        paddingBottom: 8,
        borderBottom: '1px solid var(--glass-border, rgba(180,150,90,0.20))',
      }}
    >
      <span className="eyebrow-amber" style={{ fontSize: 11 }}>
        АГЕНТ ПИТАЄ
      </span>
      <h2
        style={{
          margin: 0,
          fontSize: 20,
          fontFamily: 'Manrope, sans-serif',
          color: 'var(--ink-strong, #1F1A11)',
          lineHeight: 1.2,
        }}
      >
        {infoNeed.question}
      </h2>
      {infoNeed.hint && (
        <span
          style={{
            fontSize: 12,
            color: 'var(--ink-muted)',
            fontStyle: 'italic',
            lineHeight: 1.35,
          }}
        >
          {infoNeed.hint}
        </span>
      )}
    </header>
  );
}

function OptionCard({
  option,
  selected,
  onClick,
  compact = false,
}: {
  option: AgentInfoNeedOption;
  selected: boolean;
  onClick: () => void;
  compact?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        textAlign: 'left',
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
        padding: compact ? '10px 12px' : '12px 14px',
        minHeight: compact ? 76 : 96,
        borderRadius: 14,
        border: `1px solid ${selected ? 'rgba(244,175,37,0.55)' : 'rgba(180,150,90,0.22)'}`,
        background: selected
          ? 'linear-gradient(180deg, rgba(244,175,37,0.18) 0%, rgba(244,175,37,0.06) 100%)'
          : 'rgba(255,255,255,0.55)',
        boxShadow: selected
          ? '0 8px 22px rgba(244,175,37,0.25)'
          : 'inset 0 0 0 1px rgba(180,150,90,0.05)',
        cursor: 'pointer',
        transition: 'transform 0.12s ease',
      }}
      aria-pressed={selected}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
          {option.preview_url && (
            <span
              style={{
                width: 36,
                height: 36,
                borderRadius: 10,
                background: `url(${option.preview_url}) center/cover`,
                border: '1px solid rgba(180,150,90,0.20)',
                flexShrink: 0,
              }}
            />
          )}
          <span
            style={{
              fontSize: 14,
              fontWeight: 600,
              color: 'var(--ink-strong)',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {option.label}
          </span>
        </div>
        {option.badge && (
          <span
            style={{
              fontSize: 10,
              padding: '2px 8px',
              borderRadius: 999,
              background: 'rgba(244,175,37,0.20)',
              color: '#A36F1F',
              letterSpacing: '0.05em',
              textTransform: 'uppercase',
            }}
          >
            {option.badge}
          </span>
        )}
      </div>
      {option.description && (
        <span
          style={{
            fontSize: 12,
            color: 'var(--ink-muted)',
            lineHeight: 1.35,
            display: '-webkit-box',
            WebkitLineClamp: compact ? 2 : 3,
            WebkitBoxOrient: 'vertical',
            overflow: 'hidden',
          }}
        >
          {option.description}
        </span>
      )}
      {option.example && (
        <span
          style={{
            fontSize: 11,
            color: 'var(--ink-faint, #A6997D)',
            fontStyle: 'italic',
            lineHeight: 1.3,
          }}
        >
          «{option.example}»
        </span>
      )}
    </button>
  );
}

function VisualTile({
  option,
  selected,
  onClick,
}: {
  option: AgentInfoNeedOption;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        position: 'relative',
        width: '100%',
        aspectRatio: '4 / 3',
        borderRadius: 14,
        overflow: 'hidden',
        border: `2px solid ${selected ? 'var(--primary, #F4AF25)' : 'rgba(180,150,90,0.22)'}`,
        background: option.preview_url
          ? `url(${option.preview_url}) center/cover`
          : 'linear-gradient(135deg, rgba(244,175,37,0.18) 0%, rgba(244,175,37,0.06) 100%)',
        cursor: 'pointer',
        boxShadow: selected ? '0 8px 22px rgba(244,175,37,0.30)' : 'none',
      }}
      aria-pressed={selected}
    >
      {!option.preview_url && (
        <ImageIcon
          size={28}
          color="var(--ink-faint)"
          style={{
            position: 'absolute',
            top: '50%',
            left: '50%',
            transform: 'translate(-50%, -50%)',
          }}
        />
      )}
      <span
        style={{
          position: 'absolute',
          left: 8,
          right: 8,
          bottom: 8,
          padding: '4px 8px',
          borderRadius: 8,
          background: 'rgba(28,22,14,0.65)',
          color: '#FBE9C5',
          fontSize: 12,
          fontWeight: 600,
          textAlign: 'left',
          backdropFilter: 'blur(4px)',
        }}
      >
        {option.label}
      </span>
    </button>
  );
}

function TextVariant({
  infoNeed,
  value,
  onChange,
}: {
  infoNeed: AgentInfoNeed;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <textarea
      autoFocus
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={infoNeed.placeholder ?? 'Введіть відповідь…'}
      style={{
        width: '100%',
        minHeight: 120,
        padding: 14,
        borderRadius: 14,
        border: '1px solid rgba(180,150,90,0.30)',
        background: 'rgba(255,255,255,0.65)',
        color: 'var(--ink-strong)',
        fontSize: 14,
        fontFamily: 'Manrope, sans-serif',
        resize: 'vertical',
        outline: 'none',
      }}
    />
  );
}

function ConfirmVariant({
  value,
  onChange,
  hint,
}: {
  value: boolean | null;
  onChange: (v: boolean) => void;
  hint?: string | null;
}) {
  return (
    <div style={{ display: 'flex', gap: 12 }}>
      <button
        type="button"
        onClick={() => onChange(true)}
        style={{
          flex: 1,
          minHeight: 88,
          padding: 16,
          borderRadius: 16,
          border: `1px solid ${value === true ? 'rgba(34,197,94,0.6)' : 'rgba(180,150,90,0.25)'}`,
          background: value === true ? 'rgba(34,197,94,0.18)' : 'rgba(255,255,255,0.55)',
          color: 'var(--ink-strong)',
          fontSize: 15,
          fontWeight: 600,
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 8,
        }}
      >
        <Check size={20} color="#0E6A2A" /> Так
      </button>
      <button
        type="button"
        onClick={() => onChange(false)}
        style={{
          flex: 1,
          minHeight: 88,
          padding: 16,
          borderRadius: 16,
          border: `1px solid ${value === false ? 'rgba(185,32,31,0.5)' : 'rgba(180,150,90,0.25)'}`,
          background: value === false ? 'rgba(185,32,31,0.16)' : 'rgba(255,255,255,0.55)',
          color: 'var(--ink-strong)',
          fontSize: 15,
          fontWeight: 600,
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 8,
        }}
      >
        <X size={20} color="#B9201F" /> Ні
      </button>
      {hint && <span style={{ display: 'none' }}>{hint}</span>}
    </div>
  );
}

function RangeVariant({
  infoNeed,
  value,
  onChange,
}: {
  infoNeed: AgentInfoNeed;
  value: number;
  onChange: (v: number) => void;
}) {
  const min = infoNeed.range_min ?? 0;
  const max = infoNeed.range_max ?? 100;
  const step = infoNeed.range_step ?? 1;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div
        style={{
          fontSize: 28,
          fontFamily: 'JetBrains Mono, ui-monospace, monospace',
          color: 'var(--ink-strong)',
          textAlign: 'center',
        }}
      >
        {value}
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        style={{ width: '100%', accentColor: 'var(--primary, #F4AF25)' }}
      />
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          fontSize: 11,
          color: 'var(--ink-muted)',
        }}
      >
        <span>{min}</span>
        <span>{max}</span>
      </div>
    </div>
  );
}

function FilePickVariant({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string | null;
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <input
        autoFocus
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder ?? 'Шлях до файла, наприклад /home/user/file.txt'}
        style={{
          width: '100%',
          minHeight: 56,
          padding: '14px 16px',
          borderRadius: 12,
          border: '1px solid rgba(180,150,90,0.30)',
          background: 'rgba(255,255,255,0.65)',
          fontFamily: 'JetBrains Mono, ui-monospace, monospace',
          fontSize: 13,
          color: 'var(--ink-strong)',
          outline: 'none',
        }}
      />
      <span style={{ fontSize: 11, color: 'var(--ink-muted)' }}>
        Підказка: можна перетягнути файл сюди (drag&drop досвідні скоро з'являться).
      </span>
    </div>
  );
}

export function InfoNeedDialog({ infoNeed, busy = false, onSubmit, onCancel }: Props) {
  const [textValue, setTextValue] = useState<string>(
    typeof infoNeed.default === 'string' ? infoNeed.default : '',
  );
  const [singleValue, setSingleValue] = useState<string | null>(
    typeof infoNeed.default === 'string' ? infoNeed.default : null,
  );
  const [multiValue, setMultiValue] = useState<string[]>(
    Array.isArray(infoNeed.default) ? (infoNeed.default as string[]) : [],
  );
  const [confirmValue, setConfirmValue] = useState<boolean | null>(
    typeof infoNeed.default === 'boolean' ? infoNeed.default : null,
  );
  const [rangeValue, setRangeValue] = useState<number>(
    typeof infoNeed.default === 'number'
      ? infoNeed.default
      : Math.round(((infoNeed.range_min ?? 0) + (infoNeed.range_max ?? 100)) / 2),
  );
  const [fileValue, setFileValue] = useState<string>(
    typeof infoNeed.default === 'string' ? infoNeed.default : '',
  );

  // ESC to cancel.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && onCancel) onCancel();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onCancel]);

  const canSubmit = useMemo(() => {
    if (!infoNeed.required) return true;
    switch (infoNeed.kind) {
      case 'text':
        return textValue.trim().length > 0;
      case 'single_choice':
      case 'visual_pick':
        return singleValue !== null;
      case 'multi_choice':
        return multiValue.length > 0;
      case 'confirm':
        return confirmValue !== null;
      case 'range':
        return Number.isFinite(rangeValue);
      case 'file_pick':
        return fileValue.trim().length > 0;
      default:
        return true;
    }
  }, [infoNeed, textValue, singleValue, multiValue, confirmValue, rangeValue, fileValue]);

  const handleSubmit = async () => {
    if (!canSubmit || busy) return;
    let answer: unknown;
    switch (infoNeed.kind) {
      case 'text':
        answer = textValue.trim();
        break;
      case 'single_choice':
      case 'visual_pick':
        answer = singleValue;
        break;
      case 'multi_choice':
        answer = multiValue;
        break;
      case 'confirm':
        answer = confirmValue;
        break;
      case 'range':
        answer = rangeValue;
        break;
      case 'file_pick':
        answer = fileValue.trim();
        break;
      default:
        answer = null;
    }
    await onSubmit(answer);
  };

  return (
    <AnimatePresence>
      <motion.div
        className="fixed inset-0"
        style={{
          zIndex: 70,
          background: 'rgba(28,22,14,0.62)',
          backdropFilter: 'blur(12px)',
        }}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.18 }}
        role="presentation"
      >
        <motion.div
          className="glass-strong"
          style={{
            position: 'absolute',
            top: 24,
            left: 60,
            right: 60,
            bottom: 24,
            borderRadius: 22,
            padding: 18,
            display: 'flex',
            flexDirection: 'column',
            gap: 14,
            boxShadow:
              '0 30px 70px rgba(120,70,10,0.36), 0 0 0 1px var(--glass-border)',
          }}
          initial={{ scale: 0.97, y: 12 }}
          animate={{ scale: 1, y: 0 }}
          exit={{ scale: 0.97, y: 12 }}
          transition={{ duration: 0.22 }}
          role="dialog"
          aria-label={infoNeed.question}
        >
          <Header infoNeed={infoNeed} />

          <div
            style={{
              flex: 1,
              minHeight: 0,
              overflowY: 'auto',
              paddingRight: 4,
              display: 'flex',
              flexDirection: 'column',
              gap: 10,
            }}
          >
            {infoNeed.kind === 'text' && (
              <TextVariant infoNeed={infoNeed} value={textValue} onChange={setTextValue} />
            )}

            {infoNeed.kind === 'file_pick' && (
              <FilePickVariant value={fileValue} onChange={setFileValue} placeholder={infoNeed.placeholder} />
            )}

            {infoNeed.kind === 'range' && (
              <RangeVariant infoNeed={infoNeed} value={rangeValue} onChange={setRangeValue} />
            )}

            {infoNeed.kind === 'confirm' && (
              <ConfirmVariant
                value={confirmValue}
                onChange={setConfirmValue}
                hint={infoNeed.hint}
              />
            )}

            {(infoNeed.kind === 'single_choice' || infoNeed.kind === 'multi_choice') && (
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
                  gap: 10,
                }}
              >
                {infoNeed.options.map((opt) => {
                  const selected =
                    infoNeed.kind === 'single_choice'
                      ? singleValue === opt.id
                      : multiValue.includes(opt.id);
                  return (
                    <OptionCard
                      key={opt.id}
                      option={opt}
                      selected={selected}
                      onClick={() => {
                        if (infoNeed.kind === 'single_choice') {
                          setSingleValue(opt.id);
                        } else {
                          setMultiValue((prev) =>
                            prev.includes(opt.id)
                              ? prev.filter((x) => x !== opt.id)
                              : [...prev, opt.id],
                          );
                        }
                      }}
                    />
                  );
                })}
              </div>
            )}

            {infoNeed.kind === 'visual_pick' && (
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
                  gap: 10,
                }}
              >
                {infoNeed.options.map((opt) => (
                  <VisualTile
                    key={opt.id}
                    option={opt}
                    selected={singleValue === opt.id}
                    onClick={() => setSingleValue(opt.id)}
                  />
                ))}
              </div>
            )}
          </div>

          {/* Footer */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              paddingTop: 4,
            }}
          >
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              {!infoNeed.required && (
                <button
                  type="button"
                  onClick={() => onSubmit(null)}
                  disabled={busy}
                  style={{
                    minHeight: 44,
                    padding: '0 14px',
                    borderRadius: 12,
                    background: 'transparent',
                    border: '1px solid rgba(180,150,90,0.25)',
                    color: 'var(--ink-muted)',
                    fontSize: 12,
                    cursor: busy ? 'wait' : 'pointer',
                  }}
                >
                  Пропустити
                </button>
              )}
              {onCancel && (
                <button
                  type="button"
                  onClick={onCancel}
                  disabled={busy}
                  style={{
                    minHeight: 44,
                    padding: '0 14px',
                    borderRadius: 12,
                    background: 'transparent',
                    border: '1px solid rgba(180,150,90,0.25)',
                    color: 'var(--ink-muted)',
                    fontSize: 12,
                    cursor: busy ? 'wait' : 'pointer',
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 6,
                  }}
                >
                  <X size={14} /> Скасувати
                </button>
              )}
            </div>
            <button
              type="button"
              onClick={handleSubmit}
              disabled={!canSubmit || busy}
              style={{
                minHeight: 48,
                padding: '0 22px',
                borderRadius: 14,
                background:
                  canSubmit && !busy
                    ? 'linear-gradient(180deg, var(--primary, #F4AF25) 0%, #E89A1C 100%)'
                    : 'rgba(180,150,90,0.18)',
                border: `1px solid ${canSubmit ? 'rgba(168,118,18,0.45)' : 'rgba(180,150,90,0.20)'}`,
                color: canSubmit && !busy ? '#1F1308' : 'var(--ink-muted)',
                fontSize: 14,
                fontWeight: 700,
                cursor: canSubmit && !busy ? 'pointer' : 'not-allowed',
                display: 'inline-flex',
                alignItems: 'center',
                gap: 8,
                boxShadow: canSubmit && !busy ? '0 8px 22px rgba(244,175,37,0.30)' : 'none',
              }}
              aria-label="Надіслати відповідь"
            >
              <ChevronRight size={16} />
              Надіслати
              <ArrowUpRight size={16} />
            </button>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}

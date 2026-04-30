/**
 * Phase-5 R1 (audit-2026-04-30 OPERATOR-ASK) — Add-profile wizard.
 *
 * Closes the gap operator flagged: "ще була кнопка додавання нового
 * профілю, а ти проігнорував, і беку відповідно немає". The backend
 * always had `POST /api/v1/users` (ADR-IDB-002, ROOT-only with shared-
 * PIN guard); this file adds the missing FE wizard so a ROOT operator
 * can enroll a new profile from the login screen without dropping to
 * a terminal.
 *
 * Two-step flow:
 *   1. Authenticate as an existing ROOT user (PIN entry).
 *   2. Create the new profile (username + PIN + role + optional avatar).
 *
 * On submit the second step calls POST /api/v1/users with the JWT
 * obtained in step 1; on success the picker reloads and the tile for
 * the new user appears.
 */
import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

interface AddProfileWizardProps {
  open: boolean;
  onClose: () => void;
  onCreated: () => void;
}

type Step = 'auth' | 'form' | 'submitting';

const API_PREFIX = '/api/v1';

async function loginAsRoot(username: string, pin: string): Promise<string> {
  const res = await fetch(`${API_PREFIX}/auth/login/pin`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, pin }),
  });
  if (!res.ok) {
    const detail = await res.json().catch(() => ({}));
    throw new Error(
      typeof detail.detail === 'string'
        ? detail.detail
        : `Login failed (${res.status})`,
    );
  }
  const body = await res.json();
  if (body.user?.role !== 'ROOT') {
    throw new Error('Тільки ROOT-оператор може створювати профілі.');
  }
  return body.access_token as string;
}

async function createUser(
  token: string,
  body: { username: string; pin: string; role: 'ROOT' | 'OPERATOR' | 'GUEST' },
): Promise<void> {
  const res = await fetch(`${API_PREFIX}/users`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const detail = await res.json().catch(() => ({}));
    throw new Error(
      typeof detail.detail === 'string'
        ? detail.detail
        : `Create failed (${res.status})`,
    );
  }
}

export function AddProfileWizard({ open, onClose, onCreated }: AddProfileWizardProps) {
  const [step, setStep] = useState<Step>('auth');
  const [authUsername, setAuthUsername] = useState('phantom');
  const [authPin, setAuthPin] = useState('');
  const [token, setToken] = useState<string | null>(null);

  const [newUsername, setNewUsername] = useState('');
  const [newPin, setNewPin] = useState('');
  const [newPinConfirm, setNewPinConfirm] = useState('');
  const [newRole, setNewRole] = useState<'OPERATOR' | 'GUEST' | 'ROOT'>('OPERATOR');

  const [error, setError] = useState<string | null>(null);

  const reset = () => {
    setStep('auth');
    setAuthUsername('phantom');
    setAuthPin('');
    setToken(null);
    setNewUsername('');
    setNewPin('');
    setNewPinConfirm('');
    setNewRole('OPERATOR');
    setError(null);
  };

  const close = () => {
    reset();
    onClose();
  };

  const submitAuth = async () => {
    setError(null);
    if (!authUsername.trim() || authPin.length < 4) {
      setError('Введи ROOT-username і PIN (≥4 цифри).');
      return;
    }
    try {
      const tk = await loginAsRoot(authUsername.trim(), authPin);
      setToken(tk);
      setStep('form');
      setAuthPin('');
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Auth failed');
    }
  };

  const submitForm = async () => {
    setError(null);
    if (!newUsername.trim() || newUsername.length < 2) {
      setError('Username має бути ≥ 2 символи.');
      return;
    }
    if (newPin.length < 4 || newPin.length > 12) {
      setError('PIN — 4..12 цифр.');
      return;
    }
    if (newPin !== newPinConfirm) {
      setError('PIN не співпадають.');
      return;
    }
    if (!token) {
      setError('Сесія втрачена — авторизуйся знову.');
      setStep('auth');
      return;
    }
    setStep('submitting');
    try {
      await createUser(token, {
        username: newUsername.trim(),
        pin: newPin,
        role: newRole,
      });
      onCreated();
      close();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Create failed');
      setStep('form');
    }
  };

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 flex items-center justify-center"
          style={{
            zIndex: 80,
            background: 'rgba(26, 22, 18, 0.55)',
            backdropFilter: 'blur(8px)',
          }}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
          onClick={close}
        >
          <motion.div
            className="glass-strong"
            style={{
              width: 460,
              padding: 24,
              borderRadius: 20,
              boxShadow: '0 24px 60px rgba(120,70,10,0.32), 0 0 0 1px var(--glass-border)',
            }}
            initial={{ scale: 0.94, y: 12 }}
            animate={{ scale: 1, y: 0 }}
            exit={{ scale: 0.94, y: 12 }}
            transition={{ duration: 0.22 }}
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-label="Додати профіль"
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
              <span className="eyebrow-amber">
                {step === 'auth' ? 'КРОК 1 · ROOT АВТЕНТИФІКАЦІЯ' : 'КРОК 2 · НОВИЙ ПРОФІЛЬ'}
              </span>
              <button
                type="button"
                onClick={close}
                aria-label="Закрити"
                style={{
                  width: 32,
                  height: 32,
                  borderRadius: 10,
                  background: 'rgba(0,0,0,0.04)',
                  border: '1px solid rgba(0,0,0,0.06)',
                  color: 'var(--ink-muted)',
                  cursor: 'pointer',
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <span className="msym" aria-hidden style={{ fontSize: 16 }}>close</span>
              </button>
            </div>

            <h2 className="playfair" style={{ fontSize: 22, color: 'var(--ink-primary)', margin: '4px 0 14px' }}>
              {step === 'auth' ? 'Підтверди, що ти ROOT' : 'Кого додаємо?'}
            </h2>

            {step === 'auth' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                <Field
                  label="ROOT username"
                  value={authUsername}
                  onChange={setAuthUsername}
                  placeholder="phantom"
                  autoFocus
                />
                <Field
                  label="PIN"
                  value={authPin}
                  onChange={(v) => setAuthPin(v.replace(/\D/g, '').slice(0, 12))}
                  placeholder="••••••"
                  type="password"
                  inputMode="numeric"
                />
                {error && <ErrorBanner message={error} />}
                <PrimaryButton onClick={submitAuth} disabled={!authPin}>
                  Авторизуватися
                </PrimaryButton>
              </div>
            )}

            {step === 'form' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                <Field
                  label="Username"
                  value={newUsername}
                  onChange={(v) => setNewUsername(v.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 64))}
                  placeholder="alex"
                  autoFocus
                />
                <Field
                  label="PIN (4–12 цифр)"
                  value={newPin}
                  onChange={(v) => setNewPin(v.replace(/\D/g, '').slice(0, 12))}
                  placeholder="••••••"
                  type="password"
                  inputMode="numeric"
                />
                <Field
                  label="Повтор PIN"
                  value={newPinConfirm}
                  onChange={(v) => setNewPinConfirm(v.replace(/\D/g, '').slice(0, 12))}
                  placeholder="••••••"
                  type="password"
                  inputMode="numeric"
                />
                <RoleSelector value={newRole} onChange={setNewRole} />
                {error && <ErrorBanner message={error} />}
                <div style={{ display: 'flex', gap: 8 }}>
                  <SecondaryButton onClick={() => setStep('auth')}>← Назад</SecondaryButton>
                  <PrimaryButton onClick={submitForm} disabled={!newUsername || !newPin}>
                    Створити
                  </PrimaryButton>
                </div>
              </div>
            )}

            {step === 'submitting' && (
              <div style={{ padding: '24px 0', textAlign: 'center', color: 'var(--ink-muted)' }}>
                <span className="msym" style={{ fontSize: 32, animation: 'phantom-spin 1.2s linear infinite' }}>
                  progress_activity
                </span>
                <div className="playfair" style={{ marginTop: 8, fontSize: 14 }}>
                  Створюю профіль…
                </div>
              </div>
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

/* ─────────────────────────────────────────────────────── Form primitives ── */

function Field({
  label,
  value,
  onChange,
  placeholder,
  type = 'text',
  inputMode,
  autoFocus,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  type?: string;
  inputMode?: 'text' | 'numeric' | 'decimal';
  autoFocus?: boolean;
}) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <span className="micro-label" style={{ fontSize: 9 }}>
        {label.toUpperCase()}
      </span>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        inputMode={inputMode}
        autoFocus={autoFocus}
        style={{
          padding: '10px 12px',
          borderRadius: 10,
          border: '1px solid rgba(0,0,0,0.08)',
          background: 'rgba(255,255,255,0.65)',
          fontSize: 14,
          color: 'var(--ink-primary)',
          fontFamily: type === 'password' || inputMode === 'numeric' ? 'var(--font-mono)' : 'var(--font-display)',
          minHeight: 44,
        }}
      />
    </label>
  );
}

function RoleSelector({
  value,
  onChange,
}: {
  value: 'ROOT' | 'OPERATOR' | 'GUEST';
  onChange: (v: 'ROOT' | 'OPERATOR' | 'GUEST') => void;
}) {
  const opts: Array<['ROOT' | 'OPERATOR' | 'GUEST', string, string]> = [
    ['GUEST', 'Guest', 'Обмежений доступ'],
    ['OPERATOR', 'Operator', 'Стандартний'],
    ['ROOT', 'ROOT', 'Повний контроль'],
  ];
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <span className="micro-label" style={{ fontSize: 9 }}>РОЛЬ</span>
      <div style={{ display: 'flex', gap: 6 }}>
        {opts.map(([k, lab, hint]) => (
          <button
            key={k}
            type="button"
            onClick={() => onChange(k)}
            style={{
              flex: 1,
              minHeight: 44,
              padding: '6px 4px',
              borderRadius: 10,
              border: value === k
                ? '1px solid rgba(244,175,37,0.55)'
                : '1px solid rgba(0,0,0,0.08)',
              background: value === k
                ? 'linear-gradient(135deg, rgba(244,175,37,0.18), rgba(251,146,60,0.14))'
                : 'rgba(255,255,255,0.55)',
              color: value === k ? '#8a5e0a' : 'var(--ink-secondary)',
              cursor: 'pointer',
              fontFamily: 'var(--font-display)',
            }}
            aria-pressed={value === k}
          >
            <div style={{ fontSize: 12, fontWeight: 700 }}>{lab}</div>
            <div style={{ fontSize: 9, color: 'var(--ink-muted)', marginTop: 1 }}>{hint}</div>
          </button>
        ))}
      </div>
    </div>
  );
}

function PrimaryButton({
  onClick,
  disabled,
  children,
}: {
  onClick: () => void;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      style={{
        flex: 1,
        minHeight: 44,
        padding: '10px 16px',
        borderRadius: 12,
        border: '1px solid rgba(244,175,37,0.55)',
        background: disabled
          ? 'rgba(244,175,37,0.18)'
          : 'linear-gradient(135deg, var(--primary), var(--orange))',
        color: disabled ? 'var(--ink-muted)' : '#fff',
        fontFamily: 'var(--font-display)',
        fontSize: 13,
        fontWeight: 700,
        letterSpacing: '0.04em',
        cursor: disabled ? 'not-allowed' : 'pointer',
        boxShadow: disabled ? 'none' : '0 6px 18px rgba(244,175,37,0.32)',
      }}
    >
      {children}
    </button>
  );
}

function SecondaryButton({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        minWidth: 100,
        minHeight: 44,
        padding: '10px 14px',
        borderRadius: 12,
        border: '1px solid rgba(0,0,0,0.08)',
        background: 'rgba(255,255,255,0.6)',
        color: 'var(--ink-secondary)',
        fontFamily: 'var(--font-display)',
        fontSize: 12,
        fontWeight: 600,
        cursor: 'pointer',
      }}
    >
      {children}
    </button>
  );
}

function ErrorBanner({ message }: { message: string }) {
  return (
    <div
      role="alert"
      style={{
        padding: '8px 10px',
        borderRadius: 8,
        background: 'rgba(239,68,68,0.10)',
        border: '1px solid rgba(239,68,68,0.32)',
        color: 'var(--coral-deep, #b9201f)',
        fontSize: 12,
        fontFamily: 'var(--font-display)',
      }}
    >
      {message}
    </div>
  );
}

/**
 * Phase-5 R1 Task E (PHASE_5_FEATURE_COMPLETION.md) — Profile management UI.
 *
 * Renders the ROOT-only post-login user CRUD: a list of every operator
 * with avatar mandala + role + last-seen, plus per-row edit / role /
 * delete actions. Wraps the existing `users_router` REST surface in
 * `routes_auth.py` (GET / PUT / DELETE / PUT/role); no backend changes.
 *
 * Gated on `useAuthStore.user.role === 'ROOT'` — non-ROOT operators
 * see an empty-state explainer instead of the controls.
 */
import { useEffect, useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useAuthStore } from '../../stores/authStore';
import { EditProfileDialog } from './EditProfileDialog';
import { PhantomIcon } from '../core/PhantomIcon';

const API_PREFIX = '/api/v1';

interface ManagedUser {
  id: string;
  username: string;
  role: 'ROOT' | 'OPERATOR' | 'GUEST';
  avatar_url: string | null;
  has_rfid: boolean;
  has_pin: boolean;
  created_at: string;
  last_seen_at: string;
}

const ROLE_TINT: Record<ManagedUser['role'], string> = {
  ROOT: 'var(--coral, #ef4444)',
  OPERATOR: 'var(--primary, #f4af25)',
  GUEST: 'var(--ink-muted, #888)',
};

async function fetchUsers(token: string): Promise<ManagedUser[]> {
  const res = await fetch(`${API_PREFIX}/users`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    const detail = await res.json().catch(() => ({}));
    throw new Error(typeof detail.detail === 'string' ? detail.detail : `GET /users ${res.status}`);
  }
  const body = await res.json();
  return body.users as ManagedUser[];
}

async function deleteUser(token: string, userId: string): Promise<void> {
  const res = await fetch(`${API_PREFIX}/users/${userId}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok && res.status !== 204) {
    const detail = await res.json().catch(() => ({}));
    throw new Error(typeof detail.detail === 'string' ? detail.detail : `DELETE /users/${userId} ${res.status}`);
  }
}

async function setRole(token: string, userId: string, role: ManagedUser['role']): Promise<void> {
  const res = await fetch(`${API_PREFIX}/users/${userId}/role`, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ role }),
  });
  if (!res.ok) {
    const detail = await res.json().catch(() => ({}));
    throw new Error(typeof detail.detail === 'string' ? detail.detail : `PUT /users/${userId}/role ${res.status}`);
  }
}

export function ProfileManagementSection() {
  const token = useAuthStore((s) => s.token);
  const me = useAuthStore((s) => s.user);
  const [users, setUsers] = useState<ManagedUser[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<ManagedUser | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<ManagedUser | null>(null);
  const [busy, setBusy] = useState(false);

  const reload = useCallback(async () => {
    if (!token) return;
    try {
      const list = await fetchUsers(token);
      setUsers(list);
      setError(null);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'load failed');
      setUsers([]);
    }
  }, [token]);

  useEffect(() => {
    if (me?.role === 'ROOT') void reload();
  }, [me, reload]);

  if (!me) return null;
  if (me.role !== 'ROOT') {
    return (
      <SectionFrame title="Управління профілями">
        <div className="playfair" style={{ fontSize: 13, color: 'var(--ink-muted)', fontStyle: 'italic' }}>
          ROOT-only зона. Поточний оператор має роль{' '}
          <strong style={{ color: ROLE_TINT[me.role as ManagedUser['role']] }}>{me.role}</strong>.
        </div>
      </SectionFrame>
    );
  }

  const performDelete = async (user: ManagedUser) => {
    if (!token) return;
    setBusy(true);
    try {
      await deleteUser(token, user.id);
      setConfirmDelete(null);
      await reload();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'delete failed');
    } finally {
      setBusy(false);
    }
  };

  const performRoleChange = async (user: ManagedUser, role: ManagedUser['role']) => {
    if (!token) return;
    setBusy(true);
    try {
      await setRole(token, user.id, role);
      await reload();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'role change failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <SectionFrame title="Управління профілями">
      {error && <ErrorBanner message={error} onDismiss={() => setError(null)} />}
      {users === null && (
        <div style={{ padding: 16, color: 'var(--ink-muted)', fontSize: 12 }}>
          Завантаження…
        </div>
      )}
      {users && users.length === 0 && (
        <div className="playfair" style={{ fontSize: 13, color: 'var(--ink-muted)', fontStyle: 'italic' }}>
          Профілів немає. Це не повинно бути можливим — ти ж зайшов як ROOT.
        </div>
      )}
      {users && users.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {users.map((u) => (
            <UserRow
              key={u.id}
              user={u}
              isMe={u.id === me.id}
              busy={busy}
              onEdit={() => setEditing(u)}
              onRoleChange={(role) => performRoleChange(u, role)}
              onDelete={() => setConfirmDelete(u)}
            />
          ))}
        </div>
      )}

      <EditProfileDialog
        open={editing !== null}
        user={editing}
        token={token}
        onClose={() => setEditing(null)}
        onSaved={() => {
          setEditing(null);
          void reload();
        }}
      />

      <AnimatePresence>
        {confirmDelete && (
          <ConfirmDialog
            user={confirmDelete}
            busy={busy}
            onCancel={() => setConfirmDelete(null)}
            onConfirm={() => performDelete(confirmDelete)}
          />
        )}
      </AnimatePresence>
    </SectionFrame>
  );
}

/* ───────────────────────────────────────────────────────── User row ── */

function UserRow({
  user,
  isMe,
  busy,
  onEdit,
  onRoleChange,
  onDelete,
}: {
  user: ManagedUser;
  isMe: boolean;
  busy: boolean;
  onEdit: () => void;
  onRoleChange: (role: ManagedUser['role']) => void;
  onDelete: () => void;
}) {
  const lastSeen = formatRelative(new Date(user.last_seen_at));
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        padding: '10px 12px',
        borderRadius: 12,
        background: 'rgba(255,255,255,0.55)',
        border: '1px solid rgba(0,0,0,0.05)',
      }}
    >
      <Avatar username={user.username} avatarUrl={user.avatar_url} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink-primary)' }}>
            {user.username}
          </span>
          {isMe && (
            <span
              style={{
                fontSize: 9,
                padding: '1px 6px',
                borderRadius: 'var(--radius-pill)',
                background: 'rgba(244,175,37,0.18)',
                color: '#8a5e0a',
                letterSpacing: '0.06em',
                fontWeight: 700,
              }}
            >
              ВИ
            </span>
          )}
        </div>
        <div
          style={{
            fontSize: 10,
            color: 'var(--ink-muted)',
            marginTop: 2,
            display: 'flex',
            gap: 6,
            alignItems: 'center',
          }}
        >
          <span>last seen {lastSeen}</span>
          {user.has_pin && <Pill>PIN</Pill>}
          {user.has_rfid && <Pill>RFID</Pill>}
        </div>
      </div>
      <RoleSelector
        value={user.role}
        disabled={isMe || busy}
        onChange={onRoleChange}
      />
      <RowButton onClick={onEdit} icon="edit" label="Edit" disabled={busy} />
      <RowButton
        onClick={onDelete}
        icon="delete"
        label="Delete"
        disabled={isMe || busy}
        tone="alert"
      />
    </div>
  );
}

function RoleSelector({
  value,
  disabled,
  onChange,
}: {
  value: ManagedUser['role'];
  disabled: boolean;
  onChange: (role: ManagedUser['role']) => void;
}) {
  return (
    <select
      value={value}
      disabled={disabled}
      onChange={(e) => {
        const next = e.target.value as ManagedUser['role'];
        if (next !== value) onChange(next);
      }}
      style={{
        minHeight: 36,
        padding: '4px 8px',
        borderRadius: 8,
        border: `1px solid ${ROLE_TINT[value]}`,
        background: 'rgba(255,255,255,0.7)',
        color: ROLE_TINT[value],
        fontFamily: 'var(--font-display)',
        fontSize: 11,
        fontWeight: 700,
        letterSpacing: '0.06em',
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.5 : 1,
      }}
      title={disabled ? 'Не можна змінити свою роль' : 'Змінити роль'}
    >
      <option value="ROOT">ROOT</option>
      <option value="OPERATOR">OPERATOR</option>
      <option value="GUEST">GUEST</option>
    </select>
  );
}

function RowButton({
  onClick,
  icon,
  label,
  disabled,
  tone = 'default',
}: {
  onClick: () => void;
  icon: string;
  label: string;
  disabled: boolean;
  tone?: 'default' | 'alert';
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      style={{
        width: 44,
        height: 44,
        borderRadius: 10,
        border: '1px solid rgba(0,0,0,0.06)',
        background: tone === 'alert' ? 'rgba(239,68,68,0.08)' : 'rgba(255,255,255,0.6)',
        color: disabled
          ? 'var(--ink-muted)'
          : tone === 'alert'
            ? 'var(--coral, #ef4444)'
            : 'var(--ink-secondary)',
        cursor: disabled ? 'not-allowed' : 'pointer',
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        opacity: disabled ? 0.4 : 1,
      }}
    >
      <PhantomIcon name={icon} size={18} aria-hidden />
    </button>
  );
}

function Avatar({ username, avatarUrl }: { username: string; avatarUrl: string | null }) {
  if (avatarUrl) {
    return (
      <img
        src={avatarUrl}
        alt={username}
        style={{ width: 36, height: 36, borderRadius: '50%', objectFit: 'cover' }}
      />
    );
  }
  // Deterministic mandala stub from first letter.
  const seed = username.charCodeAt(0) || 65;
  const hue = (seed * 37) % 60; // 0..60 — sunrise palette band
  return (
    <div
      style={{
        width: 36,
        height: 36,
        borderRadius: '50%',
        background: `radial-gradient(circle at 30% 30%, hsl(${hue}, 80%, 65%), hsl(${hue + 20}, 70%, 50%))`,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        color: '#fff',
        fontFamily: 'var(--font-display)',
        fontSize: 14,
        fontWeight: 700,
      }}
    >
      {username.slice(0, 1).toUpperCase()}
    </div>
  );
}

function Pill({ children }: { children: React.ReactNode }) {
  return (
    <span
      style={{
        fontSize: 9,
        padding: '0 5px',
        borderRadius: 'var(--radius-pill)',
        background: 'rgba(0,0,0,0.04)',
        color: 'var(--ink-secondary)',
        letterSpacing: '0.06em',
        fontWeight: 600,
      }}
    >
      {children}
    </span>
  );
}

/* ───────────────────────────────────────────────────────── Confirm ── */

function ConfirmDialog({
  user,
  busy,
  onCancel,
  onConfirm,
}: {
  user: ManagedUser;
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <motion.div
      className="fixed inset-0 flex items-center justify-center"
      style={{
        zIndex: 90,
        background: 'rgba(26, 22, 18, 0.55)',
        backdropFilter: 'blur(8px)',
      }}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      onClick={onCancel}
    >
      <div
        className="glass-strong"
        style={{ width: 380, padding: 20, borderRadius: 16 }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="eyebrow-amber" style={{ color: 'var(--coral, #ef4444)' }}>
          ВИДАЛИТИ ПРОФІЛЬ
        </div>
        <h3 className="playfair" style={{ fontSize: 18, color: 'var(--ink-primary)', margin: '6px 0 10px' }}>
          Видалити «{user.username}»?
        </h3>
        <p style={{ fontSize: 12, color: 'var(--ink-secondary)' }}>
          Це безповоротно знищить профіль, його PIN та прив'язану RFID-картку.
          Чат-історія, тактична пам'ять і ChromaDB-колекція оператора залишаться,
          але стануть orphaned.
        </p>
        <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            style={{
              flex: 1,
              minHeight: 44,
              borderRadius: 10,
              border: '1px solid rgba(0,0,0,0.08)',
              background: 'rgba(255,255,255,0.6)',
              color: 'var(--ink-secondary)',
              fontFamily: 'var(--font-display)',
              fontSize: 12,
              fontWeight: 600,
              cursor: busy ? 'not-allowed' : 'pointer',
            }}
          >
            Скасувати
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={busy}
            style={{
              flex: 1,
              minHeight: 44,
              borderRadius: 10,
              border: '1px solid rgba(239,68,68,0.5)',
              background: 'linear-gradient(135deg, #ef4444, #b91c1c)',
              color: '#fff',
              fontFamily: 'var(--font-display)',
              fontSize: 12,
              fontWeight: 700,
              letterSpacing: '0.04em',
              cursor: busy ? 'not-allowed' : 'pointer',
            }}
          >
            {busy ? 'Видалення…' : 'Видалити'}
          </button>
        </div>
      </div>
    </motion.div>
  );
}

/* ───────────────────────────────────────────────────────── Frame ── */

function SectionFrame({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div
      className="glass"
      style={{
        marginTop: 16,
        padding: 16,
        borderRadius: 14,
      }}
    >
      <div className="eyebrow-amber" style={{ marginBottom: 8 }}>
        {title.toUpperCase()}
      </div>
      {children}
    </div>
  );
}

function ErrorBanner({ message, onDismiss }: { message: string; onDismiss: () => void }) {
  return (
    <div
      role="alert"
      style={{
        marginBottom: 10,
        padding: '8px 12px',
        borderRadius: 8,
        background: 'rgba(239,68,68,0.10)',
        border: '1px solid rgba(239,68,68,0.32)',
        color: 'var(--coral-deep, #b9201f)',
        fontSize: 12,
        display: 'flex',
        alignItems: 'center',
        gap: 8,
      }}
    >
      <span style={{ flex: 1 }}>{message}</span>
      <button
        type="button"
        onClick={onDismiss}
        aria-label="Закрити"
        style={{
          width: 24,
          height: 24,
          borderRadius: 6,
          border: 'none',
          background: 'transparent',
          color: 'var(--coral-deep, #b9201f)',
          cursor: 'pointer',
        }}
      >
        ×
      </button>
    </div>
  );
}

function formatRelative(d: Date): string {
  const diff = Date.now() - d.getTime();
  if (diff < 0) return 'now';
  const m = Math.floor(diff / 60000);
  if (m < 1) return 'now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const day = Math.floor(h / 24);
  if (day < 7) return `${day}d ago`;
  return d.toLocaleDateString('uk-UA', { day: 'numeric', month: 'short' });
}

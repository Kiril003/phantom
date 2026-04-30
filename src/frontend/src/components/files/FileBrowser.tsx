/**
 * Phase-6 T4-FE — FileBrowser.
 *
 * Operator-facing files panel. Wraps the routes_files.py REST surface:
 *   GET  /files/list?path=...
 *   GET  /files/read?path=...
 *   GET  /files/search?query=...
 *   DELETE /files/delete?path=...   (ROOT-only — gated client-side too)
 *
 * Layout 1024×600 strict:
 *   - Left pane (260px): breadcrumb + entry list (folders first), with
 *     a search input that switches between list/search modes.
 *   - Right pane: preview of the selected file. Text → mono panel;
 *     binary → "preview unavailable" + size + path. Big-truncate banner
 *     when file > READ_FILE_CAP_BYTES.
 */
import { useCallback, useEffect, useState } from 'react';
import { useAuthStore } from '../../stores/authStore';

const API_PREFIX = '/api/v1';

interface DirEntry {
  name: string;
  path: string;
  is_dir: boolean;
  size: number;
  size_display: string;
  mtime_ms: number;
}

interface ListResponse {
  path: string;
  display: string;
  parent: string | null;
  entries: DirEntry[];
  count: number;
}

interface FileContent {
  kind: 'text' | 'binary';
  path: string;
  name: string;
  size: number;
  size_display: string;
  truncated: boolean;
  mtime_ms: number;
  content?: string;
  content_base64?: string;
}

async function listFiles(token: string, path: string | null): Promise<ListResponse> {
  const url = path
    ? `${API_PREFIX}/files/list?path=${encodeURIComponent(path)}`
    : `${API_PREFIX}/files/list`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) {
    const detail = await res.json().catch(() => ({}));
    throw new Error(typeof detail.detail === 'string' ? detail.detail : `list ${res.status}`);
  }
  return res.json();
}

async function readFile(token: string, path: string): Promise<FileContent> {
  const url = `${API_PREFIX}/files/read?path=${encodeURIComponent(path)}`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) {
    const detail = await res.json().catch(() => ({}));
    throw new Error(typeof detail.detail === 'string' ? detail.detail : `read ${res.status}`);
  }
  return res.json();
}

async function deleteFileApi(token: string, path: string): Promise<void> {
  const url = `${API_PREFIX}/files/delete?path=${encodeURIComponent(path)}`;
  const res = await fetch(url, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    const detail = await res.json().catch(() => ({}));
    throw new Error(typeof detail.detail === 'string' ? detail.detail : `delete ${res.status}`);
  }
}

export function FileBrowser() {
  const token = useAuthStore((s) => s.token);
  const role = useAuthStore((s) => s.user?.role);
  const [list, setList] = useState<ListResponse | null>(null);
  const [selected, setSelected] = useState<FileContent | null>(null);
  const [search, setSearch] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(
    async (path: string | null) => {
      if (!token) return;
      try {
        const r = await listFiles(token, path);
        setList(r);
        setSelected(null);
        setError(null);
      } catch (e) {
        setError(e instanceof Error ? e.message : 'load failed');
      }
    },
    [token],
  );

  useEffect(() => {
    void load(null);
  }, [load]);

  const onPickEntry = async (entry: DirEntry) => {
    if (entry.is_dir) {
      await load(entry.path);
      return;
    }
    if (!token) return;
    try {
      const content = await readFile(token, entry.path);
      setSelected(content);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'read failed');
    }
  };

  const onUp = async () => {
    if (list?.parent) await load(list.parent);
  };

  const onDelete = async () => {
    if (!token || !selected) return;
    setBusy(true);
    try {
      await deleteFileApi(token, selected.path);
      setSelected(null);
      if (list) await load(list.path);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'delete failed');
    } finally {
      setBusy(false);
    }
  };

  const filtered = list && search.trim()
    ? list.entries.filter((e) => e.name.toLowerCase().includes(search.toLowerCase().trim()))
    : list?.entries ?? [];

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '260px 1fr', gap: 12, height: '100%', minHeight: 420 }}>
      {/* ── Left pane: list + search ─────────────────────────────── */}
      <div className="glass" style={{ padding: 10, borderRadius: 14, display: 'flex', flexDirection: 'column', gap: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <button
            type="button"
            onClick={onUp}
            disabled={!list?.parent}
            aria-label="Угору"
            style={{
              width: 36,
              height: 36,
              borderRadius: 8,
              border: '1px solid rgba(0,0,0,0.06)',
              background: list?.parent ? 'rgba(255,255,255,0.6)' : 'rgba(0,0,0,0.03)',
              cursor: list?.parent ? 'pointer' : 'not-allowed',
              color: list?.parent ? 'var(--ink-secondary)' : 'var(--ink-muted)',
            }}
          >
            <span className="msym" aria-hidden style={{ fontSize: 16 }}>arrow_upward</span>
          </button>
          <span
            className="micro-label"
            style={{ flex: 1, fontSize: 9, color: 'var(--ink-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
            title={list?.path}
          >
            {list?.display ?? '…'}
          </span>
        </div>
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="фільтр поточної теки…"
          style={{
            padding: '6px 10px',
            borderRadius: 8,
            border: '1px solid rgba(0,0,0,0.06)',
            background: 'rgba(255,255,255,0.7)',
            fontSize: 12,
            fontFamily: 'var(--font-display)',
            minHeight: 36,
          }}
        />
        {error && (
          <div role="alert" style={{ fontSize: 11, color: 'var(--coral-deep, #b9201f)' }}>
            {error}
          </div>
        )}
        <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 2 }}>
          {filtered.length === 0 && (
            <div className="playfair" style={{ fontSize: 11, color: 'var(--ink-muted)', fontStyle: 'italic', padding: '8px 4px' }}>
              {list ? 'Тут порожньо.' : 'Завантаження…'}
            </div>
          )}
          {filtered.map((e) => (
            <button
              key={e.path}
              type="button"
              onClick={() => void onPickEntry(e)}
              style={{
                padding: '6px 8px',
                borderRadius: 8,
                background: selected?.path === e.path ? 'rgba(244,175,37,0.18)' : 'transparent',
                border: '1px solid transparent',
                textAlign: 'left',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                fontFamily: 'var(--font-display)',
                fontSize: 12,
              }}
            >
              <span
                className="msym"
                aria-hidden
                style={{ fontSize: 16, color: e.is_dir ? 'var(--primary, #f4af25)' : 'var(--ink-muted)' }}
              >
                {e.is_dir ? 'folder' : 'description'}
              </span>
              <span style={{ flex: 1, color: 'var(--ink-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {e.name}
              </span>
              {!e.is_dir && (
                <span className="tabular" style={{ fontSize: 10, color: 'var(--ink-muted)' }}>
                  {e.size_display}
                </span>
              )}
            </button>
          ))}
        </div>
      </div>

      {/* ── Right pane: preview ──────────────────────────────────── */}
      <div className="glass" style={{ padding: 14, borderRadius: 14, display: 'flex', flexDirection: 'column', gap: 8 }}>
        {!selected ? (
          <div className="playfair" style={{ color: 'var(--ink-muted)', fontStyle: 'italic', fontSize: 13 }}>
            Виберіть файл зліва — переглянеш зміст тут.
          </div>
        ) : (
          <>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--ink-primary)' }}>
                  {selected.name}
                </div>
                <div className="tabular" style={{ fontSize: 10, color: 'var(--ink-muted)' }}>
                  {selected.size_display} · {selected.kind} · {new Date(selected.mtime_ms).toLocaleString('uk-UA')}
                </div>
              </div>
              {role === 'ROOT' && (
                <button
                  type="button"
                  onClick={onDelete}
                  disabled={busy}
                  aria-label="Видалити"
                  style={{
                    width: 44,
                    height: 44,
                    borderRadius: 10,
                    border: '1px solid rgba(239,68,68,0.32)',
                    background: 'rgba(239,68,68,0.08)',
                    color: 'var(--coral, #ef4444)',
                    cursor: busy ? 'not-allowed' : 'pointer',
                  }}
                >
                  <span className="msym" aria-hidden style={{ fontSize: 18 }}>delete</span>
                </button>
              )}
            </div>
            {selected.truncated && (
              <div
                style={{
                  fontSize: 11,
                  padding: '4px 8px',
                  borderRadius: 6,
                  background: 'rgba(244,175,37,0.12)',
                  color: '#8a5e0a',
                }}
              >
                Файл обрізано до 1 МіБ.
              </div>
            )}
            {selected.kind === 'text' ? (
              <pre
                className="tabular"
                style={{
                  flex: 1,
                  overflow: 'auto',
                  padding: 10,
                  borderRadius: 10,
                  background: 'rgba(26,22,18,0.92)',
                  color: 'rgba(255,255,255,0.86)',
                  fontFamily: 'var(--font-mono)',
                  fontSize: 11,
                  lineHeight: 1.45,
                  margin: 0,
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-word',
                }}
              >
                {selected.content ?? ''}
              </pre>
            ) : (
              <div
                className="playfair"
                style={{
                  flex: 1,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: 'var(--ink-muted)',
                  fontStyle: 'italic',
                  fontSize: 13,
                }}
              >
                Бінарний файл — попередній перегляд недоступний.
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

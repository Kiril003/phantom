/** The local verb keymap (§2.2 bound to §4.2's one focusable surface).
 *
 *  The covenant forbids global grabs and forbids the Film taking focus — so the
 *  verbs are captured *only* inside the Breath Line, the single window that
 *  legitimately owns the keyboard when summoned. Alt is the Facet modifier: no
 *  ordinary typing produces it, so the line stays a pristine text input while
 *  the same six verbs become reachable from it.
 *
 *  Keys are matched on `event.code` (physical position), not `event.key`, so the
 *  grammar survives the operator's Ukrainian layout unchanged. */

import { Verb } from './types';

export type FacetCommand =
  | { action: 'verb'; verb: Verb }
  | { action: 'target'; dir: 1 | -1 };

export interface KeyLike {
  code: string;
  altKey: boolean;
  ctrlKey?: boolean;
  metaKey?: boolean;
}

export function resolveKey(e: KeyLike): FacetCommand | null {
  // Alt alone. Alt+Ctrl / Alt+Meta belong to the host OS — never ours.
  if (!e.altKey || e.ctrlKey || e.metaKey) return null;
  switch (e.code) {
    case 'Enter':
      return { action: 'verb', verb: Verb.Approach };
    // Doctrine binds Recede to Esc, but mutter grabs Alt+Escape for its own
    // window cycling and would swallow it — Alt+Backspace is the key the WM
    // cannot intercept, so Recede always has a way through.
    case 'Escape':
    case 'Backspace':
      return { action: 'verb', verb: Verb.Recede };
    case 'Period':
      return { action: 'verb', verb: Verb.Pin };
    case 'KeyF':
      return { action: 'verb', verb: Verb.Feed };
    case 'KeyD':
      return { action: 'verb', verb: Verb.Cleave };
    case 'Slash':
      return { action: 'verb', verb: Verb.Trace };
    case 'ArrowRight':
    case 'ArrowDown':
      return { action: 'target', dir: 1 };
    case 'ArrowLeft':
    case 'ArrowUp':
      return { action: 'target', dir: -1 };
    default:
      return null;
  }
}

/** `/`-prefixed lines spawn a Facet instead of asking (§4.2: `/` forces the
 *  verb sigil). The spawned shard becomes the active target, so the verbs that
 *  follow land on the thing the operator just called into being. */
export const SPAWNABLE = ['log', 'dossier', 'monitor'] as const;
export type Spawnable = (typeof SPAWNABLE)[number];

export function parseSpawn(line: string): { kind: Spawnable; arg: string } | null {
  const trimmed = line.trim();
  if (!trimmed.startsWith('/')) return null;
  const [word, ...rest] = trimmed.slice(1).trim().split(/\s+/);
  const kind = SPAWNABLE.find((k) => k === (word ?? '').toLowerCase());
  return kind ? { kind, arg: rest.join(' ') } : null;
}

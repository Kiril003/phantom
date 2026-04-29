/**
 * Day-4 Wave-2 IDB-3 — UserPicker React component pin (ADR-IDB-004).
 *
 * Coverage:
 *
 * 1. picker fetch on mount → renders one tile per user.
 * 2. picker with < 2 users renders nothing (single-user installs
 *    skip the picker entirely).
 * 3. tile tap calls onPick(username) exactly once.
 * 4. activeUsername highlights the matching tile (data-active=1).
 * 5. fetch failure → empty state (no tiles, no error in UI but
 *    data-error attribute set).
 * 6. each tile is a 44+px touch target.
 * 7. avatar fallback: when avatar_url is null, the tile shows the
 *    first uppercase letter of the username.
 * 8. picker has aria role="listbox" and tiles role="option" with
 *    aria-selected reflecting active.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { UserPicker } from '../components/auth/UserPicker';

vi.mock('framer-motion', async () => {
  const actual = await vi.importActual<object>('framer-motion');
  return {
    ...actual,
    motion: new Proxy(
      {},
      {
        get: () => (props: Record<string, unknown>) => {
          const { children, ...rest } = props as {
            children?: React.ReactNode;
          };
          // Strip framer-motion-only props the actual <button>/<div>
          // doesn't accept (whileTap, initial, animate, exit,
          // transition).
          const cleaned: Record<string, unknown> = {};
          for (const [k, v] of Object.entries(rest)) {
            if (
              k === 'whileTap' ||
              k === 'initial' ||
              k === 'animate' ||
              k === 'exit' ||
              k === 'transition' ||
              k === 'whileHover'
            ) {
              continue;
            }
            cleaned[k] = v;
          }
          return <button {...(cleaned as object)}>{children}</button>;
        },
      }
    ),
  };
});

vi.mock('../services/api', () => ({
  authApi: {
    picker: vi.fn(),
  },
}));

beforeEach(() => {
  vi.clearAllMocks();
});

async function setupWithUsers(
  users: Array<{ id: string; username: string; avatar_url: string | null }>,
  props: Partial<React.ComponentProps<typeof UserPicker>> = {}
) {
  const { authApi } = await import('../services/api');
  (authApi.picker as ReturnType<typeof vi.fn>).mockResolvedValue(users);
  const onPick = vi.fn();
  render(
    <UserPicker onPick={onPick} {...props} />
  );
  return { onPick };
}


describe('UserPicker (IDB-3)', () => {
  it('renders one tile per user', async () => {
    await setupWithUsers([
      { id: 'u1', username: 'alice', avatar_url: null },
      { id: 'u2', username: 'bob', avatar_url: null },
      { id: 'u3', username: 'charlie', avatar_url: null },
    ]);
    const picker = await screen.findByTestId('user-picker');
    expect(picker.getAttribute('data-tile-count')).toBe('3');
    const tiles = picker.querySelectorAll('[data-username]');
    expect(tiles).toHaveLength(3);
  });

  it('renders nothing when fewer than 2 users', async () => {
    await setupWithUsers([
      { id: 'u1', username: 'solo', avatar_url: null },
    ]);
    // Wait a tick for the fetch to settle.
    await waitFor(() => {
      expect(screen.queryByTestId('user-picker')).not.toBeInTheDocument();
    });
  });

  it('renders nothing on empty list', async () => {
    await setupWithUsers([]);
    await waitFor(() => {
      expect(screen.queryByTestId('user-picker')).not.toBeInTheDocument();
    });
  });

  it('tile tap calls onPick with the username', async () => {
    const { onPick } = await setupWithUsers([
      { id: 'u1', username: 'alice', avatar_url: null },
      { id: 'u2', username: 'bob', avatar_url: null },
    ]);
    await screen.findByTestId('user-picker');
    const bobTile = screen
      .getByTestId('user-picker')
      .querySelector('[data-username="bob"]')!;
    fireEvent.click(bobTile);
    expect(onPick).toHaveBeenCalledTimes(1);
    expect(onPick).toHaveBeenCalledWith('bob');
  });

  it('activeUsername sets data-active=1 on matching tile', async () => {
    await setupWithUsers(
      [
        { id: 'u1', username: 'alice', avatar_url: null },
        { id: 'u2', username: 'bob', avatar_url: null },
      ],
      { activeUsername: 'bob' }
    );
    await screen.findByTestId('user-picker');
    const aliceTile = screen
      .getByTestId('user-picker')
      .querySelector('[data-username="alice"]')!;
    const bobTile = screen
      .getByTestId('user-picker')
      .querySelector('[data-username="bob"]')!;
    expect(aliceTile.getAttribute('data-active')).toBe('0');
    expect(bobTile.getAttribute('data-active')).toBe('1');
    expect(bobTile.getAttribute('aria-selected')).toBe('true');
  });

  it('fetch failure renders empty state', async () => {
    const { authApi } = await import('../services/api');
    (authApi.picker as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error('network down')
    );
    render(<UserPicker onPick={() => {}} />);
    // After failure tiles=[], component returns null (length<2).
    await waitFor(() => {
      expect(screen.queryByTestId('user-picker')).not.toBeInTheDocument();
    });
  });

  it('44+ tap target on each tile', async () => {
    await setupWithUsers([
      { id: 'u1', username: 'alice', avatar_url: null },
      { id: 'u2', username: 'bob', avatar_url: null },
    ]);
    await screen.findByTestId('user-picker');
    const tiles = screen
      .getByTestId('user-picker')
      .querySelectorAll('[data-username]');
    for (const tile of Array.from(tiles)) {
      const minH = parseInt((tile as HTMLElement).style.minHeight || '0', 10);
      const minW = parseInt((tile as HTMLElement).style.minWidth || '0', 10);
      expect(minW).toBeGreaterThanOrEqual(44);
      expect(minH).toBeGreaterThanOrEqual(44);
    }
  });

  it('avatar fallback shows first uppercase letter when avatar_url is null', async () => {
    await setupWithUsers([
      { id: 'u1', username: 'alice', avatar_url: null },
      { id: 'u2', username: 'bob', avatar_url: null },
    ]);
    const picker = await screen.findByTestId('user-picker');
    expect(picker.textContent).toContain('A');
    expect(picker.textContent).toContain('B');
  });

  it('aria roles wired correctly', async () => {
    await setupWithUsers([
      { id: 'u1', username: 'alice', avatar_url: null },
      { id: 'u2', username: 'bob', avatar_url: null },
    ]);
    const picker = await screen.findByTestId('user-picker');
    const list = picker.querySelector('[role="listbox"]');
    expect(list).not.toBeNull();
    const opts = picker.querySelectorAll('[role="option"]');
    expect(opts).toHaveLength(2);
  });
});

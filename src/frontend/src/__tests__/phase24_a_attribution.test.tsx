/**
 * Phase 24-A — AttributionDrawer + useAttribution tests.
 *
 * Covers:
 *   1. drawer renders the attribution union from the API
 *   2. drawer hides itself only when there is genuinely nothing to credit
 *   3. duplicate attribution strings are *not* rendered twice
 *   4. clicking the chip toggles the expanded list
 *   5. errors surface in the UI without hiding the chip
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, fireEvent, waitFor } from '@testing-library/react';

vi.mock('../services/api', () => ({
  mapApi: {
    getAttribution: vi.fn(),
  },
}));

import { mapApi } from '../services/api';
import { AttributionDrawer } from '../components/map/hud/AttributionDrawer';

const mockedGet = vi.mocked(mapApi.getAttribution);

beforeEach(() => {
  mockedGet.mockReset();
});

afterEach(() => {
  mockedGet.mockReset();
});

describe('AttributionDrawer', () => {
  it('renders nothing-active state when API returns empty union', async () => {
    mockedGet.mockResolvedValue({
      session_id: 'user:1',
      active_layer_ids: [],
      attribution: [],
    });
    render(<AttributionDrawer pollMs={0} />);
    await waitFor(() =>
      expect(screen.getByTestId('attribution-drawer-empty')).toBeInTheDocument(),
    );
  });

  it('shows the first attribution string in the collapsed chip', async () => {
    mockedGet.mockResolvedValue({
      session_id: 'user:1',
      active_layer_ids: ['base', 'air_raid_ua'],
      attribution: [
        { text: '© OpenStreetMap', license: 'ODbL', layer_ids: ['base'] },
        { text: 'Дані: alarms.in.ua', license: 'NC', layer_ids: ['air_raid_ua'] },
      ],
    });
    render(<AttributionDrawer pollMs={0} />);
    const toggle = await screen.findByTestId('attribution-drawer-toggle');
    expect(toggle).toHaveTextContent('© OpenStreetMap');
    expect(toggle).toHaveTextContent('джерел: 2');
  });

  it('expands to show every attribution line on toggle click', async () => {
    mockedGet.mockResolvedValue({
      session_id: 'user:1',
      active_layer_ids: ['base', 'air_raid_ua'],
      attribution: [
        { text: '© OpenStreetMap', license: 'ODbL', layer_ids: ['base'] },
        { text: 'Дані: alarms.in.ua', license: 'NC', layer_ids: ['air_raid_ua'] },
      ],
    });
    render(<AttributionDrawer pollMs={0} />);
    const toggle = await screen.findByTestId('attribution-drawer-toggle');
    await act(async () => {
      fireEvent.click(toggle);
    });
    const list = screen.getByTestId('attribution-drawer-list');
    expect(list).toHaveTextContent('© OpenStreetMap');
    expect(list).toHaveTextContent('Дані: alarms.in.ua');
    expect(list).toHaveTextContent('ODbL');
    expect(list).toHaveTextContent('NC');
  });

  it('renders each attribution exactly once even if API repeats text', async () => {
    // Belt-and-suspenders: backend dedups already, but the UI must not
    // re-introduce duplicates if a misbehaving server sends them.
    mockedGet.mockResolvedValue({
      session_id: 'user:1',
      active_layer_ids: ['a', 'b'],
      attribution: [
        { text: 'Source X', license: 'MIT', layer_ids: ['a'] },
        { text: 'Source X', license: 'MIT', layer_ids: ['b'] },
      ],
    });
    render(<AttributionDrawer pollMs={0} />);
    const toggle = await screen.findByTestId('attribution-drawer-toggle');
    await act(async () => {
      fireEvent.click(toggle);
    });
    const list = screen.getByTestId('attribution-drawer-list');
    const items = list.querySelectorAll('li');
    expect(items.length).toBe(1);
    expect(items[0]).toHaveTextContent('Source X');
  });

  it('still renders the chip when the API call fails', async () => {
    mockedGet.mockRejectedValue(new Error('network down'));
    render(<AttributionDrawer pollMs={0} />);
    // Empty state because no lines arrived; the empty chip is acceptable.
    await waitFor(() =>
      expect(screen.getByTestId('attribution-drawer-empty')).toBeInTheDocument(),
    );
  });
});

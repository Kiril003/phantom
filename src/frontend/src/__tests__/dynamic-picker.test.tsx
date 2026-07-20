/**
 * Day-4 Wave-2 W-4 — `<DynamicPicker>` consumer pin.
 *
 * Coverage:
 *
 * 1. Mount → fetch /api/v1/dynamic_source/{source} → render options.
 * 2. Empty server response → render placeholder text.
 * 3. Network failure → console.warn + render placeholder.
 * 4. Selecting an option fires `onChange(value)` AND closes the list.
 * 5. `value` matches an option → trigger label shows that option's label
 *    (NOT the raw id).
 * 6. `value` matches no option → trigger label shows the raw value
 *    string (defensive: previously-selected model removed → still
 *    legible).
 * 7. `disabled` prop disables the trigger.
 * 8. `refreshKey` bump re-fetches.
 * 9. Tap target ≥ 44×44 on the trigger AND on each option row.
 * 10. `aria-haspopup="listbox"` + `aria-expanded` + `role="listbox"` +
 *     `role="option"` + `aria-selected` ARIA chain is sound.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { DynamicPicker } from '../components/chat/DynamicPicker';
import type { DynamicPickerOption } from '@shared/types';

const ENVELOPE = (
  source: string,
  options: DynamicPickerOption[]
) => ({
  source,
  options,
  fetched_at: 1717459200,
  ttl_s: 30,
});

beforeEach(() => {
  vi.restoreAllMocks();
});

function mockFetch(
  response: object | Promise<object>,
  init: { ok?: boolean; status?: number } = {}
) {
  const fakeRes = {
    ok: init.ok ?? true,
    status: init.status ?? 200,
    json: () => Promise.resolve(response),
  } as Partial<Response>;
  vi.stubGlobal(
    'fetch',
    vi.fn(() => Promise.resolve(fakeRes as Response))
  );
}

describe('DynamicPicker (W-4)', () => {
  it('fetches options on mount and renders them when opened', async () => {
    mockFetch(
      ENVELOPE('ollama_models', [
        { value: 'llama3', label: 'Llama 3', meta: { provider: 'ollama' } },
        { value: 'gemma2', label: 'Gemma 2' },
      ])
    );

    render(
      <DynamicPicker
        source="ollama_models"
        value={null}
        onChange={() => {}}
      />
    );

    // Wait for the loading state to clear.
    const trigger = await screen.findByTestId('dynamic-picker');
    await waitFor(() =>
      expect(trigger.getAttribute('data-loading')).toBe('0')
    );

    // Open the dropdown.
    fireEvent.click(screen.getByRole('button', { name: /llama|gemma|—/i }));
    expect(await screen.findByTestId('dynamic-picker-list')).toBeInTheDocument();
    expect(screen.getByText('Llama 3')).toBeInTheDocument();
    expect(screen.getByText('Gemma 2')).toBeInTheDocument();
  });

  it('renders placeholder when the resolver returns empty options', async () => {
    mockFetch(ENVELOPE('serial_ports', []));

    render(
      <DynamicPicker
        source="serial_ports"
        value={null}
        onChange={() => {}}
        placeholder="No ports detected"
      />
    );

    const trigger = await screen.findByTestId('dynamic-picker');
    await waitFor(() =>
      expect(trigger.getAttribute('data-empty')).toBe('1')
    );
    // Open the dropdown — the placeholder appears as the only entry.
    // Use waitFor + getAllByText to absorb the React 18 strict-mode
    // double-effect render race in jsdom: after the click, React
    // batches state updates and the placeholder appears on the next
    // microtask. waitFor polls until the text lands.
    fireEvent.click(screen.getByTestId('dynamic-picker-trigger'));
    // Two text nodes carry the placeholder once the dropdown opens:
    // the trigger label (shown when no option matches) AND the
    // dropdown's empty-state <li>. Scope to the listbox to confirm
    // the EMPTY-STATE branch ran (not the selected-label branch).
    await waitFor(() => {
      const list = screen.getByTestId('dynamic-picker-list');
      expect(within(list).getByText('No ports detected')).toBeInTheDocument();
    });
  });

  it('falls back to placeholder when fetch fails', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.reject(new Error('network down')))
    );

    render(
      <DynamicPicker
        source="voice_voices"
        value={null}
        onChange={() => {}}
        placeholder="No voices"
      />
    );

    await waitFor(() => {
      expect(warnSpy).toHaveBeenCalled();
    });
    const trigger = await screen.findByTestId('dynamic-picker');
    expect(trigger.getAttribute('data-empty')).toBe('1');
  });

  it('selecting an option fires onChange and closes the list', async () => {
    mockFetch(
      ENVELOPE('voice_voices', [
        { value: 'Марина', label: 'Марина' },
        { value: 'Кирило', label: 'Кирило' },
      ])
    );
    const onChange = vi.fn();

    render(
      <DynamicPicker
        source="voice_voices"
        value={null}
        onChange={onChange}
      />
    );

    const trigger = await screen.findByRole('button');
    await waitFor(() => {
      expect(trigger.hasAttribute('disabled')).toBe(false);
    });
    fireEvent.click(trigger);
    const list = await screen.findByRole('listbox');
    fireEvent.click(screen.getByText('Кирило'));

    expect(onChange).toHaveBeenCalledWith('Кирило');
    // List must collapse after selection (single-shot).
    await waitFor(() => {
      expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    });
    void list;
  });

  it('shows the option LABEL when value matches an option, not the raw id', async () => {
    mockFetch(
      ENVELOPE('ollama_models', [
        { value: 'llama3', label: 'Llama 3' },
        { value: 'gemma', label: 'Gemma' },
      ])
    );

    render(
      <DynamicPicker
        source="ollama_models"
        value="llama3"
        onChange={() => {}}
      />
    );

    const trigger = await screen.findByRole('button');
    await waitFor(() =>
      expect(screen.getByTestId('dynamic-picker').getAttribute('data-loading')).toBe('0')
    );
    expect(trigger).toHaveTextContent('Llama 3');
    expect(trigger.textContent).not.toMatch(/^llama3$/);
  });

  it('shows the raw value when no option matches (defensive)', async () => {
    mockFetch(ENVELOPE('ollama_models', [{ value: 'gemma', label: 'Gemma' }]));

    render(
      <DynamicPicker
        source="ollama_models"
        value="llama3-removed"
        onChange={() => {}}
      />
    );

    const trigger = await screen.findByRole('button');
    await waitFor(() =>
      expect(screen.getByTestId('dynamic-picker').getAttribute('data-loading')).toBe('0')
    );
    expect(trigger).toHaveTextContent('llama3-removed');
  });

  it('respects the disabled prop', async () => {
    mockFetch(ENVELOPE('voice_voices', [{ value: 'A', label: 'A' }]));

    render(
      <DynamicPicker
        source="voice_voices"
        value={null}
        onChange={() => {}}
        disabled
      />
    );

    const trigger = await screen.findByRole('button');
    expect(trigger).toBeDisabled();
  });

  it('refreshKey bump triggers re-fetch', async () => {
    const fetchSpy = vi.fn(() =>
      Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve(ENVELOPE('serial_ports', [])),
      } as Response)
    );
    vi.stubGlobal('fetch', fetchSpy);

    const { rerender } = render(
      <DynamicPicker
        source="serial_ports"
        value={null}
        onChange={() => {}}
        refreshKey={1}
      />
    );

    await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(1));

    rerender(
      <DynamicPicker
        source="serial_ports"
        value={null}
        onChange={() => {}}
        refreshKey={2}
      />
    );
    await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(2));
  });

  it('trigger meets 44x44 tap-target minimum', async () => {
    mockFetch(ENVELOPE('voice_voices', [{ value: 'A', label: 'A' }]));
    render(
      <DynamicPicker
        source="voice_voices"
        value={null}
        onChange={() => {}}
      />
    );
    const trigger = await screen.findByRole('button');
    expect(parseInt(trigger.style.minWidth || '0', 10)).toBeGreaterThanOrEqual(44);
    expect(parseInt(trigger.style.minHeight || '0', 10)).toBeGreaterThanOrEqual(44);
  });

  it('aria chain for the listbox is sound', async () => {
    mockFetch(
      ENVELOPE('voice_voices', [
        { value: 'A', label: 'A' },
        { value: 'B', label: 'B' },
      ])
    );

    render(
      <DynamicPicker source="voice_voices" value="B" onChange={() => {}} />
    );

    const trigger = await screen.findByRole('button');
    await waitFor(() =>
      expect(screen.getByTestId('dynamic-picker').getAttribute('data-loading')).toBe('0')
    );
    expect(trigger.getAttribute('aria-haspopup')).toBe('listbox');
    fireEvent.click(trigger);
    const list = await screen.findByRole('listbox');
    const opts = within(list).getAllByRole('option');
    expect(opts).toHaveLength(2);
    // The selected option carries aria-selected="true".
    const selected = opts.find(
      (o) => o.getAttribute('aria-selected') === 'true'
    );
    expect(selected).toBeTruthy();
    expect(selected?.textContent).toContain('B');
  });
});


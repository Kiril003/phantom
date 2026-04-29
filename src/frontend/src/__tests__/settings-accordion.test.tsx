/**
 * Day-4 Wave-2 W-3b — Settings subgroup accordion pin (closes
 * audit U1-UX-C1 Settings overflow 1024×600).
 *
 * Coverage:
 *
 * 1. `inferSubgroup`: voice/agent/ai/chat/security keys map to the
 *    expected buckets; unknown keys fall into the General bucket.
 * 2. `groupByInferredSubgroup` preserves within-group key order and
 *    sorts groups by bucket.order ascending.
 * 3. `SettingsAccordion` renders count badge + dirty dot when
 *    dirtyCount > 0 and hides body when open=false.
 * 4. Toggling fires onToggle exactly once.
 * 5. ARIA contract: `aria-expanded` reflects `open`; `aria-controls`
 *    points at the body region; the body has `role="region"` and
 *    `aria-labelledby` matching the header.
 * 6. `writeAccordionState` + `readAccordionState` round-trip via
 *    localStorage; reading a missing key returns null; reading
 *    garbage returns null without throwing.
 * 7. `readAccordionState` filters out non-boolean values defensively.
 * 8. The accordion header tap-target meets 44x44 minimum.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import {
  inferSubgroup,
  groupByInferredSubgroup,
} from '../components/settings/groupSettings';
import {
  SettingsAccordion,
  readAccordionState,
  writeAccordionState,
} from '../components/settings/SettingsAccordion';

vi.mock('framer-motion', async () => {
  const actual = await vi.importActual<object>('framer-motion');
  return {
    ...actual,
    AnimatePresence: ({ children }: { children: React.ReactNode }) => (
      <>{children}</>
    ),
    motion: new Proxy(
      {},
      {
        get: () => (props: Record<string, unknown>) => {
          const { children, ...rest } = props as {
            children?: React.ReactNode;
          };
          return <div {...(rest as object)}>{children}</div>;
        },
      }
    ),
  };
});

beforeEach(() => {
  window.localStorage.clear();
});


describe('inferSubgroup (W-3b)', () => {
  it('maps voice_stt_* into Speech-to-text bucket', () => {
    expect(inferSubgroup('voice', 'voice_stt_mode').id).toBe('voice.stt');
    expect(inferSubgroup('voice', 'voice_stt_npu_enabled').id).toBe('voice.stt');
  });

  it('maps voice_tts_* into Text-to-speech bucket', () => {
    expect(inferSubgroup('voice', 'voice_tts_voice').id).toBe('voice.tts');
    expect(inferSubgroup('voice', 'voice_tts_alpha').id).toBe('voice.tts');
  });

  it('maps voice_always_on / wake_word / vad / amp into Always-on bucket', () => {
    expect(inferSubgroup('voice', 'voice_always_on_enabled').id).toBe(
      'voice.always_on'
    );
    expect(inferSubgroup('voice', 'voice_wake_word').id).toBe('voice.always_on');
    expect(inferSubgroup('voice', 'voice_vad_threshold').id).toBe(
      'voice.always_on'
    );
    expect(inferSubgroup('voice', 'voice_amp_factor').id).toBe(
      'voice.always_on'
    );
  });

  it('maps agent_emotion_* into Emotion model bucket', () => {
    expect(inferSubgroup('agent', 'agent_emotion_enabled').id).toBe(
      'agent.emotion'
    );
  });

  it('maps agent_proactive_* into Proactive bucket', () => {
    expect(inferSubgroup('agent', 'agent_proactive_enabled').id).toBe(
      'agent.proactive'
    );
  });

  it('maps agent_standing_orders_* into Standing orders bucket', () => {
    expect(
      inferSubgroup('agent', 'agent_standing_orders_enabled').id
    ).toBe('agent.standing_orders');
  });

  it('falls back to agent.core for misc agent keys (general suffix)', () => {
    expect(inferSubgroup('agent', 'agent_enabled').id).toBe('agent.core');
  });

  it('maps ai_gemini_* and ai_ollama_* into separate provider buckets', () => {
    expect(inferSubgroup('ai', 'ai_gemini_model').id).toBe('ai.gemini');
    expect(inferSubgroup('ai', 'ai_ollama_url').id).toBe('ai.ollama');
  });

  it('maps chat_tools_* into Chat tool-use bucket', () => {
    expect(inferSubgroup('chat', 'chat_tools_enabled').id).toBe('chat.tools');
  });

  it('falls back to General for unknown keys', () => {
    expect(inferSubgroup('system', 'system_hostname').id).toBe('general');
    expect(inferSubgroup('whatever', 'noprefix').id).toBe('general');
  });
});


describe('groupByInferredSubgroup (W-3b)', () => {
  it('preserves within-group key order', () => {
    const settings = [
      { key: 'voice_stt_mode' },
      { key: 'voice_stt_language' },
      { key: 'voice_tts_voice' },
      { key: 'voice_stt_whisper_model' },
    ];
    const groups = groupByInferredSubgroup('voice', settings);
    const stt = groups.find((g) => g.bucket.id === 'voice.stt');
    expect(stt?.items.map((s) => s.key)).toEqual([
      'voice_stt_mode',
      'voice_stt_language',
      'voice_stt_whisper_model',
    ]);
  });

  it('sorts groups by bucket.order ascending', () => {
    const settings = [
      { key: 'voice_tts_voice' },         // order 2
      { key: 'voice_amp_factor' },        // order 3
      { key: 'voice_stt_mode' },          // order 1
      { key: 'voice_pipeline_legacy' },   // order 4
    ];
    const groups = groupByInferredSubgroup('voice', settings);
    expect(groups.map((g) => g.bucket.id)).toEqual([
      'voice.stt',
      'voice.tts',
      'voice.always_on',
      'voice.pipeline',
    ]);
  });

  it('produces a single General bucket when no rules match', () => {
    const settings = [
      { key: 'system_hostname' },
      { key: 'system_log_level' },
    ];
    const groups = groupByInferredSubgroup('system', settings);
    expect(groups).toHaveLength(1);
    expect(groups[0].bucket.id).toBe('general');
    expect(groups[0].items).toHaveLength(2);
  });
});


describe('SettingsAccordion (W-3b)', () => {
  function renderAccordion(props: {
    open: boolean;
    onToggle?: () => void;
    dirtyCount?: number;
  }) {
    return render(
      <SettingsAccordion
        id="test.id"
        label="Test group"
        count={3}
        dirtyCount={props.dirtyCount ?? 0}
        open={props.open}
        onToggle={props.onToggle ?? (() => {})}
      >
        <div data-testid="acc-body-content">child rows</div>
      </SettingsAccordion>
    );
  }

  it('hides children when open=false', () => {
    renderAccordion({ open: false });
    expect(
      screen.queryByTestId('acc-body-content')
    ).not.toBeInTheDocument();
  });

  it('shows children when open=true', () => {
    renderAccordion({ open: true });
    expect(screen.getByTestId('acc-body-content')).toBeInTheDocument();
  });

  it('aria-expanded reflects open state', () => {
    const { rerender } = renderAccordion({ open: false });
    const btn = screen.getByRole('button', { name: /test group/i });
    expect(btn.getAttribute('aria-expanded')).toBe('false');
    rerender(
      <SettingsAccordion
        id="test.id"
        label="Test group"
        count={3}
        dirtyCount={0}
        open
        onToggle={() => {}}
      >
        <div>child</div>
      </SettingsAccordion>
    );
    expect(
      screen.getByRole('button', { name: /test group/i }).getAttribute(
        'aria-expanded'
      )
    ).toBe('true');
  });

  it('aria-controls + aria-labelledby chain is sound', () => {
    renderAccordion({ open: true });
    const btn = screen.getByRole('button', { name: /test group/i });
    const region = screen.getByRole('region');
    expect(btn.getAttribute('aria-controls')).toBe(region.getAttribute('id'));
    expect(region.getAttribute('aria-labelledby')).toBe(btn.getAttribute('id'));
  });

  it('shows dirty badge when dirtyCount > 0', () => {
    renderAccordion({ open: false, dirtyCount: 4 });
    const btn = screen.getByRole('button');
    expect(btn).toHaveTextContent('4');
    // aria-label should mention "unsaved changes" so screen readers
    // hear something descriptive instead of "4 4".
    expect(btn.querySelector('[aria-label*="unsaved"]')).toBeInTheDocument();
  });

  it('clicking calls onToggle exactly once', () => {
    const onToggle = vi.fn();
    renderAccordion({ open: false, onToggle });
    fireEvent.click(screen.getByRole('button', { name: /test group/i }));
    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  it('header meets 44x44 tap-target minimum', () => {
    renderAccordion({ open: false });
    const btn = screen.getByRole('button', { name: /test group/i });
    expect(parseInt(btn.style.minHeight || '0', 10)).toBeGreaterThanOrEqual(44);
  });
});


describe('localStorage persistence (W-3b)', () => {
  it('round-trips state via writeAccordionState / readAccordionState', () => {
    writeAccordionState('voice', { 'voice.stt': true, 'voice.tts': false });
    const read = readAccordionState('voice');
    expect(read).toEqual({ 'voice.stt': true, 'voice.tts': false });
  });

  it('returns null for a missing key', () => {
    expect(readAccordionState('never-stored')).toBeNull();
  });

  it('returns null when the stored value is corrupt JSON', () => {
    window.localStorage.setItem(
      'phantom.settings.accordion.broken',
      '{not-json',
    );
    expect(readAccordionState('broken')).toBeNull();
  });

  it('filters out non-boolean values defensively', () => {
    window.localStorage.setItem(
      'phantom.settings.accordion.mixed',
      JSON.stringify({ 'a': true, 'b': 'string', 'c': false, 'd': 42 })
    );
    const read = readAccordionState('mixed');
    expect(read).toEqual({ a: true, c: false });
  });
});

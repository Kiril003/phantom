/**
 * AgentRoster tests
 *
 * Covers:
 *  1. Renders all 5 chips from empty store (all inactive)
 *  2. Click Background chip → useUIStore.getState().focusedAgent === 'background'
 *  3. aria-pressed=true only on the focused chip
 *  4. Foreground chip becomes active when currentTask set + status='running'
 *  5. Council chip becomes active when councilActive=true
 *  6. Compact mode (chrome.roster=true) renders shorter chips that keep their labels
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import { AgentRoster } from '../components/agent/overlays/AgentRoster';
import { useAgentStore } from '../stores/agentStore';
import { useUIStore } from '../stores/uiStore';

// ─── Store reset helpers ───────────────────────────────────────────────────────

function resetStores() {
  useAgentStore.setState({
    currentTask: null,
    status: 'idle',
    promotedToBackgroundAt: {},
    bgTaskGoals: {},
    progressByTaskId: {},
    proactive: { enabled: false, lastCycleAt: null, hasTriggers: false },
    councilActive: false,
    councilStatements: [],
  });
  useUIStore.setState({
    focusedAgent: 'foreground',
    chrome: {
      statusBar: false,
      roster: false,   // full mode by default
      hud: false,
      toolbar: false,
    },
  });
}

describe('AgentRoster', () => {
  beforeEach(() => {
    resetStores();
  });

  // ── 1. All 5 chips render with empty store ───────────────────────────────

  it('renders all 5 chips from an empty store', () => {
    const { getByTestId } = render(<AgentRoster />);

    expect(getByTestId('roster-chip-foreground')).toBeDefined();
    expect(getByTestId('roster-chip-background')).toBeDefined();
    expect(getByTestId('roster-chip-standing_orders')).toBeDefined();
    expect(getByTestId('roster-chip-proactive')).toBeDefined();
    expect(getByTestId('roster-chip-council')).toBeDefined();
  });

  // ── 2. Click Background chip sets focusedAgent ──────────────────────────

  it('clicking Background chip sets useUIStore.focusedAgent to "background"', () => {
    const { getByTestId } = render(<AgentRoster />);

    fireEvent.click(getByTestId('roster-chip-background'));

    expect(useUIStore.getState().focusedAgent).toBe('background');
  });

  // ── 3. aria-pressed only on focused chip ────────────────────────────────

  it('aria-pressed=true only on the focused chip', () => {
    const { getByTestId } = render(<AgentRoster />);

    // Default focus is 'foreground'
    expect(getByTestId('roster-chip-foreground').getAttribute('aria-pressed')).toBe('true');
    expect(getByTestId('roster-chip-background').getAttribute('aria-pressed')).toBe('false');
    expect(getByTestId('roster-chip-standing_orders').getAttribute('aria-pressed')).toBe('false');
    expect(getByTestId('roster-chip-proactive').getAttribute('aria-pressed')).toBe('false');
    expect(getByTestId('roster-chip-council').getAttribute('aria-pressed')).toBe('false');

    // Switch focus to council
    fireEvent.click(getByTestId('roster-chip-council'));

    expect(getByTestId('roster-chip-foreground').getAttribute('aria-pressed')).toBe('false');
    expect(getByTestId('roster-chip-council').getAttribute('aria-pressed')).toBe('true');
  });

  // ── 4. Foreground chip active when task running ──────────────────────────

  it('Foreground chip has active dot when status=running and currentTask is set', () => {
    useAgentStore.setState({
      status: 'running',
      currentTask: {
        task: {
          id: 'task-1',
          goal: 'Write tests',
          status: 'running',
          track: 'foreground',
          paused_reason: null,
          error: null,
          created_at: new Date().toISOString(),
          finished_at: null,
        },
        sub_goals: [],
        self_model: null,
        observations: [],
        thought_budget: {
          estimated_actions: 0,
          actions_used: 0,
          force_reflect_ratio: 2,
          reflections_done: 0,
        },
        last_audit: [],
      },
    });

    const { getByTestId } = render(<AgentRoster />);
    const fgChip = getByTestId('roster-chip-foreground');

    // The Dot span inside the chip should carry the pulse animation when active.
    // We detect activity by checking the inline animation style on the dot span.
    const dot = fgChip.querySelector('span[style*="border-radius"]');
    expect(dot).not.toBeNull();
    // Active dot has animation set
    const style = (dot as HTMLElement).style;
    expect(style.animation).toContain('agentRosterPulse');
  });

  // ── 5. Council chip active when councilActive=true ───────────────────────

  it('Council chip has active dot when councilActive=true', () => {
    useAgentStore.setState({
      councilActive: true,
      councilStatements: [],
    });

    const { getByTestId } = render(<AgentRoster />);
    const councilChip = getByTestId('roster-chip-council');

    const dot = councilChip.querySelector('span[style*="border-radius"]');
    expect(dot).not.toBeNull();
    const style = (dot as HTMLElement).style;
    expect(style.animation).toContain('agentRosterPulse');
  });

  // ── 6. Compact mode: shorter chips, no text labels ───────────────────────

  it('compact mode (chrome.roster=true) renders shorter chips that keep their labels', () => {
    // Set roster chrome to collapsed (compact)
    useUIStore.setState({
      chrome: {
        statusBar: false,
        roster: true,   // compact
        hud: false,
        toolbar: false,
      },
    });

    const { getByTestId, queryByText } = render(<AgentRoster />);

    // Chips exist
    const fgChip = getByTestId('roster-chip-foreground');
    const bgChip = getByTestId('roster-chip-background');

    // In compact mode, chips have h=28px inline style (minHeight is still 44 for touch)
    // We check the height property on the button style directly
    const fgStyle = (fgChip as HTMLButtonElement).style;
    const bgStyle = (bgChip as HTMLButtonElement).style;

    expect(parseInt(fgStyle.height, 10)).toBe(28);
    expect(parseInt(bgStyle.height, 10)).toBe(28);

    // Підписи лишаються і в компактному режимі — без них ряд читався як
    // безіменні вкладки. Ховається лише текст статусу.
    expect(queryByText('ОСНОВНИЙ')).not.toBeNull();
    expect(queryByText('ФОНОВИЙ')).not.toBeNull();
    expect(queryByText('Немає задачі')).toBeNull();
    expect(queryByText('Немає фону')).toBeNull();
  });

  // ── 7. Full mode: text labels visible ───────────────────────────────────

  it('full mode (chrome.roster=false) renders chips with text labels', () => {
    useUIStore.setState({
      chrome: {
        statusBar: false,
        roster: false,  // full
        hud: false,
        toolbar: false,
      },
    });

    const { queryByText } = render(<AgentRoster />);

    // Label spans rendered in full mode
    expect(queryByText('ОСНОВНИЙ')).not.toBeNull();
    expect(queryByText('ФОНОВИЙ')).not.toBeNull();
    expect(queryByText('ДОРУЧЕННЯ')).not.toBeNull();
    expect(queryByText('АВТОНОМІЯ')).not.toBeNull();
  });

  // ── 8. Container has data-testid="agent-roster" ──────────────────────────

  it('container has data-testid="agent-roster"', () => {
    const { getByTestId } = render(<AgentRoster />);
    expect(getByTestId('agent-roster')).toBeDefined();
  });
});

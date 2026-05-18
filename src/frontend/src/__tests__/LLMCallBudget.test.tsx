/**
 * Phase 9.2.1 — LLM call-budget chip on AgentPanel.
 *
 * Verifies count formatting + the green/amber/red transitions that match
 * the Gemini 2.5-flash 20-RPD free-tier reality (green <20, amber 20-35,
 * red 35+).
 */
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { LLMCallBudget } from '../components/agent/status/LLMCallBudget';

describe('<LLMCallBudget />', () => {
  it('renders count and cap', () => {
    render(<LLMCallBudget used={7} cap={50} />);
    expect(screen.getByTestId('llm-call-budget')).toHaveTextContent('7 / 50');
  });

  it('paints green well under the warn threshold', () => {
    render(<LLMCallBudget used={5} cap={50} />);
    const fill = screen.getByTestId('llm-call-budget-fill');
    expect(fill).toHaveStyle({ background: 'var(--signal-ok)' });
  });

  it('paints amber after crossing the soft warn threshold', () => {
    render(<LLMCallBudget used={25} cap={50} />);
    const fill = screen.getByTestId('llm-call-budget-fill');
    expect(fill).toHaveStyle({ background: 'var(--signal-warn)' });
  });

  it('paints red after the alert threshold', () => {
    render(<LLMCallBudget used={42} cap={50} />);
    const fill = screen.getByTestId('llm-call-budget-fill');
    expect(fill).toHaveStyle({ background: 'var(--signal-alert)' });
  });

  it('falls back to cap=50 when undefined', () => {
    render(<LLMCallBudget used={10} />);
    expect(screen.getByTestId('llm-call-budget')).toHaveTextContent('10 / 50');
  });
});

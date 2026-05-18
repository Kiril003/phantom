import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('framer-motion', async () => {
  const actual = await vi.importActual<object>('framer-motion');
  return { ...actual };
});

import { MissionBriefDialog } from '../components/mission/MissionBriefDialog';

describe('MissionBriefDialog stays inside the 1024×600 frame', () => {
  it('panel is height-capped and scrolls (cannot overflow the device)', () => {
    render(<MissionBriefDialog onClose={() => {}} onSuccess={() => {}} />);
    // ROOT CAUSE: the overlay must anchor to the App's relative
    // w-[1024px] h-[600px] frame (like the working InterventionDialog),
    // NOT position:fixed to the raw browser viewport — ViewportFrame
    // scales/letterboxes the frame, so `fixed` lands off-screen.
    const overlay = screen.getByRole('presentation') as HTMLElement;
    expect(overlay.className).toContain('absolute');
    expect(overlay.className).not.toContain('fixed');

    const dlg = screen.getByRole('dialog') as HTMLElement;
    // Matches the established working-modal pattern (PlanEditor /
    // InfoNeedDialog / AgentReportScreen): bounded height + scroll so a
    // tall brief never spills past the 600px device frame.
    // Frame-correct px cap (NOT vh — viewport can mismatch the fixed
    // 1024×600 app frame). Must fit within the 600px device height.
    const mh = parseInt(dlg.style.maxHeight, 10);
    expect(dlg.style.maxHeight).toMatch(/px$/);
    expect(mh).toBeGreaterThan(0);
    expect(mh).toBeLessThanOrEqual(560);
    expect(dlg.style.overflowY).toBe('auto');
  });
});

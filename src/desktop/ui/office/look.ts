/** What each posture looks like on the body. One row per posture the reducer
 *  can produce, so a state the kernel never reported has no appearance to
 *  render. Pure data — no three, no DOM. */

import { Posture } from './reducer';

export interface Look {
  /** Override the department colour, or null to keep it. */
  tint: number | null;
  glow: number;
  /** Head pitch in radians; positive bends the body to its work. */
  headPitch: number;
  /** Colour of the mark above the head, or null for no mark. */
  mark: number | null;
  /** Breaths per second for the mark; 0 holds it still. */
  pulse: number;
  /** Turn to face the operator — only a state that wants them does this. */
  faceOperator: boolean;
}

const PALE = 0xfde9b8;
const AMBER = 0xf4af25;
const MUTED = 0x64748b;
const WOUND = 0x9b3f3f;

export const LOOKS: Readonly<Record<Posture, Look>> = {
  arriving: { tint: null, glow: 0.16, headPitch: 0, mark: null, pulse: 0, faceOperator: false },
  working: { tint: null, glow: 0.18, headPitch: 0.34, mark: null, pulse: 0, faceOperator: false },
  thinking: { tint: null, glow: 0.28, headPitch: 0.1, mark: PALE, pulse: 0.55, faceOperator: false },
  reflecting: { tint: null, glow: 0.22, headPitch: 0.18, mark: PALE, pulse: 0.28, faceOperator: false },
  blocked: { tint: MUTED, glow: 0.05, headPitch: 0.12, mark: MUTED, pulse: 0, faceOperator: false },
  waiting_user: { tint: null, glow: 0.32, headPitch: 0, mark: AMBER, pulse: 1.05, faceOperator: true },
  failed: { tint: WOUND, glow: 0.06, headPitch: 0.52, mark: WOUND, pulse: 0, faceOperator: false },
  leaving: { tint: null, glow: 0.06, headPitch: 0, mark: null, pulse: 0, faceOperator: false },
};

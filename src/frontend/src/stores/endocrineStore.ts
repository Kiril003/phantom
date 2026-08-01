import { create } from 'zustand';

export interface EndocrineLevels {
  cortisol: number; // 0.0 - 1.0 (Stress, load, errors)
  dopamine: number; // 0.0 - 1.0 (Reward, task success)
  oxytocin: number; // 0.0 - 1.0 (Bonding, uptime, interaction)
}

interface EndocrineState extends EndocrineLevels {
  spikeCortisol: (amount: number) => void;
  spikeDopamine: (amount: number) => void;
  spikeOxytocin: (amount: number) => void;
  tick: (dt: number) => void;
}

// Biological half-lives (in seconds, mapped to UI time for dramatic effect)
const CORTISOL_DECAY_RATE = 0.05; // 20s to decay 1.0 -> 0.0
const DOPAMINE_DECAY_RATE = 0.15; // Fast burst, ~6s to decay
const OXYTOCIN_DECAY_RATE = 0.01; // Slow burn, ~100s to decay

export const useEndocrineStore = create<EndocrineState>((set) => ({
  cortisol: 0.1,
  dopamine: 0.1,
  oxytocin: 0.2,

  spikeCortisol: (amount) =>
    set((state) => ({ cortisol: Math.min(1.0, state.cortisol + amount) })),

  spikeDopamine: (amount) =>
    set((state) => ({ dopamine: Math.min(1.0, state.dopamine + amount) })),

  spikeOxytocin: (amount) =>
    set((state) => ({ oxytocin: Math.min(1.0, state.oxytocin + amount) })),

  // Called via requestAnimationFrame loop
  tick: (dt) =>
    set((state) => ({
      cortisol: Math.max(0.0, state.cortisol - CORTISOL_DECAY_RATE * dt),
      dopamine: Math.max(0.0, state.dopamine - DOPAMINE_DECAY_RATE * dt),
      oxytocin: Math.max(0.0, state.oxytocin - OXYTOCIN_DECAY_RATE * dt),
    })),
}));

// Start the biological clock singleton
let lastTime = typeof performance !== 'undefined' ? performance.now() : 0;
function biologicalTick(time: number) {
  const dt = (time - lastTime) / 1000.0;
  lastTime = time;
  
  if (dt > 0 && dt < 0.5) {
    useEndocrineStore.getState().tick(dt);
  }
  
  requestAnimationFrame(biologicalTick);
}

if (typeof window !== 'undefined') {
  requestAnimationFrame(biologicalTick);
  // @ts-ignore
  window.__PHANTOM_ENDOCRINE__ = useEndocrineStore.getState();
}

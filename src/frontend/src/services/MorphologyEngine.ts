/**
 * Absolute Sentient Vision — Morphology Engine.
 * Translates system states and endocrine signals into visual properties.
 */

export type SystemState = 'SHADOW' | 'FOCUS' | 'DIALOGUE' | 'SENTINEL' | 'GHOST' | 'DREAM' | 'BACKSTAGE' | 'OPERATOR';

export interface MorphologyProfile {
  blur: number;
  opacity: number;
  contrast: number;
  saturation: number;
  motionScale: number;
  hapticIntensity: number;
}

const STATE_PROFILES: Record<SystemState, MorphologyProfile> = {
  SHADOW: { blur: 2, opacity: 0.7, contrast: 0.8, saturation: 0.5, motionScale: 0.2, hapticIntensity: 0.1 },
  FOCUS: { blur: 0, opacity: 1.0, contrast: 1.2, saturation: 1.0, motionScale: 0.1, hapticIntensity: 0.0 },
  DIALOGUE: { blur: 0, opacity: 1.0, contrast: 1.0, saturation: 1.2, motionScale: 1.0, hapticIntensity: 0.3 },
  SENTINEL: { blur: 2, opacity: 0.8, contrast: 1.5, saturation: 0.8, motionScale: 1.2, hapticIntensity: 0.8 },
  GHOST: { blur: 20, opacity: 0.4, contrast: 0.5, saturation: 0.0, motionScale: 0.0, hapticIntensity: 0.0 },
  DREAM: { blur: 5, opacity: 0.6, contrast: 0.9, saturation: 1.5, motionScale: 2.0, hapticIntensity: 0.2 },
  BACKSTAGE: { blur: 1, opacity: 0.3, contrast: 0.8, saturation: 0.7, motionScale: 0.5, hapticIntensity: 0.1 },
  OPERATOR: { blur: 0, opacity: 1.0, contrast: 1.1, saturation: 1.0, motionScale: 0.1, hapticIntensity: 0.0 },
};

export class MorphologyEngine {
  static getProfile(state: SystemState, cortisol: number = 0.2): MorphologyProfile {
    const base = STATE_PROFILES[state] || STATE_PROFILES.SHADOW;
    
    // Adjust based on cortisol (stress)
    return {
      ...base,
      contrast: base.contrast + (cortisol * 0.2),
      motionScale: base.motionScale * (1.0 + cortisol),
      hapticIntensity: Math.max(base.hapticIntensity, cortisol)
    };
  }
}

// PHANTOM theme tokens — sunrise-warm + amber-night
// State accents apply on top via LocalStateAccent equivalent

const PHANTOM_THEMES = {
  sunrise: {
    id: 'sunrise-warm',
    primary:     '#F4AF25',
    primarySoft: '#FBC66A',
    primaryDeep: '#B07A10',
    coral:       '#EF4444',
    coralDeep:   '#B9201F',
    surfaceBase: '#F8F7F5',
    surfaceDeep: '#F5F1EA',
    surfaceTint: '#EFE6D4',
    glassPanel:  'rgba(255,255,255,0.60)',
    glassCard:   'rgba(255,255,255,0.72)',
    glassElevated: 'rgba(255,255,255,0.82)',
    glassBorder: 'rgba(176, 122, 16, 0.18)',
    glassHL:     'rgba(255,255,255,0.9)',
    glowPrimary: 'rgba(244,175,37,0.30)',
    ink:         '#2A1F10',
    ink2:        '#6A5A44',
    ink3:        '#9A8A6F',
    bgGradient: `radial-gradient(120% 80% at 30% 0%, #FFE7B0 0%, #F8E9CD 35%, #F5F1EA 70%, #ECE2CB 100%)`,
    isDark: false,
  },
  amber: {
    id: 'amber-night',
    primary:     '#F4AF25',
    primarySoft: '#FBC66A',
    primaryDeep: '#FFC34A',
    coral:       '#E35858',
    coralDeep:   '#7F1D1D',
    surfaceBase: '#0E0A05',
    surfaceDeep: '#080502',
    surfaceTint: '#1A1208',
    glassPanel:  'rgba(20,15,8,0.65)',
    glassCard:   'rgba(28,21,11,0.72)',
    glassElevated: 'rgba(36,27,14,0.82)',
    glassBorder: 'rgba(244,175,37,0.22)',
    glassHL:     'rgba(255,210,120,0.18)',
    glowPrimary: 'rgba(244,175,37,0.45)',
    ink:         '#F6E8C8',
    ink2:        '#B8A47C',
    ink3:        '#7A6B4D',
    bgGradient: `radial-gradient(110% 70% at 50% -10%, #2A1A06 0%, #160E04 45%, #0A0602 100%)`,
    isDark: true,
  },
};

// SystemState → state accent + motion + opacity
const PHANTOM_STATES = {
  SHADOW:   { label: 'SHADOW',   accentLight: '#8A7F72', accentDark: '#9C8E78', motionScale: 0.6, uiOpacity: 0.92, glyph: '◐' },
  FOCUS:    { label: 'FOCUS',    accentLight: '#B07A10', accentDark: '#F4AF25', motionScale: 1.0, uiOpacity: 1.00, glyph: '◉' },
  DIALOGUE: { label: 'DIALOGUE', accentLight: '#B07A10', accentDark: '#F4AF25', motionScale: 1.1, uiOpacity: 1.00, glyph: '◉' },
  SENTINEL: { label: 'SENTINEL', accentLight: '#B9201F', accentDark: '#E35858', motionScale: 1.3, uiOpacity: 1.00, glyph: '⚠' },
  GHOST:    { label: 'GHOST',    accentLight: '#16A34A', accentDark: '#16A34A', motionScale: 0.8, uiOpacity: 0.90, glyph: '◇' },
  DREAM:    { label: 'DREAM',    accentLight: '#B07A10', accentDark: '#F4AF25', motionScale: 0.4, uiOpacity: 0.75, glyph: '☾' },
};

function getStateAccent(stateKey, theme) {
  const s = PHANTOM_STATES[stateKey] || PHANTOM_STATES.FOCUS;
  return {
    ...s,
    accent: theme.isDark ? s.accentDark : s.accentLight,
  };
}

window.PHANTOM_THEMES = PHANTOM_THEMES;
window.PHANTOM_STATES = PHANTOM_STATES;
window.getStateAccent = getStateAccent;

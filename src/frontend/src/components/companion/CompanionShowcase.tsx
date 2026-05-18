import { DesignCanvas, DCSection, DCArtboard } from './DesignCanvas';
import { PHANTOM_THEMES, getStateAccent } from './CompanionTheme';
import { PulseScreen } from './screens/PulseScreen';
import { VoiceScreen } from './screens/VoiceScreen';
import { MapScreen } from './screens/MapScreen';
import { CommsScreen } from './screens/CommsScreen';
import { VaultScreen } from './screens/VaultScreen';
import { InCallScreen } from './screens/InCallScreen';

export function CompanionShowcase() {
  const themeS = PHANTOM_THEMES.sunrise;
  const themeA = PHANTOM_THEMES.amber;

  // Each screen has a natural state or override
  const renderScreen = (Comp: any, theme: any, key: string, fixedState?: string) => {
    const states: Record<string, string> = {
      pulse: 'FOCUS',
      voice: 'DIALOGUE',
      map: 'SENTINEL',
      comms: 'FOCUS',
      vault: 'GHOST',
      incall: 'DIALOGUE'
    };
    const sk = fixedState || states[key] || 'FOCUS';
    const acc = getStateAccent(sk, theme).accent;
    const ms = 1.0; // Default motion scale
    return <Comp theme={theme} accent={acc} stateKey={sk} motionScale={ms} />;
  };

  return (
    <div className="w-full h-full relative">
      <div className="absolute top-6 left-6 z-10 pointer-events-none max-w-md">
        <div style={{ fontFamily: 'JetBrains Mono', textTransform: 'uppercase', letterSpacing: '0.22em', fontSize: 11, color: '#9a8a6f' }}>PHANTOM · COMPANION</div>
        <div style={{ fontWeight: 700, fontSize: 28, marginTop: 6, letterSpacing: '-0.01em', color: '#2a1f10' }}>
          A familiar that <em style={{ fontFamily: 'Playfair Display', fontStyle: 'italic', fontWeight: 500, color: '#b07a10' }}>breathes with you</em>
        </div>
        <div style={{ marginTop: 8, fontSize: 13, lineHeight: 1.5, color: '#6a5a44' }}>
          Six core surfaces in two themes. State-accent shifts color, motion, and opacity. Drag to pan, scroll to zoom, click any artboard to focus.
        </div>
      </div>

      <DesignCanvas>
        <DCSection title="Sunrise · Warm" subtitle="default theme · light surfaces, amber primary, glass-warm chrome">
          <DCArtboard label="Pulse · home">
            {renderScreen(PulseScreen, themeS, 'pulse')}
          </DCArtboard>
          <DCArtboard label="Voice · PTT dialogue">
            {renderScreen(VoiceScreen, themeS, 'voice', 'DIALOGUE')}
          </DCArtboard>
          <DCArtboard label="Map · sentinel">
            {renderScreen(MapScreen, themeS, 'map', 'SENTINEL')}
          </DCArtboard>
          <DCArtboard label="Comms · unified inbox">
            {renderScreen(CommsScreen, themeS, 'comms')}
          </DCArtboard>
          <DCArtboard label="Vault · ghost">
            {renderScreen(VaultScreen, themeS, 'vault', 'GHOST')}
          </DCArtboard>
          <DCArtboard label="InCall · overlay">
            {renderScreen(InCallScreen, themeS, 'incall', 'DIALOGUE')}
          </DCArtboard>
        </DCSection>

        <DCSection title="Amber · Night" subtitle="dark surfaces, amber-glow primary, low-light wardrive sessions">
          <DCArtboard label="Pulse · home">
            {renderScreen(PulseScreen, themeA, 'pulse')}
          </DCArtboard>
          <DCArtboard label="Voice · PTT dialogue">
            {renderScreen(VoiceScreen, themeA, 'voice', 'DIALOGUE')}
          </DCArtboard>
          <DCArtboard label="Map · sentinel">
            {renderScreen(MapScreen, themeA, 'map', 'SENTINEL')}
          </DCArtboard>
          <DCArtboard label="Comms · unified inbox">
            {renderScreen(CommsScreen, themeA, 'comms')}
          </DCArtboard>
          <DCArtboard label="Vault · ghost">
            {renderScreen(VaultScreen, themeA, 'vault', 'GHOST')}
          </DCArtboard>
          <DCArtboard label="InCall · overlay">
            {renderScreen(InCallScreen, themeA, 'incall', 'DIALOGUE')}
          </DCArtboard>
        </DCSection>
      </DesignCanvas>
    </div>
  );
}

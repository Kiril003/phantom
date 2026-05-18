// PHANTOM app — design canvas with both themes + tweaks
const { DesignCanvas, DCSection, DCArtboard, TweaksPanel, useTweaks, TweakSection, TweakRadio, TweakSelect, TweakSlider, TweakToggle } = window;
const { PulseScreen, VoiceScreen, MapScreen, CommsScreen, VaultScreen, InCallScreen, PHANTOM_THEMES, PHANTOM_STATES, getStateAccent } = window;

const TWEAK_DEFAULTS = /*EDITMODE-BEGIN*/{
  "themeId": "sunrise",
  "stateKey": "FOCUS",
  "motionMul": 1.0,
  "showFamiliar": true
}/*EDITMODE-END*/;

function App() {
  const [tweaks, setTweak] = useTweaks(TWEAK_DEFAULTS);

  const themeS = PHANTOM_THEMES.sunrise;
  const themeA = PHANTOM_THEMES.amber;

  const themeMap = { sunrise: themeS, amber: themeA };
  const activeTheme = themeMap[tweaks.themeId] || themeS;
  const stateKey = tweaks.stateKey;
  const motionScale = (PHANTOM_STATES[stateKey]?.motionScale || 1) * (tweaks.motionMul || 1);
  const accentS = getStateAccent(stateKey, themeS).accent;
  const accentA = getStateAccent(stateKey, themeA).accent;
  const sentinelS = getStateAccent('SENTINEL', themeS).accent;
  const sentinelA = getStateAccent('SENTINEL', themeA).accent;

  // Per-screen recommended states (when "Auto" — but here we apply the tweak override globally)
  const screenStateFor = (key) => {
    // Each screen has a natural state; if user picks Auto via stateKey === 'AUTO', use natural.
    // Currently stateKey is always picked → use it for non-fixed screens.
    if (stateKey !== 'AUTO') return stateKey;
    return ({pulse:'FOCUS', voice:'DIALOGUE', map:'SENTINEL', comms:'FOCUS', vault:'GHOST', incall:'DIALOGUE'})[key];
  };

  const renderScreen = (Comp, theme, key, fixedState) => {
    const sk = fixedState || screenStateFor(key);
    const acc = getStateAccent(sk, theme).accent;
    const ms = (PHANTOM_STATES[sk]?.motionScale || 1) * (tweaks.motionMul || 1);
    return <Comp theme={theme} accent={acc} stateKey={sk} motionScale={ms} />;
  };

  return (
    <>
      <DesignCanvas>
        <DCSection id="sunrise" title="Sunrise · Warm" subtitle="default theme · light surfaces, amber primary, glass-warm chrome">
          <DCArtboard id="s-pulse" label="Pulse · home" width={360} height={740}>
            {renderScreen(PulseScreen, themeS, 'pulse')}
          </DCArtboard>
          <DCArtboard id="s-voice" label="Voice · PTT dialogue" width={360} height={740}>
            {renderScreen(VoiceScreen, themeS, 'voice', 'DIALOGUE')}
          </DCArtboard>
          <DCArtboard id="s-map" label="Map · sentinel" width={360} height={740}>
            {renderScreen(MapScreen, themeS, 'map', 'SENTINEL')}
          </DCArtboard>
          <DCArtboard id="s-comms" label="Comms · unified inbox" width={360} height={740}>
            {renderScreen(CommsScreen, themeS, 'comms')}
          </DCArtboard>
          <DCArtboard id="s-vault" label="Vault · ghost" width={360} height={740}>
            {renderScreen(VaultScreen, themeS, 'vault', 'GHOST')}
          </DCArtboard>
          <DCArtboard id="s-incall" label="InCall · overlay" width={360} height={740}>
            {renderScreen(InCallScreen, themeS, 'incall', 'DIALOGUE')}
          </DCArtboard>
        </DCSection>

        <DCSection id="amber" title="Amber · Night" subtitle="dark surfaces, amber-glow primary, low-light wardrive sessions">
          <DCArtboard id="a-pulse" label="Pulse · home" width={360} height={740}>
            {renderScreen(PulseScreen, themeA, 'pulse')}
          </DCArtboard>
          <DCArtboard id="a-voice" label="Voice · PTT dialogue" width={360} height={740}>
            {renderScreen(VoiceScreen, themeA, 'voice', 'DIALOGUE')}
          </DCArtboard>
          <DCArtboard id="a-map" label="Map · sentinel" width={360} height={740}>
            {renderScreen(MapScreen, themeA, 'map', 'SENTINEL')}
          </DCArtboard>
          <DCArtboard id="a-comms" label="Comms · unified inbox" width={360} height={740}>
            {renderScreen(CommsScreen, themeA, 'comms')}
          </DCArtboard>
          <DCArtboard id="a-vault" label="Vault · ghost" width={360} height={740}>
            {renderScreen(VaultScreen, themeA, 'vault', 'GHOST')}
          </DCArtboard>
          <DCArtboard id="a-incall" label="InCall · overlay" width={360} height={740}>
            {renderScreen(InCallScreen, themeA, 'incall', 'DIALOGUE')}
          </DCArtboard>
        </DCSection>

        <DCSection id="states" title="State accents · live" subtitle={`Pulse home, sunrise theme, cycling SystemState — drives accent + motion + opacity. Currently: ${stateKey}`}>
          {['SHADOW','FOCUS','DIALOGUE','SENTINEL','GHOST','DREAM'].map(s => (
            <DCArtboard key={s} id={`st-${s}`} label={`${s} · motion ×${PHANTOM_STATES[s].motionScale}`} width={360} height={740}>
              {renderScreen(PulseScreen, themeS, 'pulse', s)}
            </DCArtboard>
          ))}
        </DCSection>
      </DesignCanvas>

      <TweaksPanel title="Tweaks">
        <TweakSection label="Theme">
          <TweakRadio
            label="Variant"
            value={tweaks.themeId}
            onChange={(v) => setTweak('themeId', v)}
            options={[
              { value: 'sunrise', label: 'Sunrise' },
              { value: 'amber',   label: 'Amber Night' },
            ]}
          />
        </TweakSection>
        <TweakSection label="System State">
          <TweakSelect
            label="State accent"
            value={tweaks.stateKey}
            onChange={(v) => setTweak('stateKey', v)}
            options={[
              { value: 'SHADOW',   label: 'SHADOW · low-power' },
              { value: 'FOCUS',    label: 'FOCUS · default' },
              { value: 'DIALOGUE', label: 'DIALOGUE · talking' },
              { value: 'SENTINEL', label: 'SENTINEL · threat' },
              { value: 'GHOST',    label: 'GHOST · private' },
              { value: 'DREAM',    label: 'DREAM · sleep' },
            ]}
          />
          <div style={{ fontFamily: 'var(--mono)', fontSize: 10, color: '#9a8a6f', marginTop: 6, lineHeight: 1.4 }}>
            State only retints the third row (state-accents). The first two rows show each screen's natural state.
          </div>
        </TweakSection>
        <TweakSection label="Motion">
          <TweakSlider
            label="Motion multiplier"
            unit="×"
            value={tweaks.motionMul} min={0.2} max={2.0} step={0.05}
            onChange={(v) => setTweak('motionMul', v)}
          />
        </TweakSection>
      </TweaksPanel>
    </>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(<App />);

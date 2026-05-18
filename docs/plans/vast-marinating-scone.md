# Phase 23-C — ESP32 Actuator Actions for the Agent

## Context

After Phase 23-A (voice.say / voice.listen) and Phase 23-B
(vision.see_screen) the agent has speech and screen-vision but no way
to operate the physical hardware on its own initiative. The ESP32-S3
already exposes servo (pan/tilt), buzzer (PWM tone), and haptic motor
handlers — but Phase 18 only added agent actions for Haptic, RGB and
OLEDText. Servo and buzzer are still operator-only surfaces accessed
through `command_sender` directly. This phase wraps them as agent
actions so the planner can request "look at the operator" or
"alert chime when timer ends" the same way it requests `notify.desktop`
or `vision.see_screen`.

Scope is deliberately tight: **two new agent actions, no firmware
changes**, both built on the existing `command_sender` API. The
originally-scoped third action `motor_pulse` is intentionally dropped
from the plan — the haptic motor (GPIO21) is already exposed via
the existing `ESP32Haptic` action (single / double / long / sos / short
/ triple / pulse patterns). Adding a third action would be redundant.

## Audit findings that shape the design

Confirmed by reading the firmware + backend (no edits performed):

* Firmware `actuator_ctrl.cpp` already handles `{type:"servo", pan, tilt}`
  as **incremental deltas**, clamped to absolute bounds (pan 0–180,
  tilt 30–150). The current pan/tilt is held in firmware state but is
  **not** echoed back over serial — so absolute positioning from the
  Radxa side would require a firmware extension we are NOT making in
  this phase.
* Firmware `actuator_ctrl.cpp` handles `{type:"buzz", freq, ms}` via
  Arduino `tone()` on GPIO47 (single tone, single duration). Patterns
  like siren / morse / chirp do NOT exist in firmware.
* `sensors/command_sender.py` already has fully-typed helpers
  `servo(pan_delta:int, tilt_delta:int)` and
  `buzzer(freq_hz:int=1000, duration_ms:int=200)` — both async, both
  return `bool` (True = wrote to serial, False = device offline /
  serial error). No raises.
* Existing Phase 18 actions (`ESP32Haptic`, `ESP32RGB`, `ESP32OLEDText`
  in `agent/actions/device.py` lines 225–311) all share an identical
  template: SAFE risk, NotImplementedError check via `hasattr`, then
  call helper, then return `SerialDisconnected` if helper returned
  False. This is the template to follow.
* Tests in `tests/test_phase01.py` (and Phase 18 sweeps) mock
  `command_sender.command_sender._writer` with `AsyncMock`. Same
  pattern works for Phase 23-C tests.
* Settings (`config.py`): `serial_enabled`, `sensor_serial_port`,
  `sensor_serial_baud`, `sensor_haptic_intensity_ms`,
  `sensor_buzzer_volume`, `sensor_oled_brightness` already exist — no
  new settings keys needed for Phase 23-C.

## Design

### Action 1: `ESP32ServoAim` → name `esp32.servo_aim`

* **Risk:** SAFE (no permanence, fully reversible by sending the
  inverse delta).
* **Args:**
  * `pan_delta: int` — degrees, range -90..+90, default 0
  * `tilt_delta: int` — degrees, range -60..+60, default 0
  * `hold_ms: int` — optional pause after the move so a follow-up
    capture / OCR sees the new viewpoint settled, range 0..5000,
    default 0
* **Behaviour:**
  1. Validate at least one of pan_delta / tilt_delta is non-zero
     (zero-zero is a no-op → ok=False, reason="no_delta")
  2. Call `command_sender.servo(pan_delta, tilt_delta)`
  3. If False → ok=False, reason="serial_disconnected"
  4. If hold_ms > 0 → `await asyncio.sleep(hold_ms / 1000)`
  5. Return ok=True with output `{pan_delta, tilt_delta, hold_ms}`
     and side_effects `[f"servo: pan{±N}° tilt{±N}°"]`
* **Future-proof note in the docstring:** absolute positioning
  (`pan_abs`, `tilt_abs`) awaits a firmware extension that echoes
  the current pan/tilt over serial — kept out of v1 scope.

### Action 2: `ESP32BuzzerAlert` → name `esp32.buzzer_alert`

* **Risk:** LOW — produces audible output the operator's environment
  may not expect (matches voice.say's reasoning).
* **Args:**
  * `pattern: Literal["chirp", "alert", "siren", "ack"]` — default
    "chirp". Defines a Python-side sequence of (freq, duration,
    pause) tuples sent via `command_sender.buzzer()`.
  * `freq_hz: int` — override base frequency for patterns that use a
    single tone. Range 200..4000, default 1000.
  * `repeat: int` — how many times to play the pattern. Range 1..5,
    default 1.
* **Pattern table (Python-side, no firmware change):**
  * `chirp` — 1×120ms @ freq_hz (default 1000)
  * `ack` — 2×80ms @ freq_hz with 60ms gap (success ding)
  * `alert` — 3×150ms @ freq_hz with 100ms gap (attention)
  * `siren` — sweep 800→1200→800 Hz over 600ms in 3 steps
* **Behaviour:**
  1. Resolve `pattern` to a list of `(freq, ms, pause_ms)` tuples.
  2. For each repeat, for each tuple:
     - call `command_sender.buzzer(freq, ms)`
     - if False → abort, return ok=False, reason="serial_disconnected"
     - `await asyncio.sleep((ms + pause_ms) / 1000)` so each tone
       finishes before the next one is sent (firmware `tone()` is
       non-blocking; we serialize on the Radxa side).
  3. Return ok=True with output `{pattern, repeat, total_ms}` and
     side_effects `[f"buzzer: {pattern} ×{repeat}"]`.

### Registry wiring

Add to `agent/actions/registry.py` after the existing Phase 18 ESP32
imports + the `_REGISTERED` list, in a `# Phase 23-C —` comment block.

### Tests

`tests/test_phase23c_esp32_actions.py` — mirrors the structure of
`test_phase23a_voice_actions.py` and `test_phase23b_vision_actions.py`:

* `servo_aim` happy path: monkeypatch `command_sender.servo` → return
  True, assert ActionResult.ok and the helper was called with the
  right deltas.
* `servo_aim` zero-delta short-circuit → ok=False, reason="no_delta".
* `servo_aim` serial offline → mock returns False → ok=False,
  reason="serial_disconnected".
* `servo_aim` hold_ms actually sleeps (use `monkeypatch.setattr` on
  `asyncio.sleep` to capture the awaited duration without real wait).
* `buzzer_alert` happy path: each pattern sends the expected number
  of `command_sender.buzzer` calls with the expected freq/ms.
* `buzzer_alert` repeat=3 multiplies the call count.
* `buzzer_alert` serial offline → first call returns False → ok=False
  with no further buzzer calls.
* Registry exposes both with correct risk labels (SAFE / LOW).

## Files to create / modify

* CREATE `src/backend/agent/actions/esp32_aim.py` (~140 LOC)
* CREATE `src/backend/tests/test_phase23c_esp32_actions.py` (~220 LOC)
* MODIFY `src/backend/agent/actions/registry.py` (+5 LOC: import +
  Phase 23-C comment + 2 entries in `_REGISTERED`)

No firmware changes. No new settings keys. No new dependencies.

## Verification

1. `cd src/backend && .venv/bin/python -m pytest tests/test_phase23c_esp32_actions.py -v`
   — expect 8 / 8 green, total time < 3 s (no real serial, all mocked).
2. `cd src/backend && .venv/bin/python -m pytest tests/test_phase23a_voice_actions.py tests/test_phase23b_vision_actions.py tests/test_phase23c_esp32_actions.py tests/test_phase09_2_3_time_wait.py -q`
   — expect 32 / 32 green (regression sweep across the Phase 23 + an
   adjacent action test).
3. Visual smoke (manual on the Radxa, post-merge): from `/agent` shell
   run `await runtime.executor.run("esp32.servo_aim", {"pan_delta": 15})`
   — physical servo should pan right; reverse with `pan_delta: -15`.
   `await runtime.executor.run("esp32.buzzer_alert", {"pattern": "ack"})`
   — should emit 2 quick beeps. (Manual step is informational only —
   not blocking for merge.)

## Out of scope (deferred)

* Absolute servo positioning — needs firmware echoing pan/tilt state.
  Track as Phase 23-C-fw if the operator wants it.
* New buzzer patterns at firmware level (true PWM sweeps for siren) —
  Python-side stepped tone is good enough for v1, sounds like a
  proper siren on the speaker.
* Standalone vibration-motor action — already covered by existing
  `ESP32Haptic`. Adding `motor_pulse` would just shadow it. If a
  named "pulse" pattern is missing from `ESP32Haptic`, that's a 1-line
  patch on the existing action, not a new action.

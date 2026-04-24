# Phase 11b.1 — Manual Test Script

Run this after `git checkout autonomous-run` + backend start + `npm run dev`.

Prerequisites:
- Backend on `http://127.0.0.1:8000` (or wherever `VITE_API_BASE` points)
- Frontend dev server running
- Microphone permission granted to the browser tab
- Speakers/headphones for TTS

This script is the **missing gate** from Phase 11b. If every numbered
step produces the expected observation, Phase 11b.1 ships correctly.
Any FAIL → revert the commits listed in README.md and open an issue.

---

## A. Default behaviour — always-on OFF

  1. Open the UI at the frontend URL.
  2. Log in (RFID / PIN / auto).
  3. Navigate to **Settings → Voice** (use the Settings icon in the toolbar).
  4. Scroll to the `voice_always_on_enabled` row.
     **VERIFY:** toggle exists with the label "Always-on голос".
     **VERIFY:** toggle is **OFF** (default).
  5. Close Settings (back / toolbar).
  6. Open the Dialogue overlay (toolbar → Dialogue).
     **VERIFY:** the sphere label reads **"Ready"** (not "Listening", not "Awake").
  7. **VERIFY:** the tap-to-talk mic button on the input pill is clickable
     and not disabled.

## B. Tap-to-talk still works with always-on OFF

  8. Press and hold (or click once, depending on your browser) the mic button.
     **VERIFY:** sphere label flips to **"Listening"**.
     **VERIFY:** the mic icon toggles to MicOff.
  9. Say a short phrase — e.g. "привіт фантом".
 10. Release / click again to stop recording.
     **VERIFY:** a "Transcribing…" banner appears under the chat list.
     **VERIFY:** the transcribed text appears as a user bubble in chat.
     **VERIFY:** PHANTOM replies (assistant bubble).
     **VERIFY:** TTS plays the reply (if `voice_tts_enabled` is on, default).
 11. **VERIFY:** after the exchange, sphere label returns to **"Ready"**.

## C. Turning always-on ON

 12. Settings → Voice → flip `voice_always_on_enabled` toggle **ON**.
 13. Click **Save**.
     **VERIFY:** a "Saved" confirmation appears.
 14. Return to Dialogue.
     **VERIFY:** sphere label is **"Awake"** (hook connected, ready).
 15. Wait ~1 second for the WS to settle.
 16. Say **"фантом"** clearly, then pause briefly.
     **VERIFY:** sphere label flips to **"Armed"** momentarily.
 17. Say **"який час зараз"** within the next few seconds.
     **VERIFY:** a user bubble appears in chat with the transcribed text.
     **VERIFY:** PHANTOM replies.

## D. Continuation window

 18. Within ~10 seconds of the reply, say **"а погода яка"** (no "фантом").
     **VERIFY:** message sent, PHANTOM replies.
 19. Wait ~15 seconds.
 20. Say **"а завтра"** without the wake word.
     **VERIFY:** nothing happens (cooldown expired — intentional).
 21. Say **"фантом завтра"** — wake word re-armed.
     **VERIFY:** message sent, PHANTOM replies.

## E. Self-wake guard (mic ducking during TTS)

 22. Trigger a longer response:
     - Say **"фантом розкажи про Київ"**.
 23. While PHANTOM is speaking, say a phrase with "фантом" in it —
     e.g. **"фантом перебий"**.
     **VERIFY:** no new "Armed" state flashes during TTS playback.
     **VERIFY:** only one user bubble for the current turn (no duplicate).

## F. Tap-to-talk STILL works while always-on is ON

 24. With always-on still ON, press the mic button (tap-to-talk).
     **VERIFY:** sphere flips to **"Listening"** (tap-to-talk wins).
 25. Say something, release.
     **VERIFY:** message is sent, PHANTOM replies.
     **VERIFY:** after the reply, sphere returns to **"Awake"** (always-on
     reclaims idle ownership).

## G. Toggle OFF while always-on was active

 26. Settings → Voice → flip `voice_always_on_enabled` **OFF**. Save.
 27. Return to Dialogue.
     **VERIFY:** sphere returns to **"Ready"**.
     **VERIFY:** saying "фантом" does nothing (as expected).
 28. Tap-to-talk still works (same as step 8–11).

## H. Provider display

 29. Inspect the StatusBar (top of the screen) AT startup.
     **VERIFY:** AI provider badge shows **"gemini"** (or your configured
     primary) immediately — no visible "Ollama" flicker before it changes.
     If your configured primary is "ollama", substitute that name.

---

## Failure modes to watch for

- Sphere stuck in "Listening" when always-on is OFF → **A.6 FAIL**, revert.
- "Awake" shown when always-on is OFF → setting reactivity broken, **C/G FAIL**.
- Tap-to-talk doesn't respond when always-on is OFF → **B.8 FAIL**, investigate
  `useMicStream` or `useVoiceRecorder`.
- Double-submit of the same utterance → input-mode arbitration broken,
  **F.25 FAIL**, investigate `inputModeStore` wiring.
- Self-wake loop during TTS → **E.23 FAIL**, investigate mic ducking.
- Provider flicker at startup → **H.29 FAIL**, verify `main.py` startup
  sync runs before first WS broadcast.

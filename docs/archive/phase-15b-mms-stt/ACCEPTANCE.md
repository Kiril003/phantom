# Phase 15b — Acceptance log

## Automated (CI gate)

```
$ src/backend/.venv/bin/python -m pytest tests/test_phase15_npu_stt.py tests/test_phase15b_mms_npu.py -q
................................................                         [100%]
48 passed in 5.07s
```

48 passing across both phases. New 27 tests cover:
- config schema (lang/compute/threshold validators)
- factory chain ordering (mms first, mms→npu→whisper→vosk)
- bundle resolution + missing-bundle graceful fallback
- CTC greedy decode (collapse repeats, drop blanks, empty/all-blank edge)
- audio framing (pad short, truncate long)
- settings panel surface (UI keys + invalidating cache keys)

## Manual (operator gate — fill on hardware)

| # | Check | Expected | Actual |
|---|-------|----------|--------|
| 1 | Compile script runs | rc=0, .bin 250–300 MB | _____ |
| 2 | AI Hub job URL emitted | https://workbench.aihub.qualcomm.com/jobs/<id>/ | _____ |
| 3 | Backend startup log | `MMSNPU: session up (lang=ukr ... on_npu=True)` | _____ |
| 4 | 3-sec ukr push-to-talk | engine="mms_npu", text correct | _____ |
| 5 | Latency median (5 trials) | ≤ 120 ms | _____ |
| 6 | uvicorn CPU under load | ≤ 15 % | _____ |
| 7 | Bundle missing → fallback | falls to whisper, no 500 | _____ |
| 8 | Coexist with face-tracker | STT +30 ms max, FT ≥ 25 fps | _____ |
| 9 | mms_enabled=false regress | Phase 15 behaviour intact | _____ |

## Smoke commands

```bash
# 1. Compile bundle (one-time per language; ~10–20 min wall)
src/backend/.venv/bin/python scripts/aihub_compile_mms.py --lang ukr --no-profile

# 2. Enable in settings
curl -X PUT http://localhost:8000/settings/voice_stt_mms_enabled \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"value": true}'

# 3. Sanity-check provider
curl http://localhost:8000/voice/status -H "Authorization: Bearer $TOKEN" | jq

# 4. Push-to-talk via UI; bubble appears within ~150 ms of mouseup.
```

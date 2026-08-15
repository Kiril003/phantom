#!/usr/bin/env bash
# PHANTOM OS — Agent Performance Baseline Benchmark
#
# Measures four characteristics of the live backend:
#   1. Cold start:        POST /agent/task → first action.started WS event
#   2. Per-step latency:  p50/p95 of audit.elapsed_ms across the benchmark task
#   3. Memory recall:     p50/p95 of agent.memory.recall.recall() over episodes
#   4. Checkpoint:        save + restore roundtrip time
#
# Emits a Markdown table to stdout and saves to docs/performance-baseline-<YYYY-MM-DD>.md.
#
# Environment overrides:
#   PHANTOM_API    backend base URL (default http://localhost:8000)
#   PHANTOM_USER   login username   (default phantom)
#   PHANTOM_PIN    login PIN        (default 000000)
#   BENCH_GOAL     task goal string used for cold-start + audit sampling
#   BENCH_RUN_S    seconds to let task run before pulling audit (default 8)
#   BENCH_RECALL_N number of recall samples (default 20)
#
# Exits non-zero (with a clear message) when the backend is not reachable.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BASE_URL="${PHANTOM_API:-http://localhost:8000}"
USERNAME="${PHANTOM_USER:-phantom}"
PIN="${PHANTOM_PIN:-000000}"
GOAL="${BENCH_GOAL:-Benchmark warm-up: enumerate capabilities and recall recent episodes.}"
RUN_SECONDS="${BENCH_RUN_S:-8}"
RECALL_N="${BENCH_RECALL_N:-20}"
DATE="$(date +%Y-%m-%d)"
TS_ISO="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
OUT_DIR="${ROOT}/docs"
OUT_FILE="${OUT_DIR}/performance-baseline-${DATE}.md"

# Derive ws:// URL from http(s)://
if [[ "${BASE_URL}" == https://* ]]; then
    BASE_WS="wss://${BASE_URL#https://}"
else
    BASE_WS="ws://${BASE_URL#http://}"
fi

# Prefer the backend's venv python — it has websockets + chromadb.
PYTHON="python3"
if [ -x "${ROOT}/src/backend/.venv/bin/python" ]; then
    PYTHON="${ROOT}/src/backend/.venv/bin/python"
fi

# ── Dependency check ────────────────────────────────────────────────────────
missing=()
command -v curl >/dev/null 2>&1 || missing+=("curl")
command -v jq >/dev/null 2>&1 || missing+=("jq")
[ -x "${PYTHON}" ] || command -v "${PYTHON}" >/dev/null 2>&1 || missing+=("python3")
if [ "${#missing[@]}" -gt 0 ]; then
    echo "ERROR: missing dependencies: ${missing[*]}" >&2
    exit 2
fi

# ── Backend reachability ────────────────────────────────────────────────────
HEALTH_TMP="$(mktemp)"
trap 'rm -f "${HEALTH_TMP}"' EXIT
if ! curl -fsS --max-time 3 "${BASE_URL}/health" -o "${HEALTH_TMP}" 2>/dev/null; then
    cat <<ERR >&2
ERROR: PHANTOM OS backend is not reachable at ${BASE_URL}

No response from ${BASE_URL}/health within 3 seconds. Start the backend first:

    cd ${ROOT}/src/backend && source .venv/bin/activate && \\
      uvicorn main:app --host 127.0.0.1 --port 8000

Or set PHANTOM_API to point at a running instance, e.g.:

    PHANTOM_API=http://radxa.local:8000 $0

Aborting — a benchmark against no backend would just report noise.
ERR
    exit 1
fi

HOST="$(jq -r '.hostname // "unknown"' "${HEALTH_TMP}")"
AI_ACTIVE="$(jq -r '.ai_active // "unknown"' "${HEALTH_TMP}")"
AI_FALLBACK="$(jq -r '.ai_fallback // "unknown"' "${HEALTH_TMP}")"
ESP32="$(jq -r '.esp32_connected // false' "${HEALTH_TMP}")"

echo "── PHANTOM OS benchmark ────────────────────────────────────────────"
echo "   host:       ${HOST}"
echo "   backend:    ${BASE_URL}"
echo "   ai:         ${AI_ACTIVE} (fallback: ${AI_FALLBACK})"
echo "   esp32:      ${ESP32}"
echo "   python:     ${PYTHON}"
echo

# ── Login ───────────────────────────────────────────────────────────────────
echo "→ Login as '${USERNAME}'…"
LOGIN_RESP="$(curl -fsS --max-time 5 -X POST \
    -H 'Content-Type: application/json' \
    -d "$(jq -cn --arg u "$USERNAME" --arg p "$PIN" '{username:$u, pin:$p}')" \
    "${BASE_URL}/api/v1/auth/login/pin" 2>/dev/null)" || {
    echo "ERROR: login failed for user '${USERNAME}' at ${BASE_URL}." >&2
    echo "       Override via PHANTOM_USER / PHANTOM_PIN env vars." >&2
    exit 3
}
TOKEN="$(echo "${LOGIN_RESP}" | jq -r '.token // empty')"
if [ -z "${TOKEN}" ]; then
    echo "ERROR: login response contained no token: ${LOGIN_RESP}" >&2
    exit 3
fi

# ── 1. Cold start + per-step latency sampling task ──────────────────────────
echo "→ Cold-start benchmark (POST /agent/task → first action.started)…"
COLD_JSON="$("${PYTHON}" - "${BASE_URL}" "${BASE_WS}" "${TOKEN}" "${GOAL}" <<'PY'
import asyncio, json, sys, time, urllib.error, urllib.parse, urllib.request

base, ws_base, token, goal = sys.argv[1:5]

try:
    import websockets
except ImportError:
    print(json.dumps({"error": "python 'websockets' module not available; install with: pip install websockets"}))
    sys.exit(0)


def http_post(path: str, body: dict) -> tuple[int, dict]:
    req = urllib.request.Request(
        base + path,
        data=json.dumps(body).encode(),
        headers={
            "Content-Type": "application/json",
            "Authorization": f"Bearer {token}",
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            return resp.status, json.loads(resp.read() or b"{}")
    except urllib.error.HTTPError as e:
        body = e.read().decode(errors="ignore")
        try:
            return e.code, json.loads(body)
        except Exception:
            return e.code, {"raw": body}


async def run() -> dict:
    ws_url = f"{ws_base}/ws?token={urllib.parse.quote(token)}"
    try:
        ws = await asyncio.wait_for(websockets.connect(ws_url, max_size=None), timeout=5)
    except Exception as e:
        return {"error": f"ws connect failed: {e!s}"}

    async def start_task_in_thread() -> tuple[float, float, int, dict]:
        loop = asyncio.get_running_loop()
        def _post():
            t0 = time.perf_counter()
            status, data = http_post("/api/v1/agent/task", {"goal": goal})
            return t0, time.perf_counter(), status, data
        return await loop.run_in_executor(None, _post)

    try:
        # Fire task creation + start listening on WS concurrently.
        post_task = asyncio.create_task(start_task_in_thread())

        t0 = t1 = 0.0
        task_id = None
        started = False
        post_resp = {}
        first_action_time = None

        deadline = time.perf_counter() + 60.0
        while time.perf_counter() < deadline:
            remaining = max(0.05, deadline - time.perf_counter())
            # Either the POST completes, or a WS frame arrives.
            ws_recv = asyncio.create_task(ws.recv())
            done, pending = await asyncio.wait(
                {ws_recv, post_task} if not post_task.done() else {ws_recv},
                timeout=remaining,
                return_when=asyncio.FIRST_COMPLETED,
            )
            if post_task in done and task_id is None:
                t0, t1, status, post_resp = post_task.result()
                task_id = (post_resp or {}).get("task_id")
                started = bool((post_resp or {}).get("started"))
                if not started:
                    for p in pending:
                        p.cancel()
                    return {
                        "error": "task did not start (foreground slot busy)",
                        "http_status": status,
                        "response": post_resp,
                    }

            if ws_recv in done:
                try:
                    raw = ws_recv.result()
                except Exception:
                    raw = None
                if raw:
                    try:
                        m = json.loads(raw)
                    except Exception:
                        m = None
                    if (
                        isinstance(m, dict)
                        and m.get("channel") == "agent.stream"
                        and m.get("type") == "action.started"
                        and task_id is not None
                        and (m.get("data") or {}).get("task_id") == task_id
                    ):
                        first_action_time = time.perf_counter()
                        break
            else:
                # WS recv still pending — cancel to retry next iteration.
                for p in pending:
                    p.cancel()

            if post_task.done() and task_id is None:
                # POST failed before task_id resolved.
                break

        if task_id is None:
            return {"error": "POST /agent/task never returned", "response": post_resp}

        if first_action_time is None:
            return {
                "task_id": task_id,
                "error": "timeout waiting for action.started on agent.stream",
                "post_ms": round((t1 - t0) * 1000.0, 2),
            }

        return {
            "task_id": task_id,
            "post_ms": round((t1 - t0) * 1000.0, 2),
            "to_first_action_ms": round((first_action_time - t0) * 1000.0, 2),
        }
    finally:
        try:
            await ws.close()
        except Exception:
            pass


print(json.dumps(asyncio.run(run())))
PY
)"
echo "   ${COLD_JSON}"

COLD_ERR="$(echo "${COLD_JSON}" | jq -r '.error // empty')"
TASK_ID="$(echo "${COLD_JSON}" | jq -r '.task_id // empty')"
COLD_MS="$(echo "${COLD_JSON}" | jq -r '.to_first_action_ms // "n/a"')"

# ── 2. Let task run and collect audit samples ───────────────────────────────
STEP_COUNT=0
STEP_P50="n/a"
STEP_P95="n/a"
AUDIT_JSON='{"audit":[]}'
if [ -n "${TASK_ID}" ] && [ "${COLD_MS}" != "n/a" ]; then
    echo "→ Sampling audit log for ${RUN_SECONDS}s while task runs…"
    sleep "${RUN_SECONDS}"
    # Pause so we can checkpoint-save without races from the loop.
    curl -fsS --max-time 5 -X POST \
        -H "Authorization: Bearer ${TOKEN}" \
        "${BASE_URL}/api/v1/agent/task/${TASK_ID}/pause" >/dev/null 2>&1 || true

    AUDIT_JSON="$(curl -fsS --max-time 5 \
        -H "Authorization: Bearer ${TOKEN}" \
        "${BASE_URL}/api/v1/agent/audit?task_id=${TASK_ID}&limit=500" 2>/dev/null || echo '{"audit":[]}')"
    STEP_COUNT="$(echo "${AUDIT_JSON}" | jq '.audit | length')"
    if [ "${STEP_COUNT}" -gt 0 ]; then
        STEP_P50="$(echo "${AUDIT_JSON}" | jq '[.audit[].elapsed_ms] | sort_by(.) | .[((length*0.5)|floor)] // 0')"
        STEP_P95="$(echo "${AUDIT_JSON}" | jq '[.audit[].elapsed_ms] | sort_by(.) | .[((length*0.95)|floor)] // 0')"
    fi
    echo "   steps: ${STEP_COUNT}, p50: ${STEP_P50} ms, p95: ${STEP_P95} ms"
else
    echo "   (skipped — no task_id)"
fi

# ── 3. Checkpoint save + restore roundtrip ──────────────────────────────────
CP_JSON='{"save_ms":null,"restore_ms":null,"error":"skipped"}'
CP_SAVE_MS="n/a"
CP_RESTORE_MS="n/a"
CP_TOTAL_MS="n/a"
if [ -n "${TASK_ID}" ] && [ "${COLD_MS}" != "n/a" ]; then
    echo "→ Checkpoint save/restore…"
    CP_JSON="$("${PYTHON}" - "${BASE_URL}" "${TOKEN}" "${TASK_ID}" <<'PY'
import json, sys, time, urllib.error, urllib.request

base, token, task_id = sys.argv[1:4]

def call(path: str, body=None):
    req = urllib.request.Request(
        base + path,
        data=(json.dumps(body).encode() if body is not None else b"{}"),
        headers={
            "Content-Type": "application/json",
            "Authorization": f"Bearer {token}",
        },
        method="POST",
    )
    t0 = time.perf_counter()
    try:
        with urllib.request.urlopen(req, timeout=15) as r:
            out = json.loads(r.read() or b"{}")
        return round((time.perf_counter() - t0) * 1000.0, 3), True, None, out
    except urllib.error.HTTPError as e:
        body = e.read().decode(errors="ignore")
        return round((time.perf_counter() - t0) * 1000.0, 3), False, f"http {e.code}: {body[:200]}", {}
    except Exception as e:
        return round((time.perf_counter() - t0) * 1000.0, 3), False, str(e), {}

# Resume — task was paused during audit sampling; checkpoint_now needs 'active'.
call(f"/api/v1/agent/task/{task_id}/resume")
time.sleep(0.8)

save_ms, save_ok, save_err, save_out = call(f"/api/v1/agent/task/{task_id}/checkpoint")
cp_id = save_out.get("checkpoint_id") if isinstance(save_out, dict) else None

# Free the foreground slot so resume_from_checkpoint can start a fresh run.
call("/api/v1/agent/stop", {"task_id": task_id})
# Wait for the loop task to fully wind down.
for _ in range(30):
    time.sleep(0.2)

restore_ms = None
restore_ok = False
restore_err = "no checkpoint_id" if cp_id is None else None
if cp_id is not None:
    restore_ms, restore_ok, restore_err, _ = call(
        f"/api/v1/agent/task/{task_id}/resume_from_checkpoint",
        {"checkpoint_id": cp_id},
    )

# Final cleanup — stop the restored task so the slot isn't left busy.
call("/api/v1/agent/stop", {"task_id": task_id})

print(json.dumps({
    "save_ms": save_ms if save_ok else None,
    "save_ok": save_ok,
    "save_err": save_err,
    "checkpoint_id": cp_id,
    "restore_ms": restore_ms if restore_ok else None,
    "restore_ok": restore_ok,
    "restore_err": restore_err,
}))
PY
)"
    echo "   ${CP_JSON}"
    CP_SAVE_MS="$(echo "${CP_JSON}" | jq -r '.save_ms // "n/a"')"
    CP_RESTORE_MS="$(echo "${CP_JSON}" | jq -r '.restore_ms // "n/a"')"
    if [ "${CP_SAVE_MS}" != "n/a" ] && [ "${CP_RESTORE_MS}" != "n/a" ]; then
        CP_TOTAL_MS="$(awk -v a="${CP_SAVE_MS}" -v b="${CP_RESTORE_MS}" 'BEGIN{printf "%.2f", a+b}')"
    fi
fi

# ── 4. Memory recall (self.recall) p50/p95 ──────────────────────────────────
echo "→ Memory recall benchmark (${RECALL_N} queries via agent.memory.recall)…"
RECALL_JSON="$("${PYTHON}" - "${ROOT}" "${RECALL_N}" <<'PY'
import asyncio, json, os, statistics, sys, time

root = sys.argv[1]
n_queries = int(sys.argv[2])
backend_dir = os.path.join(root, "src", "backend")

sys.path.insert(0, backend_dir)
os.environ.setdefault("PHANTOM_SERIAL_ENABLED", "false")
try:
    os.chdir(backend_dir)
    from agent.memory.recall import recall           # noqa: E402
    from agent.memory.embedder import count as ep_count  # noqa: E402
except Exception as exc:
    print(json.dumps({"error": f"cannot import recall: {exc!s}"}))
    sys.exit(0)

QUERIES = [
    "file access", "git status", "recent error", "past checkpoint",
    "memory recall", "network request", "vision frame", "voice transcript",
    "system state", "user intervention", "planning step", "audit entry",
    "action started", "goal completed", "subgoal progress", "budget warning",
    "provider fallback", "self recall", "task paused", "task resumed",
    "linux command", "chat message", "wardriving scan", "sensor snapshot",
]
QUERIES = QUERIES[:n_queries] if n_queries <= len(QUERIES) else (QUERIES * ((n_queries // len(QUERIES)) + 1))[:n_queries]

async def run():
    try:
        episode_count = await ep_count()
    except Exception:
        episode_count = 0

    # Warm-up — first call pays ChromaDB + embedder init cost.
    try:
        await asyncio.wait_for(recall("warmup", k=3), timeout=15)
    except Exception as exc:
        return {"error": f"warm-up recall failed: {exc!s}", "episode_count": episode_count}

    samples: list[float] = []
    empty = 0
    for q in QUERIES:
        t0 = time.perf_counter()
        try:
            res = await asyncio.wait_for(recall(q, k=3), timeout=10)
        except Exception as exc:
            return {"error": f"recall '{q}' failed: {exc!s}", "episode_count": episode_count, "samples": samples}
        samples.append(round((time.perf_counter() - t0) * 1000.0, 3))
        if not res:
            empty += 1

    ordered = sorted(samples)
    def pct(p: float) -> float:
        idx = min(len(ordered) - 1, max(0, int(len(ordered) * p)))
        return ordered[idx]

    return {
        "episode_count": episode_count,
        "samples": samples,
        "count": len(samples),
        "empty_results": empty,
        "p50": round(pct(0.50), 3),
        "p95": round(pct(0.95), 3),
        "mean": round(statistics.mean(samples), 3),
        "min": round(min(samples), 3),
        "max": round(max(samples), 3),
    }

print(json.dumps(asyncio.run(run())))
PY
)"
echo "   ${RECALL_JSON}"

RECALL_ERR="$(echo "${RECALL_JSON}" | jq -r '.error // empty')"
if [ -n "${RECALL_ERR}" ]; then
    RECALL_P50="n/a"
    RECALL_P95="n/a"
    RECALL_NOTE="skipped (${RECALL_ERR})"
else
    RECALL_P50="$(echo "${RECALL_JSON}" | jq -r '.p50')"
    RECALL_P95="$(echo "${RECALL_JSON}" | jq -r '.p95')"
    RECALL_N_ACT="$(echo "${RECALL_JSON}" | jq -r '.count')"
    RECALL_EMPTY="$(echo "${RECALL_JSON}" | jq -r '.empty_results')"
    EP_COUNT="$(echo "${RECALL_JSON}" | jq -r '.episode_count')"
    RECALL_NOTE="${RECALL_N_ACT} queries, ${RECALL_EMPTY} returned 0 matches, episode pool = ${EP_COUNT}"
fi

# ── 5. Emit markdown report ─────────────────────────────────────────────────
mkdir -p "${OUT_DIR}"

COLD_COL="${COLD_MS}"
[ "${COLD_COL}" != "n/a" ] && COLD_COL="${COLD_COL} ms"
[ "${COLD_COL}" = "n/a" ] && [ -n "${COLD_ERR}" ] && COLD_COL="n/a (${COLD_ERR})"

STEP_P50_COL="${STEP_P50}"; [ "${STEP_P50_COL}" != "n/a" ] && STEP_P50_COL="${STEP_P50_COL} ms"
STEP_P95_COL="${STEP_P95}"; [ "${STEP_P95_COL}" != "n/a" ] && STEP_P95_COL="${STEP_P95_COL} ms"
RECALL_P50_COL="${RECALL_P50}"; [ "${RECALL_P50_COL}" != "n/a" ] && RECALL_P50_COL="${RECALL_P50_COL} ms"
RECALL_P95_COL="${RECALL_P95}"; [ "${RECALL_P95_COL}" != "n/a" ] && RECALL_P95_COL="${RECALL_P95_COL} ms"
CP_SAVE_COL="${CP_SAVE_MS}"; [ "${CP_SAVE_COL}" != "n/a" ] && CP_SAVE_COL="${CP_SAVE_COL} ms"
CP_RESTORE_COL="${CP_RESTORE_MS}"; [ "${CP_RESTORE_COL}" != "n/a" ] && CP_RESTORE_COL="${CP_RESTORE_COL} ms"
CP_TOTAL_COL="${CP_TOTAL_MS}"; [ "${CP_TOTAL_COL}" != "n/a" ] && CP_TOTAL_COL="${CP_TOTAL_COL} ms"

{
cat <<MD
# PHANTOM OS — Performance Baseline

**Captured:** ${TS_ISO}
**Host:** \`${HOST}\`
**Backend:** \`${BASE_URL}\`
**AI provider (primary → fallback):** \`${AI_ACTIVE}\` → \`${AI_FALLBACK}\`
**ESP32 connected:** ${ESP32}
**Task ID used:** \`${TASK_ID:-n/a}\`
**Goal:** ${GOAL}
**Audit sample window:** ${RUN_SECONDS}s (${STEP_COUNT} steps observed)

| Metric | Value |
|---|---|
| Cold start (POST \`/agent/task\` → first \`action.started\` WS event) | ${COLD_COL} |
| Per-step latency, p50 (audit \`elapsed_ms\`) | ${STEP_P50_COL} |
| Per-step latency, p95 (audit \`elapsed_ms\`) | ${STEP_P95_COL} |
| Memory recall \`self.recall\`, p50 | ${RECALL_P50_COL} |
| Memory recall \`self.recall\`, p95 | ${RECALL_P95_COL} |
| Checkpoint save | ${CP_SAVE_COL} |
| Checkpoint restore | ${CP_RESTORE_COL} |
| Checkpoint roundtrip (save + restore) | ${CP_TOTAL_COL} |

## Notes

- **Cold start** = wall-clock from \`POST /api/v1/agent/task\` request send to the first
  \`agent.stream / action.started\` WebSocket message whose \`data.task_id\` matches.
  Includes planning, prompt-build, and first action dispatch.
- **Per-step latency** = \`elapsed_ms\` field of each audit entry for the benchmark task,
  sorted. Reflects action execution time only (excludes planning).
- **Memory recall** calls \`agent.memory.recall.recall()\` directly from the backend
  venv against the live ChromaDB collection. First call is treated as warm-up.
  Result set size varies with how many episodes already exist.
- **Checkpoint roundtrip** = save measured on the active task; restore measured after
  stopping the foreground slot and calling \`/resume_from_checkpoint\`.
- Recall notes: ${RECALL_NOTE}

## Raw JSON

\`\`\`json
{
  "cold_start": ${COLD_JSON},
  "audit_sample": {"step_count": ${STEP_COUNT}, "p50_ms": $( [ "${STEP_P50}" = "n/a" ] && echo null || echo "${STEP_P50}" ), "p95_ms": $( [ "${STEP_P95}" = "n/a" ] && echo null || echo "${STEP_P95}" )},
  "checkpoint": ${CP_JSON},
  "recall": ${RECALL_JSON},
  "health": $(cat "${HEALTH_TMP}")
}
\`\`\`
MD
} | tee "${OUT_FILE}"

echo
echo "→ Baseline written to ${OUT_FILE}"

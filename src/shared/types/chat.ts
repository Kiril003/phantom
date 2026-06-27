import { SystemState, StateTransition } from './system';
import type { FamiliarPose, FamiliarTarget } from './familiar';

export type ResponseForm =
  | 'text'
  | 'markdown'
  | 'chart'
  | 'diagram'
  | 'map'
  | 'terminal'
  | 'code'
  | 'metric_cards'
  | 'comparison'
  | 'timeline'
  | 'definition'
  | 'stat_highlight'
  | 'artifact'
  | 'mixed';

// ─── Scene primitives — Day-4 Block W-1 (ADR-CS-001 / ADR-CS-002) ─────────────
//
// `<ChatScene>` replaces the per-form switch in `ResponseRenderer.tsx`. Each
// AI reply MAY carry a typed scene envelope describing one of six closed
// presets (text/list/map-pin/plan/code-preview/identity-card) composed of
// typed leaf panels. Day-4 ships ONLY the types + the optional
// `ChatMessage.scene` field; W-2 lands the React composer in Wave 2.
//
// Back-compat invariant per ADR-CS-002 §60: when `scene` is absent the
// MessageBubble MUST render via the existing `<ResponseRenderer>` path
// byte-identical to `e12188f`. Adding a 7th preset requires (a) extend the
// `SceneKind` union here, (b) add panel composition spec in
// `frontend/.../scenes/presets.ts`, (c) update
// `response_formatter.scene_kind_for_form()` mapping, (d) extend pixel-snapshot
// suite. No "stringly typed" backdoors.

/** Closed enum, Day-4 + phase-28-A (chart/diagram) + companion-v2-phase-0 (artifact). New kinds require
 *  ADR amendment. */
export type SceneKind =
  | 'text'
  | 'list'
  | 'map-pin'
  | 'plan'
  | 'code-preview'
  | 'identity-card'
  | 'chart'
  | 'diagram'
  | 'artifact';

export type ArtifactCapability =
  | 'read:context'
  | 'read:sensors'
  | 'read:memory'
  | 'read:state'
  | 'action:tools';

/** Reveal choreography; lives on <ChatScene>, never on individual panels. */
export type RevealPolicy = 'sequential' | 'cascade' | 'instant';

export interface SceneReveal {
  policy: RevealPolicy;
  /** Per-step delay in ms; clamped to [0, 240] at render time. */
  staggerMs: number;
}

/** Each panel is a typed leaf. The data union keeps strict per-kind shape. */
export type ScenePanelKind =
  | 'text'
  | 'list'
  | 'map-pin'
  | 'plan-step'
  | 'code-preview'
  | 'identity-card'
  | 'chart'
  | 'diagram'
  | 'artifact';

export type ScenePanel =
  | { id: string; kind: 'text'; data: { markdown: string } }
  | {
      id: string;
      kind: 'list';
      data: {
        items: Array<{
          label: string;
          value?: string | number;
          trend?: 'up' | 'down' | 'stable';
        }>;
      };
    }
  | {
      id: string;
      kind: 'map-pin';
      data: {
        markers: Array<{
          lat: number;
          lon: number;
          label: string;
          color?: string;
        }>;
        center: [number, number];
        zoom?: number;
      };
    }
  | {
      id: string;
      kind: 'plan-step';
      data: {
        title: string;
        state: 'pending' | 'active' | 'done' | 'error';
        eta_ms?: number;
        note?: string;
      };
    }
  | {
      id: string;
      kind: 'code-preview';
      data: { language: string; code: string; runnable?: boolean };
    }
  | {
      id: string;
      kind: 'identity-card';
      data: {
        user_id: string;
        display_name: string;
        trust: number;
        facts: Array<{
          id: string;
          label: string;
          value: string;
          sensitive?: boolean;
        }>;
      };
    }
  /* phase-28-A — chart panel mirrors ChartResponse data shape so the
     existing Recharts renderer can be wrapped with no schema drift. */
  | {
      id: string;
      kind: 'chart';
      data: {
        chart_type: 'line' | 'bar' | 'area' | 'pie';
        title?: string;
        rows: Array<Record<string, unknown>>;
        x_key?: string;
        y_keys?: string[];
        colors?: string[];
      };
    }
  /* phase-28-A — diagram panel mirrors DiagramResponse data shape so
     the existing d3 force/tree/flow renderer can be wrapped. */
  | {
      id: string;
      kind: 'diagram';
      data: {
        kind?: 'force' | 'tree' | 'flow';
        title?: string;
        nodes: Array<{
          id: string;
          label?: string;
          group?: string | number;
          value?: number;
        }>;
        links: Array<{
          source: string;
          target: string;
          value?: number;
          label?: string;
        }>;
      };
    }
  | {
      id: string;
      kind: 'artifact';
      data: {
        html: string;
        title: string;
        capabilities: ArtifactCapability[];
      };
    };

/**
 * Day-4 W-2 panel composer envelope. Carries an ordered list of typed
 * leaf panels with a reveal policy. Back-compat invariant per
 * ADR-CS-002 §60: legacy persisted rows shaped this way MUST keep
 * rendering through the existing W-2 composer (`ChatScene.tsx`).
 */
export interface ChatSceneComposer {
  kind: SceneKind;
  panels: ScenePanel[];
  reveal?: SceneReveal;
}

// ─── Phase-5 R1 — Tool-result inline scenes (B-17, ADR-TS-001) ────────────────
//
// Rich, single-card scenes returned by tool executions (`tool_executor.py`).
// Each scene is one self-contained card embedded inline in chat — NOT a
// composition of leaf panels (those are the W-2 path above). The two unions
// share the `kind` field as the discriminator; values are pairwise disjoint
// so a single `ChatScene` super-union can carry either shape forward.
//
// Owner: FE-SCENES + BE-TOOLS jointly. Adding a new tool scene requires
// (a) extending the `ChatToolScene` union below, (b) emitting it from
// `tool_executor.py`, (c) a `case` in `ChatScene.tsx`'s router, and
// (d) rendering by a corresponding `*Scene.tsx` component.

/** Closed enum, Phase-5. Adding a kind requires CONTRACTS_R1 amendment. */
export type ToolSceneKind =
  | 'timer'
  | 'alarm'
  | 'calendar'
  | 'files'
  | 'audit'
  | 'wardriving'
  | 'location'
  | 'checkpoint'
  | 'sandbox'
  | 'phantom_manifest'
  | 'orchestration_flow'
  | 'objection'
  | 'patch_file'
  | 'phantom_dom';

// ─── Phantom Familiar ────────────────────────────────────────────────────────
//
// Phase-5 R1-FAMILIAR-1 — when the AI explicitly summons the Familiar inside a
// chat reply, the assistant emits a `phantom_manifest` scene. The chat router
// has a dedicated component (`PhantomManifestScene`) that delegates to the
// global `familiarStore` (the actual creature lives as an App-level overlay).
// `data` is the smallest possible envelope; the store fills in defaults.
//
// Owner: FAMILIAR (this file) + AI tool registry (`backend/ai/scenes.py`).

export interface PhantomManifestSceneData {
  pose: FamiliarPose;
  message?: string;
  durationMs?: number;
  target?: FamiliarTarget;
}

// ─── Timer ────────────────────────────────────────────────────────────────────
export type TimerStatus = 'active' | 'paused' | 'done' | 'cancelled';

export interface TimerSceneData {
  /** ULID assigned by `tools.timer.create`. */
  timer_id: string;
  /** Operator-facing label ("Pasta", "Pomodoro"). */
  label: string;
  /** Total duration, in seconds, of the original schedule. */
  duration_sec: number;
  /** Seconds remaining at snapshot time. May be 0 when status='done'. */
  remaining_sec: number;
  /** Wall-clock ms when the timer was started. */
  started_at_ms: number;
  /** Wall-clock ms when the timer is scheduled to fire. */
  ends_at_ms: number;
  /** Optional preset id ("al-dente-25m", "pomodoro-25m"). */
  preset?: string;
  status: TimerStatus;
  /** Optional NEXUS commentary, rendered Playfair italic. */
  ai_note?: string;
}

// ─── Alarm ────────────────────────────────────────────────────────────────────
export interface AlarmSceneData {
  alarm_id: string;
  /** Wall-clock ms when the alarm next fires. */
  fire_at_ms: number;
  /** ISO weekday acronym ("MON"..."SUN") for the fire date. */
  weekday: 'MON' | 'TUE' | 'WED' | 'THU' | 'FRI' | 'SAT' | 'SUN';
  /** Pre-formatted display strings (locale-aware on BE). */
  display_time: string;            // "07:00"
  display_date: string;            // "18 травня"
  display_weekday_short: string;   // "сб"
  /** Sound preset name ("Sunrise", "Coast"). */
  sound: string;
  /** Optional miniature waveform — heights 0..1, ≤ 16 samples. */
  sound_waveform?: number[];
  /** True if the alarm repeats daily. */
  repeat_daily: boolean;
  /** Sub-second offset until fire, in ms. Snapshot-relative. */
  fires_in_ms: number;
  ai_note?: string;
}

// ─── Calendar ─────────────────────────────────────────────────────────────────
export type CalendarEventCategory = 'work' | 'personal' | 'amber' | 'coral';

export interface CalendarEvent {
  event_id: string;
  /** 0..6 starting Monday — matches design DNA week strip. */
  day_index: 0 | 1 | 2 | 3 | 4 | 5 | 6;
  /** Vertical position 0..100 in the day column (percent). */
  y_pct: number;
  /** Vertical extent 0..100 (percent). */
  h_pct: number;
  category: CalendarEventCategory;
  label: string;
  starts_at_ms: number;
  ends_at_ms: number;
}

export interface CalendarSceneData {
  /** ISO date (YYYY-MM-DD) for the Monday of the displayed week. */
  week_start_iso: string;
  /** ISO date (YYYY-MM-DD) for the cell highlighted as "today". */
  today_iso: string;
  /** Localised weekday abbreviations ("ПН", "ВТ", …) — length 7. */
  weekday_labels: [string, string, string, string, string, string, string];
  /** Display dates ("21".."27"), length 7. */
  date_labels: [string, string, string, string, string, string, string];
  events: CalendarEvent[];
  /** Header summary, e.g. "11 events". */
  total_count: number;
  ai_suggestion?: string;
}

// ─── Files ────────────────────────────────────────────────────────────────────
export type FilesIconKey =
  | 'image'
  | 'movie'
  | 'audiotrack'
  | 'description'
  | 'folder'
  | 'code'
  | 'archive'
  | 'unknown';

export type FilesTone = 'amber' | 'neutral' | 'coral' | 'green';

export interface FilesMatch {
  /** Stable ID — usually content hash. */
  match_id: string;
  /** Display name (basename). */
  name: string;
  /** Material Symbols icon key. */
  icon: FilesIconKey;
  /** Visual tone — used to colour the thumbnail tile. */
  tone: FilesTone;
  /** Human-readable size ("4.2 MB"). */
  size_display: string;
  /** Bytes — for sorting. */
  size_bytes: number;
  /** Display date ("15 Sep"). */
  date_display: string;
  /** Wall-clock ms — file mtime. */
  mtime_ms: number;
  /** Highlight as the "best match" candidate. */
  highlight?: boolean;
  /** Absolute path; FE never displays this raw — privacy. */
  abs_path: string;
}

export interface FilesSceneData {
  /** Search root — display string ("~/Pictures"). */
  root_display: string;
  /** Total matches in the index (may exceed `matches.length`). */
  total_matches: number;
  /** Top-N matches surfaced inline (cap ≤ 9 to fit the 3-column grid). */
  matches: FilesMatch[];
  /** Optional inline filter chip placeholder text. */
  filter_placeholder?: string;
  ai_note?: string;
}

// ─── Audit ────────────────────────────────────────────────────────────────────
export type AuditEventStatus = 'ok' | 'retry' | 'fail';

export interface AuditEvent {
  event_id: string;
  /** Wall-clock display "HH:MM" — already locale-formatted on BE. */
  time_display: string;
  /** Wall-clock ms timestamp — for sorting / re-formatting. */
  ts_ms: number;
  /** Tool id ("web_search", "mail.search", "pptx.write"). */
  tool: string;
  status: AuditEventStatus;
  /** One-line description; for `tool === 'reflect'` rendered Playfair italic. */
  text: string;
  /** Human-readable duration ("1.4s"). */
  duration_display: string;
  duration_ms: number;
}

export interface AuditSceneData {
  /** Audit window display ("LAST 20m"). */
  window_display: string;
  /** Total event count in the window (may exceed events.length). */
  total_actions: number;
  events: AuditEvent[];
  /** Aggregated counts by status — drives the header chips. */
  counts: { ok: number; retry: number; fail: number };
  /** Trace ID for the audit replay viewer (mono short hash). */
  trace_id: string;
}

// ─── Wardriving ───────────────────────────────────────────────────────────────
export interface WardrivingHotspot {
  /** Anchor label ("Дім", "Офіс"). */
  label: string;
  /** Position 0..100 within the heatmap viewport. */
  x_pct: number;
  y_pct: number;
}

export interface WardrivingTopAp {
  /** Truncated BSSID prefix ("a4:f7:db") — full address is sealed. */
  bssid_prefix: string;
  /** Best RSSI seen, dBm (negative). */
  best_rssi: number;
  /** Number of distinct sightings in the window. */
  count: number;
}

export type WardrivingSecurity = 'open' | 'wpa2' | 'wpa3';

export interface WardrivingSceneData {
  /** Window label, e.g. "24H". */
  window_display: string;
  /** Coverage area display, e.g. "~12 km²". */
  area_display: string;
  /**
   * Heatmap cells — row-major. Values 0..1 are mapped to the warm
   * amber→coral gradient. The grid SHOULD be ≤ 8×6 to fit inside the
   * 480-px card. Larger grids are downsampled on BE.
   */
  heatmap: number[][];
  hotspots: WardrivingHotspot[];
  top_aps: WardrivingTopAp[];
  /** Per-security counters surfaced as pills. */
  security_counts: Record<WardrivingSecurity, number>;
  ai_note?: string;
}

// ─── Location ─────────────────────────────────────────────────────────────────
export type LocationStopKind = 'home' | 'work' | 'transit' | 'food' | 'other';

export interface LocationStop {
  stop_id: string;
  /** Position 0..100 within the mini-map viewport. */
  x_pct: number;
  y_pct: number;
  /** Display time "HH:MM". */
  time_display: string;
  /** Wall-clock ms. */
  ts_ms: number;
  /** Operator-friendly name ("Дім", "Офіс"). */
  label: string;
  kind: LocationStopKind;
}

export interface LocationSceneData {
  window_display: string;            // "LAST 24H"
  total_distance_display: string;    // "18.4 km"
  total_distance_m: number;
  stops: LocationStop[];
  /** Walking time display ("2h"). */
  walking_display: string;
  walking_seconds: number;
  /** Number of unrecognised stops — surfaces a privacy nudge when > 0. */
  unknowns: number;
  ai_note?: string;
}

// ─── Checkpoint ───────────────────────────────────────────────────────────────
export interface CheckpointInclusion {
  /** Component name shown in the inclusion list ("ChromaDB", "SQLite users"). */
  name: string;
  /** Whether this component is bundled into the snapshot. */
  included: boolean;
  /** Optional hint, e.g. "private notes (sealed)". */
  reason?: string;
}

export interface CheckpointSceneData {
  /** Operator-facing checkpoint id ("phantom-2026-04-29-1937"). */
  checkpoint_id: string;
  /** ISO8601 wall-clock timestamp. */
  created_at_iso: string;
  /** Bundled size in MB (already rounded). */
  size_mb: number;
  /** One-line stack summary ("ChromaDB + SQLite + state-snapshot"). */
  stack_summary: string;
  /** Components and their inclusion state. */
  inclusions: CheckpointInclusion[];
  /** Number of checkpoints stored locally — drives the housekeeping nudge. */
  total_checkpoints: number;
  /** Number of older checkpoints eligible for cleanup. */
  ripe_for_cleanup: number;
  ai_note?: string;
}

// ─── Sandbox ──────────────────────────────────────────────────────────────────
export type SandboxStepStatus = 'pending' | 'running' | 'done' | 'failed';

export interface SandboxStep {
  step_id: string;
  status: SandboxStepStatus;
  text: string;
  /** Optional step duration once `status='done'|'failed'`. */
  duration_ms?: number;
}

export interface SandboxSceneData {
  /** WS channel id — `sandbox.<session_id>`. */
  session_id: string;
  /** Whether the session has root privileges (drives the red header tint). */
  root: boolean;
  /** True while the underlying process is still emitting. */
  live: boolean;
  /** Plan steps — populated as `plan.step` events arrive. */
  steps: SandboxStep[];
  /** Last N stdout lines, newest last. UI tails to the bottom. */
  recent_stdout: string[];
  /** Last N stderr lines, newest last. */
  recent_stderr: string[];
  /** Process exit code once completed. */
  exit_code?: number;
  /** Total wall-clock ms once completed. */
  duration_ms?: number;
}

// ─── Orchestration Flow ──────────────────────────────────────────────────────
export interface OrchestrationNode {
  id: string;
  label: string;
  agentId: string;
  status: 'completed' | 'running' | 'pending' | 'failed';
  subtasks: Array<{ text: string; done: boolean }>;
}

export interface OrchestrationFlowSceneData {
  rootLabel: string;
  nodes: OrchestrationNode[];
}

// ─── Objection ───────────────────────────────────────────────────────────────
export interface ObjectionSceneData {
  signature: string;
  node: string;
  conflict: string;
  state: string;
  details: string;
}

// ─── Patch File ──────────────────────────────────────────────────────────────
export interface PatchFileSceneData {
  filename: string;
  additions: number;
  deletions: number;
  description: string;
  codePreview?: string;
}

// ─── React Artifact ─────────────────────────────────────────────────────────────
export interface ReactArtifactSceneData {
  code: string;
  dependencies?: Record<string, string>;
  title?: string;
}

// ─── Tool-scene discriminated union ───────────────────────────────────────────
export type ChatToolScene =
  | { kind: 'timer'; data: TimerSceneData }
  | { kind: 'alarm'; data: AlarmSceneData }
  | { kind: 'calendar'; data: CalendarSceneData }
  | { kind: 'files'; data: FilesSceneData }
  | { kind: 'audit'; data: AuditSceneData }
  | { kind: 'wardriving'; data: WardrivingSceneData }
  | { kind: 'location'; data: LocationSceneData }
  | { kind: 'checkpoint'; data: CheckpointSceneData }
  | { kind: 'sandbox'; data: SandboxSceneData }
  | { kind: 'phantom_manifest'; data: PhantomManifestSceneData }
  | { kind: 'orchestration_flow'; data: OrchestrationFlowSceneData }
  | { kind: 'objection'; data: ObjectionSceneData }
  | { kind: 'patch_file'; data: PatchFileSceneData }
  | { kind: 'react_artifact'; data: ReactArtifactSceneData };

/**
 * Phase-5 — `ChatScene` is the super-union of (a) the Day-4 W-2 panel
 * composer envelope and (b) the Phase-5 tool-result scene cards. The two
 * arms are disjoint by `kind`: composer kinds are
 * `text|list|map-pin|plan|code-preview|identity-card`; tool-scene kinds
 * are `timer|alarm|calendar|files|audit|wardriving|location|checkpoint|sandbox`.
 *
 * Back-compat: any persisted `ChatMessage.scene` row from Day-4 has a
 * composer-kind discriminator and renders byte-identical via the W-2
 * `<ChatScene>` composer. New tool calls emit a tool-scene-kind payload
 * which renders via `<ChatScene>` (the chat router under
 * `components/chat/scenes/ChatScene.tsx`) into one of the eight scene
 * cards. There is no runtime overlap.
 */
export type ChatScene = ChatSceneComposer | ChatToolScene;

// ─── V3 progressive artifact render — additive WS event ──────────────────────
//
// Emitted by the backend over the 'chat' WS channel (type
// 'scene.artifact.progress') during ArtifactStudio generation. The panel
// subscribes and reveals progressively; the final committed scene envelope is
// unchanged (back-compat invariant). htmlPreview is absent for the
// 'critiquing' phase (no new html yet).

export type ArtifactPhase = 'draft' | 'critiquing' | 'polishing' | 'done';

export interface ArtifactProgressEvent {
  phase: ArtifactPhase;
  /** Live HTML snapshot; absent during 'critiquing'. */
  htmlPreview?: string;
}

export interface ChatMessage {
  id: string;
  session_id: string;
  user_id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  response_form: ResponseForm;
  metadata: {
    state_at_time: SystemState;
    context_snapshot_id: string;
    ai_provider: 'gemini' | 'ollama';
    latency_ms: number;
    tokens_used: number;
    tone: string;
    input_method: 'voice' | 'text' | 'encoder';
    hormones?: {
      cortisol: number;
      dopamine: number;
      oxytocin: number;
    };
  };
  attachments: ChatAttachment[];
  created_at: string;

  /**
   * Day-4 W-1 — optional scene envelope. When ABSENT (default), MessageBubble
   * renders via the existing `<ResponseRenderer>` path exactly as today. When
   * present, the W-2 (Wave-2) `<ChatScene>` composer takes over. Back-compat
   * invariant: legacy persisted rows have no `scene` and MUST stay
   * pixel-identical to `e12188f`.
   */
  scene?: ChatScene;
}

export interface ChatAttachment {
  type:
    | 'chart_data'
    | 'map_markers'
    | 'terminal_output'
    | 'code_block'
    | 'metric_card'
    | 'comparison_data'
    | 'timeline_data'
    | 'definition_data'
    | 'stat_data'
    | 'artifact_data'
    | 'scene';
  data: Record<string, unknown>;
}

export interface ChatSession {
  id: string;
  user_id: string;
  started_at: string;
  ended_at: string | null;
  message_count: number;
  summary: string | null;
  state_history: StateTransition[];
}

// ─── DynamicPicker — Day-4 Wave-2 W-4 (ADR-XC-007 + chat-liveness §402) ──────
//
// Cross-context contract between `chat-input` (W-3 ModelCard consumer) and
// `dynamic-source-picker` (W-4 producer). Sources are a CLOSED enum at the
// cluster boundary; backend resolvers MUST mirror this exact list at
// `src/backend/api/schemas/dynamic_source.py`. Adding a 6th source requires
// (a) extending this union, (b) the backend resolver, (c) a vitest mock,
// (d) an ADR amendment.

/** Closed enum, Day-4. */
export type DynamicPickerSource =
  | 'ollama_models'
  | 'voice_voices'
  | 'mms_languages'
  | 'serial_ports'
  | 'tts_speakers';

export interface DynamicPickerOption {
  value: string;
  label: string;
  /** Optional metadata; ModelCard uses `provider` for the colour tag. */
  meta?: { provider?: string; size_mb?: number; lang?: string };
}

export interface DynamicPickerProps {
  source: DynamicPickerSource;
  value: string | null;
  onChange: (next: string) => void;
  /** Placeholder while options resolve; touch-friendly 44px row. */
  placeholder?: string;
  /** Force-refresh trigger; bump on operator action like "I just plugged a device". */
  refreshKey?: number;
  /** Disable interactions during async resolution. */
  disabled?: boolean;
}

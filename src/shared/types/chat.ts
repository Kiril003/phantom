import { SystemState, StateTransition } from './system';

export type ResponseForm =
  | 'text'
  | 'markdown'
  | 'chart'
  | 'diagram'
  | 'map'
  | 'terminal'
  | 'code'
  | 'metric_cards'
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

/** Closed enum, Day-4. New kinds require ADR amendment. */
export type SceneKind =
  | 'text'
  | 'list'
  | 'map-pin'
  | 'plan'
  | 'code-preview'
  | 'identity-card';

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
  | 'identity-card';

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
    };

export interface ChatScene {
  kind: SceneKind;
  panels: ScenePanel[];
  reveal?: SceneReveal;
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
    | 'metric_card';
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

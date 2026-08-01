/**
 * Day-4 Wave-2 W-3b — derive a subgroup label for a SettingDefinition
 * (closes audit U1-UX-C1: Settings tab content overflows 1024×600).
 *
 * The settings registry has 80+ keys distributed across ~10 categories.
 * Categories like `voice` and `agent` carry 25+ keys each; rendering
 * them as a flat list forces the user to scroll past unrelated knobs
 * to reach the one they want.
 *
 * This helper derives a *subgroup* label from the canonical
 * `<category>_<subsystem>_<rest>` key convention so the UI can collapse
 * each subsystem into its own accordion. The mapping is deliberately
 * pure (no React, no DOM) so it's testable in isolation and reusable
 * by future Settings views (mobile compact, search filters, etc.).
 *
 * Day-4 ship contract: the mapping is closed-vocabulary. A new key
 * landing under `voice_xyz_*` without an entry here falls into the
 * "General" subgroup and gets a friendly TODO log line. The
 * `_KNOWN_SUBGROUPS` table is the source of truth.
 */

export interface SubgroupBucket {
  /** Stable id used for accordion-state persistence in localStorage. */
  id: string;
  /** Display label (English, sentence case). */
  label: string;
  /** 0-based render order; lower numbers render first. */
  order: number;
}

interface SubgroupRule {
  match: RegExp;
  bucket: SubgroupBucket;
}

const FALLBACK: SubgroupBucket = {
  id: 'general',
  label: 'Загальні',
  order: 999,
};

// Closed vocabulary. To add a subgroup: append the rule, NEVER reorder
// existing entries (id is part of the persistence contract).
const _KNOWN_SUBGROUPS: ReadonlyArray<SubgroupRule> = [
  // ── voice ───────────────────────────────────────────────────────────
  {
    match: /^voice_stt_/,
    bucket: { id: 'voice.stt', label: 'Мова в текст', order: 1 },
  },
  {
    match: /^voice_tts_/,
    bucket: { id: 'voice.tts', label: 'Текст у мову', order: 2 },
  },
  {
    match: /^voice_(always_on|wake_word|vad|barge|duck|amp)/,
    bucket: { id: 'voice.always_on', label: 'Постійне слухання', order: 3 },
  },
  {
    match: /^voice_(mode|response_form|streaming|legacy|pipeline)/,
    bucket: { id: 'voice.pipeline', label: 'Конвеєр і маршрути', order: 4 },
  },

  // ── agent ───────────────────────────────────────────────────────────
  {
    match: /^agent_(max_|bash_timeout|bash_output|unbound_)/,
    bucket: { id: 'agent.limits', label: 'Межі виконання', order: 0 },
  },
  {
    match: /^agent_emotion_/,
    bucket: { id: 'agent.emotion', label: 'Модель емоцій', order: 1 },
  },
  {
    match: /^agent_proactive_/,
    bucket: { id: 'agent.proactive', label: 'Проактивний цикл', order: 2 },
  },
  {
    match: /^agent_standing_orders_/,
    bucket: {
      id: 'agent.standing_orders',
      label: 'Постійні накази',
      order: 3,
    },
  },
  {
    match: /^agent_episodic_/,
    bucket: { id: 'agent.episodic', label: 'Епізодична пам\'ять', order: 4 },
  },
  {
    match: /^agent_mcp_/,
    bucket: { id: 'agent.mcp', label: 'Інтеграції MCP', order: 5 },
  },
  {
    match: /^agent_localization_|^agent_location_history_/,
    bucket: { id: 'agent.localization', label: 'Мова та історія', order: 6 },
  },
  {
    match: /^agent_/,
    bucket: { id: 'agent.core', label: 'Ядро агента', order: 7 },
  },

  // ── ai ──────────────────────────────────────────────────────────────
  {
    match: /^ai_(gemini|google)_/,
    bucket: { id: 'ai.gemini', label: 'Gemini', order: 1 },
  },
  {
    match: /^ai_ollama_/,
    bucket: { id: 'ai.ollama', label: 'Ollama (локально)', order: 2 },
  },
  {
    match: /^ai_(primary_provider|fallback_|router|hub|locality)/,
    bucket: { id: 'ai.routing', label: 'Маршрути й запасний шлях', order: 3 },
  },

  // ── chat ────────────────────────────────────────────────────────────
  {
    match: /^chat_(tools_|response_widgets_|artifacts?_)/,
    bucket: { id: 'chat.tools', label: 'Інструменти в чаті', order: 1 },
  },
  {
    match: /^chat_/,
    bucket: { id: 'chat.core', label: 'Ядро чату', order: 2 },
  },

  // ── security ───────────────────────────────────────────────────────
  {
    match: /^security_(jwt|session|refresh|rate_limit|lockout)/,
    bucket: { id: 'security.auth', label: 'Автентифікація', order: 1 },
  },
  {
    match: /^security_(trust_xff|trusted_proxies|deployment_mode|allow_)/,
    bucket: { id: 'security.network', label: 'Мережа й розгортання', order: 2 },
  },
  {
    match: /^security_/,
    bucket: { id: 'security.core', label: 'Ядро безпеки', order: 3 },
  },
];

/** Pure: returns the SubgroupBucket for a given `(category, key)`. */
export function inferSubgroup(_category: string, key: string): SubgroupBucket {
  for (const { match, bucket } of _KNOWN_SUBGROUPS) {
    if (match.test(key)) {
      return bucket;
    }
  }
  // Categories with no rules (like `system`, `ui`, `about`) collapse
  // everything into a single fallback bucket — the accordion still
  // works, it just has one section.
  return FALLBACK;
}

/**
 * Group an array of SettingDefinitions by subgroup, preserving the
 * within-group key order. Returned buckets are sorted by
 * `subgroup.order` so the UI is stable across re-renders.
 *
 * `categoryId` is currently unused here but threaded through so a
 * future per-category override (e.g. "in `voice`, surface 'always-on'
 * first instead of 'stt'") can land without changing the call signature.
 */
export interface GroupedSettings<T> {
  bucket: SubgroupBucket;
  items: T[];
}

export function groupByInferredSubgroup<
  T extends { key: string; category?: string },
>(_categoryId: string, settings: T[]): GroupedSettings<T>[] {
  const buckets = new Map<string, GroupedSettings<T>>();
  for (const def of settings) {
    const sg = inferSubgroup(_categoryId, def.key);
    const existing = buckets.get(sg.id);
    if (existing) {
      existing.items.push(def);
    } else {
      buckets.set(sg.id, { bucket: sg, items: [def] });
    }
  }
  return Array.from(buckets.values()).sort(
    (a, b) => a.bucket.order - b.bucket.order
  );
}

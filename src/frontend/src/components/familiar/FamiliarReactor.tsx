/**
 * FamiliarReactor — Phase 18-COMPLETE + Phase 21 expansion.
 *
 * Bridges agent state ↔ familiar manifestations. The screen-vision +
 * Council + InfoNeed + report-ready paths all gain a tiny visual punch
 * without touching the agent loop or the existing `useFamiliarTriggers`
 * hook (which handles state-machine + idle + greeting cases).
 *
 * Phase 18-COMPLETE mapping (kept as-is):
 *   currentInfoNeed appears                → pose='pointing' (notice me)
 *   council.consensus_reached              → pose='waving'   (we agreed)
 *   task.report_ready (reportPending set)  → pose='waving'   (presenting)
 *   task.promoted_to_background            → pose='peeking'  (still watching)
 *   high-risk action just executed         → pose='pointing' (caution)
 *
 * Phase 21 additions — agent task health drives Familiar posture:
 *   status: running → done                 → pose='waving'   (triumphant)
 *   status: running → failed/stopped       → pose='peeking'  (concerned)
 *   status: running → awaiting_user        → pose='pointing' (look at this)
 *   status: any → blocked_quota            → pose='pointing' (skeleton mode)
 *   activeSubGoal.id changes               → pose='pointing'
 *                                            target=[data-subgoal-id=...]
 *
 * All summons go through `familiarStore.manifest('ai-summon', …)` which
 * bypasses the rarity gate + cooldown — the operator MUST see the
 * Familiar react to the agent or the feature feels broken (П-2 drama).
 *
 * Pure side-effect component: returns null. Mount once anywhere inside
 * the React tree.
 */
import { useEffect, useRef } from 'react';

import { useAgentStore } from '../../stores/agentStore';
import { useFamiliarStore } from '../../stores/familiarStore';
import type { AgentEmotionVector, FamiliarEmotion } from '@shared/types';

const HIGH_RISK_THRESHOLD = 5; // RiskLevel.MEDIUM and above

function mapEmotionToFamiliar(vector: AgentEmotionVector | null): FamiliarEmotion {
  if (!vector) return 'neutral';
  // Simplified mapping for the wisp character:
  //   fatigue → sleepy
  //   concern → alert (worry)
  //   curiosity → happy (bright)
  //   focus → alert (active)
  if (vector.fatigue > 0.65) return 'sleepy';
  if (vector.concern > 0.5) return 'alert';
  if (vector.curiosity > 0.6) return 'happy';
  if (vector.focus > 0.8) return 'alert';
  return 'neutral';
}

export function FamiliarReactor(): null {
  const reportPending = useAgentStore((s) => s.reportPending);
  const currentInfoNeed = useAgentStore((s) => s.currentInfoNeed);
  const councilDecision = useAgentStore((s) => s.councilDecision);
  const promotedToBackgroundAt = useAgentStore((s) => s.promotedToBackgroundAt);
  const recentActions = useAgentStore((s) => s.recentActions);
  // Phase 21 — task health + active sub-goal awareness.
  const status = useAgentStore((s) => s.status);
  const subGoals = useAgentStore((s) => s.subGoals);
  const emotionVector = useAgentStore((s) => s.emotion);
  const manifest = useFamiliarStore((s) => s.manifest);

  const familiarEmotion = mapEmotionToFamiliar(emotionVector);

  // Track which singletons we've already reacted to so a long-lived
  // reportPending / infoNeed only manifests once per occurrence.
  const seenReportId = useRef<string | null>(null);
  const seenInfoNeedId = useRef<string | null>(null);
  const seenCouncilTimestamp = useRef<string | null>(null);
  const seenPromotedKeys = useRef<Set<string>>(new Set());
  const lastActionAuditId = useRef<number | null>(null);
  // Phase 21 — status edge detection.
  const lastStatusRef = useRef<string | null>(null);
  const lastActiveSubGoalIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (reportPending && reportPending.task_id !== seenReportId.current) {
      seenReportId.current = reportPending.task_id;
      manifest('ai-summon', {
        pose: 'waving',
        emotion: familiarEmotion,
        message: 'Готово.',
        durationMs: 4200,
      });
    }
    if (!reportPending) {
      seenReportId.current = null;
    }
  }, [reportPending, manifest, familiarEmotion]);

  useEffect(() => {
    const id = currentInfoNeed?.id ?? null;
    if (id && id !== seenInfoNeedId.current) {
      seenInfoNeedId.current = id;
      manifest('ai-summon', {
        pose: 'pointing',
        emotion: 'alert',
        message: 'Потрібна підказка',
        durationMs: 3200,
      });
    }
    if (!id) {
      seenInfoNeedId.current = null;
    }
  }, [currentInfoNeed, manifest]);

  useEffect(() => {
    if (!councilDecision) {
      seenCouncilTimestamp.current = null;
      return;
    }
    const stamp = typeof councilDecision.ts === 'string' ? councilDecision.ts : null;
    if (stamp !== null && stamp !== seenCouncilTimestamp.current) {
      seenCouncilTimestamp.current = stamp;
      manifest('ai-summon', {
        pose: 'waving',
        emotion: 'happy',
        message: 'Рада прийшла до згоди',
        durationMs: 3000,
      });
    }
  }, [councilDecision, manifest]);

  useEffect(() => {
    for (const [taskId, at] of Object.entries(promotedToBackgroundAt)) {
      const key = `${taskId}:${at}`;
      if (seenPromotedKeys.current.has(key)) continue;
      seenPromotedKeys.current.add(key);
      manifest('ai-summon', {
        pose: 'peeking',
        emotion: familiarEmotion,
        message: 'Працюю на фоні',
        durationMs: 3500,
      });
    }
  }, [promotedToBackgroundAt, manifest, familiarEmotion]);

  // Phase 21 — task status transitions drive Familiar posture.
  useEffect(() => {
    const prev = lastStatusRef.current;
    lastStatusRef.current = status;
    if (prev === null || prev === status) return;
    // Edge cases worth a manifestation. We deliberately skip transitions
    // INTO 'idle' and OUT of 'idle' to avoid noise on every task start.
    if (status === 'done') {
      manifest('ai-summon', {
        pose: 'waving',
        emotion: 'happy',
        message: 'Готово, як просили.',
        durationMs: 4500
      });
    } else if (status === 'failed' || status === 'stopped') {
      manifest('ai-summon', {
        pose: 'peeking',
        emotion: 'alert',
        message: 'Не дотиснув.',
        durationMs: 3500
      });
    } else if (status === 'awaiting_user') {
      manifest('ai-summon', {
        pose: 'pointing',
        emotion: 'alert',
        message: 'Потрібен ти.',
        durationMs: 3500
      });
    } else if (status === 'blocked_quota' && prev !== 'blocked_quota') {
      manifest('ai-summon', {
        pose: 'pointing',
        emotion: 'sleepy',
        message: 'Працюю на скелеті — без хмари.',
        durationMs: 4000,
      });
    }
  }, [status, manifest]);

  // Phase 21 — when the active sub-goal changes, briefly point at it.
  useEffect(() => {
    const active = subGoals.find((sg) => sg.status === 'active');
    const id = active?.id ?? null;
    if (!id || id === lastActiveSubGoalIdRef.current) {
      if (!id) lastActiveSubGoalIdRef.current = null;
      return;
    }
    lastActiveSubGoalIdRef.current = id;
    // Use the data-subgoal-id selector that PlanTree exposes so the
    // Familiar's tendril resolves to the right capsule on screen.
    manifest('ai-summon', {
      pose: 'pointing',
      emotion: familiarEmotion,
      message: active?.description ?? undefined,
      durationMs: 2800,
      target: { selector: `[data-subgoal-id="${id}"]` },
    });
  }, [subGoals, manifest, familiarEmotion]);

  useEffect(() => {
    if (recentActions.length === 0) {
      lastActionAuditId.current = null;
      return;
    }
    const last = recentActions[recentActions.length - 1];
    const auditId = last?.audit_entry_id ?? null;
    const risk = (last as { risk_level?: number } | undefined)?.risk_level ?? 0;
    if (
      auditId !== null &&
      auditId !== lastActionAuditId.current &&
      risk >= HIGH_RISK_THRESHOLD &&
      last?.result?.ok !== false
    ) {
      lastActionAuditId.current = auditId;
      manifest('ai-summon', {
        pose: 'pointing',
        emotion: 'alert',
        message: 'Ризикована дія',
        durationMs: 2400,
      });
    } else if (auditId !== null) {
      lastActionAuditId.current = auditId;
    }
  }, [recentActions, manifest]);

  return null;
}

export default FamiliarReactor;

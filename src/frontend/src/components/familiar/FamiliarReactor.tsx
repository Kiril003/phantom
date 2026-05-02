/**
 * Phase 18-COMPLETE — FamiliarReactor.
 *
 * Bridges agent state ↔ familiar manifestations. The screen-vision +
 * Council + InfoNeed + report-ready paths all gain a tiny visual punch
 * without touching the agent loop or the existing `useFamiliarTriggers`
 * hook (which handles state-machine + idle + greeting cases).
 *
 * Mapping:
 *   currentInfoNeed appears                → pose='pointing' (notice me)
 *   council.consensus_reached              → pose='waving'   (we agreed)
 *   task.report_ready (reportPending set)  → pose='waving'   (presenting)
 *   task.promoted_to_background           → pose='peeking'  (still watching)
 *   high-risk action just executed         → pose='pointing' (caution)
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

const HIGH_RISK_THRESHOLD = 5; // RiskLevel.MEDIUM and above

export function FamiliarReactor(): null {
  const reportPending = useAgentStore((s) => s.reportPending);
  const currentInfoNeed = useAgentStore((s) => s.currentInfoNeed);
  const councilDecision = useAgentStore((s) => s.councilDecision);
  const promotedToBackgroundAt = useAgentStore((s) => s.promotedToBackgroundAt);
  const recentActions = useAgentStore((s) => s.recentActions);
  const manifest = useFamiliarStore((s) => s.manifest);

  // Track which singletons we've already reacted to so a long-lived
  // reportPending / infoNeed only manifests once per occurrence.
  const seenReportId = useRef<string | null>(null);
  const seenInfoNeedId = useRef<string | null>(null);
  const seenCouncilTimestamp = useRef<string | null>(null);
  const seenPromotedKeys = useRef<Set<string>>(new Set());
  const lastActionAuditId = useRef<number | null>(null);

  useEffect(() => {
    if (reportPending && reportPending.task_id !== seenReportId.current) {
      seenReportId.current = reportPending.task_id;
      manifest('ai-summon', {
        pose: 'waving',
        message: 'Готово.',
        durationMs: 4200,
      });
    }
    if (!reportPending) {
      seenReportId.current = null;
    }
  }, [reportPending, manifest]);

  useEffect(() => {
    const id = currentInfoNeed?.id ?? null;
    if (id && id !== seenInfoNeedId.current) {
      seenInfoNeedId.current = id;
      manifest('ai-summon', {
        pose: 'pointing',
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
        message: 'Працюю на фоні',
        durationMs: 3500,
      });
    }
  }, [promotedToBackgroundAt, manifest]);

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

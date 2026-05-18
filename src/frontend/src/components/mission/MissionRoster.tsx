/**
 * MissionRoster — collapsible sidebar listing the operator's missions.
 * Each row shows status, brief preview, phase progress, and age.
 * Clicking a row opens MissionDetailScreen for that mission.
 */
import { useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useMissionStore } from '../../stores/missionStore';
import type { MissionSummary, MissionStatus } from '@shared/types/mission';

interface Props {
  collapsed: boolean;
  onToggle: () => void;
  onSelectMission: (id: string) => void;
}

const STATUS_META: Record<
  MissionStatus,
  { label: string; color: string; bg: string }
> = {
  planning: { label: 'PLANNING', color: '#5B8FCC', bg: 'rgba(91,143,204,0.16)' },
  running: { label: 'RUNNING', color: '#A36F1F', bg: 'rgba(244,175,37,0.18)' },
  paused: { label: 'PAUSED', color: '#5B8FCC', bg: 'rgba(91,143,204,0.14)' },
  awaiting_user: { label: 'WAITING', color: '#A36F1F', bg: 'rgba(244,175,37,0.18)' },
  blocked_quota: { label: 'QUOTA', color: '#8A6B3F', bg: 'rgba(180,140,80,0.16)' },
  done: { label: 'DONE', color: '#0E6A2A', bg: 'rgba(34,197,94,0.16)' },
  failed: { label: 'FAILED', color: '#B9201F', bg: 'rgba(185,32,31,0.14)' },
  stopped: { label: 'STOPPED', color: '#8A6B3F', bg: 'rgba(180,140,80,0.14)' },
  abandoned: { label: 'ABANDONED', color: '#6B5C42', bg: 'rgba(120,90,50,0.14)' },
};

function timeSince(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const s = Math.floor(diff / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

function MissionRow({
  mission,
  onClick,
}: {
  mission: MissionSummary;
  onClick: () => void;
}) {
  const meta = STATUS_META[mission.status] ?? STATUS_META.planning;
  const briefPreview = mission.brief.slice(0, 90) + (mission.brief.length > 90 ? '…' : '');

  return (
    <button
      type="button"
      onClick={onClick}
      data-testid={`mission-row-${mission.id}`}
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 4,
        padding: '8px 10px',
        borderRadius: 10,
        background: 'rgba(255,255,255,0.45)',
        border: '1px solid rgba(180,150,90,0.16)',
        cursor: 'pointer',
        width: '100%',
        textAlign: 'left',
        transition: 'background 0.15s',
        minHeight: 44,
      }}
    >
      {/* Top row: status badge + time */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6 }}>
        <span
          data-testid={`mission-status-badge-${mission.id}`}
          style={{
            display: 'inline-block',
            padding: '2px 7px',
            borderRadius: 999,
            background: meta.bg,
            color: meta.color,
            fontSize: 9,
            letterSpacing: '0.08em',
            fontWeight: 700,
            fontFamily: 'JetBrains Mono, monospace',
          }}
        >
          {meta.label}
        </span>
        <span
          style={{ fontSize: 10, color: 'var(--ink-muted)', fontFamily: 'JetBrains Mono, monospace' }}
        >
          {timeSince(mission.created_at)}
        </span>
      </div>

      {/* Brief preview */}
      <span
        style={{
          fontSize: 11,
          color: 'var(--ink-strong, #1F1A11)',
          lineHeight: 1.35,
          wordBreak: 'break-word',
        }}
      >
        {briefPreview}
      </span>

      {/* Phase counter */}
      <span
        style={{ fontSize: 10, color: 'var(--ink-muted)', fontFamily: 'JetBrains Mono, monospace' }}
      >
        {mission.phases_done}/{mission.phase_count} phases
      </span>
    </button>
  );
}

export function MissionRoster({ collapsed, onToggle, onSelectMission }: Props) {
  const missions = useMissionStore((s) => s.missions);
  const loading = useMissionStore((s) => s.loading.list);
  const loadMissions = useMissionStore((s) => s.loadMissions);

  useEffect(() => {
    loadMissions();
  }, [loadMissions]);

  if (collapsed) {
    return (
      <button
        type="button"
        onClick={onToggle}
        aria-label="Expand mission roster"
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: 24,
          height: '100%',
          background: 'rgba(255,255,255,0.55)',
          border: '1px solid rgba(180,150,90,0.18)',
          borderRadius: '0 10px 10px 0',
          cursor: 'pointer',
          color: 'var(--ink-muted)',
        }}
      >
        <ChevronRight size={14} />
      </button>
    );
  }

  return (
    <AnimatePresence>
      <motion.div
        initial={{ width: 0, opacity: 0 }}
        animate={{ width: 220, opacity: 1 }}
        exit={{ width: 0, opacity: 0 }}
        transition={{ duration: 0.2 }}
        style={{
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          background: 'rgba(255,255,255,0.70)',
          borderRight: '1px solid rgba(180,150,90,0.18)',
          overflow: 'hidden',
          flexShrink: 0,
        }}
      >
        {/* Header */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '10px 12px 8px 12px',
            borderBottom: '1px solid rgba(180,150,90,0.16)',
          }}
        >
          <span
            style={{
              fontSize: 11,
              fontWeight: 700,
              letterSpacing: '0.10em',
              textTransform: 'uppercase',
              color: 'var(--ink-muted)',
            }}
          >
            Missions
          </span>
          <button
            type="button"
            onClick={onToggle}
            aria-label="Collapse mission roster"
            style={{
              minWidth: 44,
              minHeight: 44,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              color: 'var(--ink-muted)',
              borderRadius: 8,
              padding: 0,
            }}
          >
            <ChevronLeft size={14} />
          </button>
        </div>

        {/* List */}
        <div
          style={{
            flex: 1,
            overflowY: 'auto',
            padding: '8px',
            display: 'flex',
            flexDirection: 'column',
            gap: 6,
          }}
        >
          {loading && missions.length === 0 && (
            <span style={{ fontSize: 11, color: 'var(--ink-muted)', padding: '8px 4px' }}>
              Loading…
            </span>
          )}

          {!loading && missions.length === 0 && (
            <div
              style={{
                padding: '12px 4px',
                fontSize: 11,
                color: 'var(--ink-muted)',
                lineHeight: 1.5,
              }}
              data-testid="mission-roster-empty"
            >
              PHANTOM has not run any missions yet. Use the [Mission] toggle in the HUD to start one.
            </div>
          )}

          {missions.map((m) => (
            <MissionRow
              key={m.id}
              mission={m}
              onClick={() => onSelectMission(m.id)}
            />
          ))}
        </div>
      </motion.div>
    </AnimatePresence>
  );
}

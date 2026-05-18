/**
 * MissionMounts — single wrapper that hooks the mission UI overlays into
 * `useUIStore` flags so OperatorLayout stays a thin compositor. Adapter
 * between the sealed mission components (which expect callbacks, not
 * `open` props) and the store-driven gate pattern OperatorLayout uses
 * for AgentVault / ParallelChatDrawer / etc.
 */
import { useState } from 'react';
import { useUIStore } from '../../stores/uiStore';
import { useMissionStore } from '../../stores/missionStore';
import { MissionBriefDialog } from './MissionBriefDialog';
import { MissionDetailScreen } from './MissionDetailScreen';
import { MissionReportScreen } from './MissionReportScreen';
import { MissionRoster } from './MissionRoster';
import type { ExportMissionRequest } from '../../services/missionApi';

export function MissionMounts() {
  const briefOpen = useUIStore((s) => s.missionBriefOpen);
  const setBriefOpen = useUIStore((s) => s.setMissionBriefOpen);
  const detailOpen = useUIStore((s) => s.missionDetailOpen);
  const setDetailOpen = useUIStore((s) => s.setMissionDetailOpen);
  const detailId = useUIStore((s) => s.missionDetailId);
  const setDetailId = useUIStore((s) => s.setMissionDetailId);
  const reportOpen = useUIStore((s) => s.missionReportOpen);
  const setReportOpen = useUIStore((s) => s.setMissionReportOpen);
  const rosterOpen = useUIStore((s) => s.missionRosterOpen);
  const setRosterOpen = useUIStore((s) => s.setMissionRosterOpen);
  const toast = useUIStore((s) => s.toast);

  const currentReport = useMissionStore((s) => s.currentReport);
  const exportMission = useMissionStore((s) => s.exportMission);
  const [exportBusy, setExportBusy] = useState(false);

  const handleExport = async (format: ExportMissionRequest['format']) => {
    if (!detailId) return;
    setExportBusy(true);
    try {
      const res = await exportMission(detailId, { format });
      toast({ kind: 'success', message: `Exported ${format} → ${res.path}` });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Export failed';
      toast({ kind: 'error', message: msg });
    } finally {
      setExportBusy(false);
    }
  };

  return (
    <>
      {briefOpen && (
        <MissionBriefDialog
          onClose={() => setBriefOpen(false)}
          onSuccess={(missionId) => {
            setBriefOpen(false);
            setDetailId(missionId);
            setDetailOpen(true);
          }}
        />
      )}
      {detailOpen && detailId && (
        <MissionDetailScreen
          missionId={detailId}
          onClose={() => setDetailOpen(false)}
        />
      )}
      {reportOpen && currentReport && (
        <MissionReportScreen
          report={currentReport}
          onClose={() => setReportOpen(false)}
          onExport={handleExport}
          exportBusy={exportBusy}
        />
      )}
      {rosterOpen && (
        <MissionRoster
          collapsed={false}
          onToggle={() => setRosterOpen(false)}
          onSelectMission={(id) => {
            setDetailId(id);
            setDetailOpen(true);
            setRosterOpen(false);
          }}
        />
      )}
    </>
  );
}

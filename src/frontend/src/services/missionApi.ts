import { request as req } from './api';
import type {
  MissionBrief,
  MissionSummary,
  MissionDetail,
  MissionReport,
} from '@shared/types/mission';

export interface StartMissionResponse {
  mission_id: string;
  task_id: string;
  started: boolean;
  detail?: string;
}

export interface ExportMissionRequest {
  format: 'pdf' | 'dashboard' | 'ledger_md';
  style?: 'minimal' | 'branded';
  inline_assets?: boolean;
}

export interface ExportMissionResponse {
  path: string;
  format: string;
  bytes: number;
}

export interface MissionAssetView {
  name: string;
  size: number;
  kind: string;
  captured_at: string;
}

export const missionApi = {
  start: (brief: MissionBrief) =>
    req<StartMissionResponse>('POST', '/agent/mission', brief),

  list: (status?: string, limit = 50) => {
    const qs = new URLSearchParams();
    if (status) qs.set('status', status);
    qs.set('limit', String(limit));
    return req<{ missions: MissionSummary[] }>('GET', `/agent/missions?${qs.toString()}`);
  },

  detail: (id: string) =>
    req<MissionDetail>('GET', `/agent/mission/${id}`),

  compose: (id: string, preferLLM = true) =>
    req<MissionReport>('POST', `/agent/mission/${id}/report`, { prefer_llm: preferLLM }),

  export: (id: string, body: ExportMissionRequest) =>
    req<ExportMissionResponse>('POST', `/agent/mission/${id}/export`, body),

  assets: (id: string) =>
    req<{ assets: MissionAssetView[] }>('GET', `/agent/mission/${id}/assets`),
};

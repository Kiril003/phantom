import { request as req } from './api';
import type {
  PolisSnapshot,
  PolisMission,
  ManagedKeyPublic,
  PolisChatMessage,
  PolisArtifactMeta,
  PolisWorker,
} from '@shared/types';

export const polisApi = {
  state: () => req<PolisSnapshot>('GET', '/polis/state'),

  pipelines: () =>
    req<{ pipelines: { id: string; domain: string }[] }>('GET', '/polis/pipelines'),

  createMission: (brief: string, pipeline: string, title?: string) =>
    req<{ mission: PolisMission }>('POST', '/polis/missions', {
      brief,
      pipeline,
      title,
    }),

  mission: (id: string) =>
    req<{ mission: PolisMission; chat: PolisChatMessage[] }>(
      'GET',
      `/polis/missions/${id}`,
    ),

  chat: (id: string, text: string) =>
    req<{ reply: PolisChatMessage }>('POST', `/polis/missions/${id}/chat`, { text }),

  artifacts: (id: string) =>
    req<{ artifacts: PolisArtifactMeta[] }>('GET', `/polis/missions/${id}/artifacts`),

  artifact: (id: string, name: string) =>
    req<{ name: string; content: string }>(
      'GET',
      `/polis/missions/${id}/artifacts/${encodeURIComponent(name)}`,
    ),

  workers: (id: string) =>
    req<{ workers: PolisWorker[] }>('GET', `/polis/missions/${id}/workers`),

  workerTranscript: (id: string, nodeId: string) =>
    req<{ node_id: string; transcript: string }>(
      'GET',
      `/polis/missions/${id}/workers/${nodeId}`,
    ),

  pause: (id: string) => req<{ ok: boolean }>('POST', `/polis/missions/${id}/pause`),
  resume: (id: string) => req<{ ok: boolean }>('POST', `/polis/missions/${id}/resume`),
  kill: (id: string) => req<{ ok: boolean }>('POST', `/polis/missions/${id}/kill`),

  resolveGate: (gateId: string, approved: boolean) =>
    req<{ ok: boolean }>('POST', `/polis/gates/${gateId}`, { approved }),

  keys: () => req<{ keys: ManagedKeyPublic[] }>('GET', '/polis/keys'),

  addKey: (provider: string, label: string, secret: string, priority = 100) =>
    req<{ id: string }>('POST', '/polis/keys', { provider, label, secret, priority }),

  setKeyState: (id: string, state: 'active' | 'disabled') =>
    req<{ ok: boolean }>('PATCH', `/polis/keys/${id}`, { state }),

  deleteKey: (id: string) => req<{ ok: boolean }>('DELETE', `/polis/keys/${id}`),
};

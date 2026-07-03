import { request as req } from './api';
import type { PolisSnapshot, PolisMission, ManagedKeyPublic } from '@shared/types';

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
    req<{ mission: PolisMission }>('GET', `/polis/missions/${id}`),

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

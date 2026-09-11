import { request } from './api';
import type {
  BakeCapability,
  BakeScopesResponse,
  BakeSnapshot,
} from '@shared/types';

/**
 * Піч дорожніх пакетів. Тонкий шар: жодних обчислень, жодних дефолтів —
 * усе, що показує скло, приходить звідси таким, як його сказав бекенд.
 *
 * `/jobs/current` і `/jobs/last` за домовленістю (bake-architect, 05.09)
 * завжди 200 з обгорткою `{ job: … | null }`. Розбирач нижче терпить іще
 * два види відповіді — 204 без тіла й голий знімок, — бо два незалежні
 * читачі цього контракту вже розійшлись у тому, що таке «нема роботи»,
 * і мовчазний `undefined.stage` коштував би дорожче за шість рядків.
 */

export interface StartBakeRequest {
  scope_id: string;
  /** true → перезавантажити витяг OSM, навіть якщо він уже на диску. */
  refresh_source?: boolean;
}

/** Відмова 412: бекенд каже, ЧОМУ не можна, українською. */
export interface BakePreconditionFailed {
  reason: string;
  detail_ua: string;
  blockers: string[];
}

type JobEnvelope = { job: BakeSnapshot | null } | BakeSnapshot | undefined | null;

function unwrapJob(raw: JobEnvelope): BakeSnapshot | null {
  if (!raw) return null;
  if ('job' in raw) return (raw as { job: BakeSnapshot | null }).job ?? null;
  return (raw as BakeSnapshot).job_id ? (raw as BakeSnapshot) : null;
}

export const bakeApi = {
  /** Що ця машина взагалі береться пекти — і чим саме зайнятий диск. */
  scopes: () => request<BakeScopesResponse>('GET', '/bake/scopes'),

  /** Стеля машини. Запасний шлях, коли `/bake/scopes` іще не приїхав. */
  capability: () => request<BakeCapability>('GET', '/bake/capability'),

  start: async (body: StartBakeRequest): Promise<BakeSnapshot | null> =>
    unwrapJob(await request<JobEnvelope>('POST', '/bake/jobs', body)),

  current: async (): Promise<BakeSnapshot | null> =>
    unwrapJob(await request<JobEnvelope>('GET', '/bake/jobs/current')),

  last: async (): Promise<BakeSnapshot | null> =>
    unwrapJob(await request<JobEnvelope>('GET', '/bake/jobs/last')),

  /**
   * Зупинити — БЕЗ `keep_download`, і це навмисно.
   *
   * На бекенді параметр `Optional[bool] = None`, і саме `None` змушує службу
   * спитати налаштування власника `bake_keep_source_extracts`. Слати звідси
   * сталу `true` означало б зробити ту гілку недосяжною: тумблер у
   * Налаштування › Мапа стояв би живий на вигляд і не впливав ні на що —
   * рівно той клас дефекту, що це дерево видаляє. Явне значення тут мала б
   * ставити лише людина, якій ми дали окремий вибір; такого вибору в UI
   * немає, тож не вигадуємо його за неї. Що саме сталося з витягом, скаже
   * `outcome.detail_ua`.
   */
  cancel: async (): Promise<BakeSnapshot | null> =>
    unwrapJob(await request<JobEnvelope>('DELETE', '/bake/jobs/current')),
};

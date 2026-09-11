/**
 * Випікання дорожнього пакета — контракт зі знімком стану.
 *
 * Головне закодовано типами, не коментарями: **у випіканні немає
 * знаменника**. `download.bytes_total` буває `null` (сервер не дав
 * Content-Length), а в `bake` полів `*_total` немає ЗОВСІМ і не буде: скільки
 * доріг у файлі, невідомо, доки файл не прочитано. Тому смуга й відсоток
 * структурно можливі лише там, де є `bytes_total`. Знімок ПОВНИЙ щоразу:
 * заміняй стан, не зливай.
 */
export type BakeStage =
  | 'preflight' | 'downloading' | 'verifying' | 'indexing' | 'baking'
  | 'finalizing' | 'done' | 'failed' | 'cancelled';

export type BakeOutcomeKind = 'done' | 'failed' | 'cancelled';

export type BakeOutcomeReason =
  | 'low_memory' | 'low_disk' | 'network' | 'checksum' | 'worker_crashed'
  | 'worker_error' | 'corrupt' | 'osmium_missing' | 'offline'
  | 'unknown_scope' | 'shutdown' | 'user'
  // Несподіваний виняток на боці батька. Окреме слово, бо записати його як
  // `worker_error` означало б послати наступного читача логів у інший процес.
  | 'unknown';

/** Єдина стадія зі знаменником: `bytes_total` — це HTTP Content-Length. */
export interface BakeDownload {
  bytes_done: number;
  bytes_total: number | null;
  resumed_from_bytes: number;
  rate_bps: number | null;
  source_last_modified: string | null;
  from_cache: boolean;
}

export interface BakeVerify { bytes_hashed: number; bytes_total: number }

/** Лічильники печі. Знаменника тут немає й не додавати.
 *
 * Нулі тут заборонені як заповнювач. `null` означає «ми НЕ РАХУВАЛИ», і це
 * інше твердження, ніж «їх не було»: на обсязі-країні індекс вузлів будується
 * всередині C++, і жодного вузла піч не бачить — намалювати там «0 вузлів»
 * означало б повідомити факт, якого ніхто не встановлював. Тому рядок
 * лічильника малюється ЛИШЕ коли значення не null.
 */
export interface BakeCounters {
  nodes_seen: number | null;
  nodes_kept: number | null;
  ways_seen: number;
  ways_kept: number;
  rows_written: number;
  cells: number;
  elapsed_s: number;
  ram_available_pct: number | null;
  input_bytes: number | null;
  /** Розмір напівготового файла — єдиний живий сигнал між скиданнями партій. */
  output_bytes: number | null;
  /** Те саме для індексу вузлів: на країні це ЄДИНЕ, що рухається. */
  index_bytes: number | null;
}

/** Пороги сторожа памʼяті — приходять зі знімка, НІКОЛИ не літерали на склі.
 *
 * Якщо вписати 30 і 3 у компонент, то зміна порога в `bake.sh`/налаштуваннях
 * зробить скло брехуном мовчки. Тест на рівні джерела забороняє ці числа.
 */
export interface BakeGuard {
  floor_pct: number;
  strikes_to_trip: number;
  poll_s: number;
}

/** `detail_ua` — готове українське речення бекенда. Малювати дослівно.
 *
 * `reason` дорівнює null РІВНО тоді, коли `kind === 'done'`: відсутність слова
 * про причину і є твердженням «нічого не сталося». Це не недогляд — поставити
 * там `'user'` означало б записати випікання пакета на рахунок оператора.
 * Наслідок для скла: будь-яка мапа причина→копія мусить мати гілку null,
 * інакше вона намалює `undefined` саме тоді, коли в людини все вийшло.
 */
export interface BakeOutcome {
  kind: BakeOutcomeKind;
  reason: BakeOutcomeReason | null;
  detail_ua: string;
}

export interface BakePack {
  pack_id: string;
  bytes: number;
  /** ЧИСЛО, не рядок: бекенд читає його назад через `PRAGMA user_version`
   *  ПІСЛЯ фіналізації, тобто це виміряна властивість готового файла, а не
   *  константа збірки. Було типізовано як `string`, і через це будь-яке
   *  порівняння `=== 2` на склі було хибним на КОЖНОМУ вдалому випіканні. */
  format_version: number;
  sha256: string;
  way_count: number;
  row_count: number;
  cell_count: number;
  baked_at: string;
  /** Імʼя файла й шлях відносно кореня пакетів — фронт їх НЕ конструює. */
  filename?: string | null;
  rel_path?: string | null;
}

/** Минуле випікання. Ніколи не перетворювати на смугу чи ETA. */
export interface BakePrevious { way_count: number; elapsed_s: number; baked_at: string }

export interface BakeSnapshot {
  job_id: string;
  scope_id: string;
  label_ua: string;
  stage: BakeStage;
  started_at: string;
  updated_at: string;
  download: BakeDownload;
  verify: BakeVerify;
  bake: BakeCounters;
  outcome: BakeOutcome | null;
  pack: BakePack | null;
  previous: BakePrevious | null;
  /** Пороги сторожа — щоб «підлога 30 %» малювалась із виміру, не з літерала. */
  guard: BakeGuard | null;
}

/** Витяг OSM. `bytes: null` + `measured: false` → розміру НЕ друкуємо. */
export interface BakeSource {
  id: string;
  label_ua: string;
  host: string;
  url: string;
  remote: { bytes: number | null; last_modified: string | null; measured: boolean; detail?: string };
  on_disk: { bytes: number; last_modified: string | null; md5_verified: boolean } | null;
  partial: { bytes: number; resumable: boolean } | null;
}

export interface BakeScope {
  id: string;
  tier: string;
  label_ua: string;
  source_id: string;
  bbox: [number, number, number, number] | null;
  eligible: boolean;
  /** Українські речення бекенда, без префікса. Малювати дослівно. */
  blockers: string[];
  existing_pack: BakePack | null;
  previous: BakePrevious | null;
}

/** Що сторожа памʼяті бачить ЗАРАЗ — до натискання, а не після 900 МБ.
 *
 * Проба спроможності міряє БАЙТИ (≥ 2 ГіБ на місто — прохід), а сторожа стріляє
 * по ВІДСОТКУ. Машина з 2,8 ГіБ вільними з 16 проходить пробу й гине на першому
 * зливі партії. Заміряно 05.09.2026: 17,8 % проти підлоги 30 %. Тому це окреме
 * читання тим самим читачем, що й у роботі, — і воно ПОПЕРЕДЖАЄ, а не блокує:
 * сервер перевіряє ще раз на старті й відмовляє 412, тож глушити кнопку на склі
 * означало б забороняти натиск, який щойно став валідним.
 *
 * `psi_some_avg10` — факт, але не число, з яким людина щось робить. Не друкувати.
 */
export interface BakeMemoryState {
  ram_available_pct: number | null;
  floor_pct: number;
  strikes_to_trip: number;
  poll_s: number;
  measured: boolean;
  would_stop: boolean;
  psi_some_avg10: number | null;
}

export interface BakeScopesResponse {
  estimate: boolean;
  scopes: BakeScope[];
  sources: BakeSource[];
  /** Абсолютний корінь пакетів — лише REST, у WS його немає. */
  pack_root_abs?: string | null;
  memory?: BakeMemoryState | null;
}

/** Стеля машини — запасний шлях; її `blockers` несуть префікс «{label_ua}: ». */
export interface BakeCapability {
  scope: string;
  scope_ua: string;
  blockers: string[];
  estimate: boolean;
  scopes: Array<{ id: string; label_ua: string }>;
}

# PHASE L0 — Atomic Knowledge Graph Foundation

**Track:** LEARNING (паралельно до productisation Phase 16-18).
**Status:** spec — pending implementation.
**Tag (on completion):** `v0.L0.0-akg-foundation`.
**Driver:** Conversation-based design 2026-04-29; objective — перетворити PHANTOM на always-on adaptive teacher, що б'є будь-які онлайн-курси за рахунок персонального контексту, біосигналів та offline-парітету.

## Мета

Закласти **єдиний source-of-truth** для всього навчального треку: атомарну модель знання + persistence + базовий API + seed-парсер. Без цього шару ні spaced repetition (L1), ні task profiles (L2), ні JIT teaching (L3), ні mock interview (L4) не мають куди писати mastery score чи звідки тягнути `next-atom-to-review`.

L0 — **тільки дані і запити**. Жодного drill UI, TTS, scheduler-loop, DREAM batch. Це навмисно: фаза має бути малою, відвантажуваною за один блок, з pytest-зеленим gate.

## Не-цілі (відкладено)

- Drill UI (frontend `<DrillScreen/>`) — L1.
- Spaced repetition algorithm (SM-2/FSRS) — L1.
- DREAM batch consolidation — L1 (data hook), L4+ повна логіка.
- Task profiles, profile loader — L2.
- Just-In-Time injection — L3.
- Mock interview engine — L4.
- TTS / voice drill — L1+.
- Atom-mining з зовнішніх джерел (web/papers) — L5.

## Архітектурне рішення

AKG живе **поряд** із існуючою memory-стратою, не всередині. Memory layers (`session`/`tactical`/`strategic`/`archive` у `MemoryFact`) — це те, що PHANTOM пам'ятає **про користувача**. AKG — це **граф знань користувача**: окрема онтологія, окремі таблиці, окрема ChromaDB collection. Cross-link через FK на `user_id` + опціональні `evidence_fact_id` посилання назад на `MemoryFact`, коли atom mastery підтверджується спостереженням.

Розподіл сховищ:
- **SQLite** — точна структура: атоми, ребра-залежності, mastery records, applied-in-project events. Числа і flags, що повинні бути транзакційними.
- **ChromaDB** (collection `atoms`) — векторні embeddings змісту атома + metadata duplicate (для семантичного пошуку "знайди близькі за смислом атоми" і retrieval у prompt builder). SQLite — primary, Chroma — derived view.

## Schema

### 1. Shared types

`src/shared/types/learning.ts` — повний набір (новий файл):

```typescript
export type AtomKind =
  | 'concept'        // визначення, ідея
  | 'procedure'      // як зробити X
  | 'fact'           // конкретне твердження
  | 'pattern'        // повторюваний шаблон/ідіома
  | 'pitfall'        // anti-pattern, типова помилка
  | 'mnemonic'       // мнемоніка для іншого атома
  | 'example';       // конкретний приклад

export type AtomDomain =
  | 'cs.algorithms'
  | 'cs.systems'
  | 'cs.languages'
  | 'cs.architecture'
  | 'math'
  | 'ml'
  | 'security'
  | 'devops'
  | 'soft.communication'
  | 'soft.behavioral'
  | 'domain.custom';   // free-form per profile

export type EdgeKind =
  | 'prereq'           // B потребує A засвоєного
  | 'related'          // суміжне, не обов'язкове
  | 'contradicts'      // конфліктуючі ідеї (для drill)
  | 'specialization'   // B — вужчий випадок A
  | 'composes';        // B побудовано з A1..An

export interface Atom {
  id: string;                 // UUID v4
  user_id: string;            // FK → users.id
  title: string;              // ≤ 120 chars, людська назва
  body: string;               // markdown, ≤ 8000 chars, повне пояснення
  kind: AtomKind;
  domain: AtomDomain;
  tags: string[];             // free-form, для filter
  source_uri: string | null;  // звідки прийшло (file://, https://, git://commit#path)
  source_excerpt: string | null;  // ≤ 500 chars, для traceability
  created_at: string;
  updated_at: string;
  embedding_id: string | null; // ChromaDB id, null якщо ще не індексовано
  archived: boolean;          // soft-delete; не видаляємо history
}

export interface AtomEdge {
  id: string;
  from_atom_id: string;
  to_atom_id: string;
  kind: EdgeKind;
  weight: number;             // 0..1, наскільки сильна залежність
  created_at: string;
}

export interface MasteryRecord {
  id: string;
  user_id: string;
  atom_id: string;
  mastery_score: number;      // 0..1, поточний level
  stability: number;          // 0..1, опір забуванню (FSRS-like)
  difficulty: number;         // 0..1, особиста складність
  last_reviewed_at: string | null;
  next_review_at: string | null;
  review_count: number;
  lapse_count: number;        // скільки раз "забув"
  applied_count: number;      // скільки раз застосовано в реальному коді/проєкті
  last_applied_at: string | null;
  forgetting_lambda: number;  // персональний λ для exp(-λ·t)
  updated_at: string;
}

export interface AtomApplicationEvent {
  id: string;
  user_id: string;
  atom_id: string;
  source: 'git_commit' | 'manual' | 'drill_pass' | 'jit_followup';
  evidence_uri: string | null;   // git+sha://repo/path або null
  evidence_excerpt: string | null;
  confidence: number;            // 0..1
  occurred_at: string;
}

export interface AtomQueueItem {
  atom_id: string;
  reason: 'due_review' | 'low_mastery' | 'goal_path' | 'jit_followup';
  priority: number;             // 0..1
  due_at: string | null;
}
```

`src/shared/types/index.ts` — додати re-export `learning`.

### 2. SQLAlchemy ORM

`src/backend/db/models.py` — додати 4 таблиці. Колонки точно дзеркалять TS типи (snake_case, JSON string для `tags` masivu, ISO 8601 для timestamps).

| Table | PK | Indexes |
|-------|----|---------|
| `learning_atoms` | `id` | `(user_id, domain)`, `(user_id, kind)`, `embedding_id`, `archived` |
| `learning_atom_edges` | `id` | `(from_atom_id, kind)`, `(to_atom_id, kind)` UNIQUE `(from, to, kind)` |
| `learning_mastery` | `id` | `(user_id, atom_id)` UNIQUE, `(user_id, next_review_at)` |
| `learning_application_events` | `id` | `(user_id, atom_id, occurred_at DESC)` |

FK з `ON DELETE CASCADE` на `users.id` і `learning_atoms.id` (cascade на edges, mastery, applications коли atom архівується soft, видаляється hard тільки через explicit admin path — не в L0).

### 3. ChromaDB collection

```python
# src/backend/memory/akg_index.py (новий)
COLLECTION_NAME = "akg_atoms"
EMBEDDING_MODEL = config.akg_embedding_model  # default "all-MiniLM-L6-v2"

# document = atom.title + "\n\n" + atom.body[:2000]
# metadata = {
#   "user_id": str,
#   "atom_id": str,
#   "kind": str,
#   "domain": str,
#   "tags_csv": str,    # joined "tag1,tag2"; Chroma не любить list
#   "updated_at": str,
# }
```

Indexing — синхронно при `POST /atoms` і `PATCH /atoms/:id` (не batch у L0; batch reindex — окрема CLI команда у L1).

### 4. Migration

`src/backend/db/migrations/L0_akg_foundation.py` — idempotent. Pattern як у `004_chat_prompt_log.py`:
- `PRAGMA table_info(...)` гард перед кожним `CREATE TABLE`.
- `CREATE INDEX IF NOT EXISTS` для кожного індексу.
- `apply_pending(engine)` re-runnable.

## API

`src/backend/api/routes_learning.py` — новий файл. Усі ендпоінти за `/api/learning/*`, JWT-захищені, scope `learning.read` / `learning.write` (нові permission strings, додати до `security/permissions.py`).

| Method | Path | Body | Returns | Notes |
|--------|------|------|---------|-------|
| `POST` | `/atoms` | `Atom` без `id`/`*_at`/`embedding_id` | `Atom` | створює + індексує у Chroma |
| `GET` | `/atoms/:id` | — | `Atom & { mastery: MasteryRecord \| null, edges_in: AtomEdge[], edges_out: AtomEdge[] }` | join-shape, single round-trip |
| `PATCH` | `/atoms/:id` | partial `Atom` | `Atom` | re-index Chroma якщо `title` або `body` змінилися |
| `DELETE` | `/atoms/:id` | — | `204` | soft-delete (`archived = true`); Chroma запис прибирається |
| `GET` | `/atoms` | query: `domain`, `kind`, `tag`, `q` (semantic), `limit≤100`, `cursor` | `{ items: Atom[], next_cursor }` | при `q` — Chroma similarity, інакше SQL filter |
| `POST` | `/edges` | `AtomEdge` без `id`/`created_at` | `AtomEdge` | UNIQUE constraint видає 409 |
| `DELETE` | `/edges/:id` | — | `204` | hard delete |
| `GET` | `/atoms/:id/graph` | query: `depth≤3`, `kinds=prereq,...` | `{ nodes: Atom[], edges: AtomEdge[] }` | BFS обхід |
| `GET` | `/queue` | query: `limit≤50` | `AtomQueueItem[]` | у L0 повертає тільки `low_mastery` (mastery<0.5, sorted asc) і `due_review` (next_review_at ≤ now); інші `reason` — заглушка-NotImplemented для L1+ |
| `POST` | `/mastery/:atom_id` | `{ delta_score?, applied?, review_pass? }` | `MasteryRecord` | uniform write-path; обчислення `next_review_at` — у L0 проста формула `now + 24h * (1+score)`, L1 замінить на FSRS |
| `POST` | `/applications` | `AtomApplicationEvent` без `id`/`occurred_at` | `AtomApplicationEvent` | бамп `applied_count` у mastery; trigger `mastery_score = min(1, score + 0.05*confidence)` |
| `GET` | `/stats` | — | `{ total, by_domain, by_kind, mastered≥0.8, due_now }` | для UI counter pill |

`websocket_hub` channel `learning.queue` — broadcast при будь-якому write у `mastery` або `applications`, payload `{ user_id, due_now, mastered, total }`. UI у L1 буде підписуватись.

### Pydantic schemas

`src/backend/api/schemas/learning.py` — request/response validation. `mastery_score`, `stability`, `difficulty`, `confidence`, `weight`, `priority` — `confloat(ge=0, le=1)`. `title` — `constr(max_length=120)`. `body` — `constr(max_length=8000)`. `tags` — `conlist(constr(max_length=40), max_items=20)`. Будь-яке порушення → 422 без витоку trace.

### Permission gates

- `ROOT` — всі ендпоінти, including read інших користувачів через `?user_id=` (для L4 mock-interview review другої особи).
- `OPERATOR` — read/write **тільки свій** `user_id` (server-side з JWT, ігнорує query param).
- `GUEST` — `403` на всі learning endpoints. AKG приватна за замовчуванням.

## Files (повний список)

### Створити

1. `src/shared/types/learning.ts` — типи (вище).
2. `src/backend/api/routes_learning.py` — роути.
3. `src/backend/api/schemas/learning.py` — Pydantic.
4. `src/backend/learning/__init__.py`
5. `src/backend/learning/atoms_repo.py` — SQLAlchemy data access layer.
6. `src/backend/learning/edges_repo.py` — те саме для edges.
7. `src/backend/learning/mastery_repo.py` — mastery + applications.
8. `src/backend/learning/akg_index.py` — Chroma wrapper (`upsert`, `delete`, `query`).
9. `src/backend/learning/seed_parser.py` — markdown → Atom батчик (див. Seed нижче).
10. `src/backend/db/migrations/L0_akg_foundation.py` — DDL.
11. `src/backend/tests/test_phase_l0_akg_repo.py` — repo unit tests.
12. `src/backend/tests/test_phase_l0_akg_routes.py` — API integration tests.
13. `src/backend/tests/test_phase_l0_akg_index.py` — Chroma index test (skipif Chroma не встановлений у CI mock-mode).
14. `src/backend/tests/test_phase_l0_akg_seed.py` — seed parser test проти fixture markdown.
15. `tests/fixtures/learning/seed_atoms.md` — fixture файл (3-5 атомів, різні domains).

### Модифікувати

1. `src/backend/db/models.py` — 4 нові ORM models.
2. `src/backend/db/migrations/__init__.py` — register `L0_akg_foundation`.
3. `src/backend/main.py` — include `routes_learning.router`.
4. `src/backend/security/permissions.py` — додати `learning.read`, `learning.write` scopes; bind до ROOT/OPERATOR.
5. `src/backend/config.py` — нові ключі (нижче).
6. `src/shared/types/index.ts` — re-export `learning`.
7. `src/backend/api/websocket_hub.py` — register `learning.queue` channel.

### НЕ створювати (явно, щоб не плодити мертвий код)

- Frontend компоненти — L1.
- TTS / drill — L1+.
- DREAM hook — L1.
- CLI batch reindex — L1.
- Migration test scaffolding — використовуємо існуючий `tests/test_migrations.py` pattern.

## Config

`config.py` додає:

| Key | Default | Notes |
|-----|---------|-------|
| `akg_enabled` | `False` | Off-by-default; ROOT увімкне з settings UI коли L0 деплоїться |
| `akg_embedding_model` | `"all-MiniLM-L6-v2"` | для Chroma; sentence-transformers compat |
| `akg_chroma_collection` | `"akg_atoms"` | namespace |
| `akg_max_atoms_per_user` | `10000` | guard rail; L0 enforces на `POST /atoms` |
| `akg_max_body_chars` | `8000` | mirror Pydantic constraint |
| `akg_default_review_interval_hours` | `24` | для placeholder `next_review_at` formula |
| `akg_seed_on_startup` | `False` | якщо True — auto-import з `data/learning/seed/*.md` при `lifespan` |

Auto-rendered у Settings UI через існуючий `routes_settings.py` mechanism (per CLAUDE.md правило #8).

## Seed parser

Простий, без AI у L0 (AI extraction — L1 nice-to-have).

`seed_parser.py::parse_markdown_to_atoms(md_text, default_domain)`:
- Кожен `## Heading` → новий атом, `title = heading text`.
- Перший рядок під heading починається з `kind: ...` → ставить `kind`, інакше default `'concept'`.
- Tags як `tags: [tag1, tag2]` — рядок одразу після `kind:`.
- Решта тексту до наступного `##` → `body`.
- `domain` — з аргументу або з front-matter `---\ndomain: cs.algorithms\n---`.
- Edges не парсимо — це окрема ручна операція або L1 LLM-extraction.

CLI команда:
```bash
python -m backend.learning.seed_parser \
    --user-id <uuid> \
    --file docs/learning/python_async_atoms.md \
    --domain cs.languages
```

L0 ships із одним fixture-файлом `tests/fixtures/learning/seed_atoms.md` (5 атомів) — для тесту парсера. Реальний seed із твоїх docs — ручне завдання після L0 (поза кодом фази).

## Tests (gate)

Усі `pytest` зелені перед merge. Цільові виклики:

```bash
cd src/backend && pytest \
  tests/test_phase_l0_akg_repo.py \
  tests/test_phase_l0_akg_routes.py \
  tests/test_phase_l0_akg_index.py \
  tests/test_phase_l0_akg_seed.py
```

Coverage цілі:

| Test file | Cases | Що перевіряє |
|-----------|-------|--------------|
| `test_phase_l0_akg_repo.py` | 14 | CRUD на 4 таблицях, FK cascade, UNIQUE constraints (edge `(from,to,kind)`, mastery `(user_id, atom_id)`), soft-delete behaviour, `applied_count` increment ідемпотентність |
| `test_phase_l0_akg_routes.py` | 22 | Кожен ендпоінт — happy path + 1 negative (auth, validation, ownership). `/atoms` semantic search повертає relevance-ordered. `/atoms/:id/graph` BFS depth=2. ROOT може читати чужий user_id; OPERATOR — 403 на чужий. GUEST — 403 на все |
| `test_phase_l0_akg_index.py` | 6 | upsert, delete, query top_k, metadata filter `domain=...`, re-index при PATCH body, missing Chroma → graceful degrade (route повертає SQL-only fallback із warning header) |
| `test_phase_l0_akg_seed.py` | 5 | Парсер на fixture: count=5, kinds correct, tags joined, body trimmed на `\n##`, idempotent re-import (same source_uri → update, не duplicate) |

Усього ~47 нових тестів. Очікувана дельта: загальний backend pytest з 1079 (after Phase 17a) → ~1126.

Окремий smoke:
```bash
cd src/backend && python -c "
from db.migrations import apply_pending
from db.database import engine
import asyncio
asyncio.run(apply_pending(engine))
print('OK')
"
```
має пройти двічі поспіль (idempotency).

Frontend types compile:
```bash
cd src/frontend && npx tsc --noEmit
```

## Acceptance

- [ ] `pytest src/backend/tests/test_phase_l0_akg_*.py` — 47/47.
- [ ] Full backend pytest — попередні + 47, нічого не зламано.
- [ ] `npx tsc --noEmit` чисто (новий файл `learning.ts` + re-export).
- [ ] Migration `apply_pending` ідемпотентна (двічі поспіль = no-op другий раз).
- [ ] `akg_enabled=False` за замовчуванням; коли False — `routes_learning` повертає `503 {"error": "AKG disabled"}` на write-paths, але read-paths працюють (для diagnostics).
- [ ] Seed-парсер на `tests/fixtures/learning/seed_atoms.md` створює 5 атомів, кожен з валідним embedding у Chroma.
- [ ] `GET /api/learning/stats` для пустого user — `{ total: 0, by_domain: {}, by_kind: {}, mastered: 0, due_now: 0 }`, не 500.
- [ ] WebSocket `learning.queue` broadcast при `POST /mastery/:atom_id` — інтеграційний тест отримує payload.
- [ ] Permission matrix: ROOT/OPERATOR/GUEST verified у тестах (3 кейси per protected endpoint).
- [ ] Жодних `TODO`, `FIXME`, `pass  # implement later`, `mock` у production code paths.
- [ ] Атомарний commit message: `phase-L0: AKG foundation (closes ADR-LRN-001)` + Co-Authored-By.

## Out of scope (явно)

- **FSRS scheduler** — `next_review_at` у L0 = `now + 24h * (1 + mastery_score)`, placeholder. Замінюється у L1.
- **AI atom extraction** — у L0 атоми створюються тільки `POST /atoms` або через seed-парсер з готового MD. LLM-mining з твоїх codebase'у — L5.
- **Atom merge / dedup** — якщо два атоми дублюються, ROOT робить ручний merge через DELETE+ refs update (поза API). Авто-merge — L2 nice-to-have.
- **Audit log** — у `ai_tool_use_log` learning events не пишуться. Окрема таблиця `learning_audit_log` — L1 коли drill починає писати результати.
- **Metrics export** — `phantom_akg_atoms_total{user_id, domain}` Prometheus counter — L1 разом із drill metrics.
- **Per-tenant ContextEngine** — успадковує invariant з Phase 17b (single-tenant only). Multi-tenant AKG isolation — окрема ADR після того як ContextEngine розслоїться.

## Залежності і ризики

**Залежності:**
- Phase 0 scaffolding (готове).
- ChromaDB у проєкті (готове, використовується у `strategic_memory.py`).
- `users` table з ROOT-юзером (готове).
- JWT auth (готове).

**Ризики:**

1. **Embedding model завантаження на Radxa повільне.**
   Mitigation: `akg_embedding_model` configurable, тест із MiniLM (22MB, CPU-friendly). Lazy load при першому `POST /atoms`. Cache `~/.cache/torch/sentence_transformers/`.

2. **Chroma collection зростає без bound.**
   Mitigation: `akg_max_atoms_per_user` enforce у repo layer, повертає 409. L1+ додасть archive-rotation.

3. **Schema лак-in перед L1 FSRS.**
   Mitigation: `MasteryRecord` уже має `stability`, `difficulty`, `forgetting_lambda` — повний набір полів FSRS навіть якщо у L0 не використовуються. L1 заповнить логіку без ALTER TABLE.

4. **Dual-write SQLite + Chroma може розсинхронізуватися при крашi.**
   Mitigation: `atoms_repo.create()` — SQLite спочатку, потім Chroma; failure у Chroma → `embedding_id = NULL`, atom валідний без векторного пошуку. Окремий CLI command `python -m backend.learning.akg_index --reindex-missing` відновлює (поставляється у L0, тестується у `test_phase_l0_akg_index.py::test_reindex_missing`).

## Подальший шлях

Після L0 merge → L1 (`PHASE_L1_MASTERY_LOOP.md`) — FSRS scheduler, drill API, frontend `<DrillScreen/>`, DREAM batch hook, output-graded mastery через git-commit hook. L1 буде значно більший за L0; L0 свідомо мінімальний фундамент.

ADR: `docs/architecture/ADR-LRN-001-akg-foundation.md` — окремий ADR файл створюється разом із цією фазою (короткий, ~80 рядків) для traceability у commit history.

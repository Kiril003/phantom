# UI/UX переробка: Dock · Apps · Налаштування

## Context

Власник користується PHANTOM OS щодня й виявив три структурні проблеми, що псують щоденний UX на 1024×600 тач-екрані:

1. **Нижня панель кнопок (FloatingToolbar)** надто масивна (~76px), 7 первинних кнопок сперечаються з вторинним меню за увагу, частина іконок дублюється з More-меню. Немає візуальної ієрархії.
2. **Apps-grid + More-меню**: Camera / Terminal / Networks живуть одночасно і там, і там. More-меню (12 пунктів × 44px = 528px) **не вміщається у 600px-екран і не скролиться** — нижні пункти обрізаються. Tools (Timer / Alarm / Calendar / Files) сидять в окремому ToolsOverlay і ховаються в одному пункті More — низька видимість.
3. **Налаштування** виглядають плоско (rgba 0.5 без меж, без карток, без розділювачів), 150+ полів у 13 категорій без поділу на Basic/Advanced. Експертні поля (`security_trust_xff`, `voice_stt_npu_*`, `agent_emotion_decay_*`, `chat_orchestrator_*`) лізуть у головний потік. Багато полів змушують **вписувати руками** значення там, де backend міг би автоматично знайти або запропонувати dropdown: Ollama-host, серійний порт ESP32, моделі Whisper/Gemini, голос TTS, шляхи до NPU/MMS-бандлів, wake-фрази, trusted-proxies.

Мета — переосмислити IA на трьох рівнях, без зміни функціональності, тільки **логіка розміщення + автоматизація + візуальний рестайл**. Підтверджено власником: 5 первинних кнопок у доку, ToolsOverlay вливається в Apps секцією «Інструменти», Налаштування переробляються повністю (IA + autodetect + візуал, 3 коміти).

---

## Section A — Dock редизайн (1 коміт)

**Файл:** `src/frontend/src/components/core/FloatingToolbar.tsx`

### A1. Скоротити first-line з 7 до 5 (lines 150-194)
Лишаємо: **Home · Chat · Apps · Settings · More**.
- `terminal` (id=`terminal`) → видалити з `primary`. Доступ через Apps grid → `Терминал`.
- `map` (id=`map`) → видалити з `primary`. Доступ через Apps grid + StatusBar geo-pin (вже є).

Жоден `onClick`-handler не видаляється — тільки прибираємо записи з масиву `primary`.

### A2. Стиснути візуал пілюлі (lines 402-411, 467-490)
- pill: `gap: 4 → 2`, `padding: '6px 8px' → '4px 6px'`, `boxShadow: '0 14px 38px rgba(120,70,10,0.18)' → '0 6px 18px rgba(40,30,15,0.10), inset 0 0 0 1px var(--glass-border)'`.
- `ToolbarIcon`: `width/height: 44 → 40` (тач 40px у Apple HIG усе ще валідний для primary), `borderRadius: 14 → 12`, `fontSize (msym): 22 → 20`, активний bg drop важкої тіні `0 0 14px rgba(244,175,37,0.30)` → 1.5px amber ring `inset 0 0 0 1.5px rgba(244,175,37,0.55)`.
- Загальна висота dock: ~76px → ~52px (вивільняє 24px під контент).

### A3. Контекстна щільність dock (новий useEffect ~line 367)
Коли `state === SystemState.SENTINEL || state === SystemState.GHOST` — обгорнути pill `<motion.div animate={{ opacity: 0.62, scale: 0.96 }}>` (Framer вже імпортований). Dock відступає на бек, не конкурує з тривожними state.

### A4. More-меню: scroll-safe + 2-колонний grid (lines 385-397)
```
display: 'grid'
gridTemplateColumns: 'repeat(2, minmax(150px, 1fr))'
gap: 4
maxHeight: 480     // 600 - 32 (statusbar) - 52 (dock) - 36 (gap)
overflowY: 'auto'
overscrollBehavior: 'contain'
```
Математика: ROOT бачить 11 пунктів (after видалення `tools` → див. B3) ÷ 2 кол = 6 рядків × 44 = 264px (вписується). Non-ROOT: 10 ÷ 2 = 5 рядків × 44 = 220px.

### A5. Long-press affordance на Home (lines 332-352, новий localStorage-hint)
Додати `useEffect`, що читає `localStorage.phantom_more_hint_seen`. Поки `false` — рендеримо у правому-нижньому куті Home-кнопки 6×6 пульсуючу амбер-крапку (`AnimatePresence` + `animate={{ opacity: [0.3, 0.9, 0.3] }}`). Після першого long-press: `localStorage.setItem('phantom_more_hint_seen', '1')` + знімання крапки.

---

## Section B — Apps overlay редизайн (2 коміти)

**Файл:** `src/frontend/src/components/core/Overlays.tsx` (lines 786-903 — `AppsOverlay`).
**Файл:** `src/frontend/src/components/tools/ToolsOverlay.tsx` (read prop `initialTab`, line ~35).
**Файл:** `src/frontend/src/components/core/FloatingToolbar.tsx` (видалити дублі з secondary).

### B1. Резолвити дублі (single-home-per-app)
Видалити з `secondaryAll` (FloatingToolbar.tsx):
- `camera` (lines 296-305) — лишається тільки в Apps.
- `wifi` / Networks (lines 306-315) — лишається тільки в Apps.
- `tools` (lines 251-261) — розчиняється в Apps секцією «Інструменти».

Видалити з Apps grid (Overlays.tsx):
- `dialogue` (lines 858-866) — Chat-кнопка у dock уже primary, дубль зайвий.

### B2. Новий 12-tile grid у трьох секціях (replace lines 878-902)
Бюджет: 1024×(600-32-52)=1024×516. Macет 4 колонки × 3 ряди з заголовками секцій:
```
┌───────────────────────────────────────────────────────────────────────────┐
│  [search "Пошук додатків…"]                              [Apps · Tools]   │  44
├─── СИСТЕМНІ ──────────────────────────────────────────────────────────────│
│  [Map]      [Camera]    [Terminal]   [Networks]                           │  140
├─── ІНСТРУМЕНТИ ───────────────────────────────────────────────────────────│
│  [Timer]    [Alarm]     [Calendar]   [Files]                              │  140
├─── ДАНІ / АГЕНТ ──────────────────────────────────────────────────────────│
│  [Agent]    [Sentinel]  [Settings]   [Protocols]                          │  140
└───────────────────────────────────────────────────────────────────────────┘
```
Tile (~220×132): icon 32px, label 13px, **descriptor** subtitle 11px (наприклад `Networks → "Wardriving · BSSID скан"`), легкий timestamp в кутку `last-used: 5 хв тому` з `localStorage.phantom_app_last_used` (Record<id, ISO>).

Search: input у sticky-header, фільтрує по `label.toLowerCase().includes(query)` через `useMemo`.

### B3. Інструменти → Apps tiles (Tools-overlay як target)
Кожен з 4 tools-tiles викликає `setToolsOverlayOpen(true)` з `initialTab: 'timer' | 'alarm' | 'calendar' | 'files'` через ваш існуючий `useUIStore`. Потрібно:
- Додати в `useUIStore` поле `toolsInitialTab: ToolsTab | null` + setter.
- `ToolsOverlay.tsx` зчитує `toolsInitialTab` при mount і передає у внутрішній tab-state (вже є логіка `initialTab` у компоненті — line ~35).
- Tools-кнопка з More-меню видаляється (B1).

### B4. Search + last-used persist
Новий store-секція `useAppsStore` (`src/frontend/src/stores/appsStore.ts`) — простий Zustand з `lastUsed: Record<string, number>` + `markUsed(id)`. Викликається у `onClick` кожного tile. Sort-чи-ні — НЕ сортуємо (порядок секцій фіксований), лише показуємо timestamp у кутку.

---

## Section C — Налаштування: IA + autodetect + візуал (3 коміти)

### C1 (commit 1) — Schema: Basic / Advanced + store delta

**Backend:** `src/backend/api/routes_settings.py`
- Розширити `SettingDefinitionOut` (lines 36-56): додати поля
  ```python
  tier: Literal['basic', 'advanced'] = 'basic'
  unimplemented: bool = False     # замість inline " [soon]" у label
  auto_detect: bool = False       # підказка фронтенду використати custom editor
  editor: str | None = None       # явне ім'я editor-компонента
  ```
- Поряд з `LABEL_OVERRIDES` (lines 336-444) додати:
  ```python
  ADVANCED_KEYS: set[str] = {
      'voice_partial_debounce_ms', 'voice_refine_with_whisper', 'voice_refine_diff_threshold',
      'voice_stt_whisper_device', 'voice_stt_whisper_compute',
      'voice_stt_npu_enabled', 'voice_stt_npu_model_path', 'voice_stt_npu_compute',
      'voice_stt_mms_enabled', 'voice_stt_mms_bundle_dir', 'voice_stt_mms_lang',
      'voice_stt_mms_min_speech_ms', 'voice_stt_mms_max_partial_ms',
      'agent_emotion_enabled', 'agent_emotion_decay_minutes',
      'agent_reflection_every_n_actions', 'agent_proactive_cooldown_s', 'agent_proactive_interval_s',
      'agent_standing_orders_check_interval_s', 'agent_standing_orders_max_concurrent',
      'agent_max_llm_calls_per_background_task', 'agent_background_task_timeout_s',
      'agent_monologue_rate_limit_eps',
      'chat_orchestrator_enabled', 'chat_orchestrator_max_steps', 'chat_orchestrator_step_timeout_s',
      'chat_tool_call_timeout_s', 'chat_tool_max_total_ms', 'chat_tool_max_calls_per_turn',
      'chat_prompt_excerpt_max_chars',
      'security_trust_xff', 'security_trusted_proxies',
      'wardriving_min_rssi', 'wardriving_dedupe_window_s', 'wardriving_persist_interval_s',
  }
  HIDDEN_KEYS: set[str] = {'voice_always_on_enabled'}  # deprecated alias
  ```
- У `_build_definition` (line ~479) виставити `tier='advanced' if key in ADVANCED_KEYS else 'basic'`, `unimplemented=key in UNIMPLEMENTED_KEYS`, прибрати inline `" [soon]"` з label (тепер це окремий бейдж на FE).
- У GET handler фільтрувати `HIDDEN_KEYS` повністю.

**Frontend:** `src/frontend/src/stores/settingsStore.ts`
- Додати `showAdvanced: boolean` (default `false`, persist через `localStorage.phantom_settings_advanced`).
- Селектор `visibleSettings(category)`: `category.settings.filter(s => showAdvanced || s.tier === 'basic')`.

**UI:** `src/frontend/src/components/settings/SettingsPanel.tsx`
- Sticky header bar над main pane (новий `<SettingsHeader />` ~line 402): search-input (filter by label substring) + `<Switch>` "Показати розширені". 44px touch.

### C2 (commit 2) — Discovery endpoints + custom editors

**Новий backend модуль:** `src/backend/api/routes_discover.py` (зареєструвати у `main.py`).
| Endpoint | Discovers | Реалізація |
|---|---|---|
| `GET /discover/serial-ports` | `/dev/ttyUSB*`, `/dev/ttyACM*` | `serial.tools.list_ports.comports()` (вже у requirements через pyserial) |
| `GET /discover/piper-voices` | `*.onnx` під piper voices dir | `pathlib.Path(piper_dir).glob('**/*.onnx')` |
| `GET /discover/npu-models` | `*.qnn`, `*.dlc` під model root | filesystem scan |
| `GET /discover/mms-bundles` | dirs під MMS bundle root | filesystem scan |
| `GET /discover/ollama-status` | host:port reachable | `httpx.get(f'{host}/api/tags', timeout=2)` (вже є `OllamaProvider`) |
| `GET /discover/gemini-models` | static catalog | `['gemini-2.0-flash', 'gemini-2.0-flash-lite', 'gemini-1.5-pro', 'gemini-1.5-flash', 'gemini-1.5-flash-8b']` |

Кожен endpoint віддає `{items: [{value, label, meta?}]}`. Помилки — порожній array + `error: string`.

**Нова папка:** `src/frontend/src/components/settings/editors/`
| Editor | Поля | Pattern |
|---|---|---|
| `DiscoverSelectEditor.tsx` | `sensor_serial_port`, `voice_tts_voice`, `voice_stt_npu_model_path`, `voice_stt_mms_bundle_dir`, `ai_gemini_model` | Викликає discovery endpoint на mount → dropdown + кнопка «↻ Refresh» + лінк «Ввести вручну» (fallback у text-input) |
| `HostPortEditor.tsx` | `ai_ollama_host` | Split host + port; default `127.0.0.1:11434`; live-ping → green/red dot |
| `ChipInputEditor.tsx` | `voice_wake_phrase`, `voice_wake_words`, `security_trusted_proxies` | Tag-style chips, Enter додає, X видаляє, preset-suggestions row (наприклад «фантом», «phantom») |

Wire-up у `ValueEditor` (`SettingsPanel.tsx` line 964): замінити поточну hardcoded-перевірку `ai_ollama_model` (line 973) на table-driven dispatch:
```ts
const KEY_EDITORS: Record<string, FC<EditorProps>> = {
  ai_ollama_model: OllamaModelEditor,         // вже існує lines 1524-1656
  ai_ollama_host: HostPortEditor,
  ai_gemini_model: DiscoverSelectEditor,
  voice_tts_voice: DiscoverSelectEditor,
  sensor_serial_port: DiscoverSelectEditor,
  voice_stt_npu_model_path: DiscoverSelectEditor,
  voice_stt_mms_bundle_dir: DiscoverSelectEditor,
  voice_wake_phrase: ChipInputEditor,
  voice_wake_words: ChipInputEditor,
  security_trusted_proxies: ChipInputEditor,
};
const Editor = KEY_EDITORS[def.key];
if (Editor) return <Editor def={def} value={value} onChange={onChange} />;
```

`OllamaModelEditor` (вже є, lines 1524-1656) **не чіпаємо** — тільки додаємо у map.

### C3 (commit 3) — Візуальний рестайл + бейджі

**Новий CSS layer** у `src/frontend/src/styles/settings.css` (підключити в `index.css`):
```css
.setting-card {
  background: rgba(255, 250, 244, 0.62);
  border: 1px solid rgba(40, 30, 15, 0.08);
  border-radius: 14px;
  padding: 16px 20px;
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.5);
}
.setting-group       { border-top: 1px solid rgba(40, 30, 15, 0.06); padding-top: 12px; }
.setting-group:first-child { border-top: 0; }
.setting-group-eyebrow { font: 10px/1 'JetBrains Mono'; letter-spacing: 0.14em;
                          text-transform: uppercase; color: var(--accent-amber); }
.setting-row         { display: flex; align-items: center; min-height: 56px;
                        border-bottom: 1px solid rgba(40, 30, 15, 0.04); }
.setting-row:last-child { border-bottom: 0; }
.setting-cathead     { position: sticky; top: 0; z-index: 1;
                        backdrop-filter: blur(10px);
                        background: rgba(255, 250, 244, 0.78);
                        padding: 12px 20px;
                        border-bottom: 1px solid rgba(40, 30, 15, 0.08); }
.badge-soon          { display: inline-flex; padding: 2px 8px; border-radius: 999px;
                        background: rgba(244, 175, 37, 0.18);
                        border: 1px solid rgba(244, 175, 37, 0.4);
                        color: #8a5e0a; font-size: 10px; font-weight: 600; }
```

Group-eyebrow color-кодується по категорії (через CSS-vars):
- voice → `--accent-violet`
- agent → `--accent-amber`
- ai → `--accent-coral`
- security → `--accent-deep`
- остальні → `--ink-secondary`

Замінити `SettingRow` (lines 842-959) inline-styles на `.setting-card` + `.setting-row`. Прибрати inline `rgba(255,255,255,0.50)`, всі inline `border: 1px solid …`. Description рендерити `<details>` з help-іконкою (Material Symbols `info`) — клік розкриває повний текст замість truncate.

`<Badge variant="soon">скоро</Badge>` — новий компонент `src/frontend/src/components/ui/Badge.tsx`. Викликається у `SettingRow` коли `def.unimplemented === true`, поряд з label.

`SettingsAccordion.tsx` headers — додати лічильник `(N полів)` справа + chevron-rotate + кнопку collapse-all/expand-all у `SettingsHeader`.

---

## Build sequence + verification

### Order: A → B → C1 → C2 → C3 (атомарно, кожен — окремий коміт)
- **A першим** — single-file change, мала ризик-зона, відразу прибирає overflow в More.
- **B після A** — залежить від видалених записів у `primary` (Map/Terminal без primary вже мають однозначний дім у Apps).
- **C1 → C2 → C3** — schema/store спочатку, бо editors з C2 і візуал з C3 покладаються на `tier`/`auto_detect`/`unimplemented` поля у responsi.

### Verification

**Section A — `FloatingToolbar.tsx`:**
- `cd src/frontend && npm run dev`. Devtools 1024×600 viewport. Перевірити: pill ≤ 56px, активна іконка має ring замість тіні, More-меню скролиться при overflow.
- Vitest: `src/frontend/src/components/core/__tests__/FloatingToolbar.test.tsx` — додати `it('renders 5 primary + More')`, `it('More menu uses 2-column grid')`, `it('hint dot disappears after long-press')`.
- Manual touch: long-press 500ms на Home → More відкривається; крапка-hint зникає назавжди.

**Section B — `Overlays.tsx` + `ToolsOverlay.tsx`:**
- Manual: відкрити Apps з dock. Перевірити: 12 tiles у 3 секціях, search фільтрує, кожен tile веде в правильне місце.
- Manual: Camera/Terminal/Networks **відсутні** в More-меню; Tools-пункт **відсутній** в More-меню; натискання `Timer`-tile в Apps відкриває ToolsOverlay одразу на вкладці Timer.
- Vitest: `Overlays.test.tsx` — `it('renders 12 tiles in 3 sections')`, `it('search filters by label substring')`, `it('Timer tile sets toolsInitialTab=timer')`.
- Pytest: не потрібен (frontend-only).

**Section C — backend + frontend:**
- Pytest: `src/backend/tests/test_routes_settings.py` — додати `test_setting_definition_has_tier_field`, `test_advanced_keys_marked_advanced`, `test_hidden_keys_filtered`, `test_unimplemented_replaces_soon_label`.
- Pytest: `src/backend/tests/test_routes_discover.py` (новий) — mock filesystem + httpx → assert серійні порти, piper-voices, ollama-status повертають 200 + правильна структура.
- Vitest: per-editor `*.test.tsx` для `DiscoverSelectEditor`, `HostPortEditor`, `ChipInputEditor` (mock fetch).
- Manual: відкрити Settings → перемкнути «Показати розширені» → бачити expert-поля; відкрити Voice → `voice_tts_voice` має dropdown з реальними піпер-голосами (або повідомлення «нічого не знайдено»); Ollama host показує зелену крапку при доступному backend.
- Manual 1024×600: жоден екран не має горизонтального скролу, sticky-header категорії залишається при скролі.

### Critical files

- `/home/radxa/programming/my_own/phantom_ai/PHANTOM_OS_BLUEPRINT/phantom-os/src/frontend/src/components/core/FloatingToolbar.tsx` (A1-A5)
- `/home/radxa/programming/my_own/phantom_ai/PHANTOM_OS_BLUEPRINT/phantom-os/src/frontend/src/components/core/Overlays.tsx` (B1-B4, function `AppsOverlay` lines 786-903)
- `/home/radxa/programming/my_own/phantom_ai/PHANTOM_OS_BLUEPRINT/phantom-os/src/frontend/src/components/tools/ToolsOverlay.tsx` (B3 — read `toolsInitialTab` from store)
- `/home/radxa/programming/my_own/phantom_ai/PHANTOM_OS_BLUEPRINT/phantom-os/src/frontend/src/stores/uiStore.ts` (B3 — додати `toolsInitialTab`)
- `/home/radxa/programming/my_own/phantom_ai/PHANTOM_OS_BLUEPRINT/phantom-os/src/frontend/src/stores/settingsStore.ts` (C1 — додати `showAdvanced`)
- `/home/radxa/programming/my_own/phantom_ai/PHANTOM_OS_BLUEPRINT/phantom-os/src/backend/api/routes_settings.py` (C1 — schema + ADVANCED/HIDDEN/UNIMPLEMENTED)
- `/home/radxa/programming/my_own/phantom_ai/PHANTOM_OS_BLUEPRINT/phantom-os/src/backend/api/routes_discover.py` (C2 — новий)
- `/home/radxa/programming/my_own/phantom_ai/PHANTOM_OS_BLUEPRINT/phantom-os/src/backend/main.py` (C2 — register router)
- `/home/radxa/programming/my_own/phantom_ai/PHANTOM_OS_BLUEPRINT/phantom-os/src/frontend/src/components/settings/SettingsPanel.tsx` (C1+C2+C3 — header + KEY_EDITORS dispatch + .setting-card)
- `/home/radxa/programming/my_own/phantom_ai/PHANTOM_OS_BLUEPRINT/phantom-os/src/frontend/src/components/settings/editors/` (C2 — нова папка: DiscoverSelectEditor, HostPortEditor, ChipInputEditor)
- `/home/radxa/programming/my_own/phantom_ai/PHANTOM_OS_BLUEPRINT/phantom-os/src/frontend/src/components/settings/SettingsAccordion.tsx` (C3 — лічильники)
- `/home/radxa/programming/my_own/phantom_ai/PHANTOM_OS_BLUEPRINT/phantom-os/src/frontend/src/components/ui/Badge.tsx` (C3 — новий)
- `/home/radxa/programming/my_own/phantom_ai/PHANTOM_OS_BLUEPRINT/phantom-os/src/frontend/src/styles/settings.css` (C3 — новий)
- `/home/radxa/programming/my_own/phantom_ai/PHANTOM_OS_BLUEPRINT/phantom-os/src/frontend/src/stores/appsStore.ts` (B4 — новий)

### Reused existing

- `OllamaModelEditor` (`SettingsPanel.tsx` lines 1524-1656) — pattern для всіх discovery-editors; додаємо як перший entry в `KEY_EDITORS`.
- `AppsOverlay` framework (`Overlays.tsx` line 786) — лишається, тільки `apps[]` array замінюється на 12 tiles + sections.
- `ToolsOverlay` `initialTab` prop (line ~35) — використовуємо без змін.
- `useUIStore.toggleOverlay`, `setMoreMenuOpen` — без змін.
- `EASE_PHANTOM` motion preset — для нової Apps-screen анімації появи.
- `aiApi.listModels()` — pattern для нових `discoverApi.serialPorts()` etc.

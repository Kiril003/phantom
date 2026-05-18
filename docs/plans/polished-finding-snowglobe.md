# Chat V2 — Widgets, Attachments, Compact Layout, Dedup

## Context

Чат у PHANTOM OS — 1127 LOC у `ChatWindow.tsx` + 32 файли в `components/chat/` + 8 widget-форм у `response_formatter.py` + 12 сцен у `chat_tool_dispatcher`. На папері це багатий мотор. На практиці юзер бачить:

1. **AI завжди відповідає plain text.** Жоден widget/scene не з'являється.
2. **Жоден attachment не працює end-to-end** — ні файл, ні скріншот, ні camera/paste, ні recall/code/sandbox.
3. **Sessions sidebar 260px** з'їдає половину 692px ChatWindow.
4. **Header 52px + ModelCard над input** — дублюють метадані які вже у StatusBar та bubble metadata.
5. **Дублі**: дві кнопки відкриття сесій (header + input-rail), mic-кнопка vs Voice always-on gate (плутає юзера яка яку роль грає).

Корінні причини знайдені у коді — це не "поліровка", це фундаментальний рефактор pipeline + перепланування input-rail.

### Smoking guns (file:line)

- `src/backend/ai/chat_pipeline.py:99` — `tools = _filter_safe_tools()` фільтрує **тільки** side-effect catalog (`_CHAT_SAFE_TOOL_NAMES` у `chat_tool_dispatcher.py:46-95`: alarm/timer/calendar/vault/studio/web). **`RESPONSE_FORM_TOOLS` (response_formatter.py:12) НІКОЛИ не передається у `call_with_tools`** → AI не має способу повернути widget → завжди fallback на text.
- `src/frontend/src/components/chat/ChatWindow.tsx:611` + `:925` — **дві окремі кнопки** з `onClick={() => setSessionsOpen(...)}`. Header-кнопка показується тільки коли `!sessionsOpen`, input-rail Menu-кнопка завжди.
- `src/backend/api/routes_chat.py:39 SendMessageRequest` — поля `content`, `input_method`, `session_id`, `voice_source`, `voice_confidence`. **Немає** `attachments` поля. AttachDrawer chips emit selection → `pendingAttachments` state → у `handleSend` (ChatWindow.tsx) шлются у `sendMessage()` chatStore, **але SendMessageRequest їх ігнорує**. Backend ніколи не бачить чипи. Немає `/chat/upload` endpoint, немає multipart, немає image-to-Gemini-multimodal pipeline.
- `src/frontend/src/components/chat/AttachDrawer.tsx:32-88` — кнопки `file/screenshot/recall/code/sandbox` тільки emit `{kind, hint}` callback. Жодна з них не triggers file picker, screen capture, getUserMedia, або chromadb recall. Це UI-stub з Day-4.
- `chat_pipeline.py:150` — `tool_scene = (dispatch_result.get("result") or {}).get("scene")` — сцени промотуються тільки коли side-effect tool явно повертає `scene` field. Юзер каже "сцени не з'являються" — або prompt не штовхає AI до тих side-effect tools, або timer/alarm/calendar dispatchers не заповнюють `scene` field.

---

## Recommended Approach

Розкласти на 4 атомарні commits (atomic per CLAUDE.md). Кожен — самодостатній, тестований, одна тема.

### Commit 1 — `phase-27-a` Widget Engine Wired (Backend)

**Мета:** AI знову може повертати widget (chart/map/code/terminal/metrics/diagram/mixed) — не як hidden dead code, а як perma-доступний інструмент.

**Файли:**
- `src/backend/ai/chat_pipeline.py` — об'єднати каталог. Замість `tools = _filter_safe_tools()` зробити `tools = _filter_safe_tools() + RESPONSE_FORM_TOOLS`. Імпорт із `ai.response_formatter`.
- `src/backend/ai/chat_pipeline.py` — у Step 3 dispatch перевірити: якщо `tool_choice.tool_name` починається на `respond_` — **skip** chat_dispatcher, **skip** Step 5 (final LLM call), **повернути одразу** `AIResponse` з `response_form` мапленим через `_FORM_MAP` (response_formatter.py:230) + attachments побудовані з tool args. Це усуває зайвий LLM round-trip для widget.
- `src/backend/ai/response_formatter.py:19` — додати `respond_text` до catalog (зараз тільки в `_FORM_MAP`, дрейф).
- `src/backend/ai/prompt_builder.py` — у системний промпт додати 3-рядкову інструкцію "Default to widget when data is structured: use respond_chart for trends, respond_map for places, respond_metrics for KPIs, respond_terminal for command output. Only fall back to respond_text for short conversational replies." Цей tone push виключає "model never picks widget" патологію.
- `src/backend/ai/chat_tool_dispatcher.py` — для timer/alarm/calendar dispatchers перевірити та додати `scene` field у result (або вже там — підтвердити тестом). Юзер каже "сцени не з'являються" — це або промпт-рівень (commit 1 patch вище це фіксить), або dispatcher-рівень.

**Тести:**
- `tests/backend/test_chat_pipeline_widgets.py` (новий) — assert що `respond_chart` у offered tools, що pipeline повертає `response_form="chart"` коли AI вибрав tool, що skip Step 5 не робить зайвий LLM call.
- `tests/backend/test_response_formatter.py` — assert `respond_text` в catalog.

### Commit 2 — `phase-27-b` Attachments Pipeline (Backend + Frontend)

**Мета:** End-to-end робочі attachments — file upload, screenshot, paste image, recall.

**Backend:**
- `src/backend/api/routes_chat.py` — новий endpoint `POST /chat/attach` (multipart): приймає `kind` (file|screenshot|image), `blob`, `session_id`. Зберігає у `data/chat_attachments/<session_id>/<uuid>.<ext>` (existing pattern для voice — voice_pipeline robotest зберігає у `data/`). Повертає `{attachment_id, kind, mime, size, preview_url}`.
- `src/backend/api/routes_chat.py:39` — додати `attachments: list[ChatAttachmentRef]` field у `SendMessageRequest`. `ChatAttachmentRef = {attachment_id, kind, hint?}`.
- `src/backend/ai/prompt_builder.py` — якщо `req.attachments` містить `kind="image"` — конвертувати у Gemini multimodal parts (`google-genai` SDK: `Part.from_bytes(data, mime)`). Для `kind="file"` text/markdown/code — додати у prompt `<attachment name="...">\n{content}\n</attachment>`. Для recall — викликати `chroma_db.query()` і inline relevant facts.
- `src/backend/ai/gemini_provider.py` — extend `generate()` сигнатуру щоб приймати `parts: list[Part]` поряд з text. Ollama provider не має vision на Gemma — або skip із warning, або downgrade до text-only fallback.
- `src/backend/db/models.py:88 ChatMessage` — `attachments_json` вже є (line 98). Зберігати ChatAttachmentRef[] туди.
- `src/backend/vision/screen_capture.py` — якщо існує — wired у новий tool `screen_capture_now` що повертає attachment_id готовий до prompt. Inline у chat_tool_dispatcher як whitelist tool.

**Frontend:**
- `src/frontend/src/components/chat/AttachDrawer.tsx:91` — замінити stub-callback на робочий handler:
  - `kind="file"` → `<input type="file" />` programmatic click → `onChange` → POST /chat/attach → push до `pendingAttachments`.
  - `kind="screenshot"` → `navigator.mediaDevices.getDisplayMedia()` → canvas.toBlob() → POST /chat/attach.
  - `kind="image"` (новий) → camera via `getUserMedia({video: true})` → snapshot.
  - `kind="recall"` → відкриває mini-input, query → POST /chat/attach або direct chromadb через safe tool.
  - `kind="code"` → відкриває inline textarea-modal, paste code → POST /chat/attach (text/code mime).
  - `kind="sandbox"` → лишається як trigger для terminal scene (вже працює через respond_terminal).
- `src/frontend/src/components/chat/ChatWindow.tsx` — paste-image listener на textarea: `onPaste` → check clipboard items, якщо image → POST /chat/attach → push chip. Drag-drop файлу теж: `onDragOver`/`onDrop` на messages list area.
- `src/frontend/src/stores/chatStore.ts` — у `sendMessage` payload додати `attachments` array з server-returned `attachment_id`s.

**Тести:**
- `tests/backend/test_chat_attach_endpoint.py` — multipart upload, file size cap, mime whitelist, 401 без auth.
- `tests/backend/test_chat_multimodal_prompt.py` — assert що image attachment з'являється у Gemini parts.
- `tests/frontend/AttachDrawer.test.tsx` — assert що file picker triggers, screenshot triggers `getDisplayMedia`.

### Commit 3 — `phase-27-c` Compact Layout (Frontend)

**Мета:** Прибрати space hogs. Чат на 692×600 має ВЕСЬ цей простір віддавати повідомленням, не chrome.

**Зміни у `ChatWindow.tsx`:**

- **Sessions sidebar (260px) → overlay drawer.** Замість inline `flex` panel рендерити як `position: absolute; inset: 0; backdrop-blur` overlay який слайдиться з лівого краю при `sessionsOpen`. Закривається при кліку на backdrop або кнопку close. Звільняє ~260px ширини коли закритий.
  - Реалізація: видалити `<aside className="...w-[260px]...">` (line ~358), замість нього `<motion.div>` AnimatePresence overlay поверх messages list з `transform: translateX`.
- **Header 52px → 32px.** Видалити micro-label "CURRENT SESSION", лишити тільки session summary (compact 11px font) + compact "+ New" icon-button. Висота → 32px.
- **ModelCard вище input → kill.** Видалити `<ModelCard />` рендер. Provider info лишається тільки в bubble metadata (вже є). Якщо потрібен глобальний живий індикатор — він уже у StatusBar (top of screen).

**Acceptance:**
- Closed-sessions state: messages list = ~520px height (з 600 - 32 header - 48 input rail).
- Open-sessions: overlay не "пуш" контент, не reflow, instant slide.
- Bubbles ширші — `max-width: 85%` від тепер ~644px replacement-width.

### Commit 4 — `phase-27-d` Dedup (Frontend)

**Мета:** Одна семантична дія = одна кнопка / одне місце.

**Зміни:**

- **Sessions toggle**: видалити input-rail Menu-кнопку (ChatWindow.tsx:925-942). Header-кнопка лишається — вона завжди видима (overlay не приховує header), і там же контекст ("який зараз session"). Користувач не плутається.
- **Mic vs Voice always-on**: переробити семантику:
  - Mic-кнопка у input rail → toggles **always-on listening** (не push-to-talk). Tap once → mic active (always listening для wake-word + free-speech). Tap again → mute.
  - VoiceAlwaysOnGate `<VoiceAlwaysOnGate />` — видалити з DialogueLayout. Його стан і UI індикатор (LED-точка) переносимо у саму mic-кнопку (border glow + icon swap). Один UI, один стан.
  - Якщо є use-case для PTT — лишити long-press на mic-кнопці як alternate (обмежено до сесії, відпустив = stop). Без окремої кнопки.
- **Provider info**: видалити з StatusBar (якщо там показується ModelCard equivalent). Лишити тільки у bubble metadata "gemini · 1.2s · 412t". ModelCard вже видалено у commit 3.
- **AttachDrawer кнопок 5 → 4**: kill `kind="recall"` як окрему кнопку — інтегрувати у `code` (paste з clipboard вже recall-equivalent для контексту), або у `+` menu під dropdown. AttachDrawer стає [file, screenshot, camera, code]. 4 чітких kinds, кожен робочий.

**Acceptance:**
- `grep -n "setSessionsOpen" ChatWindow.tsx` → тільки 1 onClick.
- Voice always-on gate — видалено з `DialogueLayout.tsx` import.
- Mic-кнопка має чіткий стан: idle (subtle), listening (accent glow + Mic icon), muted (red dot + MicOff).
- Жоден файл не імпортує `ModelCard`.

---

## Critical Files

### Backend
- `src/backend/ai/chat_pipeline.py` — tool catalog merge + skip-Step-5 для widget tools (commit 1).
- `src/backend/ai/response_formatter.py` — `respond_text` додати в catalog (commit 1).
- `src/backend/ai/prompt_builder.py` — widget-default guidance + multimodal parts (commits 1 + 2).
- `src/backend/ai/chat_tool_dispatcher.py` — verify scene field у timer/alarm/calendar (commit 1).
- `src/backend/api/routes_chat.py` — нова `/chat/attach` endpoint + extend SendMessageRequest (commit 2).
- `src/backend/ai/gemini_provider.py` — multimodal parts support (commit 2).
- `src/backend/vision/screen_capture.py` (якщо є) — wire як whitelist chat tool (commit 2).

### Frontend
- `src/frontend/src/components/chat/ChatWindow.tsx` — sidebar overlay, header trim, kill ModelCard, dedup buttons (commits 3, 4).
- `src/frontend/src/components/chat/AttachDrawer.tsx` — реальні handlers (commit 2), 5→4 kinds (commit 4).
- `src/frontend/src/components/chat/ModelCard.tsx` — DELETE (commit 3).
- `src/frontend/src/components/chat/VoiceAlwaysOnGate.tsx` — DELETE або значно скоротити, поглинаючи логіку у mic-кнопку (commit 4).
- `src/frontend/src/stores/chatStore.ts` — `sendMessage` payload з attachment_ids (commit 2).
- `src/frontend/src/layouts/DialogueLayout.tsx` — видалити VoiceAlwaysOnGate import (commit 4).

### Reuse (НЕ створювати дублі)
- `RESPONSE_FORM_TOOLS` уже визначено — не переписувати, тільки wire (commit 1).
- `_FORM_MAP` (response_formatter.py:230) — використати для `tool_name → response_form` мапу (commit 1).
- `chat_tool_dispatcher.dispatch` — лишити для side-effect tools, тільки оминути для `respond_*` (commit 1).
- `data/` directory pattern існує (voice_pipeline) — переюзати для chat_attachments (commit 2).
- `ChatAttachment` interface (shared/types/chat.ts:511) — extend з `attachment_id` field, не створювати новий тип.
- `MessageBubble` metadata block (gemini · 1.2s · 412t) — keep, це канонічне місце для provider info (commit 3).

---

## Verification

### Per-commit gate
1. **Commit 1** (widgets backend):
   - `cd src/backend && pytest tests/test_chat_pipeline_widgets.py tests/test_response_formatter.py -v` → all green.
   - Manual: `curl POST /chat/message {"content":"show me sensor metrics as cards"}` → response має `response_form="metric_cards"` + attachments[0].type="metric_card".
   - `curl POST /chat/message {"content":"set timer for 5 min"}` → response має scene з kind="timer-control".

2. **Commit 2** (attachments):
   - `cd src/backend && pytest tests/test_chat_attach_endpoint.py tests/test_chat_multimodal_prompt.py -v` → green.
   - Manual: paste image у chat textarea → chip з'являється → send → AI описує що на фото (Gemini vision).
   - File upload .txt → AI цитує його зміст у відповіді.
   - Screenshot button → screen capture → chip → AI бачить.

3. **Commit 3** (compact):
   - `cd src/frontend && npx vitest run components/chat/ChatWindow` → green.
   - Manual: open DialogueLayout у dev → measure ChatWindow inner regions: header ≤ 32px, no ModelCard band, sessions overlay, не reflow.

4. **Commit 4** (dedup):
   - `grep -c "setSessionsOpen" src/frontend/src/components/chat/ChatWindow.tsx` → exactly 1 match for `onClick`.
   - `grep -rn "VoiceAlwaysOnGate" src/frontend/` → only definition file (or 0 if deleted).
   - Manual: tap mic-кнопка → always-on activates з glow; tap again → mute. No other voice control on screen.

### End-to-end smoke (на Radxa target hardware)
1. Boot, login, sit у DIALOGUE state.
2. Кажу "покажи погоду цифрами" → bubbles з'являється з `metric_cards` widget (3 KPI картки), не суцільний text.
3. Paste screenshot у textarea → AI описує що бачить.
4. "запусти таймер 2 хвилини" → TimerScene scene з'являється inline.
5. Drag .txt файл у chat → AI відповідає по змісту.
6. Tap menu icon → sessions overlay, click on old session → overlay closes, history loads, no reflow.
7. Тільки одна кнопка mic, тільки одна кнопка sessions, тільки одне місце де видно "gemini · 412t".

### Regression
- `cd src/backend && pytest -x` — всі існуючі тести green (chat-suite має бути untouched, бо ми тільки розширили behaviour).
- `cd src/frontend && npx vitest run` — green.
- Воно ж 154 backend / X frontend (поточний baseline з handoff) — не падати.

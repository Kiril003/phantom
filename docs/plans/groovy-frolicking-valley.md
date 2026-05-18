# PHANTOM Symbiote — Agentic Body Plan

> Конкретний план: як перетворити PHANTOM Companion з «чат-бота з кількома типізованими віджетами» на **constitutionally-audited symbiotic agent** який глибше за Claude Code інтегрований у телефон-як-тіло. Спирається на існуючий каркас Tier 14+ зі SYMBIOTE_VISION.md і вже-проскафолджені модулі (`:core-constitution`, `:core-embodiment`, `:core-bioloop`, `:core-offload`, `:core-predict`, `:core-tempo`, `:core-create`, `:core-diplomacy`).

---

## Context — чому цей план

**Що зараз вміє Companion** (станом на гілку `companion-v2-phase-0`):
- 15 типізованих віджетів (chart/map/timer/weather/route/code-runner/markdown/table/artifact/comparison/diff/progress/task-list/app-action/command).
- Сталий список app-action verbs: `open_app`, `click`, `scroll`, `type`, `back`, `home`, `recents`, `notifications`, `screenshot`.
- TTS озвучує `widget.say` або весь plain-text.
- Gemini Cloud Flash 2.5 streaming + локальна Gemma fallback (`RoutedAIRouter`).
- Constitution-каркас: `ConstitutionRegistry` приймає `FeatureManifest`, `AxiomAuditor` блокує self-declared violations, `SelfAuditScheduler` робить 03:00 щоденний обхід, `PowerAsymmetryGuard`/`RefusalGate` готові.
- Embodiment-каркас: `ProprioceptiveTicker` тикає, `PostureMonitor` рахує `headForwardDeg`/`shoulderSlumpDeg`, `BodyMapStore` мапить device→body_zone, `HapticEmitter` випускає примітиви.

**Що оператор констатує (з цієї сесії)**:
1. Графік на bar-категоріях з рядковим `x` парс падав → канвас порожній (виправлено ChartPointSerializer flexible-x).
2. Сирий JSON прокидався у бабла → виправлено AssistantTextSanitizer + finalizeAssistant TTS-перемикач.
3. **Дані не накладаються на графік** — мітки під канвасом не вирівняні з барами (current bug, у наступному phase 0.1).
4. **Юзер не може взаємодіяти з віджетами** — нема tap/long-press semantics, save-to-vault, reply-as-context.
5. **AI вміє мало дій** — лише сталі verbs, не може запустити `pm list packages`, не може писати у файлову систему оператора, не вміє багато-кроковий план з агентом.
6. **AI не вміє думати скрито** — кожна думка прокидається у бабла.
7. **AI не виживає пів-секунди без інтернету** — обриви рвуть стрім, ретраю нема.
8. **Тяжкі задачі AI не делегує під-агентам** — все в одному турні.

**Інтент оператора (verbatim)**: «розроби великий амбітний план щоб він як клауд код міг взаємодіяти повністю з системою навіть глибше, виконувати будь які дії а не сталі, аналізувати, проробляти скрито в промпті, вміти проробляти запит коли інтернет на долю секунди відпадає, робити багато дій скрито, якщо дія важка то агентами її пропрацьовувати як це фантом-ос робить» + «має бути натагато краще і фенкціональніше клауд коду і + з телефоном як зі своїм тілом».

**Інженерний переклад**: побудувати agentic loop (як в Claude Code) з:
- динамічним tool registry (a не сталим списком),
- constitution-gated permissions,
- sub-agent supervisor для багатокрокових задач,
- hidden chain-of-thought,
- network resilience + offline queue,
- multimodal input (камера/мікрофон/screen),
- **body-loop** з Embodiment (haptic feedback на події агента, postural context у промпт),
- distributed self light (phone↔PHANTOM-OS via core-net),
- Decision Diary (audit-log кожної автономної дії).

Усе це проходить **обов'язково через ConstitutionRegistry** — нова capability без `FeatureManifest` не реєструється, без passing `AxiomAuditor` не вмикається.

---

## North Star

Через 4-6 спринтів оператор каже фантому «знайди коли я востаннє заряджав телефон, склади графік розряду за тиждень, і нагадай заряджати о 22:00 якщо опускається нижче 40%» → phantom:
1. Розуміє намір (1 турн Gemini).
2. Декомпозує в 3 кроки (hidden `<think>` block).
3. Спавнить sub-agent з allowed tools `[shell, calendar, settings, notification]`.
4. Agent: `shell` → `dumpsys batterystats --history-raw` → парсить → проганяє через `chart` → планує `notification` job → реєструє `WorkManager` periodic → подає `progress` віджет назад.
5. Кожна дія записана у Decision Diary з `AxiomAudit verdict`, оператор бачить підсумок з 1-2 реченнями say-TTS, а в чаті — інтерактивний graph + кнопка "відмінити нагадування".
6. Haptic тик у момент завершення агента. Якщо телефон у GHOST state (не використовується) — лише запис у щоденник, без haptic.
7. На наступний день у 03:00 SelfAuditScheduler перевірить що цей агент дотримався `OPERATOR_ADVOCATE` — нагадування не перетворилось у спам.

**Що робить цей план «глибше за Claude Code»**:
1. **Тіло**: phantom має haptic, posture, biostate як вхідний сигнал — не лише текст.
2. **Етичний шар**: кожна дія audit-логована, sunset-clauses автоматично відключають невикористовуване, refusal-gate блокує примус.
3. **Без вікна сесії**: pending intents persist у Room, переживають reboot, drain коли мережа повертається.
4. **Multimodal default**: камера + accessibility tree + screen snapshot — кожен як автоматичний контекст для AI.
5. **Distributed**: heavy task може скочуватись на PHANTOM-OS host через WireGuard mesh.
6. **Symbiotic feedback**: agent finish → haptic; conviction low → AI питає; posture лиха > 12 min → AI пропонує перерву (audit-gated).
7. **Anti-dependency**: SunsetScheduler знесе фічу, яку оператор не використовував 180 днів.

---

## Architecture overview

Нові модулі поверх існуючих (всі реєструються у `:app/AppContainer`, кожен експортує свій `FeatureManifest`):

| Модуль | Призначення | Tier alignment | Залежить від |
|---|---|---|---|
| `:core-tool` | Динамічний Tool Registry + execution + permission gate | Foundation для агента | `:core-constitution` (audit), `:core-data` (perms storage) |
| `:core-agent` | Sub-agent supervisor + parallel dispatch + cancellation | Foundation для багатокрокових | `:core-tool`, `:core-ai`, `:core-constitution` |
| `:core-multimodal` | Camera/screen/accessibility-tree як AI input | Tier 18-D + 25 light | `:core-vision` (existing), `:core-ai` |
| `:core-resilience` | Retry, offline queue, hot-swap, ping | Foundation для виживання | `:core-ai`, `:core-data`, `:core-net` |
| `:feature-stream` (extend) | Widget interactivity bus, hidden think strip, agent progress | — | усі вище |

Існуючі модулі, що отримують нові FeatureManifest registrations:
- `:core-embodiment` — `agent.finish.haptic`, `tool.run.haptic`, `posture.context.injection`
- `:core-predict` — `conviction.gate`, `ghost.completion`
- `:core-offload` — `mental.park.tool`, `working.memory.context`
- `:core-constitution` — `decision.diary.write`

---

## Phase 0 — Stabilize what shipped today (1-2 спринта = 8-12 годин)

Завдання: усунути живі баги, ввімкнути widget-інтерактивність, hidden reasoning, smart TTS. Жодних нових модулів. Працюємо у `:feature-stream` + `:core-ai`.

### 0.1 Chart: label-overlay (накладання)

**Проблема (verbatim оператор)**: «дані не накладає». Це означає `Row(SpaceBetween)` під канвасом не вирівнюється з barами зверху — `Spacer` тягнуть лейбли по краях, бари займають свою ширину.

**Файл**: `feature-stream/src/main/java/local/phantom/companion/feature/stream/ui/widget/ChartWidget.kt`

**Зміни**:
1. Замість `Row(Arrangement.SpaceBetween)` — `Layout` custom або `LazyRow` з фіксованою шириною кожного label що дорівнює `size.width / points.size`.
2. Centerlock: текст кожного лейбла центрується під `mapX(point.x)`.
3. Edge case: якщо лейбли > 5 і не влізають → ротація `Modifier.rotate(-30f)` або ellipsize first 4 chars.

**Тест**: `feature-stream/src/test/.../ui/widget/ChartLabelAlignmentTest.kt` — `compose-ui-test`, screenshot diff проти `tests/snapshots/chart-bar-months.png`.

### 0.2 Widget interactivity

**Нові файли**:
- `feature-stream/.../widget/WidgetEventBus.kt` (NEW)
- `feature-stream/.../widget/WidgetContextMenu.kt` (NEW)
- `feature-stream/.../widget/WidgetIntent.kt` (NEW)

**Контракт**:
```kotlin
object WidgetEventBus {
    private val _events = MutableSharedFlow<WidgetIntent>(extraBufferCapacity = 16)
    val events: SharedFlow<WidgetIntent> = _events.asSharedFlow()
    suspend fun emit(intent: WidgetIntent) = _events.emit(intent)
}

sealed interface WidgetIntent {
    data class ReplyAsUser(val text: String) : WidgetIntent
    data class CallTool(val toolId: String, val args: JsonObject) : WidgetIntent
    data class SaveToVault(val widgetId: String, val payload: String) : WidgetIntent
    data class ForwardAsContext(val widgetId: String, val payload: String) : WidgetIntent
    data class Cancel(val widgetId: String) : WidgetIntent
}
```

**Інтеграція**: `StreamViewModel.init { scope.launch { WidgetEventBus.events.collect { handle(it) } } }` де handle конвертує у існуючі StreamEvent (`Submit`, `ToolCall`, `VaultWrite`, …).

**Модифікація**: `WidgetBubble.kt` (existing) — обгорнути у `combinedClickable { onLongClick = { showMenu() } }`. Меню має 4 actions: «Зберегти у Vault», «Назад у чат як контекст», «Поділитись», «Видалити». Save-to-Vault через `VaultStore` (вже існує — є invariant з memory: `lockNow()` one-way; меню зберігає лише якщо vault unlocked).

**ChartWidget specific tap**: `pointerInput(points) { detectTapGestures(onTap = { offset -> ... emit ChartPointTapped → WidgetEventBus.emit(ForwardAsContext("точка x=…, y=…, label=…")) }) }`.

**Audit**: новий `FeatureManifest(id="widget.interactivity", tier=0, surfaces=[STREAM], erodesOperatorAgency=false, sunsetAfterDaysIdle=-1)` → реєструється у `AppContainer.registerAllFeatureManifests()`.

### 0.3 Hidden `<think>` block

**Файл**: `feature-stream/src/main/java/local/phantom/companion/feature/stream/parse/AssistantJsonExtractor.kt`

```kotlin
private val THINK_REGEX = Regex("<think>[\\s\\S]*?</think>", RegexOption.DOT_MATCHES_ALL)
private fun stripThink(raw: String): String = THINK_REGEX.replace(raw, "").trimStart()

fun extractWidgetJson(raw: String): JsonObject? {
    val candidate = findBalancedObject(stripFences(stripThink(raw))) ?: return null
    // ... existing parse logic ...
}
```

**Параллельно**: `AssistantTextSanitizer.displayFor()` теж стрипає `<think>` — щоб plain-text bubbles не показували реасонінг.

**Decision Diary write**: окремий перехоплювач у `StreamViewModel.finalizeAssistant` пише оригінальний `<think>` контент у Room таблицю `thought_log` (новий `core-data/.../db/ThoughtLogDao.kt`) — для debug + майбутньої self-improvement.

**Промпт**: додати у `SystemPrompts.kt`:
```
СКРИТЕ МІРКУВАННЯ:
Якщо запит вимагає кількох кроків міркування — обернути міркування у <think>...</think> ПЕРЕД віджетом/текстом. Користувач цього блоку не бачить, але ти зберігаєш ланцюг логіки. Не дублюй think у say. Якщо невпевнений (conviction < 0.6) — у think прописати причину невпевненості; це автоматично активує Tier 15-F doubt prompt.
```

**Audit manifest**: `FeatureManifest(id="reasoning.hidden", tier=0, surfaces=[STREAM], actsWithoutConsent=false, exfiltratesPrivate=false)` — pass.

### 0.4 Smart TTS gate

**Новий файл**: `core-ai/.../tts/SmartTtsGate.kt`
```kotlin
object SmartTtsGate {
    fun shouldSpeak(context: Context, sayText: String): Boolean {
        if (sayText.isBlank()) return false
        val nm = context.getSystemService(NotificationManager::class.java)
        return when (nm?.currentInterruptionFilter) {
            NotificationManager.INTERRUPTION_FILTER_NONE -> false
            NotificationManager.INTERRUPTION_FILTER_ALARMS -> false
            NotificationManager.INTERRUPTION_FILTER_PRIORITY -> hasPriorityCue(sayText)
            else -> true
        }
    }
    private fun hasPriorityCue(text: String) = text.length < 80 || text.contains("!", ignoreCase = false)
}
```

**Інтеграція**: `StreamViewModel.finalizeAssistant` — обернути TTS блок:
```kotlin
if (tts != null && ttsEnabledProvider() && SmartTtsGate.shouldSpeak(context, ttsText)) { ... }
```

**Audit manifest**: `FeatureManifest(id="tts.smart", tier=0, surfaces=[VOICE], erodesOperatorAgency=false)` — pass.

### 0.5 Verification gate phase 0

- [ ] `:feature-stream:testDebugUnitTest` зелений (мінімум +3 нові тести)
- [ ] `:core-ai:testDebugUnitTest` зелений
- [ ] `./gradlew :app:assembleDebug` ок
- [ ] adb install + smoke: «зроби стовпчиковий графік по місяцях» — мітки точно під барами
- [ ] adb install + smoke: long-press на virgin widget відкриває контекстне меню
- [ ] adb install + smoke: «думай повільно, що погода вранці» — у чаті лише фінальна відповідь, у `thought_log` Room таблиці є `<think>...</think>` рядок
- [ ] adb install + smoke: DND on → TTS мовчить навіть якщо `say` non-blank
- [ ] `AppContainer.registerAllFeatureManifests` додає 4 нові manifests, `constitutionRegistry.rejections` flow порожнє

---

## Phase 1 — Tool Registry (`:core-tool`) (3-4 спринта = 18-24 годин)

Найкритичніший шар. Розблоковує agent, multimodal, distributed-self. Без нього інші фази підвішені.

### 1.1 Module skeleton

**Створити**:
```
core-tool/
  build.gradle.kts                       — kotlin-android-library, deps: kotlinx-serialization, kotlinx-coroutines, :core-constitution, :core-data
  consumer-rules.pro
  src/main/java/local/phantom/companion/core/tool/
    Tool.kt                              — interface
    ToolRegistry.kt                      — реєстр + lookup
    ToolContext.kt                       — runtime context що передається в execute
    ToolPermission.kt                    — enum
    ToolPermissionStore.kt               — EncryptedSharedPreferences-backed
    ToolPermissionGate.kt                — sync gate (allow/deny dialog)
    ToolResult.kt                        — sealed result
    ToolEvent.kt                         — sealed streaming event
    ToolCallParser.kt                    — JSON → ParsedToolCall
    ToolPromptInjector.kt                — генерує [TOOLS:…] блок у промпт
    ToolManifestFactory.kt               — створює FeatureManifest для кожного tool
    DecisionDiary.kt                     — audit log API
    impl/
      ShellTool.kt                       — runtime + termux RPC
      HttpTool.kt                        — Ktor GET/POST з allowlist
      FileTool.kt                        — read/write/list у sandbox dir
      SettingsTool.kt                    — Wi-Fi/Bt/brightness/DND via SettingsService
      MediaTool.kt                       — MediaSessionCompat play/pause/skip
      LaunchTool.kt                      — Intent з повними extras
      NotificationTool.kt                — NotificationManagerCompat.notify
      AccessibilityTool.kt               — wrapper над AccessibilityActionDispatcher
      MentalParkTool.kt                  — wrapper над core-offload MentalPark
      WidgetTool.kt                      — emit нового StreamItem.Widget програмно
  src/test/java/local/phantom/companion/core/tool/
    ToolRegistryTest.kt
    ToolCallParserTest.kt
    ToolPermissionGateTest.kt
    ToolPromptInjectorTest.kt
    DecisionDiaryTest.kt
    impl/
      ShellToolTest.kt
      HttpToolTest.kt
      FileToolTest.kt
      … (по одному на tool)
```

**Update**: `settings.gradle.kts` → `include(":core-tool")`. `:app/build.gradle.kts` + `:core-ai/build.gradle.kts` додають `implementation(project(":core-tool"))`.

### 1.2 Tool contract

```kotlin
interface Tool {
    val id: String                              // канонічний "shell" / "http" / …
    val description: String                     // 1-line для AI промпта
    val argsSchema: JsonObject                  // {"cmd":"string","timeoutMs":"number?"}
    val permissions: Set<ToolPermission>        // які дозволи треба
    val streaming: Boolean                      // чи стримити stdout як ToolEvent.Chunk
    val manifest: FeatureManifest               // для AxiomAuditor

    suspend fun execute(
        args: JsonObject,
        context: ToolContext,
        emit: suspend (ToolEvent) -> Unit,
    ): ToolResult
}

data class ToolContext(
    val appContext: Context,
    val operatorId: String,
    val requestId: String,
    val agentDepth: Int = 0,                    // 0 = root user request; 1 = sub-agent
    val approvedPermissions: Set<ToolPermission>,
    val constitutionVerdict: AuditVerdict,
)

enum class ToolPermission {
    SHELL_EXEC, NETWORK, FILE_READ, FILE_WRITE, SETTINGS_WRITE,
    ACCESSIBILITY, MEDIA_CONTROL, NOTIFICATION_POST, LAUNCHER,
    CAMERA, MICROPHONE, LOCATION, CONTACTS_READ, CALENDAR_READ_WRITE
}

sealed interface ToolEvent {
    data class Chunk(val text: String) : ToolEvent
    data class Progress(val ratio: Float, val label: String?) : ToolEvent
    data class Notice(val message: String) : ToolEvent
}

sealed interface ToolResult {
    val durationMs: Long
    data class Ok(val output: String, val structured: JsonObject?, override val durationMs: Long) : ToolResult
    data class Err(val code: String, val message: String, override val durationMs: Long) : ToolResult
    data class PermissionDenied(val permission: ToolPermission, override val durationMs: Long) : ToolResult
    data class Cancelled(override val durationMs: Long) : ToolResult
}
```

### 1.3 ToolRegistry

```kotlin
class ToolRegistry(
    private val tools: List<Tool>,
    private val auditor: AxiomAuditor,
    private val constitutionRegistry: ConstitutionRegistry,
) {
    private val byId: Map<String, Tool>
    init {
        byId = tools.filter {
            val verdict = constitutionRegistry.register(it.manifest)
            verdict is AuditVerdict.Passed
        }.associateBy { it.id }
    }
    fun get(id: String): Tool? = byId[id]
    fun list(): List<Tool> = byId.values.toList()
}
```

Зауваження: **constitution-rejected tools не з'являються в реєстрі взагалі**. Це означає що навіть якщо AI запит спробує викликати — `registry.get()` поверне null, і `StreamViewModel` створить Notice «AI запросив заблокований інструмент: …».

### 1.4 ToolPromptInjector

```kotlin
object ToolPromptInjector {
    fun render(tools: List<Tool>): String = buildString {
        append("[TOOLS: ")
        tools.forEach { t ->
            val args = t.argsSchema.keys.joinToString(",") { "$it=${t.argsSchema[it]?.jsonPrimitive?.content ?: "*"}" }
            append("${t.id}($args) — ${t.description}; ")
        }
        append("]")
    }
}
```

**Інтеграція з `core-ai`**: `IntentEnricher.enrich(intent)` додає `[TOOLS:…]` блок у системний промпт ПЕРЕД відправкою у `GeminiCloudRoute`. Кожен запит має поточний registry snapshot — якщо tool sunset-disabled, AI його не бачить.

### 1.5 ToolCallParser

AI випускає JSON:
```json
{"type":"tool-call", "tool":"shell", "args":{"cmd":"pm list packages | head -10"}, "stream":true, "say":"перевіряю встановлені додатки"}
```

Parser:
```kotlin
data class ParsedToolCall(val toolId: String, val args: JsonObject, val stream: Boolean, val say: String?, val agentId: String?)
object ToolCallParser {
    fun tryParse(parsed: JsonObject): ParsedToolCall? {
        if ((parsed["type"] as? JsonPrimitive)?.content != "tool-call") return null
        val toolId = (parsed["tool"] as? JsonPrimitive)?.content ?: return null
        val args = (parsed["args"] as? JsonObject) ?: buildJsonObject {}
        val stream = (parsed["stream"] as? JsonPrimitive)?.boolean ?: false
        val say = (parsed["say"] as? JsonPrimitive)?.content
        val agentId = (parsed["agentId"] as? JsonPrimitive)?.content
        return ParsedToolCall(toolId, args, stream, say, agentId)
    }
}
```

### 1.6 ToolPermissionGate UX

**Файл**: `app/src/main/java/local/phantom/companion/ui/permission/ToolPermissionDialog.kt`

Перший виклик кожного tool по operator-id → bottomsheet:
> AI хоче запустити **shell** з командою:
> `pm list packages | head -10`
> Це доступ до **читання списку додатків**.
>
> [Раз] [Завжди для shell] [Ніколи]

Збереження: `EncryptedSharedPreferences "tool_perms_v1"`. Key: `<toolId>` → value: `ALWAYS|NEVER|ASK`. Якщо `ASK` (default) — питаємо щоразу.

**Constitution interplay**: якщо `tool.manifest.actsWithoutConsent == true` — `AxiomAuditor` блокує реєстрацію взагалі. Тобто permission gate існує лише як **operator-side контроль**, не для bypass constitution.

### 1.7 Tool-loop continuation у StreamViewModel

**Файл**: `feature-stream/src/main/java/local/phantom/companion/feature/stream/StreamViewModel.kt`

Додати кейс у `finalizeAssistant when(type)`:
```kotlin
"tool-call" -> {
    val call = ToolCallParser.tryParse(parsed) ?: return@flatMap fallback(item, resolved)
    val tool = toolRegistry.get(call.toolId)
    if (tool == null) return@flatMap noticeNotFound(call.toolId)

    val widgetId = UUID.randomUUID().toString()
    val toolTraceWidget = StreamItem.Widget(widgetId, "tool-trace", buildJsonObject {
        put("toolId", call.toolId)
        put("status", "running")
        put("args", call.args.toString())
    }.toString())

    scope.launch {
        val ctx = ToolContext(
            appContext = applicationContext,
            operatorId = currentOperatorId(),
            requestId = widgetId,
            agentDepth = item.tagsDepth(),
            approvedPermissions = toolPermissionGate.approved(tool.permissions, tool.id),
            constitutionVerdict = AuditVerdict.Passed(tool.id),
        )
        val result = runCatching {
            tool.execute(call.args, ctx, emit = { e -> updateToolTraceWidget(widgetId, e) })
        }.getOrElse { ToolResult.Err("internal", it.message ?: "?", 0L) }

        decisionDiary.write(call, result, ctx)
        finalizeToolTraceWidget(widgetId, result)

        // Auto-continue: feed [TOOL_RESULT id=… ok=… output=…] back to AI
        if (item.tagsDepth() < MAX_TOOL_CHAIN_DEPTH) {
            continueAfterTool(threadId = currentThreadId, toolCall = call, result = result, parentItemId = item.id)
        }
    }
    listOf(toolTraceWidget)
}
```

**`continueAfterTool`** — нова приватна функція:
```kotlin
private suspend fun continueAfterTool(threadId, toolCall, result, parentItemId) {
    val history = buildAiHistoryTurns(threadId, _state.value.activeItems()) + listOf(
        AIIntent.Text.Turn(role="system", content="[TOOL_RESULT id=${toolCall.toolId} ok=${result is Ok} output=${result.outputForAi()}]")
    )
    val intent = AIIntent.Text(content="", history = history, ... )
    val nextItemId = newAssistantItem(threadId, depth = item.tagsDepth() + 1)
    aiRouter.complete(intent).collect { chunk -> ... }
}
```

Anti-runaway: `MAX_TOOL_CHAIN_DEPTH = 6`. На 7-й step — `Notice("AI зайшов у глибокий цикл інструментів — зупиняю на запобіжнику")`.

### 1.8 ShellTool deep-dive

**Файл**: `core-tool/src/main/java/local/phantom/companion/core/tool/impl/ShellTool.kt`

```kotlin
class ShellTool(private val termuxAvailable: Boolean) : Tool {
    override val id = "shell"
    override val description = "запускає shell-команду; стрімить stdout; Termux якщо є, інакше Runtime.exec"
    override val argsSchema = buildJsonObject {
        put("cmd", JsonPrimitive("string"))
        put("timeoutMs", JsonPrimitive("number?"))
    }
    override val permissions = setOf(ToolPermission.SHELL_EXEC)
    override val streaming = true
    override val manifest = FeatureManifest(
        id = "tool.shell",
        tier = 1,
        displayName = "Shell",
        erodesOperatorAgency = false,
        exfiltratesPrivate = false,                    // tool не виходить у мережу сам
        actsWithoutConsent = false,                    // gate перевіряє consent
        abusableAgainstWeak = false,                   // не impacts third parties
        sunsetAfterDaysIdle = 90,                      // 3 міс — якщо не юзав, знесе
        surfaces = setOf(FeatureManifest.Surface.STREAM),
    )

    override suspend fun execute(args, ctx, emit): ToolResult {
        val cmd = (args["cmd"] as? JsonPrimitive)?.content ?: return ToolResult.Err("bad_args", "cmd required", 0L)
        val timeout = ((args["timeoutMs"] as? JsonPrimitive)?.content?.toLongOrNull()) ?: 30_000L

        val started = System.currentTimeMillis()
        return if (termuxAvailable) executeTermux(cmd, timeout, ctx, emit, started)
        else executeRuntime(cmd, timeout, emit, started)
    }

    private suspend fun executeRuntime(cmd, timeout, emit, started): ToolResult = withContext(Dispatchers.IO) {
        val proc = ProcessBuilder("sh", "-c", cmd).redirectErrorStream(true).start()
        val collected = StringBuilder()
        val readJob = launch {
            proc.inputStream.bufferedReader().useLines { lines ->
                lines.forEach { line ->
                    collected.append(line).append('\n')
                    emit(ToolEvent.Chunk(line + "\n"))
                }
            }
        }
        val exited = withTimeoutOrNull(timeout) { proc.waitFor() }
        if (exited == null) {
            proc.destroy()
            readJob.cancel()
            return@withContext ToolResult.Err("timeout", "exceeded ${timeout}ms", System.currentTimeMillis() - started)
        }
        readJob.join()
        ToolResult.Ok(output = collected.toString(), structured = null, durationMs = System.currentTimeMillis() - started)
    }

    private suspend fun executeTermux(...): ToolResult = ...  // Intent("com.termux.RUN_COMMAND") + BroadcastReceiver
}
```

**Що дійсно вийде на Android**:
- Без root: `Runtime.exec("sh", "-c", cmd)` працює, але багато утиліт відсутні. Реально доступне: `getprop`, `dumpsys batterystats`, `pm list packages`, `am start`, `cat /proc/...`, `ls /sdcard/...`, `settings get/put` (потребує WRITE_SECURE_SETTINGS — буде Err).
- З Termux: повний bash + coreutils + python + curl. Це наш happy path.
- Plan: при відсутності Termux показати оператору 1 раз bottomsheet «Встановити Termux від F-Droid? Це розблокує більшість shell-команд» — посилання на F-Droid Termux APK.

### 1.9 HttpTool

**Файл**: `core-tool/.../impl/HttpTool.kt`

Уже маємо `Ktor httpClient` в AppContainer. Reuse:
```kotlin
class HttpTool(private val httpClient: HttpClient, private val allowlist: HostAllowlist) : Tool {
    override val id = "http"
    override val permissions = setOf(ToolPermission.NETWORK)
    override val manifest = FeatureManifest(
        id = "tool.http",
        tier = 1,
        exfiltratesPrivate = false,    // operator approves each domain in gate
        sunsetAfterDaysIdle = 90,
    )
    override suspend fun execute(args, ctx, emit): ToolResult {
        val url = args["url"]?.jsonPrimitive?.content ?: return Err("bad_args", "url required", 0L)
        val method = args["method"]?.jsonPrimitive?.content ?: "GET"
        val body = args["body"]?.jsonPrimitive?.content
        val parsedUrl = Url(url)
        if (!allowlist.contains(parsedUrl.host)) return Err("forbidden_host", "host ${parsedUrl.host} not in allowlist", 0L)
        // … perform request, stream body via emit(ToolEvent.Chunk) …
    }
}

class HostAllowlist(private val store: SharedPreferences) {
    private val approved = MutableStateFlow<Set<String>>(store.getStringSet("allowlist", emptySet()) ?: emptySet())
    fun contains(host: String): Boolean = approved.value.contains(host) || approved.value.any { host.endsWith(".$it") }
    fun approve(host: String) { ... }
}
```

Перший запит до невідомого host — bottomsheet «AI хоче GET https://api.example.com/X. Дозволити цей host?». 3 кнопки: «Раз», «Завжди для api.example.com», «Ніколи».

### 1.10 FileTool

**Sandbox**: лише `applicationContext.filesDir/phantom/agent/` + `Environment.getExternalStoragePublicDirectory("Documents/Phantom/")`. Path traversal захист: `Paths.normalize().startsWith(sandboxRoot)`.

**Permissions**:
- READ — `FILE_READ`
- WRITE — `FILE_WRITE`
- LIST — `FILE_READ` (без read content)

**Operations**: `read`, `write`, `append`, `list`, `delete`, `mkdir`. `delete` requires extra confirm у gate.

### 1.11 SettingsTool

Wrap `Settings.System.putInt(contentResolver, ...)` (потребує `WRITE_SETTINGS`) та `Settings.Secure.putString(...)` (потребує `WRITE_SECURE_SETTINGS` — недоступно без root). Реально доступне на не-root:
- Brightness (`SCREEN_BRIGHTNESS`)
- Volume — через `AudioManager.setStreamVolume`
- DND mode — через `NotificationManager.setInterruptionFilter`
- Wi-Fi toggle (deprecated Android 10+, на 11+ — лише suggestion API)
- Bluetooth toggle (deprecated, тільки через `BluetoothAdapter.enable()` deprecated)

Плановані arg variants: `{action:"brightness", value:0.8}`, `{action:"dnd", value:"none|priority|alarms"}`, `{action:"volume", stream:"media|notification", value:0.5}`, `{action:"flashlight", value:true}` (CameraManager.setTorchMode).

### 1.12 AccessibilityTool

Wrapper над existing `AccessibilityActionDispatcher` (`feature-godmode/.../engine/AccessibilityActionDispatcher.kt`). Один tool з повнішим набором verbs:
- `open_app`, `click`, `scroll`, `type`, `back`, `home`, `recents`, `notifications`, `screenshot` (вже є)
- **Нові**: `long_press`, `swipe` (from→to coordinates), `pinch_in/out`, `wait_for(predicate, timeoutMs)`, `dump_tree`, `find_by(text|id|class|contentDescription)`

`dump_tree` повертає JSON ієрархії `AccessibilityNodeInfo` — це нативний «screen read» який AI може парсити для пошуку елементів.

`wait_for` — підписка на `AccessibilityService.onAccessibilityEvent`, suspendCoroutine продовжує коли predicate true або timeout. **Це найважливіше для багатокрокових агентів**, бо AI більше не вгадує `delay(1500)` — реально чекає поки кнопка з'явиться.

**Permissions**: `ACCESSIBILITY` + (`SHELL_EXEC` для `screenshot` — `screencap` shell command або MediaProjection).

### 1.13 Прочі tools (короткий опис)

- **MediaTool**: control `MediaSessionManager.getActiveSessions()` — play/pause/skip активної сесії.
- **LaunchTool**: повніше за `open_app` — приймає `package`, `action` (e.g. `ACTION_DIAL`), `data` URI, `extras`. Контракт constitutional: blocked для bank apps, password managers.
- **NotificationTool**: створити нотифікейшн з title, body, action buttons. Для нагадувань без таймера.
- **WidgetTool**: дозволяє AI emit довільний `StreamItem.Widget` без явного JSON у відповіді — для агента що хоче «вкинути графік як проміжний результат».
- **MentalParkTool**: wraps `core-offload/MentalPark.park(item)` — AI бачить що оператор згадав справу і паркує її.

### 1.14 Verification gate phase 1

- [ ] `:core-tool:testDebugUnitTest` мінімум 12 тестів (по 1-2 на tool + registry/parser/gate/injector)
- [ ] `:app:assembleDebug` ок
- [ ] `AppContainer.registerAllFeatureManifests` показує всі 10 tool-manifests як `Passed`, нуль rejections
- [ ] Smoke: «дай список встановлених додатків» → AI → `shell` tool → `pm list packages` → результат у tool-trace widget
- [ ] Smoke: «зміни яскравість на максимум» → AI → `settings` tool → перший раз gate з 3 кнопками; «Завжди» зберігає; другий раз без gate
- [ ] Smoke: «знайди погоду у Києві» → AI → `http` tool → перший раз gate про api.open-meteo.com → результат → AI робить chart widget
- [ ] Smoke: «що в історії батареї за день» → AI → `shell` `dumpsys batterystats` → AI парсить → emit chart
- [ ] Smoke loop: глибина 4 кроків `shell→http→file→widget`, на 7-му step з'являється Notice про anti-runaway

---

## Phase 2 — Sub-Agent Supervisor (`:core-agent`) (2-3 спринта = 14-18 годин)

Залежить від Phase 1. Розблоковує справжню «складну дію → агент» поведінку.

### 2.1 Module skeleton

```
core-agent/
  build.gradle.kts                       — deps: :core-tool, :core-ai, :core-constitution
  src/main/java/local/phantom/companion/core/agent/
    AgentSupervisor.kt
    AgentSpec.kt
    AgentResult.kt
    AgentProgress.kt
    AgentProgressSink.kt
    AgentRouter.kt                       — preferLocal/Cloud logic
    AgentCallParser.kt                   — parse {"type":"agent",...}
    AgentManifestFactory.kt
  src/test/...
```

### 2.2 AgentSpec contract

AI випускає:
```json
{"type":"agent", "say":"шукаю інфу про реліз", "payload":{
  "goal":"знайти останній stable Kotlin реліз і його дату",
  "plan":["http get kotlinlang.org/docs/releases.html", "parse version + date", "summarize"],
  "tools":["http","file"],
  "maxSteps":6,
  "budgetMs":45000,
  "preferLocal":false
}}
```

```kotlin
data class AgentSpec(
    val agentId: String = UUID.randomUUID().toString(),
    val goal: String,
    val plan: List<String>? = null,
    val allowedTools: Set<String> = emptySet(),
    val maxSteps: Int = 6,
    val budgetMs: Long = 60_000,
    val preferLocal: Boolean = false,
    val parentItemId: String? = null,
)
```

### 2.3 AgentSupervisor

```kotlin
class AgentSupervisor(
    private val cloudRouter: AIRouter,
    private val localRouter: AIRouter,
    private val toolRegistry: ToolRegistry,
    private val decisionDiary: DecisionDiary,
    private val constitutionRegistry: ConstitutionRegistry,
) {
    suspend fun run(spec: AgentSpec, progress: AgentProgressSink): AgentResult = coroutineScope {
        val started = System.currentTimeMillis()
        val router = if (spec.preferLocal) localRouter else cloudRouter
        var history = mutableListOf(
            AIIntent.Text.Turn("system", buildSystemPrompt(spec)),
            AIIntent.Text.Turn("user", spec.goal),
        )
        var step = 0
        while (step < spec.maxSteps && System.currentTimeMillis() - started < spec.budgetMs) {
            step++
            val response = router.complete(AIIntent.Text("", history.toList(), ...)).asAccumulated()
            val parsed = AssistantJsonExtractor.extractWidgetJson(response) ?: return@coroutineScope AgentResult.Failed("bad_response", response)

            when ((parsed["type"] as? JsonPrimitive)?.content) {
                "tool-call" -> {
                    val call = ToolCallParser.tryParse(parsed)!!
                    if (call.toolId !in spec.allowedTools) {
                        return@coroutineScope AgentResult.Failed("tool_forbidden", "${call.toolId} not in allowedTools")
                    }
                    val tool = toolRegistry.get(call.toolId)!!
                    val ctx = ToolContext(agentDepth = 1, ...)
                    val result = tool.execute(call.args, ctx, emit = { e -> progress.onStep(step, call.toolId, "running", e.toString()) })
                    decisionDiary.write(call, result, ctx)
                    progress.onStep(step, call.toolId, "done", result.shortLabel())
                    history += AIIntent.Text.Turn("assistant", parsed.toString())
                    history += AIIntent.Text.Turn("system", "[TOOL_RESULT id=${call.toolId} ok=${result is Ok} output=${result.outputForAi()}]")
                }
                "agent-done" -> {
                    val summary = parsed["summary"]?.jsonPrimitive?.content.orEmpty()
                    val artifacts = (parsed["artifacts"] as? JsonArray)?.toList() ?: emptyList()
                    return@coroutineScope AgentResult.Done(summary, artifacts)
                }
                else -> return@coroutineScope AgentResult.Failed("unrecognized", parsed.toString())
            }
        }
        AgentResult.Failed("budget_exhausted", "${step} steps")
    }

    private fun buildSystemPrompt(spec: AgentSpec) = """
        Ти sub-агент. Goal: ${spec.goal}.
        Доступні tools (тільки ці): ${spec.allowedTools.joinToString()}.
        Випускай ПО ОДНОМУ tool-call за раз як {"type":"tool-call","tool":"…","args":{…}}.
        Коли goal досягнуто → {"type":"agent-done","summary":"…","artifacts":[...]}.
        Без сирого тексту, без markdown — тільки JSON.
    """.trimIndent()
}
```

### 2.4 Parallel agents

AI випускає:
```json
{"type":"agent-parallel", "agents":[
  {"agentId":"a1","goal":"...","tools":["http"]},
  {"agentId":"a2","goal":"...","tools":["calendar"]}
]}
```

StreamViewModel:
```kotlin
"agent-parallel" -> {
    val agents = (parsed["agents"] as JsonArray).map { parseAgentSpec(it as JsonObject) }
    scope.launch {
        val results = agents.map { spec ->
            async { agentSupervisor.run(spec, progress = makeSink(spec.agentId)) }
        }.awaitAll()
        // emit summary to AI as joined tool-result
        continueAfterAgents(results)
    }
    agents.map { spec -> StreamItem.Widget(spec.agentId, "agent-progress", ...) }
}
```

Безпека: `MAX_PARALLEL = 3`. Sub-agent **не може** запустити ще sub-agent (єдиний рівень вкладеності).

### 2.5 Cancellation

`StreamItem.Widget(type="agent-progress")` має tap-action «Скасувати». UI emits `WidgetIntent.Cancel(widgetId)` → StreamViewModel → `agentSupervisor.cancel(widgetId)` → coroutine.cancel() → diary entry «Cancelled by operator at step N».

### 2.6 Audit

Кожен AgentSpec тригерить registration на FeatureManifest:
```kotlin
FeatureManifest(
    id = "agent.adhoc.${spec.agentId}",
    tier = 2,
    erodesOperatorAgency = false,
    actsWithoutConsent = false,             // agent діє в межах spec.allowedTools, кожен tool має свій gate
    abusableAgainstWeak = false,
    sunsetAfterDaysIdle = 1,                // ефемерний; знесеться наступного дня
)
```

При cancel/done — `constitutionRegistry.unregister(manifest.id)`.

### 2.7 Verification phase 2

- [ ] `:core-agent:testDebugUnitTest` мінімум 6 тестів (single agent happy path, tool_forbidden, budget_exhausted, parallel, cancellation, audit)
- [ ] Smoke: «дослідь і збережи в файл коли вийшов Kotlin 2.2» → AI → agent → http+file → файл у `Documents/Phantom/agent/kotlin-2.2.txt`
- [ ] Smoke: «паралельно перевір погоду, події в календарі і чи дозаряджений телефон» → 3 паралельні агенти → один progress widget на кожного → join у фінальне summary
- [ ] Cancellation: запусти агента → tap «Скасувати» → progress widget переходить у «cancelled by operator» < 200ms

---

## Phase 3 — Network Resilience (`:core-resilience`) (1-2 спринта = 6-9 годин)

### 3.1 Module + retry

```
core-resilience/
  src/main/java/local/phantom/companion/core/resilience/
    RetryPolicy.kt
    StreamResumer.kt
    OfflineQueue.kt
    OfflineWorker.kt                       — WorkManager
    HotSwapRouter.kt                       — wraps RoutedAIRouter
    NetworkProbe.kt                        — ConnectivityManager.NetworkCallback
```

### 3.2 GeminiCloudRoute retry + resume

`GeminiCloudRoute.complete()` обернути:
```kotlin
override fun complete(intent: AIIntent): Flow<AIChunk> = retryWithResume(intent, attempt = 0)

private fun retryWithResume(intent: AIIntent, attempt: Int): Flow<AIChunk> = flow {
    val accumulated = StringBuilder()
    try {
        streamOnce(intent).collect { chunk ->
            if (chunk is AIChunk.Token) accumulated.append(chunk.text)
            emit(chunk)
        }
    } catch (e: IOException) {
        if (attempt >= RetryPolicy.MAX) throw e
        delay(RetryPolicy.delayFor(attempt))                       // 200, 600, 1500ms
        val resumed = intent.copy(history = intent.history + Turn("assistant", "[RESUME] $accumulated"))
        emitAll(retryWithResume(resumed, attempt + 1))
    }
}
```

Gemini reasonably-good на «продовжуй з місця $accumulated» — не ідеал, але мінімізує повтори.

### 3.3 Offline queue

**Schema (Room)**:
```kotlin
@Entity
data class PendingIntentEntity(
    @PrimaryKey val id: String,
    val threadId: String,
    val payload: String,        // serialized AIIntent
    val createdAtMs: Long,
    val attempts: Int = 0,
)
```

**Flow**:
1. `GeminiCloudRoute` ловить `UnknownHostException`/`ConnectException` → emit `AIChunk.ErrorChunk` AND `pendingIntentDao.insert(...)`.
2. `OfflineWorker: CoroutineWorker` зареєстрований через `OneTimeWorkRequest.Builder(...).setConstraints(Constraints(NetworkType.CONNECTED))`.
3. Коли мережа повертається → worker drain: для кожного pending intent повторюється звичайним flow.
4. UI: pending bubble отримує subtle spinner + tooltip «чекає мережі».

### 3.4 HotSwapRouter

```kotlin
class HotSwapRouter(private val cloud: AIRouter, private val local: AIRouter) : AIRouter {
    override fun complete(intent: AIIntent): Flow<AIChunk> = flow {
        val cloudFlow = cloud.complete(intent)
        val firstTokenJob = async { cloudFlow.firstOrNull { it is AIChunk.Token } }
        val firstToken = withTimeoutOrNull(FIRST_TOKEN_DEADLINE_MS) { firstTokenJob.await() }
        if (firstToken == null) {
            firstTokenJob.cancel()
            emit(AIChunk.Notice("переходжу на локальну модель"))
            emitAll(local.complete(intent))
        } else {
            emit(firstToken)
            // Skip the first token in cloudFlow since we consumed it
            emitAll(cloudFlow.drop(1))
        }
    }
}
```

`FIRST_TOKEN_DEADLINE_MS = 1500`. На повільному 2G це даватиме фолбек на Gemma швидко.

### 3.5 Tests

- `GeminiCloudRouteRetryTest`: MockEngine кидає IOException на 1-й спробі, success на 2-й → expect повне завершення
- `OfflineQueueE2ETest`: ConnectivityManager mocked offline → entity в Room → online → worker drain → AI бабла з'являється
- `HotSwapRouterTest`: slow cloud + fast local → first AIChunk.Token з local

### 3.6 Verification

- [ ] `:core-resilience:testDebugUnitTest` зелений (+5 тестів)
- [ ] Smoke: airplane on → запит → bubble з spinner «чекає мережі» → airplane off → бабла оживає
- [ ] Smoke: дуже повільна мережа (adb shell tc qdisc add dev wlan0 root netem delay 5000ms) → bubble показує «локальна модель» через 1.5с

---

## Phase 4 — Hidden Reasoning + Decision Diary (1 спринт = 5 годин)

Більшість в Phase 0 (0.3), але тут — повноцінний Diary з UI.

### 4.1 DecisionDiary

**Файл**: `core-tool/.../DecisionDiary.kt` (вже згаданий у Phase 1)
```kotlin
class DecisionDiary(private val dao: DecisionDiaryDao) {
    suspend fun write(
        call: ParsedToolCall,
        result: ToolResult,
        ctx: ToolContext,
    ) {
        dao.insert(DecisionEntity(
            id = UUID.randomUUID().toString(),
            ts = System.currentTimeMillis(),
            toolId = call.toolId,
            args = call.args.toString(),
            outcome = when (result) { is Ok -> "ok"; is Err -> "err:${result.code}"; … },
            outputDigest = result.outputForAi().take(200),
            agentId = call.agentId,
            agentDepth = ctx.agentDepth,
            constitutionVerdict = ctx.constitutionVerdict.toString(),
            convictionScore = null,                                 // populated by core-predict in phase 7
        ))
    }
}
```

### 4.2 UI

Новий екран у Settings: «Щоденник рішень» — список останніх 200 діарних записів з фільтром по tool/agent/outcome. Кнопка «експорт у Vault» — encrypted dump.

### 4.3 Verification

- [ ] Smoke: виклик 3-х tools → у DiaryDao 3 рядки з правильними outcome
- [ ] Smoke: відкрити Settings → щоденник → бачити записи з 1-line summary
- [ ] 03:00 self-audit run → читає Diary за 24h → формує `Notice("сьогодні агент виконав 12 дій, всі без порушень")`

---

## Phase 5 — Multimodal sensorium (`:core-multimodal`) (2-3 спринта = 12-16 годин)

### 5.1 Module

```
core-multimodal/
  src/main/java/local/phantom/companion/core/multimodal/
    CameraCapture.kt                      — CameraX one-shot
    ScreenCapture.kt                      — MediaProjection one-shot (потребує consent dialog)
    AccessibilityTreeDumper.kt            — використовує core-tool AccessibilityTool
    InlineDataEncoder.kt                  — image → base64 + MIME for Gemini API
    MicrophoneVad.kt                      — Voice Activity Detection (already partial у :core-voice?)
  impl/
    CameraTool.kt extends Tool
    ScreenshotTool.kt extends Tool
    DumpTreeTool.kt extends Tool
    LookAroundTool.kt                     — снапшот камери + дамп tree + screenshot як одна композитна tool
```

### 5.2 Gemini vision

`GeminiCloudRoute.buildRequest` — підтримати `inlineData` parts:
```kotlin
@Serializable
private data class GeminiInlineData(
    @SerialName("mimeType") val mimeType: String,
    @SerialName("data") val data: String,    // base64
)

@Serializable
private data class GeminiPart(
    @SerialName("text") val text: String? = null,
    @SerialName("inlineData") val inlineData: GeminiInlineData? = null,
)
```

CameraTool → отримує base64 frame → `AIIntent.Text` extends → `MultimodalIntent.Image(bytes, mime)` додається у наступний turn.

### 5.3 LookAround composite tool

Найважливіше для «глибокий доступ до системи»:
```kotlin
class LookAroundTool : Tool {
    override val id = "look_around"
    override val description = "знімок камери + screenshot + accessibility-tree як єдиний контекст для AI"
    override suspend fun execute(args, ctx, emit): ToolResult {
        val camera = if (args["camera"]?.jsonPrimitive?.boolean != false) captureFrontFrame() else null
        val screen = if (args["screen"]?.jsonPrimitive?.boolean != false) captureScreen() else null
        val tree = if (args["tree"]?.jsonPrimitive?.boolean != false) dumpAccessibilityTree() else null
        val structured = buildJsonObject {
            camera?.let { put("camera_base64", JsonPrimitive(it)) }
            screen?.let { put("screen_base64", JsonPrimitive(it)) }
            tree?.let { put("tree", JsonPrimitive(it)) }
        }
        return ToolResult.Ok(output = "captured", structured = structured, durationMs = ...)
    }
}
```

AI запит «що зараз на екрані» → `look_around` з `camera:false, screen:true, tree:true` → AI отримує base64 знімка екрану + JSON ієрархію вузлів → відповідає семантично.

### 5.4 Permissions

- Camera: `Manifest.permission.CAMERA` (runtime grant)
- Screenshot: `MediaProjection` user consent dialog (стандартний)
- Microphone: `Manifest.permission.RECORD_AUDIO`
- Accessibility tree: existing `AccessibilityServiceConfig`

Кожен запис у constitutional через `FeatureManifest(actsWithoutConsent=false, sunsetAfterDaysIdle=60)`.

### 5.5 Verification

- [ ] Smoke: «що зараз на екрані» → look_around → AI описує
- [ ] Smoke: «що видно через камеру» → camera tool → AI описує
- [ ] Smoke: «прочитай розмову у месенджері» → dump_tree → AI парсить → відповідає

---

## Phase 6 — Body-loop (Embodiment) (1-2 спринта = 6-8 годин)

Інтегрує існуючий `:core-embodiment` з агентським шаром.

### 6.1 Agent → haptic events

`AgentSupervisor` emits `AgentEvent.{Started, StepDone, Finished, Cancelled}` → новий `EmbodimentBridge` підписується і кличе `HapticEmitter`:
- Started → `HapticPattern.TICK` (50ms 0.2)
- StepDone → `TICK` (30ms 0.15)
- Finished → `PULSE` (200ms 0.5)
- Cancelled → `DOUBLE_TICK`

**Файл**: `core-embodiment/.../AgentHapticBridge.kt` (NEW)
```kotlin
class AgentHapticBridge(
    private val haptic: HapticEmitter,
    private val bodyMap: BodyMapStore,
    agentEvents: SharedFlow<AgentEvent>,
    scope: CoroutineScope,
) {
    init {
        scope.launch {
            agentEvents.collect { event ->
                val zone = bodyMap.preferredZoneFor(event)        // wrist for finish, chest for ticks
                haptic.emit(patternFor(event), zone)
            }
        }
    }
}
```

### 6.2 Posture context injection

Існуючий `PostureMonitor.headForwardDeg` ► `core-ai/IntentEnricher`:

```kotlin
fun enrich(intent: AIIntent): AIIntent {
    val postureCue = postureMonitor.currentCue()                   // "operator slumping 14m" | null
    if (postureCue != null && shouldInjectPosture(intent)) {
        return intent.withSystemAppend("[BODY: $postureCue]")
    }
    return intent
}
```

AI бачить контекст і **може** пропонувати перерву — але обмежено правилом промпта: «не пропонуй більше 1 нагадування про поставу на день», audit-gated.

### 6.3 6-state FSM via ProprioceptiveTicker

Вже існує. Просто завести FeatureManifest:
```kotlin
FeatureManifest(
    id = "embodiment.proprioceptive",
    tier = 14,
    surfaces = setOf(Surface.HAPTIC),
    sunsetAfterDaysIdle = 180,
)
```

### 6.4 Verification

- [ ] Smoke: запусти агента → відчуй tick на старті, на кожному кроці, pulse на завершенні
- [ ] Smoke: похились над телефоном 12 хв → AI у наступній відповіді спокійно пропонує перерву
- [ ] Smoke: те саме на наступний день — лише в Diary, без повтору пропозиції в день

---

## Phase 7 — Predictive (Tier 15 light) (2 спринта = 10-12 годин)

### 7.1 ConvictionScore у Diary

Існуючий `:core-predict/ConvictionScore` — wire у `DecisionDiary`. Score рахується ML-моделлю (Gemma local) над `<think>` контентом + tool results.

### 7.2 Ghost completion у input

`feature-stream/.../ui/StreamScreen.kt` text input — після 300ms idle при введенні > 3 chars, paint ghost-text справа сірим (`localRouter.completeShort(textSoFar, maxTokens=12)`). Tab → accept. Esc → dismiss.

Federated: kept лише локально (Gemma 1B), нічого в хмару.

### 7.3 Verification

- [ ] Smoke: введи «що з пого…» — ghost-text «дою сьогодні?»

---

## Phase 8 — Offload tools (Tier 23 light) (1 спринт = 5 годин)

Існуючий `:core-offload/MentalPark` — wrap у Tool.

### 8.1 MentalParkTool

```kotlin
class MentalParkTool(private val park: MentalPark) : Tool {
    override val id = "mental_park"
    override val description = "паркує справу/думку оператора у зовнішньому списку; AI повертає підтвердження"
    override suspend fun execute(args, ctx, emit): ToolResult {
        val text = args["text"]?.jsonPrimitive?.content ?: return Err(...)
        val anchor = args["anchor"]?.jsonPrimitive?.content              // optional cue
        park.add(MentalParkItem(text, anchor, ts = ...))
        return Ok(output = "parked", structured = buildJsonObject { put("id", item.id) }, ...)
    }
}
```

### 8.2 WorkingMemoryRing як context

`core-ai/IntentEnricher.enrich`:
```kotlin
val workingMemory = workingMemoryRing.snapshot().take(6).joinToString("; ")
if (workingMemory.isNotBlank()) intent.withSystemAppend("[WM: $workingMemory]")
```

### 8.3 Verification

- [ ] Smoke: «нагадай купити молоко» → `mental_park` → у Settings → Park bottomsheet справа з'явиться рядок
- [ ] Smoke: «що в мене в парку?» → AI читає `core-offload.park.list()` → markdown widget

---

## Phase 9 — Distributed-self light (Tier 18-B) (2 спринта = 10-14 годин)

### 9.1 Phone↔PHANTOM-OS через core-net

PHANTOM-OS host (Radxa) має повноцінний рантайм. Heavy agent task може скочуватись через WireGuard:

`core-resilience/.../OffloadToHostRouter.kt`:
```kotlin
class OffloadToHostRouter(private val hostUrl: String, private val httpClient: HttpClient) : AIRouter {
    override fun complete(intent: AIIntent): Flow<AIChunk> = flow {
        // POST до PHANTOM-OS /api/v1/agent зі spec
        // SSE назад
    }
}
```

`HotSwapRouter` extended: cloud → host → local порядок. Якщо у конфізі задано `phantom_os_host=https://...` → host є першим preferred fallback.

### 9.2 Verification

- [ ] Smoke: при дієвому WireGuard tunnel — важка задача йде до PHANTOM-OS, повертається з результатом

---

## Phase 10 — Constitution self-improvement (1 спринт = 5 годин)

### 10.1 SelfAuditScheduler читає Diary

Кожні 03:00 → читає 24h Diary → формує `Notice("за добу: 12 дій tools, 3 агентів, 1 cancellation; 0 violations")`. Якщо є violations — surface як `AuditFinding` widget з drill-down.

### 10.2 Auto-sunset

Якщо tool не використовувався `sunsetAfterDaysIdle` днів — `constitutionRegistry.unregister(tool.manifest.id)`. AI більше не бачить tool у `[TOOLS:…]` промпт-блоку. Operator може re-enable у Settings.

### 10.3 Verification

- [ ] Заглушити час до +91 день → ShellTool автоматично знесений → AI його не бачить у промпті

---

## Migration order + risk register

**Strict order**: 0 → 1 → 3 → 2 → 5 → 4 → 6 → 7 → 8 → 9 → 10.

(Resilience до Agents — щоб агенти переживали обриви. Multimodal перед Diary UI — щоб уже були записи з camera/screen.)

| Phase | Calendar (соло) | Ризик | Mitigation |
|---|---|---|---|
| 0 | 1-2 дн | low | unit tests + smoke checklist |
| 1 | 4-5 дн | medium (Termux dependency) | runtime detection + fallback to Runtime.exec |
| 2 | 3-4 дн | medium (runaway) | hard limits + cancellation + diary |
| 3 | 2-3 дн | low | mock-network tests |
| 4 | 1 дн | low | — |
| 5 | 3-4 дн | medium (camera permission UX) | first-use bottomsheet з рejection-clause |
| 6 | 2 дн | low (existing scaffold) | — |
| 7 | 3 дн | medium (Gemma local quality) | feature-flag for ghost-completion |
| 8 | 1 дн | low | — |
| 9 | 3-4 дн | medium (network setup) | clear admin setup doc |
| 10 | 1 дн | low | — |

Sумарно ~25-30 робочих днів соло, ~10-12 днів з парою.

---

## Verification matrix (per-phase merge gate)

Кожна фаза мерджиться лише якщо:

1. Усі `:*:testDebugUnitTest` зелені (повний прогон `./gradlew test`)
2. `:app:assembleDebug` ок
3. `adb install -r` ок на тестовому пристрої
4. Manual smoke checklist пройдений (списки наприкінці кожної фази)
5. `constitutionRegistry.rejections.value.isEmpty()` після boot
6. `constitutionRegistry.snapshot().none { manifest.violatesPhase(this) }`
7. Decision Diary за тестовий прогон не містить `outcome != "ok"` несподіваних
8. WAL пам'яті оператора оновлена (нова фіча → MEMORY.md +1 рядок про gotcha якщо є)

---

## Files-by-phase scoreboard

| Phase | Files added | Files modified | Tests added | Modules created |
|---|---|---|---|---|
| 0 | 3 | 4 | +3 | 0 |
| 1 | 32 | 5 | +14 | 1 (`:core-tool`) |
| 2 | 9 | 2 | +6 | 1 (`:core-agent`) |
| 3 | 6 | 3 | +5 | 1 (`:core-resilience`) |
| 4 | 2 | 2 | +2 | 0 |
| 5 | 8 | 3 | +4 | 1 (`:core-multimodal`) |
| 6 | 2 | 3 | +2 | 0 (extends `:core-embodiment`) |
| 7 | 2 | 4 | +3 | 0 (extends `:core-predict`) |
| 8 | 1 | 2 | +1 | 0 (extends `:core-offload`) |
| 9 | 1 | 2 | +2 | 0 (extends `:core-resilience`) |
| 10 | 0 | 1 | +1 | 0 |
| **Σ** | **66** | **31** | **+43** | **4 нових модулів** |

---

## Що НЕ робимо у цьому плані

Свідомо за межами scope (буде окремий план для Tier 19/20/21/22/26):
- Memory Palace 19 (просторові AR-меморіальні кімнати)
- Legacy AI 20 (heir mode після смерті)
- Phantom Childhood 21 (age-gated growth)
- Negotiation Court 22 (phantom-to-phantom court)
- Health Mesh 26 (clinical-grade)
- Body-extension senses 25 (EM/UV/IR sensors)
- Cooperative Swarm 27 (compute crowdsourcing)
- North Star 30 (research-grade)

Усі ці залежать від міцного Phase 1-3 foundation. Без Tool Registry + Agents + Resilience їх неможливо чесно реалізувати.

---

## Open questions для оператора

(Якщо щось з нижчого треба змінити — скажи, я перепишу відповідні фази.)

1. **Termux залежність**: чи прийнятно вимагати Termux для повного shell-functional, чи всі shell-команди мають працювати без нього (тоді обмежено `pm/am/dumpsys/settings get`)?
2. **PHANTOM-OS host**: чи WireGuard tunnel уже зконфігурений, чи setup-сесія потрібна?
3. **Camera frame у Gemini**: чи приватність камери ОК? (фронт-камера з postureMonitor — окремо від `look_around`).
4. **Sunset window**: дефолт 180 днів — задовгий/закороткий? Чи sensitive tools мають коротший (наприклад `shell` = 60)?
5. **Conviction-gate**: коли AI conviction < 0.6 — питати оператора чи silently proceed з diary entry?

---

## Reuse-список з існуючої бази

| Що треба | Уже існує (path) |
|---|---|
| Constitution audit | `core-constitution/.../AxiomAuditor.kt`, `ConstitutionRegistry.kt` |
| Refusal logic | `core-constitution/.../RefusalGate.kt` |
| Self-audit щоденник | `core-constitution/.../SelfAuditScheduler.kt` |
| Haptic primitives | `core-embodiment/.../HapticEmitter.kt`, `AndroidHapticEmitter.kt`, `HapticPattern.kt` |
| Body mapping | `core-embodiment/.../BodyMapStore.kt`, `BodyZone.kt` |
| Posture | `core-embodiment/.../PostureMonitor.kt`, `PostureMetrics.kt` |
| Proprioceptive ticking | `core-embodiment/.../ProprioceptiveTicker.kt` |
| Mental park | `core-offload/.../MentalPark.kt`, `MentalParkItem.kt` |
| Working memory | `core-offload/.../WorkingMemoryRing.kt` |
| Anchor router | `core-offload/.../AnchorRouter.kt` |
| Conviction score | `core-predict/.../ConvictionScore.kt` (читати окремо) |
| AccessibilityActionDispatcher | `feature-godmode/.../engine/AccessibilityActionDispatcher.kt` |
| GodMode event bus | `feature-godmode/.../engine/GodModeEventBus.kt` |
| AppActionParser | `feature-godmode/.../engine/AppActionParser.kt` |
| AI router contract | `core-ai/.../AIRouter.kt`, `RoutedAIRouter.kt` |
| Gemini route | `core-ai/.../route/GeminiCloudRoute.kt` |
| Gemma local route | `core-ai/.../route/GemmaLocalRoute.kt` |
| System prompts | `core-ai/.../SystemPrompts.kt` |
| Widget extractor | `feature-stream/.../parse/AssistantJsonExtractor.kt` |
| Bubble sanitizer | `feature-stream/.../parse/AssistantTextSanitizer.kt` |
| Vault store (encrypted) | `core-data/.../vault/VaultStore.kt` |
| Ktor http client | injected у `AppContainer` (lines ~917+) |
| WorkManager | вже залежність у `:app` |

---

## Final note

Цей план **обережний з аксіомами**: кожен новий tool, agent, integration реєструє `FeatureManifest` і проходить `AxiomAuditor`. Tool, що видавав би себе як «не has consent», просто **не реєструється** — `ToolRegistry` його не побачить. Це робить систему **structurally safe**: оператор не може випадково ввімкнути фічу, яку розробник сам позначив як абюзивну.

Декларація «декларовану шкідливість можна замаскувати у коді» — справедлива. Mitigation: code-review treats `FeatureManifest` зміни як safety-critical (CODEOWNERS у `:core-constitution` має узгоджувати).

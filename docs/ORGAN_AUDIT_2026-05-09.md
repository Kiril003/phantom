# PHANTOM OS — Аудит Організму (2026-05-09)

Цей документ описує цілісність зв'язків між сенсорами, пам'яттю, інтерфейсом та волею (AI) системи.

| Орган | Sensor IN | Memory layer | UI surface | Chat tool | DecisionTree | Status |
|-------|-----------|--------------|------------|-----------|--------------|--------|
| **Зір** | camera + face_tracker | tactical (face_seen) | Avatar focus | `get_sensor_status` | FOCUS state | ✅ Повноцінний |
| **Слух** | mic + STT | session (history) | Waveform | `get_recent_hearing` | DIALOGUE entry | ✅ Відновлено (09.05) |
| **Простір** | radar + GPS | strategic (places) | TacticalMap | `get_my_location` | SENTINEL trigger | ✅ Відновлено (09.05) |
| **Дотик** | encoder + buttons | session | Ripple/OLED Eye | (немає) | Interaction reset | ✅ Відновлено (09.05) |
| **Серце** | endocrine bias | (in-memory) | StatusBar mood | `get_internal_state` | Tone adjustment | ✅ Відновлено (09.05) |
| **Голос** | — | — | TTS Indicator | `speak_now`? | DIALOGUE response | ⚠️ TTS не переривається |
| **Система** | psutil | history (metrics) | StatusBar bars | `get_system_metrics` | Throttling | ✅ Повноцінний |
| **Календар** | Google API | DB (strategic) | Calendar Card | `get_calendar_events` | Morning briefing | ✅ Повноцінний |

## Обрізані нерви

1. ~~**Endocrine Introspection (🔴)**~~ ✅ (Реалізовано 09.05)
   - **Що обрізано:** AI не може прочитати свій власний емоційний стан (warmth/verbosity) через інструмент.
   - **Як з'єднати:** Додати `get_internal_state` tool, що повертає bias з `endocrine_system`.
   - **Оцінка:** S (легко).

2. ~~**Touch Feedback Loop (⚠️)**~~ ✅ (Реалізовано 09.05)
   - **Що обрізано:** Події дотику (encoder/buttons) скидають idle-timer, але не потрапляють у snapshot як дискретні події.
   - **Як з'єднати:** Додано `last_input_method` у snapshot через `ContextEngine.record_interaction()`.

3. ~~**Hearing Buffer (⚠️)**~~ ✅ (Реалізовано 09.05)
   - **Що обрізано:** Немає способу запитати "що було чутно останні 30 секунд?" (тільки текстова історія повідомлень).
   - **Як з'єднати:** Інтегровано буфер у `ContextEngine` (`get_recent_hearing`), що ловить відхилені і часткові STT-транскрипти.

4. **Handoff Sync (⚠️)**
   - **Що обрізано:** Companion-handoff працює, але стан "AI зараз говорить на Radxa" не блокує "AI говорить на телефоні".
   - **Як з'єднати:** Глобальний `speech_lock` через WS.
   - **Оцінка:** M.

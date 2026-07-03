# PHANTOM OS — Claude Design Handoff Batch #2

**Кидай це повністю одним повідомленням у claude.ai/design.** Дизайн-DNA з першого батчу (`phantom-dna.css`) лишається у силі — нові кадри мають **успадковувати** ту саму палітру, типографіку, glass-стиль, sunrise-gradient фон. Не вигадуй нових базових токенів — використовуй `--primary #f4af25 / --orange #fb923c / --coral #ef4444 / --bg #f8f7f5 / --ink #1a1612 / --glass-bg rgba(255,255,255,0.6)+blur(12px) / Manrope / Playfair Display italic / Material Symbols Outlined`.

Кожен кадр **1024×600** (матиме той самий physical screen). Кадри стек-вертикально як у першому батчі (`DesignCanvas`/`DCSection`/`DCArtboard`).

---

## Section 05 · Authentication (3 frames)

### Frame 5A · `pin-empty` — passcode lock screen

- Fullscreen sunrise-gradient backdrop, sun-orb знизу-центру (приглушений, ~40% opacity).
- Top: один operator-card по центру (як з ProfileSelector, але fixed розмір ~180×260) з мандалою + iм'я + "ROOT" eyebrow.
- Під карткою: **6-значна PIN-індикатор-стрічка** — 6 порожніх кружечків ◯◯◯◯◯◯ (each 16×16, glass-stroke), gap 12px.
- Нижче: **3×4 keypad** великих (touch-min 56×56, але візуально 88×72 з padding) glass-кнопок з цифрами 1-9, 0 по центру нижнього ряду, ◀ del-кнопка справа, біометрика-shortcut (іконка `mic` для voice unlock) зліва.
- Під клавіатурою — playfair italic шепіт: *"Скажіть свій код, або введіть руками."*
- Footer micro-label: "PHANTOM AUTH · attempts 0/3".

### Frame 5B · `pin-typing-3-of-6` — partial entry

- Те саме розташування, але **3 з 6 кружків — заповнені** (gradient `--primary → --orange`, glow halo `--shadow-glow`).
- Найсвіжіший introduce анімаційний beat: 3-й кружок має тонкий ring-pulse (як `phantom-pulse 1.6s`), решта стійкі.
- Subtle ambient highlight: keypad-кнопка "5" має `:active` glow (як ніби тільки що натиснули), решта — normal.

### Frame 5C · `pin-error-shake` + `rfid-waiting`

Поділи кадр **горизонтально** на дві колонки (488×600 кожна, gap 16px центру):

**Лівa half · `pin-error-shake`** — 6 кружків ВСІ заповнені coral (`--coral #ef4444`), панель має тонкий `flash-coral` overlay, micro-label під клавіатурою червона: "НЕВІРНИЙ КОД · спробуйте ще раз". Картка оператора з тонким coral border + horizontal shake-hint (стрілки-завитки навколо як motion lines). Top-right counter: "1 / 3".

**Права half · `rfid-waiting`** — у центрі величезне (Ø340) **дихаюче кільце** — 4 концентричні кільця amber з різними phase-зміщеннями (як радар-розгортки в Sentinel, але м'які та повільні). У середині — стилізована іконка RFID-чіпа (`contactless` Material Symbol, fill, 80px). Над кільцем — playfair: *"Піднесіть карту або браслет."* Під кільцем — тонкий progress-bar який циклічно заповнюється left-to-right за 3s. Footer micro-label: "RFID READER · listening · 13.56MHz".

**Animation hint: RFID detection bloom** — коли карта розпізнається, кільце вибухає в потужний flash (1 кадр), потім зникає у success-checkmark і фон швидко переливається в warm sunrise. Опиши це окремим коментарем у коді.

---

## Section 06 · Sensor Overlays (2 frames)

### Frame 6A · `camera-overlay` — face tracking full-screen

- **Темніший backdrop** (sunrise-gradient приглушений до 35%, бо це camera-режим). Рамка сірувато-кремова з amber-edges.
- **Live video placeholder** на 90% площі — `placeholder-stripe` pattern в м'якому amber тоні.
- **Face bounding boxes**: 2 шт. (одна primary "phantom · ROOT" — ясний amber 4px stroke з подвійним outer glow; одна secondary "unknown · 87%" — coral 2px dashed).
- **Landmark dots**: 68-point face mesh показано як крихітні (3px) кружечки `--primary`, opacity 0.8, з'єднані тонкими lines opacity 0.3 для контурів очей/брів/носа/губ.
- **Orange tracker reticle** (cross-hair з 4 кутами в стилі professional camera) на face primary — `--orange`, animation: subtle pulse + servo-lock indicator-tick зверху ("LOCKED · tracking").
- Top-left HUD: glass-pill з iconom `videocam` fill, "CAM 0 · 1280×720 · 24fps · servo Δ +12° / -3°".
- Top-right: **biometric ID badge** — мандала-аватар (як з ProfileSelector) + name + confidence bar (95%).
- Bottom-left: live frame stats (latency 18ms, faces 2, gaze "engaged").
- Bottom-right: 3 quadrant-кнопки glass — `pause` (pause stream), `flash_on` (IR illumination toggle), `close` (exit).
- Footer micro-label: "FACE TRACKER · OpenCV haarcascade + dlib 68pt".

**Animation hint:** servo-lock tick blink at 0.5Hz; landmark dots wobble ±1px; gaze indicator updates direction arrow. Opisz okremo.

### Frame 6B · `networks-overlay` — WiFi + BLE tab

- Sunrise-gradient backdrop (нормальної яскравості).
- Top tab-bar (2 tabs): "WiFi · 17" (active, amber underline) + "Bluetooth · 8".
- **Top filter row:** glass search-input + 3 sub-glass chips ("📶 ≥ -70dBm", "🔓 open", "🆕 new").
- **Main: WiFi list 12 visible items (scrollable beneath fold)** — кожен row: glass card 76px height, в один рядок:
  - SSID name (Manrope 14px semibold) + lock-icon якщо secured + "5GHz/2.4GHz" badge
  - **RSSI bar** — горизонтальний мікро-графік 5 stacked градієнт-сегментів `--primary→--orange`, в залежності від dBm (5/5 для -45, 1/5 для -85)
  - dBm value tabular ("-58 dBm" amber for strong, muted gray for weak)
  - Sub-row: BSSID mono 9px (truncated 8 chars) + channel + last-seen ("now"/"3m"/"15m")
  - Action icons right: `info`, `link` (connect)
- 1 з рядків — **highlighted active connection** (filled amber gradient bg, white-on-amber text, `wifi` filled icon з glow).
- **Bottom panel:** glass-strong "AGGREGATE WARDRIVING" stats — total scanned tonight (1247), unique networks (203), encryption breakdown (mini donut: WPA3 62% / WPA2 31% / open 7%).
- Right rail (160px): mini sparkline "RSSI стабільність / 5хв" + "noise floor -92 dBm" + button "EXPORT GeoJSON".

---

## Section 07 · Sandbox & Terminal (2 frames)

### Frame 7A · `sandbox-fullscreen` — ROOT executor + live output

- Half-and-half split (512×600 + 512×600).
- **Лівa half — INPUT/PLAN:**
  - Top: glass-strong header "SANDBOX · ROOT" з coral pulsing dot + "SESSION 3a8c12 · started 07:42".
  - **Live "AI is building" plan-tree** — 5 кроків з анімованим status (як в Operator screen, але coral/amber замість всі-amber):
    1. ✓ "Парсинг команди користувача" (done, green)
    2. ✓ "Перевірка sandbox обмежень" (done, green)
    3. ▶ "Збирання Python скрипта" (running, amber з token-stream effect — крапочки рухаються →→→)
    4. ◯ "Виконання у jail-середовищі" (pending)
    5. ◯ "Парсинг output для звіту" (pending)
  - **AI thoughts inline (playfair italic, 14px):**
    > "Скрипт буде в `/tmp/sb_3a8c12.py`. Дам йому 30 сек."
    > "Без імпортів `os.system` — використовую `subprocess.run` із timeout."
  - Bottom: command input (mono, syntax-highlighted) + ROOT-confirm button з shield-icon "EXECUTE" (warm coral gradient).
- **Права half — LIVE OUTPUT:**
  - Top header: "STDOUT · live · 1.2KB" + scroll-to-bottom toggle.
  - Дуже **monospace terminal-style** (mono 12px, coral на amber-tint glass) з ANSI кольорами адаптованими до warm:
    - directory listing з кольоровими файлами
    - syntax-highlighted Python error traceback (4 рядки — coral для error, muted для context)
    - "process completed · exit 0 · 4.7s"
  - Internal scroll line; кожен новий рядок з `slide-up-fade` micro-anim.
  - Bottom: glass quick-actions: "📋 copy output", "↻ rerun", "💾 save trace", "✕ kill (ROOT only)".

**Animation hint — sandbox build sequence:**
1. Plan tree step 3 (running) має typewriter-effect dots running ←
2. STDOUT side має **lines streaming bottom-up** (як справжній tail -f) з velocity slowing на error lines
3. RGB strip ESP32 hint: бічні edges кадру subtle pulsing coral protected mode
Описати окремим коментарем JS-stub'ом.

### Frame 7B · `inline-sandbox-result` — як scene в чаті

- **Inline в chat** (вписується у Dialogue layout, scene = 480-560 wide, не fullscreen).
- Stripe coral-tint vertical zliva (3px) — signals "ROOT-action".
- Top row: glass-strong header "BASH · executed by ROOT" + tiny exit code badge (green "0" or coral "1").
- 3-line preview мониторинг output (truncated з "... +12 more lines"); кнопка "Show full" розгортає inline.
- AI commentary (playfair):
  > "Чисто. 4 файли видалені, simulation на /tmp/. Хочеш реальне виконання?"
- 3 buttons: "Run for real" (coral gradient strong), "Edit script" (sub-glass), "Discard" (muted).

---

## Section 08 · Tools-as-Skills Inline Scenes (4 frames, кожна 480×260)

Маленькі, **самодостатні картки** які рендеряться inline в чат як результат AI tool call. Одна картка — одна функція. Стек у 2×2 (як у `screen-8-inline.jsx`).

### Frame 8A · `scene-alarm` — wake-time confirmation

- Glass card. Header: ⏰ icon + "БУДИЛЬНИК · ОДНОРАЗОВО".
- Big tabular time: **07:00**, поряд weekday "сб 18 травня".
- Sound preview chip: 🎵 "Sunrise" + tiny waveform; кнопка "▶ preview".
- Toggle: "повторювати щодня" (off).
- 3 actions: "Зберегти" (amber gradient), "Edit", "Cancel".
- AI footnote (playfair italic): *"Через 23г 42хв. Сонце сходить о 5:42 — будильник раніше світла на годину."*

### Frame 8B · `scene-wardriving-radiogrid` — RSSI heatmap mini

- Glass card. Header: 📡 + "WARDRIVING · LAST 24H · ~12km²".
- **6×4 heatmap grid** (24 cells), кожна — gradient від transparent (no signal) до coral (strong)
- Над картою — мiсце-pin "Дім" (top-left), "Офіс" (bottom-right), "Кафе Foundry" (mid).
- Right column: top-3 networks list (mono BSSID + RSSI median + count seen).
- Footer chips: "🔓 open · 17", "🔒 wpa2 · 156", "🛡 wpa3 · 30".
- AI commentary: *"Найслабша зона — район парку. Можна писати mesh-relay якщо часто там."*

### Frame 8C · `scene-location-history` — last 24h trail

- Glass card з mini-map background (warm amber, тонкий контур як з `screen-5-map.jsx`).
- Polyline path з 6 пов'язаними glass-pin'ами: "Дім 06:42 → 09:30 Офіс → 12:14 Кафе → 14:00 Офіс → 18:30 Парк → 21:00 Дім".
- Кожен hop має tiny ring (timestamp + duration).
- Right side: aggregate stats: "Total: 18.4 km · 4 stops · 2h walking · 0 unknowns".
- AI footnote: *"Сьогодні ти тричі проходив повз Foundry — варто зробити там пресет?"*

### Frame 8D · `scene-checkpoint` — system state snapshot

- Glass card. Header: 💾 + "CHECKPOINT · `phantom-2026-04-29-1937`".
- Tabular timestamp + "size 47.3 MB · ChromaDB + SQLite + state-snapshot".
- 5 mini-rows (3 на лівій колонці, 2 на правій) показують що включено: ChromaDB ✓, SQLite users ✓, ChatMessage ✓, AgentMemory ✓, settings ✓.
- One **excluded** row coral: "❌ private notes (sealed)".
- 3 actions: "Restore on next boot" (amber strong), "Download .tar.zst" (sub-glass), "Delete" (coral muted).
- AI footnote: *"Це 12-й чекпойнт цього тижня. Старіші 7 дозрілі — почистити?"*

---

## Глобальні анімаційні принципи (для всіх кадрів)

1. **Voice-listening pulse** (Dialogue, RFID-waiting, sandbox-running) — `orb-breathe 6s ease-in-out infinite` на ring/orb shapes.
2. **Token streaming** (sandbox plan, AI thinking) — крапочки з `phantom-pulse` зміщеними phase.
3. **Sandbox build sequence** — STDOUT lines streaming bottom-up із slide-up-fade на кожному рядку (varies 200-450ms duration залежно від line length).
4. **Agent step-tree pump** (sandbox, operator) — running-step має соft inner glow яка pulsует 1.4s.
5. **RFID detection bloom** — 4-stage: idle → bloom (300ms scale 1→1.3 + glow burst) → checkmark (200ms) → fade (400ms).
6. **All animations respect `prefers-reduced-motion: reduce`** — disable timed loops, leave only state changes.

Опиши кожен animation hint як **коментарний JS-stub** в jsx файлі — я не потребую виконуваного коду, лише markup + класи.

---

## Якщо щось незрозуміло

Питай мене (Kiril) перед малюванням — я дам референс або skin tweaks. Якщо decisions потрібні: вибирай **warm > cold, voice-first > GUI-first, inline-scene > separate-screen, AI commentary in playfair italic > plain text**. Це філософія: PHANTOM OS — це жива ОС-компаньйон, не enterprise dashboard.

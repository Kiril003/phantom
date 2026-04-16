# PHANTOM OS — Visual System

> Single source of truth для UI. Читати перед будь-якою зміною фронтенду.
> Не дублювати правила в компонентах — імпортувати з токенів.

---

## 🎯 Філософія

PHANTOM OS — не "dashboard app". Це **жива істота на екрані**. Візуал має:

1. **Повідомляти стан** — користувач бачить систему і розуміє що з нею зараз.
2. **Займати мінімум уваги в SHADOW** і **домінувати в SENTINEL**.
3. **Не виглядати як AI-згенерований шаблон** — без gradient-mesh, без glassmorphism-заради-glassmorphism, без smile-emoji mascot.
4. **Працювати на 1024×600 тач-дисплеї** — великі hit targets, низька щільність тексту, високий контраст.

**Референси по настрою:** термінали NORAD, інтерфейс Samaritan (Person of Interest), HUD Ghost in the Shell, Teenage Engineering OP-1.
**Антиреференси:** Material You, iOS widgets, "AI startup landing page", generic Tailwind component library look.

---

## 🎨 Дизайн-токени

Усі токени живуть у `src/frontend/src/styles/tokens.css` як CSS custom properties.
**Компоненти не мають хардкод-кольорів.** Завжди `var(--color-...)`.

### Базова палітра (темна, завжди)

```css
:root {
  /* Surface — фон і шари */
  --surface-void:    #000000;
  --surface-deep:    #0a0b0d;
  --surface-raised:  #14161a;
  --surface-glass:   rgba(20,22,26,.72);

  /* Ink — текст */
  --ink-primary:     #e8e9ec;
  --ink-secondary:   #8b8f98;
  --ink-muted:       #4a4d54;
  --ink-inverse:     #0a0b0d;

  /* Line — бордери, роздільники */
  --line-subtle:     rgba(255,255,255,.06);
  --line-default:    rgba(255,255,255,.12);
  --line-strong:     rgba(255,255,255,.24);

  /* Semantic — сигнали */
  --signal-ok:       #7ee787;
  --signal-warn:     #f0b72f;
  --signal-alert:    #ff6b6b;
  --signal-info:     #7aa2f7;
}
```

### Акценти стану (міняються з SystemState)

Акцент — **один колір на весь інтерфейс**, задається поточним станом. Компоненти беруть `var(--accent)` і не знають про конкретний стан.

```css
[data-state="shadow"] {
  --accent:         #3a3d42;
  --accent-glow:    rgba(58,61,66,.3);
  --ui-opacity:     0.85;
  --motion-scale:   0.6;
}

[data-state="focus"] {
  --accent:         #4fc3f7;
  --accent-glow:    rgba(79,195,247,.4);
  --ui-opacity:     1;
  --motion-scale:   1;
}

[data-state="dialogue"] {
  --accent:         #b388ff;
  --accent-glow:    rgba(179,136,255,.4);
  --ui-opacity:     1;
  --motion-scale:   1.1;
}

[data-state="sentinel"] {
  --accent:         #ff5252;
  --accent-glow:    rgba(255,82,82,.5);
  --ui-opacity:     1;
  --motion-scale:   1.3;
}

[data-state="ghost"] {
  --accent:         #69f0ae;
  --accent-glow:    rgba(105,240,174,.3);
  --ui-opacity:     0.95;
  --motion-scale:   0.8;
  --surface-deep:   #000000;
}

[data-state="dream"] {
  --accent:         #9575cd;
  --accent-glow:    rgba(149,117,205,.2);
  --ui-opacity:     0.6;
  --motion-scale:   0.4;
}
```

Перемикач — на `<html data-state="focus">`. Міняється через Zustand store у `<App/>`.

---

## 🔤 Типографіка

```css
:root {
  --font-display: "JetBrains Mono", "IBM Plex Mono", monospace;
  --font-body:    "Inter", system-ui, sans-serif;
  --font-tech:    "JetBrains Mono", monospace;

  --fs-micro: 11px;
  --fs-xs:    13px;
  --fs-sm:    15px;
  --fs-md:    17px;
  --fs-lg:    22px;
  --fs-xl:    32px;
  --fs-xxl:   56px;

  --lh-tight: 1.15;
  --lh-normal: 1.4;
  --lh-loose: 1.6;
}
```

**Правило:** на одному екрані максимум 3 розміри шрифту.

---

## 📐 Layout правила для 1024×600

- **Grid:** 12-колонок, gutter 12px, outer padding 16px
- **Safe zone:** `960×568`
- **Touch targets:** `min-width: 44px; min-height: 44px`. Для ключових кнопок — 56px
- **Нема скролу на main screens.** Якщо не влазить — переробити layout
- **Модалки — slide-over панелі, не popup**
- **Z-index шкала:** base 0, raised 10, sticky 20, overlay 30, modal 40, toast 50

---

## 🎞 Motion System

**Движок:** Framer Motion 11. CSS transitions тільки для hover/focus.

### Правила

1. **Анімація = інформація.** Нічого не повідомляє — видалити.
2. **Duration:** 120-200ms для появи, 400-800ms для зміни стану системи.
3. **Easing:** уникай `linear`. Стандарт — `[0.16, 1, 0.3, 1]`.
4. **Усі анімації множать duration на `--motion-scale`** — в SHADOW повільніше, в SENTINEL швидше.

### Preset бібліотека (`src/frontend/src/styles/motion.ts`)

```ts
export const motion = {
  fadeIn:      { initial: { opacity: 0 },              animate: { opacity: 1 },                duration: 200 },
  slideUp:     { initial: { opacity: 0, y: 12 },       animate: { opacity: 1, y: 0 },          duration: 280 },
  slideOver:   { initial: { x: "100%" },               animate: { x: 0 },                      duration: 400 },
  stateTransition: { duration: 600, ease: [0.16, 1, 0.3, 1] },
  pulse:       { animate: { opacity: [0.4, 1, 0.4] },  duration: 2000, repeat: Infinity },
  heartbeat:   { animate: { scale: [1, 1.06, 1] },     duration: 1400, repeat: Infinity },
  alarm:       { animate: { scale: [1, 1.1, 1] },      duration: 600, repeat: Infinity },
} as const;
```

### State transition choreography

Зміна `SystemState` — оркестрована послідовність:

```
0ms    → попередній accent починає fade-out
150ms  → StatusBar state indicator морфить у нову форму
300ms  → content shift (elements re-densify/sparsify)
600ms  → новий accent повністю, анімації адаптуються під --motion-scale
```

Реалізація — `src/frontend/src/app/StateTransitionController.tsx`.

---

## 🧩 Компонентна ієрархія

```
<App>
  <StateProvider>                  # задає data-state на <html>
    <MotionConfig>
      <StatusBar />                # завжди, sticky top
      <StateLayout>
        SHADOW    → <ShadowLayout>
        FOCUS     → <FocusLayout>
        DIALOGUE  → <DialogueLayout>
        SENTINEL  → <SentinelLayout>
        GHOST     → <GhostLayout>
        DREAM     → <DreamLayout>
      </StateLayout>
    </MotionConfig>
  </StateProvider>
</App>
```

**Шари компонентів** (`src/frontend/src/components/`):

- `core/` — StatusBar, StateIndicator, Avatar, SystemPulse
- `chat/` — ChatWindow, MessageBubble, ResponseForms, VoiceWaveform
- `map/` — TacticalMap, Layers, MarkerCards
- `settings/` — SettingsPanel + SettingsGroups
- `auth/` — LoginScreen, PinPad, RFIDScanner
- `terminal/` — TerminalWidget, LiveOutput
- `tools/` — Timer, Alarm, Calendar, FileManager
- `primitives/` — Button, Card, Input, Toggle, Slider

---

## 🔘 Primitives API

```tsx
<Button variant="primary|ghost|danger" size="sm|md|lg" icon={Icon}>Label</Button>
<Card tone="default|raised|glass" padding="sm|md|lg">...</Card>
<Input prefix={Icon} suffix={...} state="default|focus|error" />
<Toggle checked onChange />
<Slider min max step value onChange marks />
```

Усі primitives:
- Підтримують `data-state` з оточення через CSS
- Touch target ≥ 44px навіть якщо виглядають менше
- Не мають власних кольорів — беруть з токенів

---

## 🖼 Іконки

- **Бібліотека:** `lucide-react`
- **Розмір:** 16 / 20 / 24 px
- **Stroke:** `1.5px` default, `2px` для emphasis
- **Колір:** `currentColor` завжди

---

## 📊 Data viz

- **Charts:** Recharts для стандартних, D3 для кастомних
- **Кольори:** палітра з 5 тонів `--chart-1..5` + accent, не rainbow
- **Ніяких 3D chart. Ніяких pie > 5 сегментів**
- **Map:** MapLibre GL, dark style, кастомний tile layer

---

## ✅ Visual acceptance criteria

Перед "готово":

1. Screenshot у всіх 6 станах (SHADOW/FOCUS/DIALOGUE/SENTINEL/GHOST/DREAM)
2. Немає хардкод-кольорів (`grep "#[0-9a-f]\{3,6\}" src/frontend/src/components/` → тільки в tokens.css)
3. Усі кнопки ≥ 44×44
4. Fits 1024×600 без скролу
5. State transition 60fps
6. Lighthouse performance + a11y ≥ 90
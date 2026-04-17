# PHANTOM OS — Visual System

> **Єдине джерело істини для UI.** Читати перед будь-якою зміною фронтенду.
> Антипаттерн: ASCII brackets + monospace + flat tactical terminal. Це НЕ наша естетика.
> Наша естетика: **Premium AI OS з tactical data density**.

---

## 🎯 Філософія

PHANTOM OS — це **жива AI-сутність** у preміумному скляному корпусі.
Не termінал. Не консоль. Не військовий HUD. А **персональний AI-компаньйон** з відчуттям:

- **Apple Vision Pro** — глибина, прозорість, плинність
- **Refik Anadol digital installations** — органічні morphing форми, живий рух
- **Bang & Olufsen** — тиха впевненість, преміумність через деталі
- **Teenage Engineering OP-1** — tactility через мікроанімації і реактивність
- **Superhuman / Linear / Arc browser** — craft у кожному пікселі

**Антиреференси:** Material You, generic Tailwind templates, "AI startup landing page", ASCII-terminal brutalism, військовий шрифт всюди.

Продукт для **оператора-оригіналу**, не для адміна серверної. Він має **дихати**, **світитися**, **реагувати**.

---

## 📚 Реальні дизайн-референси

**ОБОВ'ЯЗКОВО** перед розробкою прочитай і подивись файли у `docs/design-refs/*.html`.

Це **власні прототипи попередньої версії** продукту — єталон естетики.

| Файл | Що показує |
|------|------------|
| `docs/design-refs/system_core.html` | Головний екран — SYSTEM_CORE з morphing orb, glass cards, toolbar внизу |
| `docs/design-refs/tactical_map.html` | Карта з lateral icon panel, floating search bar, bottom toolbar |
| `docs/design-refs/wardriving_sigint.html` | Data table з amber accent, signal bars, monospace BSSID |
| `docs/design-refs/login.html` | Glassmorphism login з avatar ring, green accent, glow-pulse PIN dots |
| `docs/design-refs/profiles.html` | Profile cards з image + glass layer + ring glow |
| `docs/design-refs/music_lyrics.html` | Orb-based interactive mode з dynamic background |

**Правило:** якщо Claude вагається між "ASCII-style" і "glass+orb style" — **завжди glass+orb**. Усі інші рішення — перевіряти проти прототипів.

---

## 🎨 Дизайн-токени

Усі токени — у `src/frontend/src/styles/tokens.css` як CSS custom properties.
Компоненти **ніколи не мають хардкод-кольорів**. Завжди `var(--...)`.

### Surfaces — шари глибини

Ми використовуємо **layered glass** — прозорі шари з blur над темним фоном з ambient glows.

```css
:root {
  /* Base — фони */
  --surface-base:       #020617;              /* deep slate — основний фон */
  --surface-deep:       #0a0f1a;              /* трохи світліше, бази панелей */
  --surface-void:       #000000;              /* pure black для SHADOW/GHOST */

  /* Glass layers — прозорі панелі */
  --glass-subtle:       rgba(15, 23, 42, 0.4);   /* легкий шар, hover states */
  --glass-panel:        rgba(15, 23, 42, 0.6);   /* основний glass panel */
  --glass-card:         rgba(15, 23, 42, 0.7);   /* cards з більшим contrast */
  --glass-elevated:     rgba(15, 23, 42, 0.85);  /* modal, overlay */

  --glass-border:       rgba(255, 255, 255, 0.08);
  --glass-border-hover: rgba(255, 255, 255, 0.16);
  --glass-highlight:    rgba(255, 255, 255, 0.05);  /* inset top-line */

  /* Ambient glows — м'які кольорові плями на фоні */
  --glow-primary:       rgba(34, 211, 238, 0.2);    /* cyan — default ambient */
  --glow-secondary:     rgba(139, 92, 246, 0.15);   /* purple — orb */
  --glow-warm:          rgba(244, 175, 37, 0.15);   /* amber — data tables */
}
```

### Ink — текст

```css
:root {
  --ink-primary:     #f1f5f9;       /* slate-100, основний */
  --ink-secondary:   #94a3b8;       /* slate-400, вторинний */
  --ink-muted:       #64748b;       /* slate-500, hint/label */
  --ink-faint:       #475569;       /* slate-600, disabled */
  --ink-inverse:     #020617;       /* на світлому accent */
}
```

### Accent — акценти стану

Акцент — **один primary колір**, задається SystemState. Зберігаємо рисунок з прототипів:

```css
[data-state="shadow"] {
  /* Dormant — майже невидимий, система спостерігає */
  --accent:         #64748b;
  --accent-glow:    rgba(100, 116, 139, 0.2);
  --accent-radial:  radial-gradient(circle at 30% 30%, #475569, #1e293b);
  --ui-opacity:     0.5;
  --motion-scale:   0.5;
  --surface-base:   #000000;
}

[data-state="focus"] {
  /* Active — operator за роботою */
  --accent:         #22d3ee;               /* cyan */
  --accent-glow:    rgba(34, 211, 238, 0.4);
  --accent-radial:  radial-gradient(circle at 30% 30%, #22d3ee, #0ea5e9, #6366f1);
  --ui-opacity:     1;
  --motion-scale:   1;
}

[data-state="dialogue"] {
  /* Conversational — AI + voice/chat */
  --accent:         #8b5cf6;               /* purple */
  --accent-glow:    rgba(139, 92, 246, 0.4);
  --accent-radial:  radial-gradient(circle at 30% 30%, #a78bfa, #8b5cf6, #6366f1);
  --ui-opacity:     1;
  --motion-scale:   1.1;
}

[data-state="sentinel"] {
  /* Alert — підвищена готовність */
  --accent:         #f43f5e;               /* rose */
  --accent-glow:    rgba(244, 63, 94, 0.5);
  --accent-radial:  radial-gradient(circle at 30% 30%, #fb7185, #f43f5e, #be123c);
  --ui-opacity:     1;
  --motion-scale:   1.3;
}

[data-state="ghost"] {
  /* Incognito — зашифровано, без логів */
  --accent:         #10b981;               /* emerald */
  --accent-glow:    rgba(16, 185, 129, 0.3);
  --accent-radial:  radial-gradient(circle at 30% 30%, #34d399, #10b981, #047857);
  --ui-opacity:     0.9;
  --motion-scale:   0.8;
  --surface-base:   #000000;
}

[data-state="dream"] {
  /* Offline processing — консолідація пам'яті */
  --accent:         #f4af25;               /* amber */
  --accent-glow:    rgba(244, 175, 37, 0.2);
  --accent-radial:  radial-gradient(circle at 30% 30%, #fbbf24, #f59e0b, #b45309);
  --ui-opacity:     0.6;
  --motion-scale:   0.4;
}
```

Перемикач — `<html data-state="focus">` через Zustand store.

---

## 🔤 Типографіка

Повторюємо з прототипів:

```css
:root {
  /* Primary sans — UI, заголовки, body */
  --font-display: "Space Grotesk", "Outfit", system-ui, sans-serif;

  /* Monospace — тільки для data (BSSID, coordinates, timestamps, logs) */
  --font-mono: "JetBrains Mono", ui-monospace, "SF Mono", monospace;

  /* Серіф — акцентні тексти (поетичні фрази AI, "Nexus Suggests") */
  --font-serif: "Playfair Display", Georgia, serif;

  --fs-micro:  11px;      /* service labels, uppercase tracking */
  --fs-xs:     12px;      /* metadata, captions */
  --fs-sm:     14px;      /* body default */
  --fs-base:   15px;      /* chat messages */
  --fs-md:     17px;      /* section subtitles */
  --fs-lg:     22px;      /* card titles */
  --fs-xl:     32px;      /* screen titles */
  --fs-2xl:    48px;      /* hero — hero stats, large numbers */
  --fs-display: 64px;     /* rare — лише логотип, час */

  --tracking-tight:   -0.02em;
  --tracking-normal:   0;
  --tracking-wide:     0.05em;
  --tracking-widest:   0.15em;       /* для uppercase labels */

  --lh-tight:    1.1;
  --lh-normal:   1.4;
  --lh-relaxed:  1.6;
}
```

**Правила:**

- Uppercase labels (CPU LOAD, WARDRIVING_SIGINT, SYS_LOG) — завжди з `tracking-widest`, `fs-xs`, `--ink-secondary`
- Числа в data контексті — **моно-шрифт** (`var(--font-mono)`) для правильного вирівнювання колонок
- Великі числа (26%, 64/100, 07:00) — `Space Grotesk 700` або `600` з `tracking-tight`
- AI фрази ("Your deep sleep was low...") — `Playfair Display italic` у цитатному блоці
- Максимум 3 розміри на одному екрані

---

## 📐 Layout для 1024×600

Це embedded дисплей, тач. Нагадування:

- **Viewport:** 1024×600, fixed
- **Outer padding:** 16-24px по краях
- **Grid:** Tailwind 12-col або flex, gap 12-24px
- **Touch target:** min 44×44px. Для primary — 56×56px
- **Без вертикального скролу на main screens.** Якщо не влазить — переглянь layout
- **Модалки — slide-over панелі**, не popup
- **Z-index шкала:** base 0, raised 10, sticky 20, overlay 30, modal 40, toast 50

---

## 🎞 Motion — рух як характер

**Движок:** Framer Motion 11. Tailwind animations для простих keyframes. CSS transitions — тільки hover/focus.

### Ключові анімації (з прототипів)

Заклади усі ці у `src/frontend/src/styles/motion.ts` і Tailwind config.

#### Орб (центральний — SystemState indicator)

```js
// tailwind.config.ts — extend.animation
animation: {
  'breathe':       'breathe 8s ease-in-out infinite',
  'morph':         'morph 8s ease-in-out infinite',
  'float':         'float 6s ease-in-out infinite',
  'pulse-slow':    'pulse 4s cubic-bezier(0.4, 0, 0.6, 1) infinite',
  'pulse-music':   'pulseMusic 1.2s cubic-bezier(0.4, 0, 0.6, 1) infinite',
  'radar':         'radar 10s linear infinite',
  'fade-in':       'fadeIn 0.6s cubic-bezier(0.16, 1, 0.3, 1) forwards',
  'equalizer':     'equalizer 1s ease-in-out infinite',
  'scanline':      'scanline 3s linear infinite',
},
keyframes: {
  breathe:   { '0%, 100%': { transform: 'scale(1)', opacity: '0.9' },
               '50%':      { transform: 'scale(1.05)', opacity: '0.7' } },
  morph:     { '0%':       { borderRadius: '60% 40% 30% 70%/60% 30% 70% 40%' },
               '50%':      { borderRadius: '30% 60% 70% 40%/50% 60% 30% 60%' },
               '100%':     { borderRadius: '60% 40% 30% 70%/60% 30% 70% 40%' } },
  float:     { '0%, 100%': { transform: 'translateY(0)' },
               '50%':      { transform: 'translateY(-6px)' } },
  radar:     { '0%':       { transform: 'rotate(0deg)' },
               '100%':     { transform: 'rotate(360deg)' } },
  fadeIn:    { '0%':       { opacity: '0', transform: 'translateY(20px)' },
               '100%':     { opacity: '1', transform: 'translateY(0)' } },
  pulseMusic:{ '0%, 100%': { transform: 'scale(1)', opacity: '0.8' },
               '50%':      { transform: 'scale(1.15)', opacity: '1' } },
  equalizer: { '0%, 100%': { height: '20%' },
               '50%':      { height: '100%' } },
}
```

### Масштабування через `--motion-scale`

Усі анімації множать duration на `--motion-scale` через CSS custom property або Framer variants:
- SHADOW → 0.5× (повільніше, сонніше)
- FOCUS → 1×
- SENTINEL → 1.3× (швидше, тривожніше)

### State transition choreography

Перемикання SystemState — **600ms orchestrated sequence**:

```
0ms    → accent починає fade + ambient glow морфиться у новий колір
150ms  → StatusBar state indicator cross-fades
300ms  → content re-densifies / sparsifies залежно від стану
600ms  → нова палітра повністю, motion-scale застосовано
```

Реалізація — `src/frontend/src/app/StateTransitionController.tsx`.

---

## 🧊 Glassmorphism — базовий CSS

Повторюємо з прототипів у global CSS або як Tailwind classes:

```css
.glass-panel {
  background: var(--glass-panel);
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
  border: 1px solid var(--glass-border);
  box-shadow:
    0 4px 20px -2px rgba(0, 0, 0, 0.2),
    inset 0 1px 0 var(--glass-highlight);
}

.glass-card {
  background: var(--glass-card);
  backdrop-filter: blur(24px);
  -webkit-backdrop-filter: blur(24px);
  border: 1px solid var(--glass-border);
  box-shadow:
    0 4px 20px -2px rgba(0, 0, 0, 0.3),
    inset 0 1px 0 var(--glass-highlight);
}

.glass-elevated {
  background: var(--glass-elevated);
  backdrop-filter: blur(32px);
  -webkit-backdrop-filter: blur(32px);
  border: 1px solid var(--glass-border-hover);
  box-shadow:
    0 20px 50px -10px rgba(0, 0, 0, 0.5),
    inset 0 1px 0 var(--glass-highlight);
}

/* Glow text — для headers + AI фраз */
.glow-text {
  text-shadow:
    0 0 20px var(--accent-glow),
    0 0 40px var(--accent-glow);
}

/* Text gradient — для брендових заголовків */
.text-gradient {
  background-clip: text;
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  background-image: linear-gradient(to right, var(--accent), var(--ink-primary));
}
```

**Правило:** якщо компонент показує дані поверх іншого layer'а → `glass-panel` або `glass-card`. Якщо це solid surface (fullscreen login) → ambient glows + без blur.

---

## 🔮 Орб — серце системи

Центральний AI-орб — **не просто крапка**. Це жива сутність.

Обов'язковий набір шарів:

```tsx
<div className="relative w-64 h-64 flex items-center justify-center animate-float">
  {/* Core — morphing gradient blob */}
  <div
    className="absolute inset-8 animate-morph animate-breathe mix-blend-screen opacity-90"
    style={{
      background: 'var(--accent-radial)',
      filter: 'blur(20px)',
      boxShadow: '0 0 100px var(--accent-glow)',
    }}
  />

  {/* Outer glow */}
  <div
    className="absolute inset-0 rounded-full blur-2xl animate-pulse-music"
    style={{ background: 'var(--accent-glow)' }}
  />

  {/* Orbital rings — повільні, різна швидкість */}
  <div
    className="absolute w-80 h-80 rounded-full opacity-40 animate-[spin_20s_linear_infinite]"
    style={{ border: '1px solid var(--accent-glow)' }}
  />
  <div
    className="absolute w-72 h-72 rounded-full opacity-50 rotate-45 animate-[spin_15s_linear_infinite_reverse]"
    style={{ border: '1px dashed var(--accent-glow)' }}
  />

  {/* Sparks — random ping dots */}
  <div className="absolute top-0 right-10 w-1.5 h-1.5 bg-white rounded-full animate-ping" style={{ animationDuration: '3s' }} />
  <div className="absolute bottom-10 left-4 w-1 h-1 rounded-full animate-ping" style={{ background: 'var(--accent)', animationDuration: '4s' }} />
</div>
```

Розміри орба (responsive до SystemState):
- SHADOW: маленький (~120px), повільне дихання, dim accent
- FOCUS: середній (~220px), активний, cyan
- DIALOGUE: великий (~280px), pulse на voice activity
- SENTINEL: середній, швидке pulse + червоний glow
- GHOST: маленький + майже невидимий
- DREAM: середній, дуже повільний morph

---

## 🧩 Компонентна ієрархія

```
<App>
  <StateProvider>
    <AmbientGlows />                 # fixed fullscreen blur balls на фоні
    <MotionConfig>
      <StatusBar />                  # завжди, top sticky
      <StateLayout>
        SHADOW    → <ShadowLayout    orbSize="sm" />
        FOCUS     → <FocusLayout />  # SYSTEM_CORE-style: cards + orb + toolbar
        DIALOGUE  → <DialogueLayout /> # chat + orb з voice pulse
        SENTINEL  → <SentinelLayout />
        GHOST     → <GhostLayout />
        DREAM     → <DreamLayout />
      </StateLayout>
      <FloatingToolbar />            # bottom glass toolbar з quick actions
    </MotionConfig>
  </StateProvider>
</App>
```

### AmbientGlows — обов'язковий компонент

Завжди присутній. Створює живий фон:

```tsx
<div className="fixed inset-0 pointer-events-none z-0 overflow-hidden">
  <div
    className="absolute top-[-20%] left-[-10%] w-[50%] h-[80%] rounded-full blur-[120px] opacity-40 animate-pulse-slow"
    style={{ background: 'var(--glow-primary)' }}
  />
  <div
    className="absolute bottom-[-20%] right-[-10%] w-[40%] h-[60%] rounded-full blur-[100px] opacity-40 animate-pulse-slow"
    style={{ background: 'var(--glow-secondary)', animationDelay: '2s' }}
  />
</div>
```

Без них — UI flat і мертвий.

### FloatingToolbar (з прототипу SYSTEM_CORE)

Bottom-centered glass bar з icon buttons — terminal / map / voice / scan / home / menu / settings / camera / security / wifi / power.

```tsx
<footer className="absolute bottom-4 left-1/2 -translate-x-1/2 z-30">
  <div className="glass-card rounded-full px-6 py-3 flex items-center gap-5">
    {/* icons, each 44x44 tap target, 24px icon */}
  </div>
</footer>
```

Active button — з `text-accent` + `bg-accent/10` + subtle glow.

---

## 🔘 Primitives API

```tsx
<Button variant="primary|ghost|glass|danger" size="sm|md|lg" icon={Icon}>
  Label
</Button>

<Card tone="glass|glass-card|glass-elevated|solid" padding="sm|md|lg">
  ...
</Card>

<Input
  prefix={Icon}
  suffix={Icon}
  state="default|focus|error"
  tone="glass"
/>

<Toggle checked onChange />
<Slider min max step value onChange marks />

<Badge variant="accent|warn|alert|success" dot>
  LABEL
</Badge>

<Orb size="sm|md|lg|xl" state={SystemState} />  {/* використовує композит вище */}
```

**Усі primitives:**
- Читають `data-state` з оточення
- Touch target ≥ 44px, hit area через `::before` якщо візуально менше
- Не мають власних кольорів — беруть з токенів
- Мають `hover` і `active:scale-[0.97]` для тактильності

---

## 🖼 Іконки

- **Бібліотека:** `lucide-react` (локально, не Material Symbols з Google CDN)
- **Розмір:** 14 / 18 / 20 / 24 px (строго)
- **Stroke:** `1.5` default, `2` для emphasis
- **Колір:** `currentColor` завжди

Material Symbols з Google CDN — **не використовувати**. У прототипах був, але для production на embedded Linux потрібен локальний bundle. Lucide покриває 99% потреб і ставиться через npm.

---

## 📊 Data visualization

З прототипів (sleep graph, signal bars, equalizer):

- **Charts:** Recharts з кастомним тематичним wrapper
- **Палітра графіків:** 5 тонів `--chart-1..5` + accent
- **Лінійні графіки:** `stroke-width: 2.5`, `stroke-linecap: round`, `stroke-linejoin: round`, завжди з нижнім **gradient fill**
- **Bar charts:** без 3D, без legend якщо < 4 серій
- **Signal bars (wardriving):** тонкий indicator з rounded corners, amber → green залежно від RSSI
- **Мапа:** MapLibre GL dark style, кастомний tile layer

---

## ✅ Visual acceptance — automated checks

Перед "готово":

1. Скріни у всіх 6 станах через Playwright
2. Немає хардкод-кольорів (`grep -rn "#[0-9a-f]\{3,6\}" src/frontend/src/components/` повертає тільки tokens.css)
3. Усі кнопки ≥ 44×44 (Playwright bounding box)
4. Fits 1024×600 без скролу
5. AmbientGlows + Orb видно на FOCUS
6. Немає ASCII-стилізованих frames у UI (`grep -rn "┌\|└\|├" src/frontend/src/`)
7. Немає `font-mono` на body-тексті (тільки на data)
8. Lighthouse perf + a11y ≥ 90

---

## 🚫 Заборонено

- ASCII brackets (`┌─ SESSIONS ─┐`, `└─`, `├─`) у UI
- Monospace на title, body text, UI labels
- `[ AUTH.DENY ]`-стилізовані error — замість цього glass toast з icon
- `operator@phantom:~$` prompt у чаті — стандартне chat input
- Flat solid backgrounds без ambient glows
- Material Symbols від Google CDN
- Cyan blast `#4fc3f7` на всьому активному елементі
- Generic rounded buttons без character
- Centered 380px cards на 1024×600 з великими чорними полями навколо
- Decorative анімації без інформаційного навантаження

---

## ✨ Дозволено і заохочується

- Glass panels з `backdrop-blur`
- Ambient gradient glows на фоні (fixed, pointer-events-none)
- Morphing orbs з multiple animation layers
- Orbital rings (повільне обертання)
- Gradient text для headers (`text-gradient` class)
- Glow text для pulse/active elements
- `active:scale-[0.97]` на всіх clickable елементах
- Неправильні border-radius (60% 40% 30% 70%) для organic shapes
- Animated decorative dots/sparks
- Paused equalizer bars при voice activity
- Scan line overlay (але тонкий, opacity 0.02-0.05)
- Playfair Display italic для AI-згенерованих quote блоків
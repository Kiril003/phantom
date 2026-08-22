import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        primary: 'var(--primary)',
        'primary-soft': 'var(--primary-soft)',
        'primary-deep': 'var(--primary-deep)',
        'primary-shadow': 'var(--primary-shadow)',
        accent: 'var(--accent)',
        'ink-primary': 'var(--ink-primary)',
        'ink-secondary': 'var(--ink-secondary)',
        'ink-muted': 'var(--ink-muted)',
        'ink-faint': 'var(--ink-faint)',
        'ink-inverse': 'var(--ink-inverse)',
        'glass-border': 'var(--glass-border)',
        'glass-panel': 'var(--glass-panel)',
        'glass-card': 'var(--glass-card)',
        'glass-elevated': 'var(--glass-elevated)',
        'signal-ok': 'var(--signal-ok)',
        'signal-warn': 'var(--signal-warn)',
        'signal-alert': 'var(--signal-alert)',
        'signal-info': 'var(--signal-info)',
        // ── Обсидіан --ph-* (контракт ATLAS, Ф1) ──────────────────────
        'ph-ground': 'var(--ph-color-ground)',
        'ph-surface': 'var(--ph-color-surface)',
        'ph-raised': 'var(--ph-color-surface-raised)',
        'ph-glass': 'var(--ph-color-glass)',
        'ph-scrim': 'var(--ph-color-scrim)',
        'ph-border': 'var(--ph-color-border)',
        'ph-ink': 'var(--ph-color-ink)',
        'ph-ink-muted': 'var(--ph-color-ink-muted)',
        'ph-ink-faint': 'var(--ph-color-ink-faint)',
        'ph-accent': 'var(--ph-color-accent)',
        'ph-accent-warm': 'var(--ph-color-accent-warm)',
        'ph-alert': 'var(--ph-color-alert)',
        'ph-danger': 'var(--ph-color-danger)',
        'ph-success': 'var(--ph-color-success)',
        'ph-info': 'var(--ph-color-info)',
        // Доктрина чесності: live — тільки реальний фід; simulated —
        // тільки модель. Див. коментар у tokens.css.
        'ph-live': 'var(--ph-color-live)',
        'ph-simulated': 'var(--ph-color-simulated)',
        'ph-route': 'var(--ph-color-route)',
        'ph-route-alt': 'var(--ph-color-route-alt)',
        'ph-water': 'var(--ph-color-water)',
        'ph-green': 'var(--ph-color-green)',
        'ph-road-major': 'var(--ph-color-road-major)',
        'ph-road-minor': 'var(--ph-color-road-minor)',
      },
      // Типографічні ролі --ph-type-* (розміри йдуть за --fs-scale юзера)
      fontSize: {
        'ph-display': [
          'var(--ph-type-display-size)',
          {
            lineHeight: 'var(--lh-tight)',
            letterSpacing: 'var(--ph-type-display-tracking)',
            fontWeight: 'var(--ph-type-display-weight)',
          },
        ],
        'ph-title': [
          'var(--ph-type-title-size)',
          {
            lineHeight: 'var(--lh-tight)',
            letterSpacing: 'var(--ph-type-title-tracking)',
            fontWeight: 'var(--ph-type-title-weight)',
          },
        ],
        'ph-body': [
          'var(--ph-type-body-size)',
          {
            lineHeight: 'var(--lh-normal)',
            letterSpacing: 'var(--ph-type-body-tracking)',
            fontWeight: 'var(--ph-type-body-weight)',
          },
        ],
        'ph-caption': [
          'var(--ph-type-caption-size)',
          {
            lineHeight: 'var(--lh-normal)',
            letterSpacing: 'var(--ph-type-caption-tracking)',
            fontWeight: 'var(--ph-type-caption-weight)',
          },
        ],
        'ph-micro': [
          'var(--ph-type-micro-size)',
          {
            lineHeight: 'var(--lh-tight)',
            letterSpacing: 'var(--ph-type-micro-tracking)',
            fontWeight: 'var(--ph-type-micro-weight)',
          },
        ],
      },
      spacing: {
        'ph-1': 'var(--ph-space-1)',
        'ph-2': 'var(--ph-space-2)',
        'ph-3': 'var(--ph-space-3)',
        'ph-4': 'var(--ph-space-4)',
        'ph-5': 'var(--ph-space-5)',
        'ph-6': 'var(--ph-space-6)',
        'ph-7': 'var(--ph-space-7)',
        'ph-8': 'var(--ph-space-8)',
      },
      borderRadius: {
        'ph-s': 'var(--ph-radius-s)',
        'ph-m': 'var(--ph-radius-m)',
        'ph-l': 'var(--ph-radius-l)',
        'ph-pill': 'var(--ph-radius-pill)',
      },
      borderWidth: {
        'ph-hair': 'var(--ph-stroke-hair)',
        'ph-thin': 'var(--ph-stroke-thin)',
        'ph-bold': 'var(--ph-stroke-bold)',
      },
      boxShadow: {
        'ph-1': 'var(--ph-shadow-1)',
        'ph-2': 'var(--ph-shadow-2)',
        'ph-3': 'var(--ph-shadow-3)',
      },
      transitionDuration: {
        'ph-fast': 'var(--ph-motion-fast)',
        'ph-base': 'var(--ph-motion-base)',
        'ph-slow': 'var(--ph-motion-slow)',
      },
      transitionTimingFunction: {
        'ph-standard': 'var(--ph-ease-standard)',
        'ph-enter': 'var(--ph-ease-enter)',
        'ph-exit': 'var(--ph-ease-exit)',
      },
      fontFamily: {
        // Вирок Ф1 (шрифтова розбіжність виміряна: tokens.css ставив Manrope
        // першим, tailwind — Space Grotesk; дві гарнітури мішались випадково).
        // Тепер обидві системи читають ОДИН контракт --ph-font-*:
        //   sans/тіло/контроли = Manrope; display = Space Grotesk
        //   (заголовки/великі цифри); mono = JetBrains Mono.
        display: ['var(--ph-font-display)'],
        sans: ['var(--ph-font-ui)'],
        mono: ['var(--ph-font-mono)'],
        serif: ['Playfair Display', 'Georgia', 'serif'],
      },
      screens: {
        phantom: '1024px',
      },
      width: {
        'status-bar': '1024px',
      },
      height: {
        // h-screen мусить означати висоту екрана. Перевизначення на 600px
        // робило застосунок 600-піксельною смугою на будь-якому моніторі —
        // саме звідси мертва чорна зона під згином. Рамка пристрою тепер
        // h-device там, де вона справді потрібна.
        device: '600px',
        'status-bar': '36px',
        main: '564px',
      },
      animation: {
        breathe: 'breathe 8s ease-in-out infinite',
        morph: 'morph 8s ease-in-out infinite',
        float: 'float 6s ease-in-out infinite',
        'pulse-slow': 'pulse 4s cubic-bezier(0.4, 0, 0.6, 1) infinite',
        'pulse-music': 'pulseMusic 1.2s cubic-bezier(0.4, 0, 0.6, 1) infinite',
        radar: 'radar 10s linear infinite',
        'fade-in': 'fadeIn 0.6s cubic-bezier(0.16, 1, 0.3, 1) forwards',
        equalizer: 'equalizer 1s ease-in-out infinite',
        scanline: 'scanline 3s linear infinite',
      },
      keyframes: {
        breathe: {
          '0%, 100%': { transform: 'scale(1)', opacity: '0.9' },
          '50%': { transform: 'scale(1.05)', opacity: '0.7' },
        },
        morph: {
          '0%': { borderRadius: '60% 40% 30% 70%/60% 30% 70% 40%' },
          '50%': { borderRadius: '30% 60% 70% 40%/50% 60% 30% 60%' },
          '100%': { borderRadius: '60% 40% 30% 70%/60% 30% 70% 40%' },
        },
        float: {
          '0%, 100%': { transform: 'translateY(0)' },
          '50%': { transform: 'translateY(-6px)' },
        },
        radar: {
          '0%': { transform: 'rotate(0deg)' },
          '100%': { transform: 'rotate(360deg)' },
        },
        fadeIn: {
          '0%': { opacity: '0', transform: 'translateY(16px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        pulseMusic: {
          '0%, 100%': { transform: 'scale(1)', opacity: '0.8' },
          '50%': { transform: 'scale(1.15)', opacity: '1' },
        },
        equalizer: {
          '0%, 100%': { height: '20%' },
          '50%': { height: '100%' },
        },
        scanline: {
          '0%': { transform: 'translateY(-100%)', opacity: '0' },
          '50%': { opacity: '0.5' },
          '100%': { transform: 'translateY(600px)', opacity: '0' },
        },
      },
    },
  },
  plugins: [],
};

export default config;

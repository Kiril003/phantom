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
      },
      fontFamily: {
        display: ['Space Grotesk', 'Outfit', 'system-ui', 'sans-serif'],
        sans: ['Space Grotesk', 'Outfit', 'system-ui', 'sans-serif'],
        mono: ['JetBrains Mono', 'ui-monospace', 'SF Mono', 'monospace'],
        serif: ['Playfair Display', 'Georgia', 'serif'],
      },
      screens: {
        phantom: '1024px',
      },
      width: {
        'status-bar': '1024px',
      },
      height: {
        screen: '600px',
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

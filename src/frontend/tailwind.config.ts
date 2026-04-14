import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        phantom: {
          bg: '#0A0E14',
          surface: '#0D1117',
          border: '#1E2A3A',
          cyan: '#00D4FF',
          'cyan-dim': '#0099BB',
          warning: '#FF6B35',
          success: '#39FF14',
          danger: '#FF073A',
          dream: '#9B8FD4',
          ghost: '#1A1A2E',
          text: '#C8D8E8',
          'text-dim': '#6B7E8F',
          'text-bright': '#E8F4FF',
        },
      },
      fontFamily: {
        mono: ['JetBrains Mono', 'Fira Code', 'Consolas', 'monospace'],
        ui: ['Inter', 'system-ui', 'sans-serif'],
      },
      screens: {
        phantom: '1024px',
      },
      width: {
        'status-bar': '1024px',
      },
      height: {
        screen: '600px',
        'status-bar': '28px',
        'main': '572px',
      },
      animation: {
        'pulse-cyan': 'pulse-cyan 2s ease-in-out infinite',
        'breathe': 'breathe 4s ease-in-out infinite',
        'scan': 'scan 2s linear infinite',
        'flicker': 'flicker 0.15s ease-in-out infinite',
        'state-transition': 'state-transition 0.4s ease-out',
      },
      keyframes: {
        'pulse-cyan': {
          '0%, 100%': { boxShadow: '0 0 4px #00D4FF40' },
          '50%': { boxShadow: '0 0 12px #00D4FFAA' },
        },
        breathe: {
          '0%, 100%': { opacity: '0.4', transform: 'scale(1)' },
          '50%': { opacity: '1', transform: 'scale(1.02)' },
        },
        scan: {
          '0%': { transform: 'translateY(-100%)' },
          '100%': { transform: 'translateY(100%)' },
        },
        flicker: {
          '0%, 100%': { opacity: '1' },
          '50%': { opacity: '0.8' },
        },
        'state-transition': {
          '0%': { opacity: '0', transform: 'scale(0.98)' },
          '100%': { opacity: '1', transform: 'scale(1)' },
        },
      },
      boxShadow: {
        'cyan-glow': '0 0 8px #00D4FF60',
        'danger-glow': '0 0 8px #FF073A60',
        'success-glow': '0 0 8px #39FF1460',
        'dream-glow': '0 0 12px #9B8FD460',
      },
    },
  },
  plugins: [],
};

export default config;

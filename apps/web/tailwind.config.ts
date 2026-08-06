import type { Config } from 'tailwindcss';

/**
 * Design system PropectAI.
 * Referencia dos tokens: CLAUDE.md e docs/strategic/scope-v0.1.1.md
 *
 * Cores literais em vez de var(--...) de proposito: permite que os
 * modificadores de opacidade do Tailwind (bg-brand-600/10) funcionem.
 * As mesmas cores existem como CSS variables em globals.css para uso
 * fora do Tailwind.
 */
const config: Config = {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        navy: {
          900: '#14213D',
          950: '#0F1B33',
        },
        brand: {
          50: '#EAF2FC',
          100: '#DCEAFF',
          600: '#2F6BFF',
          700: '#1F56D9',
        },
        surface: {
          DEFAULT: '#FFFFFF',
          soft: '#F5F8FD',
        },
        appbg: '#EAF2FC',
        line: '#D8E3F1',
        muted: '#6B7A99',
        success: '#22C55E',
        warning: '#F59E0B',
        danger: '#EF4444',
        info: '#3B82F6',
      },
      fontFamily: {
        sans: ['var(--font-inter)', 'ui-sans-serif', 'system-ui', 'sans-serif'],
      },
      fontSize: {
        'page-title': ['1.75rem', { lineHeight: '2.125rem', fontWeight: '700' }],
        kpi: ['2.25rem', { lineHeight: '2.5rem', fontWeight: '700' }],
        'card-title': ['0.8125rem', { lineHeight: '1.125rem', fontWeight: '600' }],
        label: ['0.6875rem', { lineHeight: '1rem', fontWeight: '600' }],
      },
      borderRadius: {
        card: '14px',
        control: '9px',
      },
      boxShadow: {
        card: '0 8px 24px rgba(15, 27, 51, 0.06)',
        'card-hover': '0 12px 32px rgba(15, 27, 51, 0.10)',
      },
      spacing: {
        sidebar: '176px',
        topbar: '60px',
      },
      keyframes: {
        shimmer: {
          '100%': { transform: 'translateX(100%)' },
        },
      },
      animation: {
        shimmer: 'shimmer 1.6s infinite',
      },
    },
  },
  plugins: [],
};

export default config;

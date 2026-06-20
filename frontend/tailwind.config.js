export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        // Brand colors (heavy blue)
        brand: {
          50: '#eff6ff',
          100: '#dbeafe',
          200: '#bfdbfe',
          300: '#93c5fd',
          400: '#60a5fa',
          500: '#3b82f6',
          600: '#2563eb',
          700: '#1d4ed8',
          800: '#1e40af',
          900: '#1e3a8a',
          950: '#172554',
        },

        // Success states
        success: {
          50: '#f0fdf4',
          100: '#dcfce7',
          200: '#bbf7d0',
          300: '#86efac',
          400: '#4ade80',
          500: '#22c55e',
          600: '#16a34a',
          700: '#15803d',
          800: '#166534',
          900: '#14532d',
          950: '#052e16',
        },

        // Error states
        error: {
          50: '#fef2f2',
          100: '#fee2e2',
          200: '#fecaca',
          300: '#fca5a5',
          400: '#f87171',
          500: '#ef4444',
          600: '#dc2626',
          700: '#b91c1c',
          800: '#991b1b',
          900: '#7f1d1d',
          950: '#450a0a',
        },

        // Warning states
        warning: {
          50: '#fffbeb',
          100: '#fef3c7',
          200: '#fde68a',
          300: '#fcd34d',
          400: '#fbbf24',
          500: '#f59e0b',
          600: '#d97706',
          700: '#b45309',
          800: '#92400e',
          900: '#78350f',
          950: '#451a03',
        },

        // Info states
        info: {
          50: '#eff6ff',
          100: '#dbeafe',
          200: '#bfdbfe',
          300: '#93c5fd',
          400: '#60a5fa',
          500: '#3b82f6',
          600: '#2563eb',
          700: '#1d4ed8',
          800: '#1e40af',
          900: '#1e3a8a',
          950: '#172554',
        },

        // Surface colors — CSS-variable channels so data-palette can re-theme them
        surface: {
          DEFAULT: 'rgb(var(--surface) / <alpha-value>)',
          secondary: 'rgb(var(--surface-secondary) / <alpha-value>)',
          tertiary: 'rgb(var(--surface-tertiary) / <alpha-value>)',
          hover: 'rgb(var(--surface-hover) / <alpha-value>)',
          active: 'rgb(var(--surface-active) / <alpha-value>)',
          dark: {
            DEFAULT: 'rgb(var(--surface-dark) / <alpha-value>)',
            secondary: 'rgb(var(--surface-dark-secondary) / <alpha-value>)',
            tertiary: 'rgb(var(--surface-dark-tertiary) / <alpha-value>)',
            hover: 'rgb(var(--surface-dark-hover) / <alpha-value>)',
            active: 'rgb(var(--surface-dark-active) / <alpha-value>)',
          },
        },

        // Border colors
        border: {
          DEFAULT: 'rgb(var(--border) / <alpha-value>)',
          secondary: 'rgb(var(--border-secondary) / <alpha-value>)',
          hover: 'rgb(var(--border-hover) / <alpha-value>)',
          dark: {
            DEFAULT: 'rgb(var(--border-dark) / <alpha-value>)',
            secondary: 'rgb(var(--border-dark-secondary) / <alpha-value>)',
            hover: 'rgb(var(--border-dark-hover) / <alpha-value>)',
          },
        },

        // macOS traffic light colors
        'traffic-close': '#ff5f57',
        'traffic-minimize': '#febc2e',
        'traffic-maximize': '#28c840',

        // Text colors
        text: {
          primary: 'rgb(var(--text-primary) / <alpha-value>)',
          secondary: 'rgb(var(--text-secondary) / <alpha-value>)',
          tertiary: 'rgb(var(--text-tertiary) / <alpha-value>)',
          quaternary: 'rgb(var(--text-quaternary) / <alpha-value>)',
          dark: {
            primary: 'rgb(var(--text-dark-primary) / <alpha-value>)',
            secondary: 'rgb(var(--text-dark-secondary) / <alpha-value>)',
            tertiary: 'rgb(var(--text-dark-tertiary) / <alpha-value>)',
            quaternary: 'rgb(var(--text-dark-quaternary) / <alpha-value>)',
          },
        },
      },

      keyframes: {
        shimmer: {
          '0%': { left: '-33%' },
          '100%': { left: '100%' },
        },
        fadeIn: {
          '0%': { opacity: '0', transform: 'translateY(10px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        'fade-in': {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
        'fade-out': {
          '0%': { opacity: '1' },
          '100%': { opacity: '0' },
        },
        'slide-in': {
          '0%': { transform: 'translateX(-100%)' },
          '100%': { transform: 'translateX(0)' },
        },
        'slide-out': {
          '0%': { transform: 'translateX(0)' },
          '100%': { transform: 'translateX(-100%)' },
        },
        pulse: {
          '0%, 100%': { opacity: '1' },
          '50%': { opacity: '0.5' },
        },
        bounce: {
          '0%, 100%': {
            transform: 'translateY(-25%)',
            animationTimingFunction: 'cubic-bezier(0.8, 0, 1, 1)',
          },
          '50%': {
            transform: 'translateY(0)',
            animationTimingFunction: 'cubic-bezier(0, 0, 0.2, 1)',
          },
        },
        'fade-in-up': {
          '0%': { opacity: '0', transform: 'translateY(4px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        'dot-pulse': {
          '0%, 100%': { opacity: '0.3' },
          '50%': { opacity: '1' },
        },
        'progress-bar': {
          '0%': { width: '0%' },
          '100%': { width: '100%' },
        },
      },

      animation: {
        shimmer: 'shimmer 1.5s ease-in-out infinite',
        fadeIn: 'fadeIn 0.3s ease-out forwards',
        'fade-in': 'fade-in 0.2s ease-out forwards',
        'fade-out': 'fade-out 0.2s ease-out forwards',
        'slide-in': 'slide-in 0.3s ease-out',
        'slide-out': 'slide-out 0.3s ease-in',
        'pulse-slow': 'pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite',
        'bounce-gentle': 'bounce 1s infinite',
        'fade-in-up': 'fade-in-up 0.35s ease-out forwards',
        'dot-pulse': 'dot-pulse 1.4s ease-in-out infinite',
        'progress-bar': 'progress-bar 5s linear infinite',
      },

      // Custom spacing
      spacing: {
        18: '4.5rem',
        88: '22rem',
        128: '32rem',
      },

      // Safe area padding for mobile
      padding: {
        safe: 'env(safe-area-inset-bottom)',
      },

      // Custom border radius
      borderRadius: {
        '4xl': '2rem',
        '5xl': '3rem',
      },

      // Custom shadows
      boxShadow: {
        soft: '0 2px 15px -3px rgba(0, 0, 0, 0.07), 0 10px 20px -2px rgba(0, 0, 0, 0.04)',
        medium: '0 4px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04)',
        strong: '0 10px 40px -10px rgba(0, 0, 0, 0.15), 0 4px 25px -5px rgba(0, 0, 0, 0.1)',
        glow: '0 0 20px rgba(0, 0, 0, 0.15)',
        'glow-lg': '0 0 40px rgba(0, 0, 0, 0.2)',
      },

      // Typography
      fontSize: {
        '2xs': ['0.625rem', { lineHeight: '0.875rem' }],
      },
    },
  },
  plugins: [],
};

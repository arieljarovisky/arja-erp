// tailwind.config.js
/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  darkMode: 'class',
  theme: {
    screens: {
      'xs': '475px',
      'sm': '640px',
      'md': '768px',
      'lg': '1024px',
      'xl': '1280px',
      '2xl': '1536px',
    },
    extend: {
      colors: {
        // Tokens ARJA ERP
        background: {
          DEFAULT: 'rgb(var(--background))',
          secondary: 'rgb(var(--background-secondary))',
        },
        foreground: {
          DEFAULT: 'rgb(var(--foreground))',
          secondary: 'rgb(var(--foreground-secondary))',
          muted: 'rgb(var(--foreground-muted))',
        },
        border: {
          DEFAULT: 'rgb(var(--border))',
          hover: 'rgb(var(--border-hover))',
        },
        primary: {
          DEFAULT: 'rgb(var(--primary))',
          hover: 'rgb(var(--primary-hover))',
          light: 'rgb(var(--primary-light))',
          50: '#f2f6fb',
          100: '#e5edf5',
          200: '#c6d4e4',
          300: '#a6bbd3',
          400: '#7a93b6',
          500: '#4f6c98',
          600: '#364f7c',
          700: '#273b62',
          800: '#1a2748',
          900: '#0f1b30',
        },
        accent: {
          DEFAULT: 'rgb(var(--accent))',
          hover: 'rgb(var(--accent-hover))',
          50: '#f7f8f9',
          100: '#eceff1',
          200: '#d8dce0',
          300: '#c2c7cc',
          400: '#9aa0a6',
          500: '#7e868d',
          600: '#636a72',
          700: '#4d545b',
          800: '#363b41',
          900: '#25292d',
        },
        // Mantener dark para compatibilidad
        dark: {
          50: '#18181b',
          100: '#27272a',
          200: '#3f3f46',
          300: '#52525b',
          400: '#71717a',
          500: '#a1a1aa',
          600: '#d4d4d8',
          700: '#e4e4e7',
          800: '#f4f4f5',
          900: '#fafafa',
        },
      },
      animation: {
        'fade-in': 'fadeIn 0.3s ease-in-out',
        'slide-up': 'slideUp 0.3s ease-out',
        'slide-down': 'slideDown 0.3s ease-out',
        'scale-in': 'scaleIn 0.2s ease-out',
      },
      keyframes: {
        fadeIn: {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
        slideUp: {
          '0%': { transform: 'translateY(10px)', opacity: '0' },
          '100%': { transform: 'translateY(0)', opacity: '1' },
        },
        slideDown: {
          '0%': { transform: 'translateY(-10px)', opacity: '0' },
          '100%': { transform: 'translateY(0)', opacity: '1' },
        },
        scaleIn: {
          '0%': { transform: 'scale(0.95)', opacity: '0' },
          '100%': { transform: 'scale(1)', opacity: '1' },
        },
      },
      backgroundImage: {
        'gradient-dark': 'linear-gradient(to bottom right, #101820, #0c1118)',
        'gradient-primary': 'linear-gradient(135deg, #0f233b 0%, #1e3b5f 52%, #6a8eb8 100%)',
      },
      boxShadow: {
        'dark': '0 12px 30px -12px rgba(15, 35, 59, 0.45)',
        'dark-lg': '0 20px 45px -18px rgba(15, 35, 59, 0.55)',
        'glow': '0 0 20px rgba(79, 108, 152, 0.35)',
        'glow-lg': '0 0 40px rgba(79, 108, 152, 0.45)',
      },
    },
  },
  plugins: [],
}
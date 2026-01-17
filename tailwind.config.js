/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './src/pages/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        forge: {
          // Professional color palette - refined and cohesive
          primary: '#FF660E',      // Vibrant Orange - primary brand color
          'primary-dark': '#CC520B', // Darker orange
          'primary-light': '#FF8A4B', // Lighter orange
          secondary: '#1A1A2E',    // Deep Navy - secondary brand color
          'secondary-dark': '#16213E', // Darker navy
          'secondary-light': '#0F3460', // Lighter navy
          accent: '#FF660E',       // Orange accent
          'accent-dark': '#CC520B',
          dark: '#0D1117',         // GitHub dark
          'dark-light': '#161B22', // Slightly lighter dark
          flame: '#FF660E',        // Main flame color
          'flame-dark': '#CC520B', // Dark flame
          'flame-light': '#FF8A4B', // Light flame
          gray: {
            50: '#F8FAFC',   // Clean White
            100: '#F1F5F9',
            200: '#E2E8F0',
            300: '#CBD5E1',
            400: '#94A3B8',
            500: '#64748B',
            600: '#475569',
            700: '#334155',
            800: '#1E293B',
            900: '#0F172A',
            950: '#020617',
          },
          // Status colors
          success: '#10B981',
          'success-dark': '#059669',
          warning: '#F59E0B',
          'warning-dark': '#D97706',
          error: '#EF4444',
          'error-dark': '#DC2626',
          info: '#3B82F6',
          'info-dark': '#2563EB',
        },
        // Gradient colors - Professional and modern
        gradient: {
          'forge-primary': 'linear-gradient(135deg, #FF660E 0%, #FF8A4B 100%)',
          'forge-secondary': 'linear-gradient(135deg, #1A1A2E 0%, #0F3460 100%)',
          'forge-flame': 'linear-gradient(135deg, #FF660E 0%, #FF8A4B 100%)',
          'dark-gradient': 'linear-gradient(135deg, #0D1117 0%, #1A1A2E 100%)',
          'speed-gradient': 'linear-gradient(135deg, #FF660E 0%, #1A1A2E 50%, #FF8A4B 100%)',
          'brand-gradient': 'linear-gradient(135deg, #FF660E 0%, #1A1A2E 100%)',
          'hero-gradient': 'linear-gradient(135deg, #0D1117 0%, #1A1A2E 50%, #0F3460 100%)',
        }
      },
      fontFamily: {
        sans: ['Satoshi', 'Inter', 'system-ui', 'sans-serif'],
        heading: ['"Azeret Mono"', 'Satoshi', 'monospace'],
        mono: ['"Azeret Mono"', 'JetBrains Mono', 'Fira Code', 'monospace'],
        inter: ['Inter', 'system-ui', 'sans-serif'],
      },
      fontSize: {
        'xs': ['0.75rem', { lineHeight: '1rem' }],
        'sm': ['0.875rem', { lineHeight: '1.25rem' }],
        'base': ['1rem', { lineHeight: '1.5rem' }],
        'lg': ['1.125rem', { lineHeight: '1.75rem' }],
        'xl': ['1.25rem', { lineHeight: '1.75rem' }],
        '2xl': ['1.5rem', { lineHeight: '2rem' }],
        '3xl': ['1.875rem', { lineHeight: '2.25rem' }],
        '4xl': ['2.25rem', { lineHeight: '2.5rem' }],
        '5xl': ['3rem', { lineHeight: '1' }],
        '6xl': ['3.75rem', { lineHeight: '1' }],
        '7xl': ['4.5rem', { lineHeight: '1' }],
        '8xl': ['6rem', { lineHeight: '1' }],
        '9xl': ['8rem', { lineHeight: '1' }],
      },
      spacing: {
        '18': '4.5rem',
        '88': '22rem',
        '128': '32rem',
      },
      borderRadius: {
        '4xl': '2rem',
        '5xl': '2.5rem',
      },
      boxShadow: {
        'forge': '0 10px 25px -5px rgba(232, 81, 2, 0.15), 0 10px 10px -5px rgba(232, 81, 2, 0.1)',
        'forge-lg': '0 20px 25px -5px rgba(232, 81, 2, 0.2), 0 10px 10px -5px rgba(232, 81, 2, 0.1)',
        'flame': '0 0 20px rgba(232, 81, 2, 0.4)',
        'flame-lg': '0 0 40px rgba(232, 81, 2, 0.6)',
        'speed': '0 0 30px rgba(232, 81, 2, 0.3), 0 0 60px rgba(0, 0, 54, 0.2)',
        'midnight': '0 0 20px rgba(0, 0, 54, 0.4)',
        'midnight-lg': '0 0 40px rgba(0, 0, 54, 0.6)',
      },
      animation: {
        'fade-in': 'fadeIn 0.5s ease-in-out',
        'slide-up': 'slideUp 0.3s ease-out',
        'slide-down': 'slideDown 0.3s ease-out',
        'scale-in': 'scaleIn 0.2s ease-out',
        'bounce-gentle': 'bounceGentle 2s infinite',
        'pulse-glow': 'pulseGlow 2s infinite',
        'float': 'float 3s ease-in-out infinite',
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
        bounceGentle: {
          '0%, 100%': { transform: 'translateY(0)' },
          '50%': { transform: 'translateY(-5px)' },
        },
        pulseGlow: {
          '0%, 100%': { boxShadow: '0 0 20px rgba(232, 81, 2, 0.3)' },
          '50%': { boxShadow: '0 0 40px rgba(232, 81, 2, 0.6)' },
        },
        float: {
          '0%, 100%': { transform: 'translateY(0px)' },
          '50%': { transform: 'translateY(-10px)' },
        },
      },
      backdropBlur: {
        xs: '2px',
      },
    },
  },
  plugins: [
    require('@tailwindcss/forms'),
    require('@tailwindcss/typography'),
  ],
  safelist: [
    'font-satoshi',
    'font-satoshi-light',
    'font-satoshi-bold',
    'font-satoshi-black',
    'text-forge-primary',
    'text-forge-secondary',
    'bg-forge-primary',
    'bg-forge-secondary',
    'border-forge-primary',
    'border-forge-secondary',
    'from-forge-primary',
    'to-forge-secondary',
    'hover:from-forge-primary-dark',
    'hover:to-forge-secondary-dark',
  ],
}

/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        ops: {
          bg: '#060b14',
          panel: '#0b1424',
          panel2: '#0f1b2f',
          line: '#1b2c47',
          dim: '#5d7391',
          text: '#c9d8ec',
          cyan: '#38d6f5',
          blue: '#3b82f6',
          green: '#34d399',
          amber: '#f5b13d',
          red: '#f2545b',
          violet: '#a78bfa',
        },
      },
      fontFamily: {
        mono: ['"JetBrains Mono"', 'ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
        sans: ['"Rajdhani"', '"Inter"', 'system-ui', 'sans-serif'],
      },
    },
  },
  plugins: [],
};

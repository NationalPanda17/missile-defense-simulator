/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        ops: {
          bg: 'rgb(var(--ops-bg) / <alpha-value>)',
          panel: 'rgb(var(--ops-panel) / <alpha-value>)',
          panel2: 'rgb(var(--ops-panel2) / <alpha-value>)',
          line: 'rgb(var(--ops-line) / <alpha-value>)',
          dim: 'rgb(var(--ops-dim) / <alpha-value>)',
          text: 'rgb(var(--ops-text) / <alpha-value>)',
          cyan: 'rgb(var(--ops-cyan) / <alpha-value>)',
          blue: 'rgb(var(--ops-blue) / <alpha-value>)',
          green: 'rgb(var(--ops-green) / <alpha-value>)',
          amber: 'rgb(var(--ops-amber) / <alpha-value>)',
          red: 'rgb(var(--ops-red) / <alpha-value>)',
          violet: 'rgb(var(--ops-violet) / <alpha-value>)',
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

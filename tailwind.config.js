/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        background: '#080b10',
        primary: '#00ff88',
        negative: '#ff4444',
        edge: '#ffcc00',
        auth: '#4488ff'
      },
      fontFamily: {
        mono: ['"IBM Plex Mono"', '"JetBrains Mono"', 'monospace']
      }
    },
  },
  plugins: [],
}

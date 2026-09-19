/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./app/**/*.{js,ts,jsx,tsx}', './components/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        ink:       '#0d1f24',
        deep:      { DEFAULT: '#13343b', 2: '#0c2429' },
        paper:     { DEFAULT: '#f6f3ec', soft: '#fbf9f4' },
        mist:      '#dfe6e3',
        jade:      { DEFAULT: '#37b59b', deep: '#1f7d6b' },
        amber:     { DEFAULT: '#d8a24a', deep: '#8a6020' },
        rose:      '#c2675e',
        blue:      { DEFAULT: '#5a8fa8', deep: '#33607a' },
        // legacy names kept for backwards compat
        ground:   { DEFAULT: '#13343b', light: '#1a2e35' },
        surface:  { DEFAULT: '#f6f3ec', muted: '#ede8df' },
      },
      fontFamily: {
        serif: ['Newsreader', 'Georgia', 'serif'],
        sans:  ['Space Grotesk', 'system-ui', 'sans-serif'],
        mono:  ['Space Mono', 'monospace'],
      },
      borderRadius: {
        phone: '38px',
        screen: '29px',
      },
    },
  },
  plugins: [],
}

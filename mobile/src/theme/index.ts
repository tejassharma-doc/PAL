export const PAL = {
  // Brand
  jade: '#37b59b',
  jadeDeep: '#1f7d6b',
  jadeFaint: 'rgba(55,181,155,0.12)',
  jadeBorder: 'rgba(55,181,155,0.22)',
  rose: '#c2675e',
  roseFaint: 'rgba(194,103,94,0.14)',
  roseBorder: 'rgba(194,103,94,0.35)',

  // Dark surfaces
  navyDeep: '#0c2429',
  navyMid: '#13343b',
  navyBorder: 'rgba(255,255,255,0.08)',

  // Light surfaces
  cream: '#f6f3ec',
  creamMuted: 'rgba(246,243,236,0.55)',
  creamFaint: 'rgba(246,243,236,0.08)',
  surface: '#ffffff',
  surfaceBorder: 'rgba(13,31,36,0.10)',

  // Text
  textDark: '#0d1f24',
  textMuted: 'rgba(13,31,36,0.55)',
  textFaint: 'rgba(13,31,36,0.40)',
  bg: '#f4f1ea',
} as const

export const FONT = {
  serif: 'serif' as const,
  mono: 'monospace' as const,
  sans: 'sans-serif' as const,
}

export const RADIUS = {
  sm: 9,
  md: 14,
  lg: 20,
  pill: 50,
  full: 9999,
} as const

export const SPACE = {
  xs: 4,
  sm: 8,
  md: 14,
  lg: 20,
  xl: 28,
  xxl: 40,
} as const

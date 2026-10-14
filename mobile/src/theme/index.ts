/**
 * PAL design tokens — mirrored from the website (web/app/globals.css and the
 * `c` palette in web/app/page.tsx) so the Android app and palcare.life look
 * like one product.
 *
 * Fonts are the website's three families, bundled as TTFs in
 * android/app/src/main/assets/fonts (SIL Open Font License):
 *   Newsreader      — serif headlines and answers
 *   Space Grotesk   — UI text
 *   Space Mono      — small uppercase labels, metadata
 * On Android each weight is its own family name, so use F.* below instead of
 * fontWeight with a custom family.
 */

export const C = {
  ink: '#0d1f24',
  deep: '#13343b',
  deep2: '#0c2429',
  paper: '#f6f3ec',
  soft: '#fbf9f4',
  white: '#ffffff',
  mist: '#dfe6e3',
  jade: '#37b59b',
  jadeD: '#1f7d6b',
  amber: '#d8a24a',
  amberD: '#8a6020',
  rose: '#c2675e',
  blue: '#5a8fa8',
  blueD: '#33607a',
  line: 'rgba(13,31,36,0.14)',
  line2: 'rgba(13,31,36,0.22)',
  jadeTint: 'rgba(55,181,155,0.14)',
  jadeTint2: 'rgba(55,181,155,0.08)',
  roseTint: 'rgba(194,103,94,0.06)',
  roseLine: 'rgba(194,103,94,0.30)',
  amberTint: 'rgba(216,162,74,0.08)',
  amberLine: 'rgba(216,162,74,0.35)',
  scrim: 'rgba(13,31,36,0.45)',
  /** Secondary text — solid, never faded (legible for older eyes). */
  muted: '#4a5a5f',
  faint: '#4a5a5f',
  /** Every icon (tabs, top bar, composer) — same dark grey on web and app. */
  icon: '#2f3b40',
  activeTint: 'rgba(31,125,107,0.12)',
} as const

export const F = {
  serifLight: 'Newsreader-Light',
  serifLightItalic: 'Newsreader-LightItalic',
  serif: 'Newsreader-Regular',
  serifItalic: 'Newsreader-Italic',
  serifMedium: 'Newsreader-Medium',
  sans: 'SpaceGrotesk-Regular',
  sansMedium: 'SpaceGrotesk-Medium',
  sansSemi: 'SpaceGrotesk-SemiBold',
  sansBold: 'SpaceGrotesk-Bold',
  mono: 'SpaceMono-Regular',
  monoBold: 'SpaceMono-Bold',
} as const

/** The website sizes are in rem (16px); these are the same values in dp. */
export const T = {
  slab: { fontFamily: F.mono, fontSize: 11.5, letterSpacing: 1.2, textTransform: 'uppercase' as const, color: C.muted },
  meta: { fontFamily: F.mono, fontSize: 12, color: C.muted },
  h1: { fontFamily: F.serif, fontSize: 29, letterSpacing: -0.3, lineHeight: 34, color: C.ink },
  h2: { fontFamily: F.serif, fontSize: 25, lineHeight: 30, color: C.ink },
  lead: { fontFamily: F.sans, fontSize: 16, color: C.muted, lineHeight: 23 },
  body: { fontFamily: F.sans, fontSize: 16, color: C.ink, lineHeight: 24 },
  bodySerif: { fontFamily: F.serif, fontSize: 17, color: C.ink, lineHeight: 27 },
  title: { fontFamily: F.sansSemi, fontSize: 16, color: C.ink, lineHeight: 22 },
} as const

export const R = { sm: 9, md: 11, lg: 13, xl: 16, sheet: 20, pill: 999 } as const

export const S = { xs: 4, sm: 8, md: 12, lg: 18, xl: 24, xxl: 36 } as const

/** Avatar gradient (web: linear-gradient(150deg,#37b59b,#1f7d6b)). */
export const AVATAR_GRAD = ['#37b59b', '#1f7d6b'] as const
/** Dark hero card (web: linear-gradient(160deg,#13343b,#0c2429)). */
export const DEEP_GRAD = ['#13343b', '#0c2429'] as const

// ── Legacy names used by the original screens/components (kept so the
// Hermes call components and Fugu router UI still compile). ──
export const PAL = {
  jade: C.jade,
  jadeDeep: C.jadeD,
  jadeFaint: 'rgba(55,181,155,0.12)',
  jadeBorder: 'rgba(55,181,155,0.22)',
  rose: C.rose,
  roseFaint: 'rgba(194,103,94,0.14)',
  roseBorder: 'rgba(194,103,94,0.35)',
  navyDeep: C.deep2,
  navyMid: C.deep,
  navyBorder: 'rgba(255,255,255,0.08)',
  cream: C.paper,
  creamMuted: 'rgba(246,243,236,0.55)',
  creamFaint: 'rgba(246,243,236,0.08)',
  surface: C.white,
  surfaceBorder: C.line,
  textDark: C.ink,
  textMuted: 'rgba(13,31,36,0.55)',
  textFaint: 'rgba(13,31,36,0.40)', // legacy (Hermes components only)
  bg: C.soft,
} as const

export const FONT = { serif: F.serifLight, mono: F.mono, sans: F.sans } as const
export const RADIUS = { sm: 9, md: 14, lg: 20, pill: 50, full: 9999 } as const
export const SPACE = { xs: 4, sm: 8, md: 14, lg: 20, xl: 28, xxl: 40 } as const

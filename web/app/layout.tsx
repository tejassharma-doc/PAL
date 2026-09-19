import type { Metadata, Viewport } from 'next'
import './globals.css'
import ClientPreloader from './ClientPreloader'
import { Newsreader, Space_Grotesk, Space_Mono } from 'next/font/google'

const newsreader = Newsreader({ subsets: ['latin'], variable: '--font-serif', display: 'swap' })
const spaceGrotesk = Space_Grotesk({ subsets: ['latin'], variable: '--font-sans', display: 'swap' })
const spaceMono = Space_Mono({ weight: ['400', '700'], subsets: ['latin'], variable: '--font-mono', display: 'swap' })

export const metadata: Metadata = {
  title: 'PAL — Your Health, Answered',
  description: 'Patient-owned health record and universal health search.',
  manifest: '/manifest.json',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'default',
    title: 'PAL',
  },
  icons: {
    icon: '/icon.svg',
    apple: '/apple-touch-icon.png',
  },
}

export const viewport: Viewport = {
  themeColor: '#37b59b',
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${newsreader.variable} ${spaceGrotesk.variable} ${spaceMono.variable}`}>
      <body style={{ minHeight: '100vh', background: 'var(--deep-2)', color: 'var(--ink)' }}>
        {/* Warm up SmolLM2 classifier + Whisper STT in background Web Workers */}
        <ClientPreloader />
        {children}
      </body>
    </html>
  )
}

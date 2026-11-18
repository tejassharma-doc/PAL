'use client'

/**
 * Shared UI preferences for the redesign shell: text size (--scale), high
 * contrast, and read-aloud. Persisted in localStorage and broadcast via a
 * `pal-uiprefs` event so the Settings controls and the AppShell stay in sync
 * across the tree (and across tabs via the storage event).
 */
import { useCallback, useEffect, useState } from 'react'

export const TEXT_SCALES = [1, 1.18, 1.38] as const

function num(key: string, def: number): number {
  if (typeof window === 'undefined') return def
  const v = parseFloat(localStorage.getItem(key) || '')
  return Number.isFinite(v) && v > 0 ? v : def
}
function flag(key: string): boolean {
  if (typeof window === 'undefined') return false
  return localStorage.getItem(key) === '1'
}

export function useUiPrefs() {
  const [scale, setScaleState] = useState(1)
  const [hc, setHcState] = useState(false)
  const [readAloud, setReadAloudState] = useState(false)

  useEffect(() => {
    const load = () => {
      setScaleState(num('pal_text_scale', 1))
      setHcState(flag('pal_high_contrast'))
      setReadAloudState(flag('pal_read_aloud'))
    }
    load()
    const handler = () => load()
    window.addEventListener('pal-uiprefs', handler)
    window.addEventListener('storage', handler)
    return () => {
      window.removeEventListener('pal-uiprefs', handler)
      window.removeEventListener('storage', handler)
    }
  }, [])

  const broadcast = () => window.dispatchEvent(new Event('pal-uiprefs'))

  const setScale = useCallback((s: number) => {
    localStorage.setItem('pal_text_scale', String(s)); broadcast()
  }, [])
  const cycleScale = useCallback(() => {
    const cur = num('pal_text_scale', 1)
    const i = TEXT_SCALES.indexOf(cur as (typeof TEXT_SCALES)[number])
    setScale(TEXT_SCALES[(i + 1) % TEXT_SCALES.length])
  }, [setScale])
  const setHc = useCallback((v: boolean) => {
    localStorage.setItem('pal_high_contrast', v ? '1' : '0'); broadcast()
  }, [])
  const setReadAloud = useCallback((v: boolean) => {
    localStorage.setItem('pal_read_aloud', v ? '1' : '0'); broadcast()
  }, [])

  return { scale, setScale, cycleScale, hc, setHc, readAloud, setReadAloud }
}

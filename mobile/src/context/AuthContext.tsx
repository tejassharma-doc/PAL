import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { AppState } from 'react-native'
import { Session, loadSession } from '../lib/session'
import { onUnauthorized } from '../lib/http'
import * as api from '../lib/api'

interface AuthState {
  ready: boolean
  session: Session | null
  /** set when the server rejected our token; shown once on the login screen */
  notice: string | null
  setSession: (s: Session | null) => void
  refresh: () => Promise<void>
  signOut: () => Promise<void>
  clearNotice: () => void
}

const Ctx = createContext<AuthState | null>(null)

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [ready, setReady] = useState(false)
  const [session, setSession] = useState<Session | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    setSession(await loadSession())
  }, [])

  useEffect(() => {
    refresh().finally(() => setReady(true))
    const unsub = onUnauthorized(() => {
      setSession(null)
      setNotice('Your session has expired. Please sign in again.')
    })
    // Coming back to the app after a while: loadSession() notices an expired
    // token and fires the listener above.
    const sub = AppState.addEventListener('change', st => {
      if (st === 'active') loadSession()
    })
    return () => {
      unsub()
      sub.remove()
    }
  }, [refresh])

  const signOut = useCallback(async () => {
    await api.signOut()
    setSession(null)
  }, [])

  const value = useMemo<AuthState>(
    () => ({
      ready,
      session,
      notice,
      setSession,
      refresh,
      signOut,
      clearNotice: () => setNotice(null),
    }),
    [ready, session, notice, refresh, signOut],
  )
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useAuth(): AuthState {
  const v = useContext(Ctx)
  if (!v) throw new Error('useAuth must be used inside <AuthProvider>')
  return v
}

import { create } from 'zustand'

interface AuthState {
  token: string | null
  userId: string | null
  tenantId: string
  preferredLang: string
  setAuth: (token: string, userId: string, lang: string) => void
  clearAuth: () => void
  hydrate: () => void
}

export const DEFAULT_TENANT_ID = '00000000-0000-0000-0000-000000000001'

export const useAuthStore = create<AuthState>()((set) => ({
  token: null,
  userId: null,
  tenantId: DEFAULT_TENANT_ID,
  preferredLang: 'en',

  hydrate: () => {
    if (typeof window === 'undefined') return
    set({
      token: localStorage.getItem('pal_token'),
      userId: localStorage.getItem('pal_user_id'),
      preferredLang: localStorage.getItem('pal_preferred_lang') || 'en',
    })
  },

  setAuth: (token, userId, lang) => {
    if (typeof window !== 'undefined') {
      localStorage.setItem('pal_token', token)
      localStorage.setItem('pal_user_id', userId)
      localStorage.setItem('pal_preferred_lang', lang)
    }
    set({ token, userId, preferredLang: lang })
  },

  clearAuth: () => {
    if (typeof window !== 'undefined') {
      localStorage.removeItem('pal_token')
      localStorage.removeItem('pal_user_id')
      localStorage.removeItem('pal_preferred_lang')
    }
    set({ token: null, userId: null })
  },
}))

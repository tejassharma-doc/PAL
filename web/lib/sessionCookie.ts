/**
 * "Signed in on this browser" flag for the server.
 *
 * The auth token lives in localStorage, which the server cannot see. To decide
 * whether "/" shows the landing page (visitors) or the app (signed-in users),
 * next.config.js checks this small cookie. It holds no token or personal data —
 * only "1". Set it wherever pal_token is stored; clear it wherever it is removed.
 */
const NAME = 'pal_session'
const MAX_AGE = 60 * 60 * 24 * 30 // 30 days; refreshed on every sign-in

export function markSignedIn(): void {
  if (typeof document === 'undefined') return
  document.cookie = `${NAME}=1; Path=/; Max-Age=${MAX_AGE}; SameSite=Lax`
}

export function markSignedOut(): void {
  if (typeof document === 'undefined') return
  document.cookie = `${NAME}=; Path=/; Max-Age=0; SameSite=Lax`
}

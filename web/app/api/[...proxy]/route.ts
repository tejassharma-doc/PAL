/**
 * Catch-all proxy — forwards /api/* to the FastAPI backend.
 *
 * Next.js URL         → FastAPI URL
 * /api/auth/verify-otp → http://localhost:8000/auth/verify-otp
 * /api/search          → http://localhost:8000/search
 * /api/records/…       → http://localhost:8000/records/…
 *
 * Runs server-side (no CORS needed — same-machine fetch).
 */

import { NextRequest, NextResponse } from 'next/server'

// Docker service name by default, exactly as before. The env override exists
// so a non-Docker dev run (or a differently named service) does not silently
// fail every API call — the default is unchanged, so this is a no-op in the
// deployments that already work.
const BACKEND = process.env.BACKEND_URL || process.env.NEXT_PUBLIC_API_URL || 'http://api:8000'

const STRIP_REQ  = new Set(['host', 'connection', 'content-length', 'transfer-encoding'])
const STRIP_RESP = new Set(['connection', 'transfer-encoding', 'keep-alive'])

async function proxy(
  req: NextRequest,
  { params }: { params: Promise<{ proxy: string[] }> },
): Promise<NextResponse> {
  const { proxy: segments } = await params
  const path = '/' + segments.join('/')

  const target = new URL(path, BACKEND)
  req.nextUrl.searchParams.forEach((v, k) => target.searchParams.set(k, v))

  const reqHeaders: Record<string, string> = {}
  req.headers.forEach((v, k) => {
    if (!STRIP_REQ.has(k)) reqHeaders[k] = v
  })

  const body =
    req.method !== 'GET' && req.method !== 'HEAD' ? await req.arrayBuffer() : undefined

  let upstream: Response
  try {
    upstream = await fetch(target, {
      method: req.method,
      headers: reqHeaders,
      body,
      // Never cache. Without this a GET can be served from Next's fetch cache,
      // which for /chat/stream would mean an SSE connection that replays a
      // stale body and never delivers a live frame.
      cache: 'no-store',
      // @ts-expect-error — undici option, not in the DOM RequestInit type.
      duplex: body ? 'half' : undefined,
    })
  } catch {
    return NextResponse.json({ detail: 'Backend unavailable' }, { status: 503 })
  }

  const respHeaders = new Headers()
  upstream.headers.forEach((v, k) => {
    if (!STRIP_RESP.has(k)) respHeaders.set(k, v)
  })

  return new NextResponse(upstream.body, {
    status: upstream.status,
    headers: respHeaders,
  })
}

// The response body is piped straight through (`new NextResponse(upstream.body)`),
// which is what lets /chat/stream work as Server-Sent Events: the stream stays
// open and each frame reaches the browser as it is written. `force-dynamic`
// keeps Next from trying to render or cache this route.
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export const GET     = proxy
export const POST    = proxy
export const PATCH   = proxy
export const PUT     = proxy
export const DELETE  = proxy

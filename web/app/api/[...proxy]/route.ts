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

// Always use Docker service name 'api' since we run in Docker
const BACKEND = 'http://api:8000'

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
    upstream = await fetch(target, { method: req.method, headers: reqHeaders, body })
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

export const GET     = proxy
export const POST    = proxy
export const PATCH   = proxy
export const PUT     = proxy
export const DELETE  = proxy

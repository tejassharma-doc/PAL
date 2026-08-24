import { NextRequest, NextResponse } from 'next/server'

const BACKEND = process.env.API_INTERNAL_URL || 'http://api:8000'

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const authHeader = request.headers.get('authorization')

    if (!authHeader) {
      return NextResponse.json(
        { error: 'Authentication required' },
        { status: 401 }
      )
    }

    console.log('[Hermes Proxy] Forwarding to backend:', BACKEND)

    const response = await fetch(`${BACKEND}/hermes/chat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': authHeader
      },
      body: JSON.stringify(body)
    })

    if (!response.ok) {
      const errorText = await response.text()
      console.error('[Hermes Proxy] Backend error:', response.status, errorText)
      return NextResponse.json(
        { error: `Backend error: ${response.status}` },
        { status: response.status }
      )
    }

    const data = await response.json()
    console.log('[Hermes Proxy] Success, response length:', data.answer?.length || 0)

    return NextResponse.json(data)

  } catch (error) {
    console.error('[Hermes Proxy] Error:', error)
    return NextResponse.json(
      { error: 'Failed to get AI response' },
      { status: 500 }
    )
  }
}

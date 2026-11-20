/**
 * Hermes AI Chat API Client
 * Connects to Hermes chat endpoint with MCP + Vertex AI
 */

export interface HermesChatRequest {
  query: string
  patient_id: string
  conversation_id?: string
}

export interface HermesChatResponse {
  answer: string
  conversation_id: string
  sources: Array<{
    type: string
    count: number
  }>
}

/**
 * Ask Hermes AI a question
 * Flow: Frontend → FastAPI → MCP Server → Vertex AI → Response
 */
export async function askHermes(
  query: string,
  patientId: string,
  conversationId?: string
): Promise<HermesChatResponse> {
  const token = typeof window !== 'undefined'
    ? localStorage.getItem('pal_token')
    : null

  if (!token) {
    throw new Error('Please log in to chat with PAL')
  }

  if (!patientId) {
    throw new Error('Patient ID not found. Please log in again.')
  }

  const response = await fetch('/api/hermes/chat', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`
    },
    body: JSON.stringify({
      query,
      patient_id: patientId,
      conversation_id: conversationId
    })
  })

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Unknown error' }))
    throw new Error(error.error || `API error: ${response.status}`)
  }

  return response.json()
}

export interface HermesVoiceResponse {
  transcript: string        // what the user said, in their own language
  source_language: string   // e.g. "hi-IN"
  answer: string            // answer in the user's language
  answer_en: string         // answer in English
  conversation_id: string
}

/**
 * Voice Ask — upload a recorded clip. Sarvam transcribes it, the query goes to
 * Gemma in English, and the answer comes back translated into the spoken language.
 */
export async function askHermesVoice(
  audio: Blob,
  patientId: string,
  conversationId?: string,
  filename = 'query.webm',
): Promise<HermesVoiceResponse> {
  const token = typeof window !== 'undefined' ? localStorage.getItem('pal_token') : null
  if (!token) throw new Error('Please log in to chat with PAL')
  if (!patientId) throw new Error('Patient ID not found. Please log in again.')

  const form = new FormData()
  form.append('audio', audio, filename)
  form.append('patient_id', patientId)
  if (conversationId) form.append('conversation_id', conversationId)

  // No Content-Type header — the browser sets the multipart boundary.
  const res = await fetch('/api/hermes/voice-query', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: form,
  })
  if (!res.ok) {
    const e = await res.json().catch(() => ({}))
    throw new Error((e as { detail?: string }).detail || `API error: ${res.status}`)
  }
  return res.json()
}

/**
 * Streaming version — Gemma resolves tool calls (retrieval) then streams the
 * answer. `onDelta` is called with each text chunk; `onDone` with the final
 * conversation id. Throws on auth / network / server error.
 */
export async function askHermesStream(
  query: string,
  patientId: string,
  conversationId: string | undefined,
  onDelta: (text: string) => void,
  onDone: (conversationId?: string) => void,
): Promise<void> {
  const token = typeof window !== 'undefined' ? localStorage.getItem('pal_token') : null
  if (!token) throw new Error('Please log in to chat with PAL')
  if (!patientId) throw new Error('Patient ID not found. Please log in again.')

  const response = await fetch('/api/hermes/chat/stream', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ query, patient_id: patientId, conversation_id: conversationId }),
  })
  if (!response.ok || !response.body) {
    const e = await response.json().catch(() => ({}))
    throw new Error((e as { detail?: string }).detail || `API error: ${response.status}`)
  }

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buf = ''
  let convId: string | undefined
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    buf += decoder.decode(value, { stream: true })
    let sep: number
    while ((sep = buf.indexOf('\n\n')) >= 0) {
      const evt = buf.slice(0, sep)
      buf = buf.slice(sep + 2)
      const dataLine = evt.split('\n').find((l) => l.startsWith('data:'))
      if (!dataLine) continue
      const payload = dataLine.slice(5).trim()
      if (!payload) continue
      let obj: { delta?: string; error?: string; conversation_id?: string; done?: boolean }
      try {
        obj = JSON.parse(payload)
      } catch {
        continue
      }
      if (obj.error) throw new Error(obj.error)
      if (obj.delta) onDelta(obj.delta)
      if (obj.conversation_id) convId = obj.conversation_id
    }
  }
  onDone(convId)
}

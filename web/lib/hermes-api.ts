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

'use client'

/**
 * /ask — redesigned Ask screen (new shell + streaming chat).
 * Uses askHermesStream so Gemma's answer streams in after retrieval.
 */
import { useState, useRef, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { AppShell } from '../../components/pal/AppShell'
import { Icon } from '../../components/pal/Icon'
import { PalVoice } from '../../components/PalEmblem'
import { askHermesStream } from '../../lib/hermes-api'

type Msg = { id: string; role: 'user' | 'assistant'; text: string; thinking?: boolean }

export default function AskPage() {
  const router = useRouter()
  const [msgs, setMsgs] = useState<Msg[]>([])
  const [input, setInput] = useState('')
  const [conversationId, setConversationId] = useState<string | undefined>()
  const [busy, setBusy] = useState(false)
  const endRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (typeof window === 'undefined') return
    if (!localStorage.getItem('pal_token')) { router.replace('/login'); return }
    const pending = sessionStorage.getItem('pal_pending_q')
    if (pending) { sessionStorage.removeItem('pal_pending_q'); send(pending) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router])

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [msgs])

  async function send(text: string) {
    const q = text.trim()
    if (!q || busy) return
    setInput(''); setBusy(true)
    const id = Date.now().toString()
    setMsgs(p => [...p, { id: `u-${id}`, role: 'user', text: q }, { id: `a-${id}`, role: 'assistant', text: '', thinking: true }])
    const patientId = localStorage.getItem('pal_patient_id') || ''
    let acc = ''
    try {
      await askHermesStream(
        q, patientId, conversationId,
        (delta) => { acc += delta; setMsgs(p => p.map(m => m.id === `a-${id}` ? { ...m, text: acc, thinking: false } : m)) },
        (cid) => { if (cid) setConversationId(cid) },
      )
    } catch (err) {
      setMsgs(p => p.map(m => m.id === `a-${id}`
        ? { ...m, text: err instanceof Error ? `⚠ ${err.message}` : '⚠ Could not reach the server.', thinking: false }
        : m))
    } finally { setBusy(false) }
  }

  return (
    <AppShell active="ask" title="Ask PAL">
      <div className="askwrap">
        <div className="convo">
          <div className="scroll"><div className="inner">
            {msgs.length === 0 && (
              <>
                <div className="pal-msg">
                  <div className="who2"><PalVoice size={30} /> PAL</div>
                  <p className="ans">Ask me anything about your health — in your own language. I answer from peer-reviewed medical literature, and use your record only with your consent.</p>
                </div>
                <div className="suggest">
                  <button onClick={() => send('What is tuberculosis?')}>What is tuberculosis?</button>
                  <button onClick={() => send('What lowers LDL cholesterol?')}>What lowers LDL cholesterol?</button>
                  <button onClick={() => send('What are the symptoms of type 2 diabetes?')}>Symptoms of type 2 diabetes?</button>
                </div>
              </>
            )}
            {msgs.map(m => m.role === 'user' ? (
              <div key={m.id} className="me">{m.text}</div>
            ) : (
              <div key={m.id} className="pal-msg">
                <div className="who2"><PalVoice size={28} /> PAL</div>
                {m.thinking && !m.text
                  ? <p className="ans muted">Searching the medical literature…</p>
                  : <p className="ans" style={{ whiteSpace: 'pre-wrap' }}>{m.text}</p>}
              </div>
            ))}
            <div ref={endRef} />
          </div></div>

          <div className="composer">
            <div className="askbox" style={{ boxShadow: 'none' }}>
              <button className="attach" aria-label="Add a report" onClick={() => router.push('/upload')}><Icon name="cam" /></button>
              <input aria-label="Ask a question" placeholder="Ask about your health, in any language"
                value={input} onChange={e => setInput(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') send(input) }} />
              <button className="mic" aria-label="Send" onClick={() => send(input)} disabled={busy}><Icon name="send" /></button>
            </div>
            <p className="fine">PAL gives health information, not a diagnosis. <b>In an emergency call 112.</b></p>
          </div>
        </div>
      </div>
    </AppShell>
  )
}

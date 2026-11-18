'use client'

/**
 * Ask — redesigned onto AppShell (pal-app.html `S.ask`), powered by the
 * patient-scoped Hermes chat agent (Gemma-4 + knowledge retrieval + tools),
 * streamed token-by-token. The older /api/search stack needs a provisioned
 * Tenant row (hence "Tenant not found" on this deployment), so Ask uses the
 * Hermes path instead. Threads from listConversations, SOS card, deep-link ?q=.
 */
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { AppShell } from '@/components/layout/AppShell'
import { Icon } from '@/components/ui/Icon'
import { PalVoice } from '@/components/PalEmblem'
import Markdown, { CopyAnswerButton } from '@/components/Markdown'
import { askHermes, askHermesStream } from '@/lib/hermes-api'
import { listConversations, getConversationTurns, type ConversationSummary } from '@/lib/api'

type Msg = { id: string; role: 'user' | 'assistant'; text: string; thinking?: boolean; secondLook?: boolean; error?: boolean }

const SOS_WORDS = ['chest pain', "can't breathe", 'cant breathe', 'stroke', 'suicid', 'bleeding heavily', 'unconscious', 'heart attack']

function AskInner() {
  const router = useRouter()
  const sp = useSearchParams()
  const [msgs, setMsgs] = useState<Msg[]>([])
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [threads, setThreads] = useState<ConversationSummary[]>([])
  const [sos, setSos] = useState<string | null>(null)
  const [noPatient, setNoPatient] = useState(false)

  const conversationId = useRef<string | undefined>(undefined)
  const endRef = useRef<HTMLDivElement>(null)
  const started = useRef(false)

  useEffect(() => {
    if (typeof window === 'undefined') return
    if (!localStorage.getItem('pal_token')) { router.replace('/login'); return }
    if (!localStorage.getItem('pal_patient_id')) { setNoPatient(true); return }
    void listConversations().then(setThreads).catch(() => {})
    const q = sp?.get('q')
    if (q && !started.current) { started.current = true; void ask(q) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router])

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [msgs])

  const run = useCallback(async (q: string, second: boolean) => {
    const patientId = localStorage.getItem('pal_patient_id') || ''
    setBusy(true)
    const id = Date.now().toString()
    setMsgs(p => [
      ...p,
      ...(second ? [] : [{ id: `u-${id}`, role: 'user', text: q } as Msg]),
      { id: `a-${id}`, role: 'assistant', text: '', thinking: true, secondLook: second },
    ])
    const prompt = second ? `Please re-check and reconsider your previous answer carefully, then answer again: ${q}` : q
    let acc = ''
    try {
      await askHermesStream(
        prompt, patientId, conversationId.current,
        (delta) => { acc += delta; setMsgs(p => p.map(m => m.id === `a-${id}` ? { ...m, text: acc, thinking: false } : m)) },
        (cid) => { if (cid) conversationId.current = cid },
      )
      if (!acc) {
        // Stream yielded nothing (or the /stream route isn't deployed) — fall back to the plain endpoint.
        const r = await askHermes(prompt, patientId, conversationId.current)
        conversationId.current = r.conversation_id || conversationId.current
        acc = r.answer || 'No answer was returned. Please try rephrasing.'
        setMsgs(p => p.map(m => m.id === `a-${id}` ? { ...m, thinking: false, text: acc } : m))
      }
    } catch (streamErr) {
      // Streaming failed outright (e.g. older backend without /chat/stream) — try non-streaming.
      try {
        const r = await askHermes(prompt, patientId, conversationId.current)
        conversationId.current = r.conversation_id || conversationId.current
        setMsgs(p => p.map(m => m.id === `a-${id}` ? { ...m, thinking: false, text: r.answer || 'No answer was returned.' } : m))
      } catch (e) {
        const msg = e instanceof Error ? e.message : (streamErr instanceof Error ? streamErr.message : 'Could not reach the server.')
        setMsgs(p => p.map(m => m.id === `a-${id}` ? { ...m, thinking: false, error: true, text: `⚠ ${msg}` } : m))
      }
    } finally { setBusy(false) }
  }, [])

  async function ask(raw: string) {
    const q = raw.trim()
    if (!q || busy) return
    setInput('')
    if (SOS_WORDS.some(w => q.toLowerCase().includes(w))) { setSos(q); return }
    await run(q, false)
  }

  async function openThread(c: ConversationSummary) {
    setBusy(true)
    try {
      const turns = await getConversationTurns(c.id)
      conversationId.current = c.id
      setMsgs(turns.map((t, i) => ({ id: `t-${i}`, role: t.role, text: t.content })))
      setSos(null)
    } catch { /* ignore */ } finally { setBusy(false) }
  }
  function newQuestion() { conversationId.current = undefined; setMsgs([]); setSos(null); setInput('') }

  const lastUserText = useMemo(() => [...msgs].reverse().find(m => m.role === 'user')?.text || '', [msgs])

  if (noPatient) {
    return (
      <AppShell active="ask" title="Ask PAL">
        <div className="page narrow"><article className="card"><p className="muted">Finish setting up your profile to ask PAL about your health.</p><div className="row" style={{ marginTop: '.8em' }}><button className="btn pri" onClick={() => router.push('/onboarding')}>Complete setup</button></div></article></div>
      </AppShell>
    )
  }

  return (
    <AppShell active="ask" title="Ask PAL">
      <div className="askwrap">
        <aside className="threads" aria-label="Past questions">
          <button className="btn pri newq" onClick={newQuestion}><Icon name="plus" /> New question</button>
          <button className="btn ghost" style={{ padding: '0 .3em', minHeight: '2.6em' }} onClick={() => router.push('/history')}>See all past questions</button>
          {threads.length > 0 && <h4>Recent</h4>}
          {threads.slice(0, 12).map(t => (
            <button key={t.id} className="th" aria-current={conversationId.current === t.id} onClick={() => void openThread(t)}>
              {t.title || 'Untitled'}<small>{t.scope_tag && /record|phi|personal|patient/i.test(t.scope_tag) ? 'Used your record' : 'General answer'}</small>
            </button>
          ))}
        </aside>

        <div className="convo">
          <div className="scroll"><div className="inner">
            <button className="btn sec pastbtn" onClick={() => router.push('/history')}><Icon name="clock" /> Past questions</button>

            {msgs.length === 0 && !sos && (
              <>
                <div className="pal-msg">
                  <div className="who2"><PalVoice size={30} /> PAL</div>
                  <p className="ans">Ask me anything about your health — in your own language. I answer from peer-reviewed medical literature, and use your record to answer for you.</p>
                </div>
                <div className="suggest">
                  <button onClick={() => void ask('What is tuberculosis?')}>What is tuberculosis?</button>
                  <button onClick={() => void ask('Is my cholesterol okay?')}>Is my cholesterol okay?</button>
                  <button onClick={() => void ask('What are the symptoms of type 2 diabetes?')}>Symptoms of type 2 diabetes?</button>
                </div>
              </>
            )}

            {msgs.map(m => m.role === 'user' ? (
              <div key={m.id} className="me">{m.text}</div>
            ) : (
              <div key={m.id} className="pal-msg">
                <div className="who2"><PalVoice size={28} /> PAL{m.secondLook && <span className="tag info" style={{ marginLeft: 'auto' }}><Icon name="eye" /> Second look</span>}</div>
                {m.thinking && !m.text
                  ? <p className="ans muted">Thinking…</p>
                  : <div className="ans" style={{ whiteSpace: m.error ? 'pre-wrap' : undefined }}>{m.error ? m.text : <Markdown text={m.text} />}</div>}
                {!m.thinking && !m.error && (
                  <div className="ansbar">
                    <CopyAnswerButton text={m.text} />
                    <button className="btn ghost second" onClick={() => void run(lastUserText, true)}>Doesn&apos;t seem right? Get a second look</button>
                  </div>
                )}
              </div>
            ))}

            {sos && (
              <div className="sos" role="alert">
                <div className="t"><Icon name="alert" /> This may be a medical emergency</div>
                <p style={{ margin: '.5em 0 .9em' }}>Your message mentions something urgent. Please get help now — don&apos;t wait for an answer from PAL.</p>
                <div style={{ display: 'grid', gap: '.5em' }}>
                  <a className="btn danger big2" href="tel:112"><Icon name="phone" /> Call 112 for emergency help</a>
                  <a className="btn sec" href="tel:108"><Icon name="phone" /> Call 108 for an ambulance</a>
                  <button className="btn ghost" onClick={() => setSos(null)}>I&apos;m safe, go back</button>
                </div>
              </div>
            )}

            <div ref={endRef} />
          </div></div>

          <div className="composer">
            <div className="askbox" style={{ boxShadow: 'none' }}>
              <button className="attach" aria-label="Add a report" onClick={() => router.push('/upload')}><Icon name="cam" /></button>
              <input aria-label="Ask a question" placeholder="Ask about your health, in any language"
                value={input} onChange={e => setInput(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') void ask(input) }} />
              <button className="mic" aria-label="Send" onClick={() => void ask(input)} disabled={busy}><Icon name="send" /></button>
            </div>
            <p className="fine">PAL gives health information, not a diagnosis. <b>In an emergency call 112.</b></p>
          </div>
        </div>
      </div>
    </AppShell>
  )
}

export default function AskPage() {
  return (
    <Suspense fallback={null}>
      <AskInner />
    </Suspense>
  )
}

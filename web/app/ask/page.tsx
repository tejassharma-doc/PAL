'use client'

/**
 * Ask — redesigned onto AppShell (pal-app.html `S.ask`), reusing the proven
 * /api/search stack (search / secondOpinion / confirmAction) rather than
 * rebuilding on a new contract. Threads sidebar from listConversations, consent
 * 3-way, sources + provenance, second look, emergency (SOS) card, deep-link ?q=.
 */
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { AppShell } from '@/components/layout/AppShell'
import { Icon } from '@/components/ui/Icon'
import { PalVoice } from '@/components/PalEmblem'
import Markdown, { CopyAnswerButton } from '@/components/Markdown'
import {
  search as apiSearch, secondOpinion as apiSecondOpinion, confirmAction,
  listConversations, getConversationTurns,
  type SearchResult, type ConversationSummary,
} from '@/lib/api'

type Pending = NonNullable<SearchResult['pending_actions']>[number]
type Msg = {
  id: string
  role: 'user' | 'assistant'
  text: string
  citations?: SearchResult['citations']
  provenance?: string
  pending?: Pending[]
  secondLook?: boolean
  thinking?: boolean
  error?: boolean
}

const SOS_WORDS = ['chest pain', 'can\'t breathe', 'cant breathe', 'stroke', 'suicid', 'bleeding heavily', 'unconscious', 'heart attack']

function AskInner() {
  const router = useRouter()
  const sp = useSearchParams()
  const [msgs, setMsgs] = useState<Msg[]>([])
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [threads, setThreads] = useState<ConversationSummary[]>([])
  const [sos, setSos] = useState<string | null>(null)
  const [pendingConsent, setPendingConsent] = useState<string | null>(null)

  const sessionId = useRef('')
  const conversationId = useRef<string | null>(null)
  const consentMode = useRef<'ask' | 'session' | 'always' | 'general'>('ask')
  const endRef = useRef<HTMLDivElement>(null)
  const started = useRef(false)

  useEffect(() => {
    if (typeof window === 'undefined') return
    if (!localStorage.getItem('pal_token')) { router.replace('/login'); return }
    sessionId.current = crypto.randomUUID()
    if (localStorage.getItem('pal_consent_always') === '1') consentMode.current = 'always'
    void listConversations().then(setThreads).catch(() => {})
    const q = sp?.get('q')
    if (q && !started.current) { started.current = true; void handleAsk(q) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router])

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [msgs])

  const runSearch = useCallback(async (q: string, second: boolean) => {
    setBusy(true)
    const id = Date.now().toString()
    setMsgs(p => [
      ...p,
      ...(second ? [] : [{ id: `u-${id}`, role: 'user', text: q } as Msg]),
      { id: `a-${id}`, role: 'assistant', text: '', thinking: true, secondLook: second },
    ])
    try {
      const memberId = consentMode.current === 'general' ? undefined : (localStorage.getItem('pal_user_id') || undefined)
      const consentBasis = consentMode.current === 'always' ? 'standing' : consentMode.current === 'session' ? 'session' : undefined
      const res = second
        ? await apiSecondOpinion(q, sessionId.current, conversationId.current, { memberId })
        : await apiSearch(q, sessionId.current, { memberId, consentBasis, conversationId: conversationId.current || undefined })
      if (res.conversation_id) conversationId.current = res.conversation_id
      setMsgs(p => p.map(m => m.id === `a-${id}` ? {
        ...m, thinking: false,
        text: res.clinical_disagreement ? `${res.answer_text}\n\n> ⚠ ${res.clinical_disagreement}` : res.answer_text,
        citations: res.citations, provenance: res.provenance_summary, pending: res.pending_actions,
      } : m))
    } catch (e) {
      setMsgs(p => p.map(m => m.id === `a-${id}` ? { ...m, thinking: false, error: true, text: e instanceof Error ? `⚠ ${e.message}` : '⚠ Could not reach the server.' } : m))
    } finally { setBusy(false) }
  }, [])

  async function handleAsk(raw: string) {
    const q = raw.trim()
    if (!q || busy) return
    setInput('')
    if (SOS_WORDS.some(w => q.toLowerCase().includes(w))) { setSos(q); return }
    if (consentMode.current === 'ask') { setPendingConsent(q); return }
    await runSearch(q, false)
  }

  function resolveConsent(mode: 'session' | 'always' | 'general') {
    consentMode.current = mode
    if (mode === 'always') localStorage.setItem('pal_consent_always', '1')
    const q = pendingConsent
    setPendingConsent(null)
    if (q) void runSearch(q, false)
  }

  async function doConfirm(a: Pending) {
    try {
      const r = await confirmAction({ actionType: a.type, actionPayload: a.action_payload || {}, confirmToken: a.confirm_token || '', sessionId: sessionId.current })
      setMsgs(p => [...p, { id: `c-${Date.now()}`, role: 'assistant', text: r.message || 'Done.' }])
    } catch (e) {
      setMsgs(p => [...p, { id: `c-${Date.now()}`, role: 'assistant', text: e instanceof Error ? `⚠ ${e.message}` : '⚠ Could not complete that.', error: true }])
    }
  }

  async function openThread(c: ConversationSummary) {
    setBusy(true)
    try {
      const turns = await getConversationTurns(c.id)
      conversationId.current = c.id
      setMsgs(turns.map((t, i) => ({ id: `t-${i}`, role: t.role, text: t.content })))
    } catch { /* ignore */ }
    finally { setBusy(false) }
  }

  function newQuestion() {
    conversationId.current = null
    sessionId.current = crypto.randomUUID()
    setMsgs([]); setSos(null); setInput('')
  }

  const lastUserText = useMemo(() => [...msgs].reverse().find(m => m.role === 'user')?.text || '', [msgs])

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

            {msgs.length === 0 && !sos && !pendingConsent && (
              <>
                <div className="pal-msg">
                  <div className="who2"><PalVoice size={30} /> PAL</div>
                  <p className="ans">Ask me anything about your health — in your own language. I answer from peer-reviewed medical literature, and use your record only with your consent.</p>
                </div>
                <div className="suggest">
                  <button onClick={() => void handleAsk('Is my cholesterol okay?')}>Is my cholesterol okay?</button>
                  <button onClick={() => void handleAsk('Do my medicines interact?')}>Do my medicines interact?</button>
                  <button onClick={() => void handleAsk('What are the symptoms of type 2 diabetes?')}>Symptoms of type 2 diabetes?</button>
                </div>
              </>
            )}

            {msgs.map(m => m.role === 'user' ? (
              <div key={m.id} className="me">{m.text}</div>
            ) : (
              <div key={m.id} className="pal-msg">
                <div className="who2"><PalVoice size={28} /> PAL{m.secondLook && <span className="tag info" style={{ marginLeft: 'auto' }}><Icon name="eye" /> Second look</span>}</div>
                {m.thinking
                  ? <p className="ans muted">Searching the medical literature…</p>
                  : <div className="ans" style={{ whiteSpace: m.error ? 'pre-wrap' : undefined }}>{m.error ? m.text : <Markdown text={m.text} />}</div>}
                {!m.thinking && m.provenance && (
                  <details className="how"><summary>How PAL got this answer <Icon name="down" /></summary><ol><li><span className="tick"><Icon name="check" /></span><span>{m.provenance}</span></li></ol></details>
                )}
                {!m.thinking && m.citations && m.citations.length > 0 && (
                  <div className="sources">
                    {m.citations.map((c, i) => (
                      <div className="src" key={i}><b>{i + 1}</b> {c.url ? <a href={c.url} target="_blank" rel="noreferrer">{c.title}</a> : c.title}{c.source ? ` — ${c.source}` : ''}</div>
                    ))}
                  </div>
                )}
                {!m.thinking && m.pending && m.pending.map((a, i) => (
                  <div className="consent" key={i} style={{ marginTop: '.8em' }}>
                    <div className="t"><Icon name="shield" /> {a.description}</div>
                    {a.confirm_token_required && <div className="acts" style={{ marginTop: '.6em' }}><button className="btn pri" onClick={() => void doConfirm(a)}>Confirm</button></div>}
                  </div>
                ))}
                {!m.thinking && !m.error && !m.secondLook && (
                  <div className="ansbar">
                    <CopyAnswerButton text={m.text} />
                    <button className="btn ghost second" onClick={() => void runSearch(lastUserText, true)}>Doesn&apos;t seem right? Get a second look</button>
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

            {pendingConsent && (
              <div className="consent" role="group" aria-label="Permission">
                <div className="t"><Icon name="shield" /> Use your health record for this answer?</div>
                <p>PAL can give a general answer, or look at your reports and medicines to answer for you specifically. Your record never leaves PAL.</p>
                <div className="acts three">
                  <button className="btn pri" onClick={() => resolveConsent('session')}>Yes, for this question</button>
                  <button className="btn sec" onClick={() => resolveConsent('always')}>Yes, always</button>
                  <button className="btn sec" onClick={() => resolveConsent('general')}>No, a general answer</button>
                </div>
              </div>
            )}

            <div ref={endRef} />
          </div></div>

          <div className="composer">
            <div className="askbox" style={{ boxShadow: 'none' }}>
              <button className="attach" aria-label="Add a report" onClick={() => router.push('/upload')}><Icon name="cam" /></button>
              <input aria-label="Ask a question" placeholder="Ask about your health, in any language"
                value={input} onChange={e => setInput(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') void handleAsk(input) }} />
              <button className="mic" aria-label="Send" onClick={() => void handleAsk(input)} disabled={busy}><Icon name="send" /></button>
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

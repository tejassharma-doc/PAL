'use client'

/**
 * Past questions — redesigned onto AppShell (pal-app.html `S.history`).
 * Lists saved conversations grouped by day, with search and a real delete
 * (confirm sheet → deleteConversation). Data: lib/api conversations.
 */
import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { AppShell } from '@/components/layout/AppShell'
import { Icon } from '@/components/ui/Icon'
import { listConversations, deleteConversation, type ConversationSummary } from '@/lib/api'

function dayBucket(iso: string): string {
  const d = new Date(iso); const now = new Date()
  const days = Math.floor((now.setHours(0, 0, 0, 0) - new Date(iso).setHours(0, 0, 0, 0)) / 86400000)
  if (Number.isNaN(d.getTime())) return 'Earlier'
  if (days <= 0) return 'Today'
  if (days === 1) return 'Yesterday'
  if (days < 7) return 'Earlier this week'
  return 'Earlier'
}
function timeLabel(iso: string): string {
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
}
function usedRecord(scope?: string | null): boolean {
  const s = (scope || '').toLowerCase()
  return s.includes('record') || s.includes('phi') || s.includes('personal') || s.includes('patient')
}

export default function HistoryPage() {
  const router = useRouter()
  const [items, setItems] = useState<ConversationSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [q, setQ] = useState('')
  const [confirmId, setConfirmId] = useState<string | null>(null)
  const [deleting, setDeleting] = useState(false)

  useEffect(() => {
    if (typeof window === 'undefined') return
    if (!localStorage.getItem('pal_token')) { router.replace('/login'); return }
    ;(async () => {
      try { setItems(await listConversations()); setError(null) }
      catch (e) { setError(e instanceof Error ? e.message : 'Failed to load') }
      finally { setLoading(false) }
    })()
  }, [router])

  const groups = useMemo(() => {
    const term = q.trim().toLowerCase()
    const filtered = items.filter(c => !term || (c.title || '').toLowerCase().includes(term) || (c.hindsight_summary || '').toLowerCase().includes(term))
    const order = ['Today', 'Yesterday', 'Earlier this week', 'Earlier']
    const m = new Map<string, ConversationSummary[]>()
    filtered.sort((a, b) => (b.updated_at || b.created_at).localeCompare(a.updated_at || a.created_at))
      .forEach(c => { const k = dayBucket(c.updated_at || c.created_at); if (!m.has(k)) m.set(k, []); m.get(k)!.push(c) })
    return order.filter(k => m.has(k)).map(k => [k, m.get(k)!] as const)
  }, [items, q])

  async function doDelete() {
    if (!confirmId) return
    setDeleting(true)
    try {
      await deleteConversation(confirmId)
      setItems(prev => prev.filter(c => c.id !== confirmId))
      setConfirmId(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not delete')
    } finally { setDeleting(false) }
  }

  return (
    <AppShell active="ask" title="Past questions">
      <div className="page narrow hist">
        <div className="headrow">
          <div><h1 className="h">Past questions</h1><p className="lede">Saved so you can continue. Yours to delete.</p></div>
          <button className="btn pri" onClick={() => router.push('/ask')}><Icon name="plus" /> New question</button>
        </div>

        <div className="hsearch" style={{ marginTop: '1.2em', padding: '.15em .9em' }}>
          <Icon name="search2" />
          <input aria-label="Search past questions" placeholder="Search your questions" value={q} onChange={e => setQ(e.target.value)} />
        </div>

        {error && <div className="alertcard" style={{ marginTop: '.8em' }}><Icon name="alert" /><div><b>Couldn&apos;t load</b><span className="muted small">{error}</span></div></div>}

        {loading ? (
          <div className="muted" style={{ marginTop: '1em' }}>Loading…</div>
        ) : groups.length === 0 ? (
          <article className="card" style={{ marginTop: '1em' }}><p className="muted">No past questions yet. Tap “New question” to ask PAL something.</p></article>
        ) : groups.map(([bucket, list]) => (
          <div key={bucket}>
            <h2 className="s">{bucket}</h2>
            <div className="list">
              {list.map(c => (
                <div className="li" key={c.id}>
                  <button className="tx" onClick={() => router.push(`/history/${c.id}`)} style={{ border: 0, background: 'none', textAlign: 'left', padding: 0, minHeight: 0 }}>
                    <b>{c.title || 'Untitled question'}</b>
                    <span className="meta">
                      {usedRecord(c.scope_tag)
                        ? <span className="tag ok"><Icon name="lock" /> Used your record</span>
                        : <span className="tag info">General answer</span>}
                      <span>{timeLabel(c.updated_at || c.created_at)}</span>
                    </span>
                  </button>
                  <button className="iconbtn" aria-label="Delete this conversation" onClick={() => setConfirmId(c.id)}><Icon name="trash" /></button>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>

      <div className={`overlay${confirmId ? ' on' : ''}`} role="dialog" aria-modal="true" aria-label="Delete conversation" onClick={e => { if (e.target === e.currentTarget) setConfirmId(null) }}>
        <div className="sheet">
          <h3>Delete this conversation?</h3>
          <p className="muted" style={{ marginTop: '.3em' }}>This can&apos;t be undone. PAL will permanently remove the messages, any record details it pulled in, and what it remembered.</p>
          <div className="stack2">
            <button className="btn danger" disabled={deleting} onClick={() => void doDelete()}><Icon name="trash" /> {deleting ? 'Deleting…' : 'Delete permanently'}</button>
            <button className="btn sec" onClick={() => setConfirmId(null)}>Keep it</button>
          </div>
        </div>
      </div>
    </AppShell>
  )
}

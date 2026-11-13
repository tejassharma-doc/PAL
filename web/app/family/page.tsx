'use client'

/**
 * Family — redesigned onto AppShell (pal-app.html `S.family`).
 * Your groups (→ hub chat), "waiting for you" access requests, payments due,
 * and create/join sheets. All logic preserved from the previous screen
 * (getFamilyPlans / access requests / payments / create / join / delete).
 */
import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { AppShell } from '@/components/layout/AppShell'
import { Icon } from '@/components/ui/Icon'
import {
  acceptInvite, approveAccess, chatUnreadCount, createFamilyPlan, deleteFamilyPlan, denyAccess,
  getFamilyPlans, listAccessRequests, listPayments, payRequest,
  type AccessRequest, type FamilyPlanListItem, type PaymentRequest,
} from '@/lib/family-api'
import { getSubscriptionStatus } from '@/lib/subscription-api'

export default function FamilyPage() {
  const router = useRouter()
  const [plans, setPlans] = useState<FamilyPlanListItem[]>([])
  const [canJoinMore, setCanJoinMore] = useState(true)
  const [unreadMap, setUnreadMap] = useState<Record<string, number>>({})
  const [requests, setRequests] = useState<AccessRequest[]>([])
  const [payments, setPayments] = useState<PaymentRequest[]>([])
  const [loading, setLoading] = useState(true)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [toast, setToast] = useState<string | null>(null)
  const [sheet, setSheet] = useState<'create' | 'join' | null>(null)
  // Family is a Family-plan feature. `null` = still checking.
  const [allowed, setAllowed] = useState<boolean | null>(
    typeof window !== 'undefined' ? (localStorage.getItem('pal_plan') === 'family' ? true : null) : null,
  )
  useEffect(() => {
    void getSubscriptionStatus().then(s => {
      const plan = String(s.plan || ''); localStorage.setItem('pal_plan', plan); setAllowed(plan === 'family')
    }).catch(() => setAllowed(false))
  }, [])

  // create/join form
  const [gName, setGName] = useState('')
  const [gDisplay, setGDisplay] = useState('')
  const [joinCode, setJoinCode] = useState('')
  const [formBusy, setFormBusy] = useState(false)
  const [formErr, setFormErr] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const [pl, rq, py, un] = await Promise.all([getFamilyPlans(), listAccessRequests(), listPayments(), chatUnreadCount()])
      if (pl) {
        setPlans(pl.plans); setCanJoinMore(pl.can_join_more)
        if (pl.plans.length > 0 && un > 0) { const first = pl.plans.find(p => p.hub_room_id); if (first) setUnreadMap({ [first.plan_id]: un }) }
      }
      setRequests(rq); setPayments(py.filter(x => x.status === 'pending'))
    } catch { /* fail closed */ } finally { setLoading(false) }
  }, [])
  useEffect(() => { void load() }, [load])
  useEffect(() => { if (!toast) return; const t = setTimeout(() => setToast(null), 2600); return () => clearTimeout(t) }, [toast])

  async function decide(id: string, approve: boolean) {
    setBusyId(id)
    try { approve ? await approveAccess(id) : await denyAccess(id); setRequests(r => r.filter(x => x.id !== id)); setToast(approve ? 'Access granted' : 'Request declined') }
    catch (e) { setToast(e instanceof Error ? e.message : 'Could not update') }
    setBusyId(null)
  }
  async function settle(id: string) {
    setBusyId(id)
    try { await payRequest(id); setPayments(p => p.filter(x => x.id !== id)); setToast('Payment settled') }
    catch (e) { setToast(e instanceof Error ? e.message : 'Payment failed') }
    setBusyId(null)
  }
  async function createGroup() {
    if (!gName.trim() || !gDisplay.trim()) return
    setFormBusy(true); setFormErr(null)
    try { await createFamilyPlan({ name: gName.trim(), display_name: gDisplay.trim() }); setSheet(null); setGName(''); setGDisplay(''); await load() }
    catch (e) { setFormErr(e instanceof Error ? e.message : 'Could not create group') }
    setFormBusy(false)
  }
  async function joinGroup() {
    if (joinCode.trim().length < 6) return
    setFormBusy(true); setFormErr(null)
    try { await acceptInvite('', joinCode.trim()); setSheet(null); setJoinCode(''); setToast('You joined the group!'); await load() }
    catch (e) { setFormErr(e instanceof Error ? e.message : 'Invalid or expired code') }
    setFormBusy(false)
  }
  async function del(id: string, name: string) {
    if (!confirm(`Delete "${name}"? This permanently removes the group and its messages.`)) return
    setBusyId(id)
    try { await deleteFamilyPlan(id); setPlans(ps => ps.filter(p => p.plan_id !== id)); setCanJoinMore(true); setToast(`"${name}" deleted`) }
    catch (e) { setToast(e instanceof Error ? e.message : 'Could not delete group') }
    setBusyId(null)
  }

  if (allowed === false) {
    return (
      <AppShell active="family" title="Family">
        <div className="page narrow">
          <h1 className="h">Family care</h1>
          <p className="lede">Shared family groups, access controls, a care room and shared payments are part of the <b>Family plan</b>.</p>
          <article className="card hl" style={{ marginTop: '1.2em' }}>
            <div className="fam">
              <div className="stack"><span className="av p">P</span><span className="av m">M</span><span className="av r">R</span></div>
              <div style={{ flex: 1 }}><b>Look after your family together</b><div className="muted small">Up to 3 people, one shared care room.</div></div>
            </div>
            <div className="row" style={{ marginTop: '1em' }}>
              <button className="btn pri" onClick={() => router.push('/pricing')}>Upgrade to Family</button>
              <button className="btn ghost" onClick={() => router.push('/')}>Not now</button>
            </div>
          </article>
        </div>
      </AppShell>
    )
  }

  return (
    <AppShell active="family" title="Family">
      <div className="page">
        <div className="headrow">
          <div><h1 className="h">Your family</h1><p className="lede">Groups you belong to, people you look after, and who can see what.</p></div>
          <div className="row">
            <button className="btn sec" onClick={() => { setSheet('join'); setFormErr(null) }}><Icon name="key" /> Join with a code</button>
            {canJoinMore && <button className="btn pri" onClick={() => { setSheet('create'); setFormErr(null) }}><Icon name="plus" /> Create a group</button>}
          </div>
        </div>

        {(requests.length > 0 || payments.length > 0) && <h2 className="s">Waiting for you</h2>}
        {(requests.length > 0 || payments.length > 0) && (
          <div className="groupsrow">
            {requests.map(r => (
              <article className="card hl" key={r.id}>
                <div className="row" style={{ gap: '.8em', alignItems: 'flex-start' }}>
                  <span className="av p">{(r.grantee_name || '?').charAt(0).toUpperCase()}</span>
                  <div style={{ flex: 1 }}><b>{r.grantee_name} wants to see {r.subject_name}&apos;s {r.scope}</b>{r.message && <div className="small muted">&ldquo;{r.message}&rdquo;</div>}</div>
                </div>
                <div className="row" style={{ marginTop: '.8em' }}>
                  <button className="btn pri" disabled={busyId === r.id} onClick={() => void decide(r.id, true)}>Allow</button>
                  <button className="btn sec" disabled={busyId === r.id} onClick={() => void decide(r.id, false)}>Not now</button>
                </div>
              </article>
            ))}
            {payments.map(p => (
              <article className="card" style={{ border: '1.5px solid var(--amber)' }} key={p.id}>
                <div className="row" style={{ gap: '.8em', alignItems: 'flex-start' }}>
                  <div className="pillico" style={{ background: 'var(--amber-tint)', color: 'var(--amber-deep)' }}><Icon name="rupee" /></div>
                  <div style={{ flex: 1 }}><b>{p.amount_display} — {p.description}</b></div>
                </div>
                <div className="row" style={{ marginTop: '.8em' }}>
                  {p.can_pay ? <button className="btn pri" disabled={busyId === p.id} onClick={() => void settle(p.id)}>Pay {p.amount_display}</button> : <span className="muted small">Awaiting billing member</span>}
                </div>
              </article>
            ))}
          </div>
        )}

        <h2 className="s">Your groups</h2>
        {loading ? <div className="muted">Loading…</div> : plans.length === 0 ? (
          <article className="card"><p className="muted">No groups yet. Create one to coordinate care with your family, or join with an invite code.</p></article>
        ) : (
          <div className="list">
            {plans.map(p => (
              <div className="li" key={p.plan_id}>
                <button className="tx" onClick={() => router.push(`/family/hub?planId=${p.plan_id}`)} style={{ display: 'flex', alignItems: 'center', gap: '.9em', border: 0, background: 'none', padding: 0, minHeight: 0, flex: 1, textAlign: 'left' }}>
                  <span className="av a">{p.name.split(' ').map(w => w[0] || '').join('').slice(0, 2).toUpperCase()}</span>
                  <span style={{ flex: 1 }}><b style={{ display: 'block' }}>{p.name}</b><span className="small muted">{p.member_count} member{p.member_count !== 1 ? 's' : ''}{p.is_admin ? ' · admin' : ''}</span></span>
                  {(unreadMap[p.plan_id] ?? 0) > 0 && <span className="badge2">{unreadMap[p.plan_id]}</span>}
                </button>
                {p.is_admin && <button className="iconbtn" aria-label={`Delete ${p.name}`} disabled={busyId === p.plan_id} onClick={() => void del(p.plan_id, p.name)} style={{ color: 'var(--rose-deep)' }}><Icon name="trash" /></button>}
                <Icon name="right" className="ico chev" />
              </div>
            ))}
          </div>
        )}

        <div className="row" style={{ marginTop: '1em' }}>
          <button className="btn sec" onClick={() => router.push('/family/invite')}><Icon name="plus" /> Add a member</button>
        </div>
      </div>

      {/* create / join sheet */}
      <div className={`overlay${sheet ? ' on' : ''}`} role="dialog" aria-modal="true" onClick={e => { if (e.target === e.currentTarget) setSheet(null) }}>
        <div className="sheet">
          {sheet === 'create' ? (<>
            <h3>New group</h3>
            <div className="field"><label>Group name</label><input value={gName} onChange={e => setGName(e.target.value)} placeholder="e.g. Sharma family" /></div>
            <div className="field"><label>Your name in this group</label><input value={gDisplay} onChange={e => setGDisplay(e.target.value)} placeholder="Your name" /></div>
            {formErr && <p className="small" style={{ color: 'var(--rose-deep)' }}>{formErr}</p>}
            <div className="stack2" style={{ marginTop: '1em' }}>
              <button className="btn pri" disabled={formBusy || !gName.trim() || !gDisplay.trim()} onClick={() => void createGroup()}>{formBusy ? 'Creating…' : 'Create group'}</button>
              <button className="btn sec" onClick={() => setSheet(null)}>Cancel</button>
            </div>
          </>) : sheet === 'join' ? (<>
            <h3>Join a group</h3>
            <p className="muted small" style={{ marginTop: '.3em' }}>Ask the group admin for an invite code, then enter it below.</p>
            <div className="field"><label>6-digit code</label><input value={joinCode} onChange={e => setJoinCode(e.target.value.replace(/\D/g, '').slice(0, 6))} inputMode="numeric" maxLength={6} style={{ textAlign: 'center', letterSpacing: '.22em', fontFamily: 'var(--mono)' }} /></div>
            {formErr && <p className="small" style={{ color: 'var(--rose-deep)' }}>{formErr}</p>}
            <div className="stack2" style={{ marginTop: '1em' }}>
              <button className="btn pri" disabled={formBusy || joinCode.length < 6} onClick={() => void joinGroup()}>{formBusy ? 'Joining…' : 'Join group'}</button>
              <button className="btn sec" onClick={() => setSheet(null)}>Cancel</button>
            </div>
          </>) : null}
        </div>
      </div>

      {toast && <div className="card" style={{ position: 'fixed', bottom: '5em', left: '1em', right: '1em', maxWidth: '30em', margin: '0 auto', background: 'var(--deep)', color: 'var(--paper)', zIndex: 60 }}>{toast}</div>}
    </AppShell>
  )
}

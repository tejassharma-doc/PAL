'use client'

/**
 * Add a family member — redesigned onto AppShell (pal-app.html `S.invite`).
 * inviteMember / createFamilyPlan logic preserved; member-kind as the radio set.
 */
import { Suspense, useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { AppShell } from '@/components/layout/AppShell'
import { Icon } from '@/components/ui/Icon'
import { createFamilyPlan, getFamilyPlan, inviteMember, type FamilyPlanInfo } from '@/lib/family-api'
import { invalidateFamilyPlanCache } from '@/components/family/FamilyHubButton'

const RELATIONSHIPS = ['spouse', 'parent', 'child', 'sibling', 'grandparent', 'other']
type Role = 'adult' | 'dependent_adult' | 'minor'
const ROLES: { value: Role; title: string; sub: string }[] = [
  { value: 'adult', title: 'An adult who manages their own care', sub: 'They decide what you can see.' },
  { value: 'dependent_adult', title: 'An adult who needs help', sub: 'For example, an elderly parent.' },
  { value: 'minor', title: 'A child under 18', sub: 'You’ll be their guardian.' },
]

function InviteInner() {
  const router = useRouter()
  const planId = useSearchParams()?.get('planId') ?? undefined
  const [plan, setPlan] = useState<FamilyPlanInfo | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [code, setCode] = useState<string | null>(null)

  const [name, setName] = useState('')
  const [phone, setPhone] = useState('+91')
  const [relation, setRelation] = useState('parent')
  const [role, setRole] = useState<Role>('dependent_adult')
  const [dob, setDob] = useState('')

  useEffect(() => { getFamilyPlan(planId).then(setPlan).catch(() => setPlan(null)) }, [planId])

  async function ensurePlan(): Promise<boolean> {
    if (plan) return true
    try {
      const nm = localStorage.getItem('pal_user_name') || localStorage.getItem('pal_full_name') || 'Me'
      await createFamilyPlan({ name: `${nm}'s Family`, display_name: nm })
      invalidateFamilyPlanCache()
      const p = await getFamilyPlan(); setPlan(p); return !!p
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not create a family plan'); return false }
  }

  async function invite() {
    setError(null)
    if (!name.trim()) { setError('Enter a name'); return }
    if (!/^\+\d{6,}$/.test(phone.replace(/[\s-]/g, ''))) { setError('Phone must be international format, e.g. +919876543210'); return }
    setBusy(true)
    if (await ensurePlan()) {
      try {
        const r = await inviteMember({ display_name: name.trim(), phone: phone.replace(/[\s-]/g, ''), relationship_type: relation, role, date_of_birth: dob || undefined })
        setCode(r.invite_code)
      } catch (e) { setError(e instanceof Error ? e.message : 'Could not send the invitation') }
    }
    setBusy(false)
  }

  return (
    <AppShell active="family" title="Family">
      <div className="page narrow">
        <button className="btn ghost" style={{ padding: 0 }} onClick={() => router.push('/family')}><Icon name="left" /> Back to family</button>
        <h1 className="h" style={{ marginTop: '.3em' }}>Add a family member</h1>
        <p className="lede">They&apos;ll get a code to join your family group.</p>

        {code ? (
          <article className="card" style={{ marginTop: '1.2em', textAlign: 'center' }}>
            <p className="small muted" style={{ letterSpacing: '.1em', textTransform: 'uppercase' }}>Invitation code</p>
            <p style={{ fontFamily: 'var(--mono)', fontSize: '2rem', fontWeight: 700, letterSpacing: '.18em', margin: '.3em 0' }}>{code}</p>
            <p className="muted small">Send this to {name}. It&apos;s shown only once and expires in 7 days.</p>
            <div className="row" style={{ marginTop: '1em', justifyContent: 'center' }}>
              <button className="btn sec" onClick={() => { setCode(null); setName(''); setPhone('+91') }}>Invite another</button>
              <button className="btn pri" onClick={() => router.push('/family')}>Done</button>
            </div>
          </article>
        ) : (
          <article className="card" style={{ marginTop: '1.2em' }}>
            <div className="field" style={{ marginTop: 0 }}><label>Their name</label><input value={name} onChange={e => setName(e.target.value)} placeholder="Amma" /></div>
            <div className="field"><label>Their mobile number</label><input value={phone} onChange={e => setPhone(e.target.value)} inputMode="tel" placeholder="+91 98765 43210" /></div>
            <div className="field"><label>How are they related to you?</label>
              <select value={relation} onChange={e => setRelation(e.target.value)} style={{ font: 'inherit', border: '1.5px solid var(--line-2)', borderRadius: '.8em', padding: '.7em .9em', background: '#fff', minHeight: '3em', width: '100%' }}>
                {RELATIONSHIPS.map(r => <option key={r} value={r}>{r[0].toUpperCase() + r.slice(1)}</option>)}
              </select>
            </div>
            <div className="field"><label>What kind of member are they?</label></div>
            <div className="radio">
              {ROLES.map(r => (
                <label key={r.value} className={role === r.value ? 'on' : ''} onClick={() => setRole(r.value)}>
                  <span className="dotr" /><span><b>{r.title}</b><span>{r.sub}</span></span>
                </label>
              ))}
            </div>
            <div className="field"><label>Date of birth (optional)</label><input type="date" value={dob} onChange={e => setDob(e.target.value)} /></div>
            {error && <p className="small" style={{ color: 'var(--rose-deep)', marginTop: '.6em' }}>{error}</p>}
            <button className="btn pri big full" style={{ marginTop: '1.2em' }} disabled={busy} onClick={() => void invite()}>{busy ? 'Creating…' : 'Send invite'}</button>
          </article>
        )}
      </div>
    </AppShell>
  )
}

export default function FamilyInvitePage() {
  return <Suspense fallback={null}><InviteInner /></Suspense>
}

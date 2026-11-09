'use client'

/**
 * Profile — redesigned onto AppShell (pal-app.html `S.profile`).
 * About you / Health IDs / Medical details / Emergency contact, from the real
 * patient record (getUserProfile). Name edit via updateProfile.
 */
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { AppShell } from '@/components/layout/AppShell'
import { Icon } from '@/components/ui/Icon'
import { getUserProfile, updateProfile } from '@/lib/api-auth'

type Patient = NonNullable<Awaited<ReturnType<typeof getUserProfile>>['patient']>

function fmtDate(iso?: string): string {
  if (!iso) return '—'
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })
}

export default function ProfilePage() {
  const router = useRouter()
  const [patient, setPatient] = useState<Patient | null>(null)
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState(false)
  const [name, setName] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (typeof window === 'undefined') return
    if (!localStorage.getItem('pal_token')) { router.replace('/login'); return }
    ;(async () => {
      try {
        const data = await getUserProfile()
        setPatient(data.patient)
        setName(data.patient?.full_name || '')
      } catch { /* ignore */ }
      finally { setLoading(false) }
    })()
  }, [router])

  async function save() {
    setSaving(true)
    try {
      await updateProfile({ full_name: name.trim() })
      localStorage.setItem('pal_full_name', name.trim())
      setPatient(p => p ? { ...p, full_name: name.trim() } : p)
      setEditing(false)
    } catch { /* ignore */ }
    finally { setSaving(false) }
  }

  const p = patient
  const initial = (p?.full_name || 'Y').trim().charAt(0).toUpperCase()
  const ec = p?.emergency_contact

  return (
    <AppShell active="settings" title="Profile">
      <div className="page narrow">
        <div className="headrow">
          <div className="row" style={{ gap: '1em' }}>
            <span className="av a" style={{ width: '4.2em', height: '4.2em', fontSize: '1.3em', borderRadius: '1.1em' }}>{initial}</span>
            <div>
              {editing
                ? <input value={name} onChange={e => setName(e.target.value)} style={{ font: 'inherit', fontSize: '1.4em', border: '1.5px solid var(--line-2)', borderRadius: '.6em', padding: '.2em .5em' }} />
                : <h1 className="h">{p?.full_name || 'Your profile'}</h1>}
              <p className="lede">{p?.phone || ''}</p>
            </div>
          </div>
          {editing
            ? <div className="row"><button className="btn pri" disabled={saving} onClick={() => void save()}>{saving ? 'Saving…' : 'Save'}</button><button className="btn ghost" onClick={() => { setEditing(false); setName(p?.full_name || '') }}>Cancel</button></div>
            : <button className="btn sec" onClick={() => setEditing(true)}>Edit profile</button>}
        </div>

        {loading ? <div className="muted" style={{ marginTop: '1em' }}>Loading…</div> : (
          <>
            <h2 className="s"><Icon name="user" /> About you</h2>
            <div className="card kv">
              <div><span>Date of birth</span><b>{fmtDate(p?.date_of_birth)}</b></div>
              <div><span>Gender</span><b>{p?.gender || '—'}</b></div>
              <div><span>Address</span><b>{p?.address || '—'}</b></div>
              <div><span>Email</span><b>{p?.email || '—'}</b></div>
            </div>

            <h2 className="s"><Icon name="idc" /> Health IDs</h2>
            <div className="card kv">
              <div><span>ABHA number</span><b>{p?.abha_id || '—'}</b></div>
              <div><span>ABHA address</span><b>{p?.abha_address || '—'}</b></div>
              <div><span>Medical record number</span><b>{p?.mrn || '—'}</b></div>
            </div>

            <h2 className="s"><Icon name="drop" /> Medical details</h2>
            <div className="card kv">
              <div><span>Blood group</span><b>{p?.blood_group || '—'}</b></div>
              <div><span>Allergies</span><b>{p?.allergies || 'None recorded'}</b></div>
              <div><span>Long-term conditions</span><b>{p?.chronic_conditions || 'None recorded'}</b></div>
              <div><span>Current medicines</span><b>{p?.current_medications || 'None recorded'}</b></div>
            </div>

            <h2 className="s"><Icon name="phone" /> Emergency contact</h2>
            <div className="card row" style={{ justifyContent: 'space-between' }}>
              <div><b>{ec?.name || 'Not set'}</b><div className="muted small">{[ec?.relationship, ec?.phone].filter(Boolean).join(', ') || 'Add one in your record'}</div></div>
              {ec?.phone && <a className="btn pri" href={`tel:${ec.phone}`}><Icon name="phone" /> Call</a>}
            </div>
          </>
        )}
      </div>
    </AppShell>
  )
}

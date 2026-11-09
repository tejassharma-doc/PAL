'use client'

/**
 * Records — redesigned onto AppShell (pal-app.html `S.records`).
 * Reports/prescriptions list grouped by month with filter chips, and the
 * "Key readings" card. Data: lib/records-api (lab tests) + getHealthFacts.
 */
import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { AppShell } from '@/components/layout/AppShell'
import { Icon } from '@/components/ui/Icon'
import { Reading, readingFromFact } from '@/components/ui/Reading'
import { getPatientLabTests, type LabTest } from '@/lib/records-api'
import { getHealthFacts, type HealthFact } from '@/lib/api'

type Filter = 'all' | 'lab' | 'rx' | 'notes' | 'mine'
const FILTERS: { id: Filter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'lab', label: 'Lab reports' },
  { id: 'rx', label: 'Prescriptions' },
  { id: 'notes', label: 'Visit notes' },
  { id: 'mine', label: 'Added by you' },
]

function kindOf(t: LabTest): Filter {
  const s = `${t.report_name} ${t.test_category}`.toLowerCase()
  if (s.includes('prescription')) return 'rx'
  if (s.includes('visit') || s.includes('note')) return 'notes'
  return 'lab'
}
function monthKey(iso?: string | null): string {
  if (!iso) return 'Earlier'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return 'Earlier'
  return d.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })
}
function shortDate(iso?: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })
}

export default function RecordsPage() {
  const router = useRouter()
  const [patientId, setPatientId] = useState<string | null>(null)
  const [tests, setTests] = useState<LabTest[]>([])
  const [facts, setFacts] = useState<HealthFact[]>([])
  const [filter, setFilter] = useState<Filter>('all')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (typeof window === 'undefined') return
    if (!localStorage.getItem('pal_token')) { router.replace('/login'); return }
    setPatientId(localStorage.getItem('pal_patient_id'))
  }, [router])

  useEffect(() => {
    if (!patientId) { setLoading(false); return }
    let cancelled = false
    ;(async () => {
      setLoading(true)
      try {
        const [t, f] = await Promise.all([
          getPatientLabTests(patientId),
          getHealthFacts(patientId).catch(() => [] as HealthFact[]),
        ])
        if (!cancelled) { setTests(t); setFacts(f); setError(null) }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Failed to load records')
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [patientId])

  const filtered = useMemo(() => {
    const list = filter === 'all' ? tests : tests.filter(t => kindOf(t) === filter)
    const groups = new Map<string, LabTest[]>()
    list.slice().sort((a, b) => (b.result_date || b.ordered_date || '').localeCompare(a.result_date || a.ordered_date || ''))
      .forEach(t => {
        const k = monthKey(t.result_date || t.ordered_date)
        if (!groups.has(k)) groups.set(k, [])
        groups.get(k)!.push(t)
      })
    return [...groups.entries()]
  }, [tests, filter])

  // prefer LDL/BP/HbA1c; show up to 4 readings
  const readings = useMemo(() => {
    const priority = ['ldl', 'blood pressure', 'bp', 'systolic', 'hba1c', 'a1c']
    const score = (f: HealthFact) => {
      const h = `${f.key} ${f.type}`.toLowerCase()
      const i = priority.findIndex(p => h.includes(p))
      return i === -1 ? 99 : i
    }
    return facts.slice().sort((a, b) => score(a) - score(b)).slice(0, 4)
  }, [facts])

  return (
    <AppShell active="records" title="Health records">
      <div className="page">
        <div className="headrow">
          <div><h1 className="h">Health records</h1><p className="lede">Reports, prescriptions and visit notes.</p></div>
          <button className="btn pri" onClick={() => router.push('/upload')}><Icon name="cam" /> Add a report</button>
        </div>

        <div className="filters" role="group" aria-label="Filter records">
          {FILTERS.map(f => (
            <button key={f.id} aria-pressed={filter === f.id} onClick={() => setFilter(f.id)}>{f.label}</button>
          ))}
        </div>

        {error && <div className="alertcard" style={{ marginTop: '.8em' }}><Icon name="alert" /><div><b>Couldn&apos;t load records</b><span className="muted small">{error}</span></div></div>}

        <div className="homegrid" style={{ marginTop: '.4em' }}>
          <div>
            <h2 className="s">Reports and documents</h2>
            {loading ? (
              <div className="muted">Loading…</div>
            ) : filtered.length === 0 ? (
              <article className="card"><p className="muted">No records in this view yet. Add a report to get started.</p></article>
            ) : (
              filtered.map(([month, items]) => (
                <div key={month}>
                  <p className="small muted" style={{ margin: '1em 0 .5em' }}>{month}</p>
                  <div className="list">
                    {items.map(t => {
                      const kind = kindOf(t)
                      const ic = kind === 'rx' ? 'rx' : kind === 'notes' ? 'note' : 'lab'
                      const icon = kind === 'rx' ? 'pill' : kind === 'notes' ? 'ask' : 'rec'
                      return (
                        <button key={t.id} className="li" onClick={() => router.push(`/records/${t.id}`)}>
                          <span className={`ic ${ic}`}><Icon name={icon as 'pill' | 'ask' | 'rec'} /></span>
                          <span className="tx"><b>{t.report_name}</b><span>{[t.lab_name || t.ordered_by, shortDate(t.result_date || t.ordered_date)].filter(Boolean).join(', ')}</span></span>
                          {t.has_abnormal_values && <span className="tag warn">Check</span>}
                          <Icon name="right" className="ico chev" />
                        </button>
                      )
                    })}
                  </div>
                </div>
              ))
            )}
          </div>

          <div>
            <h2 className="s">Key readings</h2>
            {readings.length === 0 ? (
              <article className="card"><p className="muted">No readings yet. They appear here as reports are added.</p></article>
            ) : (
              <div className="card">
                {readings.map(f => <Reading key={f.id} {...readingFromFact(f)} />)}
              </div>
            )}
            <p className="small muted" style={{ marginTop: '.8em' }}>Tap any report to see the full result.</p>
          </div>
        </div>
      </div>
    </AppShell>
  )
}

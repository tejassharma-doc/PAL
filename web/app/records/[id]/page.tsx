'use client'

/**
 * Report detail — redesigned onto AppShell (pal-app.html `S.report`).
 * Lab-result table + interpretation. Data: lib/records-api getLabTest.
 */
import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { AppShell } from '@/components/layout/AppShell'
import { Icon } from '@/components/ui/Icon'
import { getLabTest, type LabTest } from '@/lib/records-api'

type Row = { test: string; result: string; range: string; flag?: string }

function toRows(results: LabTest['results']): Row[] {
  if (!results || typeof results !== 'object') return []
  return Object.entries(results).map(([k, v]) => {
    if (v && typeof v === 'object') {
      const o = v as Record<string, unknown>
      const val = [o.value, o.unit].filter(Boolean).join(' ')
      return {
        test: String(o.name || k),
        result: val || String(o.value ?? ''),
        range: String(o.reference_range || o.range || o.normal || ''),
        flag: o.flag ? String(o.flag) : (o.abnormal ? 'High' : undefined),
      }
    }
    return { test: k, result: String(v), range: '' }
  })
}

function shortDate(iso?: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' })
}

export default function ReportDetailPage() {
  const router = useRouter()
  const params = useParams<{ id: string }>()
  const id = params?.id
  const [test, setTest] = useState<LabTest | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (typeof window === 'undefined') return
    if (!localStorage.getItem('pal_token')) { router.replace('/login'); return }
    if (!id) return
    ;(async () => {
      setLoading(true)
      const t = await getLabTest(id)
      setTest(t)
      setLoading(false)
    })()
  }, [id, router])

  const rows = test ? toRows(test.results) : []

  return (
    <AppShell active="records" title="Health records">
      <div className="page narrow">
        <button className="btn ghost" style={{ padding: 0 }} onClick={() => router.push('/records')}><Icon name="left" /> Back to records</button>

        {loading ? (
          <div className="muted" style={{ marginTop: '1em' }}>Loading…</div>
        ) : !test ? (
          <article className="card" style={{ marginTop: '1em' }}><p className="muted">This report could not be found.</p></article>
        ) : (
          <>
            <div className="headrow" style={{ marginTop: '.3em' }}>
              <div>
                <h1 className="h">{test.report_name}</h1>
                <p className="lede">{[test.lab_name, shortDate(test.result_date || test.ordered_date)].filter(Boolean).join(', ')}{test.ordered_by ? `. Ordered by ${test.ordered_by}.` : ''}</p>
              </div>
            </div>

            {rows.length > 0 && (
              <div className="card" style={{ marginTop: '1.2em' }}>
                <div className="tablewrap">
                  <table className="results">
                    <thead><tr><th>Test</th><th>Your result</th><th>Normal range</th><th></th></tr></thead>
                    <tbody>
                      {rows.map((r, i) => (
                        <tr key={i}>
                          <td>{r.test}</td>
                          <td className="v">{r.result}</td>
                          <td>{r.range}</td>
                          <td>{r.flag ? <span className="tag warn">{r.flag}</span> : <span className="tag ok">Normal</span>}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {test.interpretation && (
              <>
                <h2 className="s">What the lab said</h2>
                <div className="plantext" style={{ background: '#fff', border: '1px solid var(--line)' }}>{test.interpretation}</div>
              </>
            )}

            <div className="row" style={{ marginTop: '1.2em' }}>
              <button className="btn pri" onClick={() => router.push(`/ask?q=${encodeURIComponent(`What does my ${test.report_name} mean?`)}`)}><Icon name="ask" /> Ask PAL what this means</button>
            </div>
          </>
        )}
      </div>
    </AppShell>
  )
}

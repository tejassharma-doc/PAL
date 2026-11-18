'use client'

/**
 * Add a report — redesigned onto AppShell (pal-app.html `S.upload`).
 * Three-step flow: choose → check (edit extracted rows) → saved. Upload/confirm
 * logic preserved verbatim (/api/medical/upload → /api/medical/confirm).
 */
import { useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { AppShell } from '@/components/layout/AppShell'
import { Icon } from '@/components/ui/Icon'

type Phase = 'idle' | 'uploading' | 'verifying' | 'success' | 'error'
/* eslint-disable @typescript-eslint/no-explicit-any */

export default function UploadPage() {
  const router = useRouter()
  const fileRef = useRef<HTMLInputElement>(null)
  const [phase, setPhase] = useState<Phase>('idle')
  const [error, setError] = useState('')
  const [verify, setVerify] = useState<any>(null)
  const [obs, setObs] = useState<any[]>([])

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    if (file.size > 20 * 1024 * 1024) { setError('File too large (max 20 MB)'); setPhase('error'); return }
    if (!['application/pdf', 'image/jpeg', 'image/jpg', 'image/png'].includes(file.type)) { setError('Please upload a PDF, JPEG or PNG'); setPhase('error'); return }
    setPhase('uploading'); setError('')
    try {
      const token = localStorage.getItem('pal_token'); const patientId = localStorage.getItem('pal_patient_id')
      if (!token) { router.push('/login'); return }
      if (!patientId) { setError('Please create your patient profile first'); setPhase('error'); return }
      const fd = new FormData(); fd.append('file', file); fd.append('patient_id', patientId)
      const res = await fetch('/api/medical/upload', { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: fd })
      if (!res.ok) throw new Error(`Upload failed: ${res.status}`)
      const result = await res.json()
      if (result.type === 'pending_verification') {
        setVerify(result)
        setObs((result.observations || []).map((o: any) => ({ ...o, original_display: o.original_display ?? o.display })))
        setPhase('verifying')
      } else if (result.type === 'document_accepted') {
        setPhase('success'); setTimeout(() => router.push('/records'), 1800)
      } else { setError(result.message || 'Upload failed'); setPhase('error') }
    } catch (err: any) { setError(err.message || 'Upload failed. Please try again.'); setPhase('error') }
  }

  async function confirm() {
    if (!verify) return
    setPhase('uploading')
    try {
      const token = localStorage.getItem('pal_token'); const patientId = localStorage.getItem('pal_patient_id')
      const res = await fetch('/api/medical/confirm', {
        method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          raw_source_id: verify.raw_source_id, patient_id: patientId,
          observations: obs.map(o => ({ ...o, edited: o.display !== (o.original_display ?? o.display) })),
          report_date: verify.report_date, report_title: verify.report_title, fhir_bundle: null,
          extraction_id: verify.extraction_id, source_modality: verify.source_modality,
          extraction_method: verify.extraction_method, transcription_text: verify.transcription_text,
          transcription_model: verify.transcription_model, needs_review: verify.needs_review,
        }),
      })
      if (!res.ok) throw new Error(`Confirm failed: ${res.status}`)
      setPhase('success'); setTimeout(() => router.push('/records'), 1800)
    } catch (err: any) { setError(err.message || 'Failed to save'); setPhase('error') }
  }

  const step = phase === 'success' ? 3 : phase === 'verifying' ? 2 : 1
  const isRx = verify?.doc_kind === 'prescription'

  return (
    <AppShell active="records" title="Add a report">
      <div className="page">
        <input ref={fileRef} type="file" accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png" style={{ display: 'none' }} onChange={onFile} />
        <button className="btn ghost" style={{ padding: 0 }} onClick={() => router.push('/records')}><Icon name="left" /> Back to records</button>
        <h1 className="h" style={{ marginTop: '.3em' }}>{phase === 'verifying' ? 'Check what PAL read' : 'Add a report'}</h1>
        <p className="lede">{phase === 'verifying' ? 'Fix anything that looks wrong before it goes into your record.' : 'Photograph a prescription or lab report — PAL reads it, you confirm.'}</p>

        <div className="steps" aria-label="Progress">
          <div className={step > 1 ? 'done' : 'now'}><i>{step > 1 ? <Icon name="check" /> : '1'}</i> Choose</div>
          <div className={step === 2 ? 'now' : step > 2 ? 'done' : ''}><i>{step > 2 ? <Icon name="check" /> : '2'}</i> Check</div>
          <div className={step === 3 ? 'now' : ''}><i>3</i> Saved</div>
        </div>

        {error && <div className="alertcard" style={{ marginBottom: '1em' }}><Icon name="alert" /><div><b>Upload problem</b><span className="muted small">{error}</span></div></div>}

        {(phase === 'idle' || phase === 'error') && (
          <article className="card">
            <p className="muted">Upload a PDF, JPEG or PNG of your prescription or lab report (max 20 MB).</p>
            <div className="row" style={{ marginTop: '1em' }}>
              <button className="btn pri big" onClick={() => fileRef.current?.click()}><Icon name="cam" /> Take a photo</button>
              <button className="btn sec" onClick={() => fileRef.current?.click()}><Icon name="up" /> Choose a file</button>
            </div>
          </article>
        )}

        {phase === 'uploading' && <article className="card"><p className="muted">Processing…</p></article>}

        {phase === 'verifying' && verify && (
          <div className="upgrid">
            <div className="thumb">
              <div className="paperdoc">{Array.from({ length: 8 }).map((_, i) => <b key={i} style={{ width: `${55 + (i % 4) * 10}%` }} />)}</div>
              <p className="small muted" style={{ marginTop: '.7em' }}>{verify.filename || 'document'}</p>
              <button className="btn sec full" style={{ marginTop: '.6em' }} onClick={() => fileRef.current?.click()}><Icon name="cam" /> Retake / choose again</button>
            </div>
            <div>
              <div className="card">
                <div className="field"><label>Report</label><input value={verify.report_title || verify.filename || ''} readOnly /></div>
                <div className="field"><label>Date</label><input value={verify.report_date || ''} readOnly /></div>
                <h2 className="s">{isRx ? 'Medicines' : 'Lab values'}</h2>
                {obs.length === 0 && <p className="muted small">We couldn&apos;t read this automatically — the original is saved to your records.</p>}
                {obs.map((o, i) => (
                  <div className="medfix" key={i}>
                    <div className="field check" style={{ margin: 0 }}>
                      <label>Name</label>
                      {isRx
                        ? <input value={o.display} onChange={e => setObs(prev => prev.map((x, j) => j === i ? { ...x, display: e.target.value } : x))} />
                        : <input value={o.display} readOnly />}
                      {o.legible === false && <span className="hint"><Icon name="alert" /> Please check — the handwriting was unclear</span>}
                    </div>
                    <div className="field" style={{ margin: 0 }}><label>Value</label><input value={[o.value, o.unit].filter(Boolean).join(' ')} readOnly /></div>
                    <div className="field" style={{ margin: 0 }}><label>Range</label><input value={o.reference_range || ''} readOnly /></div>
                  </div>
                ))}
                <div className="row" style={{ marginTop: '1.2em' }}>
                  <button className="btn pri big" onClick={() => void confirm()}><Icon name="check" /> Save to my record</button>
                  <button className="btn ghost" onClick={() => setPhase('idle')}>Cancel</button>
                </div>
              </div>
            </div>
          </div>
        )}

        {phase === 'success' && (
          <article className="card hl"><div className="row" style={{ gap: '.8em' }}><span className="pillico"><Icon name="check" /></span><div><b style={{ fontSize: '1.1em' }}>Report saved</b><div className="muted small">Taking you to your records…</div></div></div></article>
        )}
      </div>
    </AppShell>
  )
}

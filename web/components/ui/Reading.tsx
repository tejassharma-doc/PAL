'use client'

/**
 * A single "key reading" row with the value, a range bar, a normal zone, and a
 * marker — ported from the pal-app.html `reading()` helper. `Reading` is the raw
 * presentational row; `readingFromFact` maps a backend HealthFact onto it using
 * a small per-metric range table (LDL / BP / HbA1c / cholesterol / glucose…).
 */
import React from 'react'
import type { HealthFact } from '../../lib/api'

export interface ReadingProps {
  name: string
  date?: string
  value: string
  unit?: string
  pos?: number        // 0–100 marker position; omit to hide the bar
  zoneL?: number      // normal-zone left %
  zoneW?: number      // normal-zone width %
  status?: 'ok' | 'warn' | 'bad'
  statusLabel?: string
  low?: string
  high?: string
  color?: string
}

export function Reading(p: ReadingProps) {
  const color = p.color || (p.status === 'warn' ? '#d8a24a' : p.status === 'bad' ? '#c2675e' : '#1f7d6b')
  return (
    <div className="reading">
      <div><div className="nm">{p.name}</div>{p.date && <div className="dt">{p.date}</div>}</div>
      <div className="val">{p.value}{p.unit && <small>{p.unit}</small>}</div>
      {typeof p.pos === 'number' && (
        <>
          <div className="bar">
            {typeof p.zoneL === 'number' && <span className="zone" style={{ left: `${p.zoneL}%`, width: `${p.zoneW ?? 0}%` }} />}
            <span className="mark" style={{ left: `${p.pos}%`, background: color }} />
          </div>
          <div className="legend">
            <span>{p.low ?? ''}</span>
            {p.status && <span className={`tag ${p.status}`}>{p.statusLabel}</span>}
            <span>{p.high ?? ''}</span>
          </div>
        </>
      )}
    </div>
  )
}

type Metric = { match: string[]; label: string; min: number; max: number; nl: number; nh: number; unit: string }
const METRICS: Metric[] = [
  { match: ['ldl'], label: 'LDL cholesterol', min: 0, max: 200, nl: 0, nh: 100, unit: 'mg/dL' },
  { match: ['hdl'], label: 'HDL cholesterol', min: 0, max: 100, nl: 40, nh: 100, unit: 'mg/dL' },
  { match: ['triglyceride'], label: 'Triglycerides', min: 0, max: 300, nl: 0, nh: 150, unit: 'mg/dL' },
  { match: ['total cholesterol', 'cholesterol'], label: 'Total cholesterol', min: 0, max: 300, nl: 0, nh: 200, unit: 'mg/dL' },
  { match: ['hba1c', 'a1c'], label: 'HbA1c', min: 4, max: 10, nl: 4, nh: 5.7, unit: '%' },
  { match: ['systolic', 'blood pressure', 'bp'], label: 'Blood pressure', min: 80, max: 200, nl: 90, nh: 120, unit: 'mmHg' },
  { match: ['glucose', 'sugar', 'fasting'], label: 'Blood glucose', min: 50, max: 300, nl: 70, nh: 140, unit: 'mg/dL' },
]

function shortDate(iso?: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })
}

export function readingFromFact(f: HealthFact): ReadingProps {
  const hay = `${f.key} ${f.type}`.toLowerCase()
  const m = METRICS.find(metric => metric.match.some(s => hay.includes(s)))
  const base: ReadingProps = { name: (f.key || 'Reading').replace(/_/g, ' '), date: shortDate(f.recorded_at), value: f.value, unit: f.unit || undefined }
  if (!m) return base
  const num = parseFloat(String(f.value).split('/')[0])
  const clamp = (x: number) => Math.max(0, Math.min(100, x))
  const pos = Number.isFinite(num) ? clamp(((num - m.min) / (m.max - m.min)) * 100) : undefined
  const zoneL = clamp(((m.nl - m.min) / (m.max - m.min)) * 100)
  const zoneW = clamp(((m.nh - m.nl) / (m.max - m.min)) * 100)
  const inNormal = Number.isFinite(num) && num >= m.nl && num <= m.nh
  return {
    name: m.label,
    date: shortDate(f.recorded_at),
    value: f.value,
    unit: f.unit || m.unit,
    pos,
    zoneL,
    zoneW,
    status: inNormal ? 'ok' : 'warn',
    statusLabel: inNormal ? 'Normal' : 'Out of range',
    low: String(m.min),
    high: `${m.max}+`,
  }
}

export default Reading

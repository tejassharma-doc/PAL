'use client'

/**
 * Nutrition — redesigned onto AppShell (pal-app.html `S.nutrition`), wired to the
 * real iNutriMon prescription via lib/nutrition-api (GET /nutrition/patient/{id}).
 *
 * The prototype's demo recipe library / plan-maker is NOT reproduced: the stored
 * payload carries recipe names + per-dish macros + day totals + targets + guidance,
 * so the page shows exactly that. No dummy data.
 */
import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { AppShell } from '@/components/layout/AppShell'
import { Icon, type IconName } from '@/components/ui/Icon'
import {
  getPatientNutrition,
  type NutritionPrescription,
  type NutritionDay,
  type NutritionMenuItem,
} from '@/lib/nutrition-api'

type Tab = 'meals' | 'tips' | 'numbers'

// iNutriMon feed-time codes → human slot label + icon + sort order.
const SLOTS: { code: string; label: string; icon: IconName }[] = [
  { code: 'EM', label: 'Early morning', icon: 'sunrise' },
  { code: 'BF', label: 'Breakfast', icon: 'sun' },
  { code: 'MM', label: 'Mid morning', icon: 'apple' },
  { code: 'L', label: 'Lunch', icon: 'bowl' },
  { code: 'LU', label: 'Lunch', icon: 'bowl' },
  { code: 'T', label: 'Tea time', icon: 'cup' },
  { code: 'TE', label: 'Tea time', icon: 'cup' },
  { code: 'ME', label: 'Evening meal', icon: 'moon' },
  { code: 'EV', label: 'Evening meal', icon: 'moon' },
  { code: 'D', label: 'Dinner', icon: 'moon' },
]
function slotInfo(code: string | null): { label: string; icon: IconName } {
  const c = (code || '').trim().toUpperCase()
  const hit = SLOTS.find(s => s.code === c)
  return hit ? { label: hit.label, icon: hit.icon } : { label: code || 'Meal', icon: 'bowl' }
}

function fmtDate(iso?: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })
}
function num(n?: number | null): string {
  return n == null ? '—' : n.toLocaleString('en-IN')
}

/** Group a day's items by feed time, preserving first-appearance order. */
function groupBySlot(items: NutritionMenuItem[]): { code: string | null; items: NutritionMenuItem[] }[] {
  const order: string[] = []
  const map = new Map<string, NutritionMenuItem[]>()
  for (const it of items) {
    const key = (it.feed_time || '·').toUpperCase()
    if (!map.has(key)) { map.set(key, []); order.push(key) }
    map.get(key)!.push(it)
  }
  return order.map(k => ({ code: k === '·' ? null : k, items: map.get(k)! }))
}

export default function NutritionPage() {
  const router = useRouter()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const [rx, setRx] = useState<NutritionPrescription | null>(null)
  const [tab, setTab] = useState<Tab>('meals')
  const [dayIdx, setDayIdx] = useState(0)

  useEffect(() => {
    if (typeof window === 'undefined') return
    if (!localStorage.getItem('pal_token')) { router.replace('/login'); return }
    ;(async () => {
      try {
        const res = await getPatientNutrition()
        setRx(res.has_plan && res.prescription ? res.prescription : null)
      } catch { setError(true) }
      finally { setLoading(false) }
    })()
  }, [router])

  const days = rx?.days ?? []
  const day: NutritionDay | undefined = days[dayIdx]
  const slots = useMemo(() => (day ? groupBySlot(day.items) : []), [day])

  // How-to guidance split by kind.
  const eat = (rx?.guidance ?? []).filter(g => (g.kind || '').toUpperCase() === 'EAT')
  const avoid = (rx?.guidance ?? []).filter(g => (g.kind || '').toUpperCase() === 'AVOID')
  const otherGuidance = (rx?.guidance ?? []).filter(g => !['EAT', 'AVOID'].includes((g.kind || '').toUpperCase()))

  const mealsPerDay = day ? new Set(day.items.map(i => (i.feed_time || '').toUpperCase())).size : 0

  return (
    <AppShell active="nutrition" title="Nutrition">
      <div className="page">
        {loading ? (
          <div className="muted" style={{ marginTop: '1em' }}>Loading your plan…</div>
        ) : error ? (
          <>
            <h1 className="h">Nutrition</h1>
            <div className="alertcard" style={{ marginTop: '1em' }}>
              <Icon name="alert" />
              <div><b>Couldn&apos;t load your plan</b><span className="muted small">Please try again in a moment.</span></div>
            </div>
          </>
        ) : !rx ? (
          <>
            <h1 className="h">Nutrition</h1>
            <p className="lede">Meals planned around your health, prescribed by your clinic&apos;s dietitian.</p>
            <article className="card hl empty" style={{ marginTop: '1.4em' }}>
              <div className="gicon"><Icon name="bowl" /></div>
              <div>
                <b className="gt">You don&apos;t have a nutrition plan yet</b>
                <p className="muted">When your clinic&apos;s dietitian prescribes a meal plan, it will appear here automatically — with your daily meals, targets and guidance.</p>
                <div className="row" style={{ marginTop: '.9em' }}>
                  <button className="btn sec" onClick={() => router.push('/visits')}><Icon name="cal" /> See your visits</button>
                </div>
              </div>
            </article>
          </>
        ) : (
          <>
            {/* Header */}
            <div className="rxhead">
              <div>
                <span className="tag ok"><Icon name="leaf" /> {rx.is_current ? 'Current plan' : 'Plan'}</span>
                <h1 className="h" style={{ marginTop: '.3em' }}>Your nutrition plan</h1>
                <p className="lede">
                  {rx.dietitian_name ? `From ${rx.dietitian_name}` : 'From your dietitian'}
                  {rx.clinic_name ? `, ${rx.clinic_name}` : ''}. Given on {fmtDate(rx.issued_at)}.
                </p>
              </div>
            </div>

            {/* Goal */}
            <article className="card hl goal" style={{ marginTop: '1.2em' }}>
              <div className="gicon"><Icon name="target" /></div>
              <div>
                <b className="gt">{rx.goal?.label || 'Your nutrition goal'}</b>
                {rx.goal?.summary ? <p>{rx.goal.summary}</p> : rx.consultation_summary ? <p>{rx.consultation_summary}</p> : null}
                <div className="facts">
                  {mealsPerDay ? <span><Icon name="clock" /> {mealsPerDay} meals a day</span> : null}
                  {(rx.targets.energy_kcal_min || rx.targets.energy_kcal_max) ? (
                    <span><Icon name="bowl" /> About {num(rx.targets.energy_kcal_max || rx.targets.energy_kcal_min)} kcal a day</span>
                  ) : null}
                  {rx.diet_pattern ? <span><Icon name="leaf" /> {rx.diet_pattern}</span> : null}
                  {rx.cuisine ? <span><Icon name="bowl" /> {rx.cuisine}</span> : null}
                </div>
                {rx.diagnoses.length > 0 && (
                  <div className="facts" style={{ marginTop: '.4em' }}>
                    {rx.diagnoses.map((d, i) => <span key={i}><Icon name="pulse" /> {d.description || d.code}</span>)}
                  </div>
                )}
              </div>
            </article>

            {/* Tabs */}
            <div className="ntabs" role="tablist" aria-label="Plan sections">
              <button role="tab" aria-selected={tab === 'meals'} onClick={() => setTab('meals')}><Icon name="bowl" /> Meals</button>
              <button role="tab" aria-selected={tab === 'tips'} onClick={() => setTab('tips')}><Icon name="leaf" /> How to follow it</button>
              <button role="tab" aria-selected={tab === 'numbers'} onClick={() => setTab('numbers')}><Icon name="pulse" /> Your numbers</button>
            </div>

            {tab === 'meals' && (
              <div>
                {days.length === 0 ? (
                  <p className="muted" style={{ marginTop: '1em' }}>No daily menu in this plan yet.</p>
                ) : (
                  <>
                    <div className="dayrow" role="tablist" aria-label="Day">
                      {days.map((d, i) => (
                        <button key={i} role="tab" aria-selected={i === dayIdx} onClick={() => setDayIdx(i)}>
                          <small>{d.day_label ? d.day_label.slice(0, 3) : 'Day'}</small>
                          <b>{d.day_number ?? i + 1}</b>
                        </button>
                      ))}
                    </div>
                    <h2 className="s">{day?.day_label || `Day ${day?.day_number ?? dayIdx + 1}`}</h2>
                    <div className="meals">
                      {slots.map((grp, i) => {
                        const info = slotInfo(grp.code)
                        const kc = grp.items.reduce((a, x) => a + (x.energy_kcal || 0), 0)
                        return (
                          <article className="meal" key={i}>
                            <div className="mslot">
                              <span className="sico"><Icon name={info.icon} /></span>
                              <span>{info.label}</span>
                              {kc > 0 ? <span className="kc">{Math.round(kc)} kcal</span> : null}
                            </div>
                            {grp.items.map((it, j) => (
                              <div className="dish" key={j}>
                                <b>{it.recipe_name || 'Dish'}</b>
                                <span>
                                  {[
                                    it.servings ? `${num(it.servings)} serving${it.servings === 1 ? '' : 's'}` : null,
                                    it.protein_g != null ? `${num(it.protein_g)} g protein` : null,
                                  ].filter(Boolean).join(', ')}
                                </span>
                              </div>
                            ))}
                          </article>
                        )
                      })}
                    </div>
                    {day?.totals?.energy_kcal != null && (
                      <p className="daytot"><Icon name="info" /> This day adds up to about {num(day.totals.energy_kcal)} kcal
                        {day.totals.protein_g != null ? `, ${num(day.totals.protein_g)} g protein` : ''}.</p>
                    )}
                  </>
                )}
              </div>
            )}

            {tab === 'tips' && (
              <div>
                {eat.length === 0 && avoid.length === 0 && otherGuidance.length === 0 && rx.instructions.length === 0 ? (
                  <p className="muted" style={{ marginTop: '1em' }}>No extra guidance in this plan.</p>
                ) : null}

                {eat.length > 0 && (
                  <>
                    <h2 className="s"><Icon name="leaf" /> Foods to eat more of</h2>
                    <div className="list">
                      {eat.map((g, i) => (
                        <div className="li" key={i}>
                          <span className="ic rx"><Icon name="check" /></span>
                          <span className="tx"><b>{g.text}</b>{g.source ? <span>{g.source}</span> : null}</span>
                        </div>
                      ))}
                    </div>
                  </>
                )}

                {avoid.length > 0 && (
                  <>
                    <h2 className="s"><Icon name="alert" /> Best to limit or avoid</h2>
                    <div className="list">
                      {avoid.map((g, i) => (
                        <div className="li" key={i}>
                          <span className="ic note"><Icon name="x" /></span>
                          <span className="tx"><b>{g.text}</b>{g.source ? <span>{g.source}</span> : null}</span>
                        </div>
                      ))}
                    </div>
                  </>
                )}

                {(otherGuidance.length > 0 || rx.instructions.length > 0) && (
                  <>
                    <h2 className="s"><Icon name="info" /> How to follow your plan</h2>
                    <div className="card tipg">
                      {[...otherGuidance.map(g => ({ text: g.text, source: g.source })), ...rx.instructions].map((t, i) => (
                        <div className="tip" key={i}><b>{t.text}</b>{t.source ? <p className="nsrc">{t.source}</p> : null}</div>
                      ))}
                    </div>
                  </>
                )}

                {rx.checkins.length > 0 && (
                  <>
                    <h2 className="s"><Icon name="pulse" /> What to track</h2>
                    <div className="list">
                      {rx.checkins.map((c, i) => (
                        <div className="li" key={i}>
                          <span className="ic lab"><Icon name="pulse" /></span>
                          <span className="tx"><b>{c.label || c.prompt}</b><span>{[c.frequency, c.stream].filter(Boolean).join(' · ')}</span></span>
                        </div>
                      ))}
                    </div>
                  </>
                )}
              </div>
            )}

            {tab === 'numbers' && (
              <div>
                <h2 className="s" style={{ marginTop: '.4em' }}>What your body needs each day</h2>
                <div className="tgrid">
                  <div className="card tg"><span className="tl">Energy</span><b>{num(rx.targets.energy_kcal_max || rx.targets.energy_kcal_min)}</b><span className="tu">kcal a day</span>
                    {rx.targets.energy_kcal_min && rx.targets.energy_kcal_max ? <span className="tn">{num(rx.targets.energy_kcal_min)}–{num(rx.targets.energy_kcal_max)}</span> : null}</div>
                  <div className="card tg"><span className="tl">Protein</span><b>{num(rx.targets.protein_g)}</b><span className="tu">grams a day</span></div>
                  <div className="card tg"><span className="tl">Carbohydrate</span><b>{num(rx.targets.carb_g)}</b><span className="tu">grams a day</span></div>
                  <div className="card tg"><span className="tl">Fat</span><b>{num(rx.targets.fat_g)}</b><span className="tu">grams a day</span></div>
                </div>
                <p className="small muted" style={{ marginTop: '.6em' }}>Your meals are planned around these. You don&apos;t need to count anything yourself.</p>

                <h2 className="s">Your measurements</h2>
                <div className="card">
                  <div className="kv">
                    <div><span>Height</span><b>{rx.anthropometry.height_cm ? `${num(rx.anthropometry.height_cm)} cm` : '—'}</b></div>
                    <div><span>Weight</span><b>{rx.anthropometry.weight_kg ? `${num(rx.anthropometry.weight_kg)} kg` : '—'}</b></div>
                    <div><span>Body mass index (BMI)</span><b>{num(rx.anthropometry.bmi)}</b></div>
                    <div><span>BMI status</span><b>{rx.anthropometry.bmi_status || '—'}</b></div>
                  </div>
                </div>

                {rx.labs.length > 0 && (
                  <>
                    <h2 className="s">Relevant lab results</h2>
                    <div className="card">
                      <div className="tablewrap">
                        <table className="results">
                          <thead><tr><th>Test</th><th>Result</th><th></th></tr></thead>
                          <tbody>
                            {rx.labs.map((l, i) => (
                              <tr key={i}>
                                <td>{l.display_name || l.analyte}</td>
                                <td className="v">{l.result || (l.numeric_value != null ? `${l.numeric_value}${l.unit ? ' ' + l.unit : ''}` : '—')}</td>
                                <td>{l.flag && l.flag.toUpperCase() !== 'NORMAL' ? <span className="tag warn">{l.flag}</span> : <span className="tag ok">Normal</span>}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  </>
                )}
              </div>
            )}

            <p className="small muted rxfoot">
              {rx.version ? `Version ${rx.version} of your plan. ` : ''}
              Given by {rx.dietitian_name || 'your dietitian'} on {fmtDate(rx.issued_at)}. When it&apos;s updated, the new version replaces this one.
            </p>
          </>
        )}
      </div>
    </AppShell>
  )
}

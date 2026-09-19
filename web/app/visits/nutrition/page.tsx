'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import PhoneShell from '@/components/layout/PhoneShell';
import TabBar from '@/components/layout/TabBar';

const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

const meals = {
  breakfast: {
    name: 'Greek yogurt bowl',
    kcal: 320,
    items: ['200g Greek yogurt', 'Mixed berries', 'Flaxseeds', 'Honey (1 tsp)'],
    why: 'High protein, omega-3s from flaxseeds support LDL reduction. Low saturated fat.',
  },
  lunch: {
    name: 'Grilled fish & quinoa',
    kcal: 480,
    items: ['150g grilled salmon', '60g quinoa', 'Roasted vegetables', 'Olive oil drizzle'],
    why: 'Omega-3 fatty acids from salmon are evidence-backed for cardiovascular benefit (ACC/AHA 2018).',
  },
  dinner: {
    name: 'Lentil & vegetable curry',
    kcal: 420,
    items: ['1 cup red lentils', 'Spinach, tomatoes', 'Brown rice (small portion)', 'No ghee'],
    why: 'Soluble fibre from lentils binds bile acids, reduces LDL. Avoids saturated fat from ghee.',
  },
};

type MealKey = keyof typeof meals;

export default function NutritionPlanPage() {
  const router = useRouter();
  const [activeDay, setActiveDay] = useState(0);
  const [expanded, setExpanded] = useState<MealKey | null>('breakfast');

  const todayIdx = new Date().getDay() === 0 ? 6 : new Date().getDay() - 1;

  return (
    <PhoneShell>
      <div style={{ height: 28 }} />

      {/* Header */}
      <div style={{ padding: '10px 16px 0', display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
        <button onClick={() => router.back()} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4 }}>
          <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
            <path d="M13 4l-6 6 6 6" stroke="var(--ink)" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" strokeOpacity="0.5"/>
          </svg>
        </button>
        <div style={{ flex: 1 }}>
          <p style={{ fontSize: 13, fontWeight: 700, color: 'var(--ink)' }}>Nutrition plan</p>
          <p style={{ fontSize: 11, color: 'rgba(13,31,36,0.45)' }}>Meera Nair · Low-cholesterol</p>
        </div>
      </div>

      {/* Day picker */}
      <div style={{ padding: '12px 16px 0', display: 'flex', gap: 6, flexShrink: 0 }}>
        {days.map((d, i) => (
          <button key={d} onClick={() => setActiveDay(i)} style={{
            flex: 1, padding: '8px 0', borderRadius: 10, border: 'none', cursor: 'pointer',
            background: activeDay === i ? 'var(--jade)' : i === todayIdx ? 'rgba(55,181,155,0.1)' : 'transparent',
            color: activeDay === i ? '#fff' : i === todayIdx ? 'var(--jade-deep)' : 'rgba(13,31,36,0.4)',
            fontSize: 11, fontWeight: 700, transition: 'all 0.2s',
          }}>
            {d}
          </button>
        ))}
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '12px 16px 8px' }}>
        {/* Calorie summary */}
        <div style={{
          background: 'rgba(55,181,155,0.08)', borderRadius: 12, padding: '10px 14px',
          border: '1px solid rgba(55,181,155,0.2)', marginBottom: 12,
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        }}>
          <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink)' }}>Daily total</span>
          <span style={{ fontSize: 15, fontWeight: 700, fontFamily: 'var(--mono)', color: 'var(--jade-deep)' }}>
            {Object.values(meals).reduce((sum, m) => sum + m.kcal, 0)} kcal
          </span>
        </div>

        {/* Meal cards */}
        {(Object.entries(meals) as [MealKey, typeof meals[MealKey]][]).map(([key, meal]) => (
          <div key={key} style={{ marginBottom: 8 }}>
            <button onClick={() => setExpanded(expanded === key ? null : key)}
                    style={{
                      width: '100%', background: '#fff', borderRadius: expanded === key ? '14px 14px 0 0' : 14,
                      border: '1px solid var(--line)', padding: '12px 14px',
                      display: 'flex', alignItems: 'center', gap: 10,
                      cursor: 'pointer', textAlign: 'left',
                    }}>
              <span style={{ fontSize: 20 }}>
                {key === 'breakfast' ? '🌅' : key === 'lunch' ? '☀️' : '🌙'}
              </span>
              <div style={{ flex: 1 }}>
                <p style={{ fontSize: 12, fontWeight: 700, color: 'rgba(13,31,36,0.4)', textTransform: 'capitalize', letterSpacing: '0.04em' }}>{key}</p>
                <p style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink)' }}>{meal.name}</p>
              </div>
              <span style={{ fontSize: 12, fontFamily: 'var(--mono)', color: 'rgba(13,31,36,0.45)' }}>{meal.kcal} kcal</span>
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none"
                   style={{ transform: expanded === key ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s' }}>
                <path d="M3 5l4 4 4-4" stroke="rgba(13,31,36,0.4)" strokeWidth="1.5" strokeLinecap="round"/>
              </svg>
            </button>

            {expanded === key && (
              <div style={{
                background: '#fff',
                borderRadius: '0 0 14px 14px',
                border: '1px solid var(--line)', borderTop: 'none',
                padding: '12px 14px',
                animation: 'fadeIn 0.2s ease',
              }}>
                {meal.items.map((item, i) => (
                  <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                    <div style={{ width: 5, height: 5, borderRadius: '50%', background: 'var(--jade)', flexShrink: 0 }} />
                    <span style={{ fontSize: 13, color: 'var(--ink)' }}>{item}</span>
                  </div>
                ))}
                <div style={{
                  marginTop: 10, padding: '10px 12px',
                  background: 'rgba(55,181,155,0.06)', borderRadius: 10,
                  border: '1px solid rgba(55,181,155,0.15)',
                }}>
                  <p style={{ fontSize: 10, fontWeight: 700, color: 'var(--jade-deep)', marginBottom: 4, letterSpacing: '0.05em' }}>WHY:</p>
                  <p style={{ fontSize: 12, color: 'rgba(13,31,36,0.6)', lineHeight: 1.5, fontFamily: 'var(--serif)' }}>{meal.why}</p>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>

      <TabBar />
    </PhoneShell>
  );
}

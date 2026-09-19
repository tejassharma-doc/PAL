'use client';

import { useEffect, useState, useCallback } from 'react';

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';
const DEFAULT_TENANT = '00000000-0000-0000-0000-000000000001';

const c = {
  ink: '#0d1f24', jade: '#37b59b', jadeD: '#1f7d6b',
  rose: '#c2675e', amber: '#d8a24a', amberD: '#8a6020', blue: '#5a8fa8',
  paper: '#f6f3ec',
};
const mono = "'Space Mono', monospace";
const serif = "'Newsreader', serif";

const EVENT_TYPES = [
  '', 'consent_granted', 'consent_revoked',
  'phi_record_read', 'phi_egress_decision', 'phi_access_denied',
];
const EVENT_COLORS: Record<string, string> = {
  consent_granted:     c.jade,
  consent_revoked:     c.rose,
  phi_record_read:     c.blue,
  phi_egress_decision: c.amber,
  phi_access_denied:   c.rose,
};

export default function AuditPage() {
  const [events, setEvents]       = useState<any[]>([]);
  const [total, setTotal]         = useState(0);
  const [pages, setPages]         = useState(1);
  const [page, setPage]           = useState(1);
  const [loading, setLoading]     = useState(true);
  const [error, setError]         = useState<string | null>(null);
  const [expanded, setExpanded]   = useState<string | null>(null);

  // Filters
  const [eventType, setEventType] = useState('');
  const [dateFrom, setDateFrom]   = useState('');
  const [dateTo, setDateTo]       = useState('');

  const token = typeof window !== 'undefined' ? localStorage.getItem('pal_token') : null;
  const authHeader: Record<string, string> = token ? { Authorization: `Bearer ${token}` } : {};

  const load = useCallback(() => {
    setLoading(true);
    const params = new URLSearchParams({ page: String(page), page_size: '50' });
    if (eventType) params.set('event_type', eventType);
    if (dateFrom)  params.set('date_from', new Date(dateFrom).toISOString());
    if (dateTo)    params.set('date_to', new Date(dateTo + 'T23:59:59').toISOString());

    fetch(`${API}/admin/${DEFAULT_TENANT}/audit?${params}`, { headers: authHeader })
      .then(r => r.ok ? r.json() : r.json().then((e: any) => Promise.reject(e.detail || 'API error')))
      .then(d => {
        setEvents(d.events);
        setTotal(d.total);
        setPages(d.pages);
        setLoading(false);
      })
      .catch(e => { setError(String(e)); setLoading(false); });
  }, [page, eventType, dateFrom, dateTo]);

  useEffect(() => { load(); }, [load]);

  function exportCsv() {
    const params = new URLSearchParams();
    if (eventType) params.set('event_type', eventType);
    if (dateFrom)  params.set('date_from', new Date(dateFrom).toISOString());
    if (dateTo)    params.set('date_to', new Date(dateTo + 'T23:59:59').toISOString());
    window.open(`${API}/admin/${DEFAULT_TENANT}/audit/export?${params}`, '_blank');
  }

  const inputStyle: React.CSSProperties = {
    fontFamily: "'Space Grotesk', sans-serif", fontSize: '.82rem',
    padding: '8px 11px', borderRadius: 9,
    border: '1px solid rgba(13,31,36,.16)', background: c.paper, outline: 'none',
  };

  return (
    <div style={{ padding: '36px 40px', maxWidth: 1200 }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 24 }}>
        <div>
          <h1 style={{ fontFamily: serif, fontWeight: 300, fontSize: '1.9rem', letterSpacing: '-.02em', marginBottom: 4 }}>Audit log</h1>
          <p style={{ fontSize: '.85rem', opacity: .55 }}>PHI access + consent events. Append-only. {total > 0 && <strong>{total.toLocaleString()} total events.</strong>}</p>
        </div>
        <button onClick={exportCsv} style={{
          fontFamily: "'Space Grotesk', sans-serif", fontWeight: 600, fontSize: '.8rem',
          padding: '9px 16px', borderRadius: 9,
          border: '1px solid rgba(13,31,36,.16)', background: 'transparent', cursor: 'pointer',
        }}>
          ⬇ Export CSV
        </button>
      </div>

      {/* Filters */}
      <div style={{ display: 'flex', gap: 12, marginBottom: 22, flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
          <span style={{ fontFamily: mono, fontSize: '.54rem', opacity: .5 }}>EVENT TYPE</span>
          <select value={eventType} onChange={e => { setEventType(e.target.value); setPage(1); }} style={inputStyle}>
            {EVENT_TYPES.map(t => <option key={t} value={t}>{t || 'All events'}</option>)}
          </select>
        </label>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
          <span style={{ fontFamily: mono, fontSize: '.54rem', opacity: .5 }}>FROM</span>
          <input type="date" value={dateFrom} onChange={e => { setDateFrom(e.target.value); setPage(1); }} style={inputStyle} />
        </label>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
          <span style={{ fontFamily: mono, fontSize: '.54rem', opacity: .5 }}>TO</span>
          <input type="date" value={dateTo} onChange={e => { setDateTo(e.target.value); setPage(1); }} style={inputStyle} />
        </label>
        {(eventType || dateFrom || dateTo) && (
          <button onClick={() => { setEventType(''); setDateFrom(''); setDateTo(''); setPage(1); }} style={{
            fontFamily: mono, fontSize: '.6rem', padding: '8px 12px', borderRadius: 9,
            border: '1px solid rgba(13,31,36,.16)', background: 'transparent', cursor: 'pointer', alignSelf: 'flex-end',
          }}>clear ×</button>
        )}
      </div>

      {error && (
        <div style={{ background: 'rgba(194,103,94,.08)', border: '1px solid rgba(194,103,94,.4)', borderRadius: 12, padding: '12px 16px', marginBottom: 20, fontSize: '.82rem', color: c.rose }}>
          ⚠ {error}
        </div>
      )}

      {/* Table */}
      <div style={{ background: '#fff', border: '1px solid rgba(13,31,36,.10)', borderRadius: 14, overflow: 'hidden' }}>
        <div style={{
          display: 'grid', gridTemplateColumns: '28px 180px 1fr 1fr 160px',
          padding: '11px 18px', borderBottom: '1px solid rgba(13,31,36,.10)',
          fontFamily: mono, fontSize: '.54rem', letterSpacing: '.12em', textTransform: 'uppercase', opacity: .4,
        }}>
          <span />
          <span>Event</span><span>Actor</span><span>Subject</span><span>When</span>
        </div>

        {loading && <div style={{ padding: '28px', textAlign: 'center', fontFamily: mono, fontSize: '.62rem', opacity: .4 }}>Loading…</div>}
        {!loading && events.length === 0 && <div style={{ padding: '28px', textAlign: 'center', fontFamily: mono, fontSize: '.62rem', opacity: .4 }}>No events match your filters.</div>}

        {events.map((ev: any, i: number) => (
          <div key={ev.id}>
            <div
              onClick={() => setExpanded(expanded === ev.id ? null : ev.id)}
              style={{
                display: 'grid', gridTemplateColumns: '28px 180px 1fr 1fr 160px',
                padding: '12px 18px', alignItems: 'center',
                borderBottom: '1px solid rgba(13,31,36,.06)',
                cursor: 'pointer',
                background: expanded === ev.id ? 'rgba(55,181,155,.04)' : 'transparent',
              }}
            >
              <span style={{
                width: 8, height: 8, borderRadius: '50%',
                background: EVENT_COLORS[ev.event_type] || '#dfe6e3',
                display: 'inline-block',
              }} />
              <span style={{ fontFamily: mono, fontSize: '.6rem', color: EVENT_COLORS[ev.event_type] || c.ink }}>{ev.event_type}</span>
              <span style={{ fontFamily: mono, fontSize: '.58rem', opacity: .55 }}>{ev.actor_user_id ? ev.actor_user_id.slice(0, 8) + '…' : '—'}</span>
              <span style={{ fontFamily: mono, fontSize: '.58rem', opacity: .55 }}>{ev.subject_member_id ? ev.subject_member_id.slice(0, 8) + '…' : '—'}</span>
              <span style={{ fontFamily: mono, fontSize: '.54rem', opacity: .38 }}>{new Date(ev.occurred_at).toLocaleString()}</span>
            </div>

            {/* Expanded detail */}
            {expanded === ev.id && (
              <div style={{
                padding: '14px 46px 16px',
                background: 'rgba(55,181,155,.04)',
                borderBottom: '1px solid rgba(13,31,36,.08)',
              }}>
                <div style={{ fontFamily: mono, fontSize: '.56rem', opacity: .45, marginBottom: 8 }}>EVENT DETAIL</div>
                <pre style={{
                  fontFamily: mono, fontSize: '.64rem', lineHeight: 1.7,
                  background: '#fff', border: '1px solid rgba(13,31,36,.10)', borderRadius: 9,
                  padding: '12px 14px', overflow: 'auto', maxHeight: 240,
                  margin: 0,
                }}>
                  {JSON.stringify(ev.detail, null, 2)}
                </pre>
                <div style={{ fontFamily: mono, fontSize: '.54rem', opacity: .4, marginTop: 8 }}>
                  id: {ev.id}
                  {ev.conversation_id && ` · conversation: ${ev.conversation_id.slice(0, 8)}…`}
                </div>
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Pagination */}
      {pages > 1 && (
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 18, justifyContent: 'center' }}>
          <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1} style={{
            fontFamily: mono, fontSize: '.62rem', padding: '7px 14px', borderRadius: 8,
            border: '1px solid rgba(13,31,36,.16)', background: 'transparent',
            cursor: page === 1 ? 'default' : 'pointer', opacity: page === 1 ? .4 : 1,
          }}>← prev</button>
          <span style={{ fontFamily: mono, fontSize: '.6rem', opacity: .5 }}>page {page} of {pages}</span>
          <button onClick={() => setPage(p => Math.min(pages, p + 1))} disabled={page === pages} style={{
            fontFamily: mono, fontSize: '.62rem', padding: '7px 14px', borderRadius: 8,
            border: '1px solid rgba(13,31,36,.16)', background: 'transparent',
            cursor: page === pages ? 'default' : 'pointer', opacity: page === pages ? .4 : 1,
          }}>next →</button>
        </div>
      )}
    </div>
  );
}

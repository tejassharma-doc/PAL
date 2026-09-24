'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import PhoneShell from '@/components/layout/PhoneShell';
import AppBar from '@/components/layout/AppBar';
import TabBar from '@/components/layout/TabBar';
import PersonSheet from '@/components/layout/PersonSheet';
import {
  listConversations,
  deleteConversation,
  type ConversationSummary,
} from '@/lib/api';

function groupByDate(convs: ConversationSummary[]): { label: string; items: ConversationSummary[] }[] {
  const now = new Date();
  const todayStart = new Date(now); todayStart.setHours(0, 0, 0, 0);
  const yestStart  = new Date(todayStart); yestStart.setDate(yestStart.getDate() - 1);

  const buckets: Record<string, ConversationSummary[]> = { Today: [], Yesterday: [], Earlier: [] };
  for (const c of convs) {
    const d = new Date(c.updated_at); d.setHours(0, 0, 0, 0);
    if (d >= todayStart)      buckets.Today.push(c);
    else if (d >= yestStart)  buckets.Yesterday.push(c);
    else                      buckets.Earlier.push(c);
  }
  return (['Today', 'Yesterday', 'Earlier'] as const)
    .filter(k => buckets[k].length > 0)
    .map(k => ({ label: k, items: buckets[k] }));
}

function formatTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1)    return 'Just now';
  if (m < 60)   return `${m}m ago`;
  if (m < 1440) return `${Math.floor(m / 60)}h ago`;
  return new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
}

export default function HistoryPage() {
  const router = useRouter();
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [loading, setLoading]   = useState(true);
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
  const [showSheet, setShowSheet] = useState(false);
  const [person, setPerson] = useState({
    initial: '…',
    grad: 'linear-gradient(150deg,#37b59b,#1f7d6b)',
    name: '…',
    sub: 'your record · active',
  });

  useEffect(() => {
    const name = localStorage.getItem('pal_user_name') || localStorage.getItem('pal_full_name') || 'Me';
    setPerson({ initial: name[0]?.toUpperCase() || 'M', grad: 'linear-gradient(150deg,#37b59b,#1f7d6b)', name, sub: 'your record · active' });
  }, []);

  useEffect(() => {
    listConversations().then(setConversations).finally(() => setLoading(false));
  }, []);

  async function handleDelete() {
    if (!deleteTarget) return;
    await deleteConversation(deleteTarget);
    setConversations(prev => prev.filter(c => c.id !== deleteTarget));
    setDeleteTarget(null);
  }

  const groups = groupByDate(conversations);

  return (
    <PhoneShell>
      <AppBar person={person} onAvatarTap={() => setShowSheet(true)} />

      <div className="scr" style={{ flex: 1, overflowY: 'auto', padding: '6px 18px 92px' }}>
        <div style={{ fontFamily: "'Newsreader', serif", fontWeight: 300, fontSize: '1.5rem', margin: '12px 0 3px', color: '#0d1f24' }}>
          Your conversations
        </div>
        <div style={{ fontSize: '0.8rem', opacity: .6, marginBottom: 13, color: '#0d1f24' }}>
          Saved so you can continue. Yours to delete.
        </div>

        <div style={{ background: '#fff', border: '1px solid rgba(13,31,36,.14)', borderRadius: 12, padding: '10px 12px', display: 'flex', alignItems: 'center', gap: 9, marginBottom: 16 }}>
          <span style={{ color: '#1f7d6b', fontSize: '0.9rem', opacity: .7 }}>⌕</span>
          <input
            placeholder="Search conversations…"
            style={{ fontFamily: "'Space Grotesk', sans-serif", fontSize: '0.85rem', border: 'none', outline: 'none', background: 'none', width: '100%', color: '#0d1f24' }}
          />
        </div>

        {loading && (
          <div style={{ fontFamily: "'Space Mono', monospace", fontSize: '0.6rem', opacity: .4, textAlign: 'center', padding: '40px 0' }}>
            Loading…
          </div>
        )}

        {!loading && conversations.length === 0 && (
          <div style={{ textAlign: 'center', padding: '48px 0' }}>
            <div style={{ fontSize: '2rem', marginBottom: 12, opacity: .2 }}>◴</div>
            <div style={{ fontFamily: "'Newsreader', serif", fontSize: '1.1rem', color: '#0d1f24', opacity: .5, marginBottom: 6 }}>
              No conversations yet
            </div>
            <div style={{ fontFamily: "'Space Mono', monospace", fontSize: '0.55rem', color: '#0d1f24', opacity: .35 }}>
              Ask PAL a question to get started
            </div>
          </div>
        )}

        {groups.map(({ label, items }) => (
          <div key={label}>
            <div style={{ fontFamily: "'Space Mono', monospace", fontSize: '0.58rem', textTransform: 'uppercase', opacity: .45, margin: '14px 2px 9px', color: '#0d1f24' }}>
              {label}
            </div>
            {items.map(c => (
              <div
                key={c.id}
                onClick={() => router.push(`/search?conversationId=${c.id}`)}
                style={{ background: '#fff', border: '1px solid rgba(13,31,36,.10)', borderRadius: 13, padding: 13, marginBottom: 9, position: 'relative', overflow: 'hidden', cursor: 'pointer' }}
              >
                <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: 3, background: c.scope_tag === 'personal' ? '#37b59b' : '#dfe6e3' }} />
                <div style={{ paddingLeft: 8, paddingRight: 22 }}>
                  <div style={{ fontFamily: "'Newsreader', serif", fontSize: '0.94rem', lineHeight: 1.35, color: '#0d1f24', marginBottom: c.hindsight_summary ? 5 : 7 }}>
                    {c.title || 'Untitled conversation'}
                  </div>
                  {c.hindsight_summary && (
                    <div style={{ fontSize: '0.75rem', color: 'rgba(13,31,36,.55)', lineHeight: 1.45, marginBottom: 7, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
                      {c.hindsight_summary}
                    </div>
                  )}
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
                    <span style={{
                      fontFamily: "'Space Mono', monospace", fontSize: '0.55rem', padding: '3px 8px', borderRadius: 10,
                      display: 'inline-flex', gap: 5, alignItems: 'center',
                      background: c.scope_tag === 'personal' ? 'rgba(55,181,155,.10)' : 'rgba(13,31,36,.06)',
                      color: c.scope_tag === 'personal' ? '#1f7d6b' : 'rgba(13,31,36,.5)',
                    }}>
                      <span style={{ width: 5, height: 5, borderRadius: '50%', background: c.scope_tag === 'personal' ? '#37b59b' : '#dfe6e3', display: 'inline-block' }} />
                      {c.scope_tag === 'personal' ? 'used your record' : 'general'}
                    </span>
                    <span style={{ fontFamily: "'Space Mono', monospace", fontSize: '0.55rem', opacity: .4, marginLeft: 'auto', color: '#0d1f24' }}>
                      {formatTime(c.updated_at)}
                    </span>
                  </div>
                </div>
                <button
                  onClick={e => { e.stopPropagation(); setDeleteTarget(c.id); }}
                  style={{ position: 'absolute', top: 10, right: 10, background: 'none', border: 'none', fontSize: '0.95rem', opacity: .28, cursor: 'pointer', color: '#0d1f24' }}
                >
                  ⋯
                </button>
              </div>
            ))}
          </div>
        ))}
      </div>

      <TabBar />

      {deleteTarget && (
        <div onClick={() => setDeleteTarget(null)} style={{ position: 'absolute', inset: 0, background: 'rgba(13,31,36,.45)', zIndex: 40, borderRadius: 29 }}>
          <div onClick={e => e.stopPropagation()} style={{ position: 'absolute', left: 0, right: 0, bottom: 0, background: '#fbf9f4', borderRadius: '20px 20px 0 0', padding: '20px 18px 28px' }}>
            <div style={{ width: 36, height: 4, borderRadius: 3, background: 'rgba(13,31,36,.16)', margin: '0 auto 16px' }} />
            <div style={{ fontFamily: "'Newsreader', serif", fontSize: '1.1rem', fontWeight: 400, marginBottom: 12, color: '#0d1f24' }}>
              Delete this conversation?
            </div>
            {['All messages in this thread', 'Embeddings and semantic index', 'Hindsight summary entries'].map((item, i) => (
              <div key={i} style={{ display: 'flex', gap: 9, marginBottom: 8, alignItems: 'center' }}>
                <span style={{ color: '#c2675e', fontSize: '0.8rem' }}>✗</span>
                <span style={{ fontSize: '0.82rem', color: '#0d1f24', opacity: .7 }}>{item}</span>
              </div>
            ))}
            <div style={{ fontSize: '0.74rem', opacity: .55, marginTop: 10, marginBottom: 16, padding: '10px 12px', borderLeft: '2px solid rgba(216,162,74,.5)', background: 'rgba(216,162,74,.06)', borderRadius: '0 9px 9px 0', color: '#8a6020', lineHeight: 1.5 }}>
              Raw uploaded documents are flagged, not deleted (provenance).
            </div>
            <button onClick={handleDelete} style={{ width: '100%', padding: 12, borderRadius: 11, background: '#c2675e', border: 'none', color: '#fff', fontSize: '0.82rem', fontWeight: 700, cursor: 'pointer', marginBottom: 8 }}>
              Delete permanently
            </button>
            <button onClick={() => setDeleteTarget(null)} style={{ width: '100%', padding: 12, borderRadius: 11, background: 'transparent', border: '1px solid rgba(13,31,36,.16)', color: '#0d1f24', fontSize: '0.82rem', fontWeight: 600, cursor: 'pointer' }}>
              Keep it
            </button>
          </div>
        </div>
      )}

      {showSheet && <PersonSheet onClose={() => setShowSheet(false)} />}
    </PhoneShell>
  );
}

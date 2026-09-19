'use client';

import { Suspense, useState, useRef, useEffect, useCallback } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import PhoneShell from '@/components/layout/PhoneShell';
import TabBar from '@/components/layout/TabBar';
import PersonSheet from '@/components/layout/PersonSheet';
import { classifyMultilingual, preloadMultilingualClassifier } from '@/lib/multilingualClassifier';
import { search as apiSearch, secondOpinion as apiSecondOpinion, listConversations, uploadMedicalDocument, confirmMedicalDocument } from '@/lib/api';
import type { ConversationSummary, MedicalDocVerifyResult } from '@/lib/api';
import { VerificationCard } from '@/components/search/VerificationCard';
import type { MLClassificationResult } from '@/lib/multilingualClassifierTypes';
import FamilyHubButton from '@/components/family/FamilyHubButton';

/* ─── Voice capability ────────────────────────────────────────────── */
// Languages with Kokoro TTS voice packs — "Tap to speak" (voice conversation)
// vs "Tap to type by voice" (STT-only, text response)
const KOKORO_TTS_LANGS = new Set(['en', 'hi', 'pa', 'bn']);

// Web Speech Recognition BCP-47 language tags per PAL language code
const SPEECH_LANG: Record<string, string> = {
  en: 'en-IN', hi: 'hi-IN', pa: 'pa-IN', bn: 'bn-IN', ta: 'ta-IN',
  te: 'te-IN', kn: 'kn-IN', ml: 'ml-IN', mr: 'mr-IN', gu: 'gu-IN',
  ur: 'ur-IN', or: 'or-IN', as: 'as-IN', ne: 'ne-NP', si: 'si-LK',
};

/* ─── Safety keywords (deterministic, sync — runs before model) ──── */
const EMERGENCY_KW = [
  'chest pain', 'heart attack', 'stroke', 'severe bleeding',
  "can't breathe", 'breathing difficulty', 'unconscious', 'seizure',
  'choking', 'overdose', 'poisoning', 'severe burn',
];
const CRISIS_KW = [
  'suicide', 'self-harm', 'kill myself', 'end my life',
  'want to die', 'hurt myself',
];

function keywordSafety(q: string): 'emergency' | 'crisis' | 'routine' {
  const l = q.toLowerCase();
  if (EMERGENCY_KW.some(kw => l.includes(kw))) return 'emergency';
  if (CRISIS_KW.some(kw => l.includes(kw))) return 'crisis';
  return 'routine';
}

/* ─── Agents ─────────────────────────────────────────────────────── */
const AGENTS = [
  { key: 'records',     label: 'Records',    desc: 'reading your record',  doneDesc: 'read your record',  src: 'your data',  waitIcon: '⛁' },
  { key: 'medication',  label: 'Medication', desc: 'checking your meds',   doneDesc: 'checked your meds', src: 'formulary',  waitIcon: '℞' },
  { key: 'diet',        label: 'Nutrition',  desc: 'building your plan',   doneDesc: 'plan ready',        src: 'iNutriMon',  waitIcon: '☘' },
  { key: 'evidence',    label: 'Evidence',   desc: 'finding studies',      doneDesc: 'studies found',     src: 'PubMed',     waitIcon: '⚛' },
  { key: 'appointment', label: 'Booking',    desc: 'checking schedule',    doneDesc: 'slots found',       src: 'clinic',     waitIcon: '◷' },
];

type AgentStatus = 'waiting' | 'live' | 'done';
interface AgentState {
  key: string; label: string; desc: string; doneDesc: string;
  src: string; waitIcon: string; status: AgentStatus;
}

/* ─── Quick-ask items ─────────────────────────────────────────────── */
const QUICK_ITEMS = [
  { icon: '⚛', text: 'What is type 2 diabetes?', sub: 'general · no record' },
  { icon: '℞', text: 'Do my meds interact?',       sub: 'about you · consent' },
  { icon: '◷', text: 'Book a follow-up',            sub: 'action · you confirm' },
  { icon: '☘', text: 'A recipe for tonight',        sub: 'nutrition' },
];

/* ─── Time utils ──────────────────────────────────────────────────── */
function getGreeting(): string {
  const h = new Date().getHours();
  if (h < 12) return 'Good morning';
  if (h < 17) return 'Good afternoon';
  return 'Good evening';
}

function formatRelTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

/* ─── Depth rules (mirrors DepthRules.ts / planner.py exactly) ───── */
interface RoutingDecision {
  depth: 'on_device' | 'one' | 'many' | 'launch_hermes';
  agentsToShow: string[];
  loadRecord: boolean;
  safetyShortCircuit?: boolean;
  reason: string;
}

function applyDepthRules(cls: MLClassificationResult | null): RoutingDecision {
  if (!cls) {
    return { depth: 'many', agentsToShow: AGENTS.map(a => a.key), loadRecord: false, reason: 'classifier_unavailable' };
  }
  const safety = cls.safety ?? 'routine';
  if (safety === 'emergency' || safety === 'crisis') {
    return { depth: 'on_device', agentsToShow: [], loadRecord: false, safetyShortCircuit: true, reason: `safety:${safety}` };
  }
  const complexity = cls.complexity ?? 'simple';
  if (complexity === 'trivial') {
    return { depth: 'on_device', agentsToShow: [], loadRecord: false, reason: 'trivial' };
  }
  if (complexity === 'call' || cls.agent === 'appointment') {
    return { depth: 'launch_hermes', agentsToShow: ['appointment'], loadRecord: cls.scope === 'personal', reason: 'call' };
  }
  const load = cls.scope === 'personal';
  if (complexity === 'complex' || safety === 'urgent' || cls.confidence < 0.75) {
    const agents: string[] = [];
    if (load) agents.push('records');
    if (!agents.includes(cls.agent)) agents.push(cls.agent);
    if ((cls.agent === 'medication' || cls.agent === 'diet') && !agents.includes('evidence')) agents.push('evidence');
    if (!agents.includes('evidence')) agents.push('evidence');
    return { depth: 'many', agentsToShow: agents, loadRecord: load, reason: `complex:${cls.agent}` };
  }
  const agents: string[] = [];
  if (load) agents.push('records');
  agents.push(cls.agent);
  if (cls.agent === 'medication' && !agents.includes('evidence')) agents.push('evidence');
  return { depth: agents.length > 1 ? 'many' : 'one', agentsToShow: agents, loadRecord: load, reason: `simple:${cls.agent}@${cls.confidence.toFixed(2)}` };
}

/* ─── Trivial on-device responses ─────────────────────────────────── */
function getTrivialResponse(q: string): string {
  const l = q.toLowerCase();
  if (/^(hi|hello|hey|namaste|vanakkam|namaskar)\b/.test(l))
    return "Hi! I'm PAL, your personal health assistant. What health question can I help you with today?";
  if (/thank|thanks|shukriya|dhanyavad|nandri/.test(l))
    return "You're welcome! I'm here whenever you have a health question.";
  if (/\bbye\b|goodbye|see you|alvida/.test(l))
    return "Take care and stay healthy! Come back anytime.";
  if (/what can you|what do you do|how do you work|your capabilit/.test(l))
    return "I can answer health questions, explain your lab results, discuss medications, suggest dietary guidance, and help you book appointments — across 12+ languages.";
  return "I'm here to help with your health questions. What would you like to know?";
}

/* ─── Answer data ─────────────────────────────────────────────────── */
interface AnswerData {
  text: string;
  agentKeys: string[];
  citations: Array<{ title: string; source: string; url?: string }>;
  provenanceSummary: string;
  pendingActions: Array<{
    type: string;
    description: string;
    confirm_token_required: boolean;
    confirm_token?: string;
    action_payload?: Record<string, unknown>;
  }>;
  conversationId: string | null;
  threadSummaryForRouter: string | null;
  scope: 'personal' | 'generic' | 'ambiguous';
  isMock: boolean;
}

const MOCK_ANSWER: AnswerData = {
  text: "Your LDL has improved — down from 158 to 131 mg/dL over 3 months. The 2023 ACC/AHA guidelines target <100 for your risk profile, so you're trending well but not at goal yet.\n\nAtorvastatin 10mg (your current dose) can typically achieve a 30–40% reduction. Discuss with Dr Sharma whether a dose increase makes sense.",
  agentKeys: ['records', 'evidence', 'medication'],
  citations: [
    { title: 'Grundy SM et al. 2018 AHA/ACC Cholesterol Guidelines. JACC. 2019.', source: 'PubMed' },
    { title: 'Your lipid panel — 12 Mar 2025 (from records)', source: 'records' },
  ],
  provenanceSummary:
    'Records agent retrieved your last 3 lipid panels via PHI egress (session consent).\nEvidence agent searched PubMed for "LDL statin reduction RCT 2023" (5 results).\nMedication agent cross-referenced your current Atorvastatin 10mg.',
  pendingActions: [{
    type: 'appointment',
    description: 'Book a lipid review with Dr Sharma',
    confirm_token_required: true,
    action_payload: { clinic: 'Apollo Clinic', department: 'OPD', duration: '15 min' },
  }],
  conversationId: null,
  threadSummaryForRouter: null,
  scope: 'personal',
  isMock: true,
};

/* ─── Provenance chips (.pchip style from HTML) ───────────────────── */
const PCHIP: Record<string, { dot: string; color: string; border: string; label: string }> = {
  records:     { dot: 'var(--jade)',  color: 'var(--jade-deep)',  border: 'rgba(31,125,107,.4)',  label: 'from your record' },
  evidence:    { dot: 'var(--amber)', color: 'var(--amber-deep)', border: 'rgba(216,162,74,.5)',  label: 'studies cited' },
  medication:  { dot: 'var(--ink)',   color: 'rgba(13,31,36,.6)', border: 'rgba(13,31,36,.2)',    label: 'estimate' },
  diet:        { dot: 'var(--jade)',  color: 'var(--jade-deep)',  border: 'rgba(31,125,107,.4)',  label: 'nutrition plan' },
  appointment: { dot: 'var(--amber)', color: 'var(--amber-deep)', border: 'rgba(216,162,74,.5)', label: 'booking' },
};

function PChip({ agentKey }: { agentKey: string }) {
  const c = PCHIP[agentKey] ?? PCHIP.evidence;
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 4,
      fontFamily: 'var(--mono)', fontSize: '0.6rem', borderRadius: 18,
      border: `1px solid ${c.border}`, color: c.color,
      padding: '2px 8px', whiteSpace: 'nowrap',
    }}>
      <span style={{ width: 5, height: 5, borderRadius: '50%', background: c.dot, flexShrink: 0 }} />
      {c.label}
    </span>
  );
}

/* ─── ThinkingView — matches HTML Screen 02 .thinking card ───────── */
function ThinkingView({ query, agents }: { query: string; agents: AgentState[] }) {
  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', padding: '12px 16px', gap: 10, overflowY: 'auto' }}>
      {/* Query recall bubble (.qrecall) */}
      <div style={{
        background: 'var(--deep)', color: 'var(--paper)',
        borderRadius: '14px 14px 14px 4px', padding: '12px 15px',
        fontFamily: 'var(--serif)', fontSize: 14, lineHeight: 1.5,
        maxWidth: '88%',
      }}>
        {query}
      </div>

      {/* Thinking card (.thinking) */}
      <div style={{ border: '1px solid var(--line)', borderRadius: 14, background: '#fff', padding: 14 }}>
        {/* Header (.th) */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 12 }}>
          <span style={{ fontFamily: 'var(--mono)', fontSize: '0.6rem', color: 'var(--jade-deep)' }}>
            working · {agents.length} specialists
          </span>
          <span style={{
            width: 8, height: 8, borderRadius: '50%', background: 'var(--jade)',
            animation: 'pulse-dot 1.1s infinite', flexShrink: 0, display: 'inline-block',
          }} />
        </div>

        {/* Agent rows (.arow) */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
          {agents.map(a => {
            const isDone = a.status === 'done';
            const isLive = a.status === 'live';
            return (
              <div key={a.key} style={{
                display: 'flex', alignItems: 'center', gap: 9,
                opacity: a.status === 'waiting' ? 0.35 : 1,
                transition: 'opacity 0.4s ease',
              }}>
                {/* Status icon box (.ad) */}
                <div style={{
                  width: 22, height: 22, borderRadius: 6, flexShrink: 0,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontFamily: 'var(--mono)', fontSize: '0.7rem', fontWeight: 700,
                  background: isDone
                    ? 'rgba(55,181,155,.16)'
                    : isLive ? 'var(--jade)' : 'var(--mist)',
                  color: isDone ? 'var(--jade-deep)' : isLive ? '#fff' : 'var(--ink)',
                }}>
                  {isDone ? '✓' : isLive ? '⋯' : a.waitIcon}
                </div>

                {/* Label — description */}
                <div style={{ flex: 1, minWidth: 0, fontSize: '0.8rem', lineHeight: 1.3 }}>
                  <span style={{ color: 'var(--ink)', fontWeight: 500 }}>{a.label}</span>
                  <span style={{ color: 'rgba(13,31,36,0.45)' }}>
                    {' — '}{isDone ? a.doneDesc : a.desc}
                  </span>
                </div>

                {/* Source */}
                <span style={{
                  fontFamily: 'var(--mono)', fontSize: '0.58rem',
                  color: 'rgba(13,31,36,0.4)', whiteSpace: 'nowrap', flexShrink: 0,
                }}>
                  {a.src}
                </span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

/* ─── OnDeviceView — trivial on-device answers ────────────────────── */
function OnDeviceView({ query, response, onBack }: { query: string; response: string; onBack: () => void }) {
  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', padding: '16px', gap: 12, overflowY: 'auto', animation: 'fadeIn 0.25s ease' }}>
      <button onClick={onBack} style={{ background: 'none', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6, padding: 0 }}>
        <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
          <path d="M11 4l-5 5 5 5" stroke="var(--ink)" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" strokeOpacity="0.5"/>
        </svg>
        <span style={{ fontSize: 12, color: 'rgba(13,31,36,0.5)', fontWeight: 500 }}>New search</span>
      </button>
      <div style={{
        background: 'var(--deep)', color: 'var(--paper)',
        borderRadius: '14px 14px 14px 4px', padding: '12px 15px',
        fontFamily: 'var(--serif)', fontSize: 14, lineHeight: 1.5, maxWidth: '88%',
      }}>
        {query}
      </div>
      <div style={{ background: '#fff', borderRadius: 14, padding: '16px', border: '1px solid var(--line)' }}>
        <p style={{ fontFamily: 'var(--serif)', fontSize: 15, color: 'var(--ink)', lineHeight: 1.7 }}>{response}</p>
      </div>
    </div>
  );
}

/* ─── SafetyView — emergency / crisis short-circuit ──────────────── */
function SafetyView({ query, kind, onBack }: { query: string; kind: 'emergency' | 'crisis'; onBack: () => void }) {
  const isEmergency = kind === 'emergency';
  const accent = isEmergency ? 'var(--rose)' : 'var(--amber)';
  const bg     = isEmergency ? 'rgba(194,103,94,.05)' : 'rgba(216,162,74,.07)';
  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', padding: '16px', gap: 12, overflowY: 'auto', animation: 'fadeIn 0.25s ease' }}>
      <button onClick={onBack} style={{ background: 'none', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6, padding: 0 }}>
        <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
          <path d="M11 4l-5 5 5 5" stroke="var(--ink)" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" strokeOpacity="0.5"/>
        </svg>
        <span style={{ fontSize: 12, color: 'rgba(13,31,36,0.5)', fontWeight: 500 }}>New search</span>
      </button>
      <div style={{
        background: 'var(--deep)', color: 'var(--paper)',
        borderRadius: '14px 14px 14px 4px', padding: '12px 15px',
        fontFamily: 'var(--serif)', fontSize: 14, lineHeight: 1.5, maxWidth: '88%',
      }}>
        {query}
      </div>
      <div style={{ border: `1px solid ${accent}`, borderRadius: 13, padding: '16px', background: bg }}>
        <p style={{ fontFamily: 'var(--mono)', fontSize: '0.68rem', fontWeight: 700, color: accent, marginBottom: 10, letterSpacing: '0.04em' }}>
          {isEmergency ? '— Emergency' : '— You\'re not alone'}
        </p>
        <p style={{ fontFamily: 'var(--serif)', fontSize: 14, color: 'var(--ink)', lineHeight: 1.7, marginBottom: 14 }}>
          {isEmergency
            ? 'Please call emergency services immediately. PAL cannot assist with emergencies — please seek help right away.'
            : 'If you\'re having thoughts of hurting yourself, please reach out to a counsellor. You deserve support.'}
        </p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <a href={isEmergency ? 'tel:112' : 'tel:+919152987821'} style={{
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
            background: accent, borderRadius: 10, padding: '11px',
            color: '#fff', fontSize: 13, fontWeight: 700, textDecoration: 'none',
          }}>
            {isEmergency ? 'Call 112 — Emergency' : 'iCall — 9152987821'}
          </a>
          {!isEmergency && (
            <a href="tel:18602662345" style={{
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              borderRadius: 10, padding: '10px', border: `1px solid ${accent}`,
              color: accent, fontSize: 13, fontWeight: 600, textDecoration: 'none',
            }}>
              Vandrevala Foundation — 1860 266 2345
            </a>
          )}
        </div>
      </div>
    </div>
  );
}

/* ─── AnswerView — matches HTML Screen 02 answer design ──────────── */
function AnswerView({
  query, data, onBack, onSecondOpinion,
}: { query: string; data: AnswerData; onBack: () => void; onSecondOpinion: () => void }) {
  const [showConsent,     setShowConsent]     = useState(data.scope === 'personal');
  const [showProvenance,  setShowProvenance]  = useState(false);
  const [dismissedAction, setDismissedAction] = useState(false);

  const pendingAction = data.pendingActions?.[0];
  const paragraphs = data.text.split('\n\n');

  return (
    <div style={{ flex: 1, overflowY: 'auto', padding: '12px 16px 144px', animation: 'fadeIn 0.2s ease' }}>
      {/* Back */}
      <button onClick={onBack} style={{ background: 'none', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6, marginBottom: 12, padding: 0 }}>
        <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
          <path d="M11 4l-5 5 5 5" stroke="var(--ink)" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" strokeOpacity="0.5"/>
        </svg>
        <span style={{ fontSize: 12, color: 'rgba(13,31,36,0.5)', fontWeight: 500 }}>New search</span>
      </button>

      {/* Query recall bubble (.qrecall) */}
      <div style={{
        background: 'var(--deep)', color: 'var(--paper)',
        borderRadius: '14px 14px 14px 4px', padding: '12px 15px',
        fontFamily: 'var(--serif)', fontSize: 14, lineHeight: 1.5,
        maxWidth: '88%', marginBottom: 12,
      }}>
        {query}
      </div>

      {/* Consent gate (.consent) */}
      {showConsent && (
        <div style={{
          border: '1px solid rgba(194,103,94,.4)', borderRadius: 13, padding: '14px',
          marginBottom: 12, background: 'rgba(194,103,94,.06)', animation: 'fadeIn 0.3s ease',
        }}>
          <p style={{ fontFamily: 'var(--mono)', fontSize: '0.68rem', fontWeight: 700, color: 'var(--rose)', marginBottom: 6, letterSpacing: '0.04em' }}>
            Use your health record?
          </p>
          <p style={{ fontFamily: 'var(--serif)', fontSize: 13, color: 'rgba(13,31,36,0.6)', lineHeight: 1.55, marginBottom: 12 }}>
            PAL can personalise this answer using your vitals and labs — for this session only.
          </p>
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={() => setShowConsent(false)} style={{
              flex: 1, padding: '9px 0', borderRadius: 10,
              background: 'var(--jade)', border: 'none', cursor: 'pointer',
              color: 'var(--deep-2)', fontSize: 12, fontWeight: 700,
            }}>
              Use my record
            </button>
            <button onClick={() => setShowConsent(false)} style={{
              flex: 1, padding: '9px 0', borderRadius: 10,
              background: 'transparent', border: '1px solid var(--line-2)', cursor: 'pointer',
              color: 'rgba(13,31,36,0.6)', fontSize: 12, fontWeight: 600,
            }}>
              Keep it general
            </button>
          </div>
          <p style={{ fontFamily: 'var(--mono)', fontSize: '0.58rem', color: 'rgba(13,31,36,0.35)', marginTop: 10, textAlign: 'center' }}>
            PAL never books or messages without this step.
          </p>
        </div>
      )}

      {/* Answer card */}
      <div style={{ background: '#fff', borderRadius: 14, padding: '16px', border: '1px solid var(--line)', marginBottom: 10 }}>
        {/* Provenance chips (.pchip) */}
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 12 }}>
          {data.agentKeys.map(k => <PChip key={k} agentKey={k} />)}
        </div>

        {/* Answer text */}
        <div style={{ fontFamily: 'var(--serif)', fontSize: 15, color: 'var(--ink)', lineHeight: 1.7 }}>
          {paragraphs.map((para, i) => (
            <p key={i} style={i < paragraphs.length - 1 ? { marginBottom: 12 } : undefined}>{para}</p>
          ))}
        </div>

        {/* Provenance toggle (.followups dashed top) */}
        <div style={{ borderTop: '1px dashed var(--line)', marginTop: 14, paddingTop: 12 }}>
          <button onClick={() => setShowProvenance(p => !p)} style={{
            background: 'none', border: 'none', cursor: 'pointer', padding: 0,
            display: 'flex', alignItems: 'center', gap: 4, width: '100%',
          }}>
            <span style={{ fontFamily: 'var(--mono)', fontSize: '0.66rem', color: 'var(--jade-deep)', fontWeight: 700, flex: 1, textAlign: 'left' }}>
              Why do you think that?
            </span>
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none" style={{ transform: showProvenance ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s', flexShrink: 0 }}>
              <path d="M3 4.5l3 3 3-3" stroke="var(--jade-deep)" strokeWidth="1.5" strokeLinecap="round"/>
            </svg>
          </button>
          {showProvenance && (
            <p style={{ fontFamily: 'var(--mono)', fontSize: '0.64rem', color: 'rgba(13,31,36,0.55)', lineHeight: 1.6, whiteSpace: 'pre-line', marginTop: 10, animation: 'fadeIn 0.2s ease' }}>
              {data.provenanceSummary}
            </p>
          )}
        </div>
      </div>

      {/* Citations */}
      {data.citations.length > 0 && (
        <div style={{ marginBottom: 10 }}>
          <p style={{ fontFamily: 'var(--mono)', fontSize: '0.58rem', color: 'rgba(13,31,36,0.4)', letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 6 }}>
            Sources
          </p>
          {data.citations.map((c, i) => (
            <p key={i} style={{ fontFamily: 'var(--mono)', fontSize: '0.64rem', color: 'rgba(13,31,36,0.55)', lineHeight: 1.5, marginBottom: 4 }}>
              [{i + 1}] {c.title}
            </p>
          ))}
        </div>
      )}

      {/* Second opinion */}
      <button onClick={onSecondOpinion} style={{
        width: '100%', padding: '10px', borderRadius: 12,
        border: '1px solid var(--line-2)', background: 'transparent',
        cursor: 'pointer', fontSize: 12, color: 'rgba(13,31,36,0.5)',
        fontFamily: 'var(--mono)', fontWeight: 400, marginBottom: 8,
      }}>
        This doesn&apos;t seem right — get a second opinion
      </button>

      {/* Booking action card (.actcard) */}
      {pendingAction && !dismissedAction && (
        <div style={{
          background: 'linear-gradient(160deg, var(--deep), var(--deep-2))',
          borderRadius: 14, padding: '16px', marginBottom: 8,
        }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 6 }}>
            <p style={{ fontFamily: 'var(--mono)', fontSize: '0.58rem', fontWeight: 700, color: 'rgba(255,255,255,0.45)', letterSpacing: '0.1em', textTransform: 'uppercase' }}>
              Suggested action
            </p>
            <button onClick={() => setDismissedAction(true)} style={{
              background: 'none', border: 'none', cursor: 'pointer', padding: 0,
              fontFamily: 'var(--mono)', fontSize: '0.58rem', color: 'rgba(255,255,255,0.35)',
              lineHeight: 1,
            }}>
              ✕
            </button>
          </div>
          <p style={{ fontFamily: 'var(--serif)', fontSize: 14, color: '#fff', marginBottom: 4, lineHeight: 1.4 }}>
            {pendingAction.description}
          </p>
          {pendingAction.action_payload && (
            <p style={{ fontFamily: 'var(--mono)', fontSize: '0.64rem', color: 'rgba(255,255,255,0.45)', marginBottom: 14 }}>
              {[
                pendingAction.action_payload.clinic,
                pendingAction.action_payload.department,
                pendingAction.action_payload.duration ? `~${pendingAction.action_payload.duration}` : null,
              ].filter(Boolean).join(' · ')}
            </p>
          )}
          <button style={{
            width: '100%', padding: '10px', borderRadius: 10,
            background: 'var(--jade)', border: 'none', cursor: 'pointer',
            color: 'var(--deep-2)', fontSize: 13, fontWeight: 700,
          }}>
            Review &amp; confirm booking
          </button>
          <button onClick={() => setDismissedAction(true)} style={{
            width: '100%', marginTop: 10, background: 'none', border: 'none', cursor: 'pointer',
            fontFamily: 'var(--mono)', fontSize: '0.6rem', color: 'rgba(255,255,255,0.3)',
            padding: '4px 0',
          }}>
            Not now
          </button>
        </div>
      )}
    </div>
  );
}

/* ─── UploadingView — spinner while MDT processes the document ────── */
function UploadingView() {
  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 16, padding: '24px 16px' }}>
      <div style={{
        width: 48, height: 48, borderRadius: 14,
        background: 'var(--jade)', display: 'flex', alignItems: 'center', justifyContent: 'center',
        animation: 'pulse-dot 1.1s infinite',
      }}>
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
          <polyline points="17 8 12 3 7 8"/>
          <line x1="12" y1="3" x2="12" y2="15"/>
        </svg>
      </div>
      <div style={{ textAlign: 'center' }}>
        <p style={{ fontFamily: 'var(--serif)', fontSize: 15, color: 'var(--ink)', fontWeight: 500, marginBottom: 4 }}>
          Extracting health data
        </p>
        <p style={{ fontFamily: 'var(--mono)', fontSize: '0.68rem', color: 'rgba(13,31,36,0.5)', lineHeight: 1.5 }}>
          Medical Data Toolkit is reading your document…
        </p>
      </div>
    </div>
  );
}

/* ─── SearchContent — Fugu Router wired in ────────────────────────── */
function SearchContent() {
  const params       = useSearchParams();
  const router       = useRouter();
  const initialQuery = params.get('q') ?? '';

  type Phase = 'idle' | 'thinking' | 'answer' | 'on_device' | 'safety' | 'uploading' | 'verifying';

  const [query,        setQuery]        = useState('');
  const [phase,        setPhase]        = useState<Phase>('idle');
  const [agents,       setAgents]       = useState<AgentState[]>(
    AGENTS.map((a, i) => ({ ...a, status: (i === 0 ? 'live' : 'waiting') as AgentStatus }))
  );
  const [answer,       setAnswer]       = useState<AnswerData | null>(null);
  const [safetyKind,   setSafetyKind]   = useState<'emergency' | 'crisis'>('emergency');
  const [onDeviceText, setOnDeviceText] = useState('');
  const [userName,     setUserName]     = useState('');
  const [recentConvs,  setRecentConvs]  = useState<ConversationSummary[]>([]);
  const [followUpText, setFollowUpText] = useState('');
  const [showSheet,    setShowSheet]    = useState(false);

  // Voice state
  const [isRecording,  setIsRecording]  = useState(false);
  const [sttInterim,   setSttInterim]   = useState('');
  const [isSpeaking,   setIsSpeaking]   = useState(false);
  const [userLang,     setUserLang]     = useState('en');
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const recognizerRef                   = useRef<any>(null);

  const langHasTTS = KOKORO_TTS_LANGS.has(userLang);

  // Async coordination refs
  const sessionIdRef      = useRef('');
  const conversationIdRef = useRef<string | null>(null);
  const threadSummaryRef  = useRef('');
  const simulateRef       = useRef(false);
  const animDoneRef       = useRef(false);
  const apiDoneRef        = useRef(false);
  const pendingAnswerRef  = useRef<AnswerData | null>(null);
  const isSecondOpRef     = useRef(false);

  const [verifyData, setVerifyData] = useState<MedicalDocVerifyResult | null>(null);
  const [savingDoc,  setSavingDoc]  = useState(false);
  const fileInputRef                = useRef<HTMLInputElement>(null);

  const setAnswerRef = useRef(setAnswer);
  const setPhaseRef  = useRef(setPhase);
  setAnswerRef.current = setAnswer;
  setPhaseRef.current  = setPhase;

  useEffect(() => {
    sessionIdRef.current = crypto.randomUUID();
    preloadMultilingualClassifier();
    if (typeof window !== 'undefined') {
      setUserName(localStorage.getItem('pal_user_name') || '');
      setUserLang(localStorage.getItem('pal_preferred_lang') || 'en');
    }
    listConversations()
      .then(c => setRecentConvs(c.slice(0, 2)))
      .catch(() => {});
    if (initialQuery) {
      setQuery(initialQuery);
      runSearch(initialQuery, false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function checkBothDone() {
    if (animDoneRef.current && apiDoneRef.current && pendingAnswerRef.current) {
      setAnswerRef.current(pendingAnswerRef.current);
      setPhaseRef.current('answer');
    }
  }

  if (phase === 'thinking' && !simulateRef.current) {
    simulateRef.current = true;
    const agentCount = agents.length;
    let idx = 0;
    const tick = () => {
      idx++;
      setAgents(prev => prev.map((a, i) => ({
        ...a,
        status: i < idx ? 'done' : i === idx ? 'live' : 'waiting',
      })));
      if (idx < agentCount) {
        setTimeout(tick, 700);
      } else {
        setTimeout(() => { animDoneRef.current = true; checkBothDone(); }, 600);
      }
    };
    setTimeout(tick, 700);
  }

  function resetThinkingRefs() {
    simulateRef.current     = false;
    animDoneRef.current     = false;
    apiDoneRef.current      = false;
    pendingAnswerRef.current = null;
  }

  function refreshHistory() {
    listConversations().then(c => setRecentConvs(c.slice(0, 2))).catch(() => {});
  }

  function handleNew() {
    setQuery('');
    setPhase('idle');
    setAnswer(null);
    isSecondOpRef.current = false;
    resetThinkingRefs();
    setAgents(AGENTS.map((a, i) => ({ ...a, status: (i === 0 ? 'live' : 'waiting') as AgentStatus })));
    refreshHistory();
  }

  async function runSearch(q: string, isSecondOp: boolean) {
    const safetyResult = keywordSafety(q);
    if (safetyResult !== 'routine') {
      setSafetyKind(safetyResult);
      setQuery(q);
      setPhase('safety');
      return;
    }

    const contextQuery = threadSummaryRef.current
      ? `[Context: ${threadSummaryRef.current}] ${q}`
      : q;
    const cls = await classifyMultilingual(contextQuery);
    const routing = applyDepthRules(cls);

    if (routing.depth === 'on_device' && !routing.safetyShortCircuit) {
      setOnDeviceText(getTrivialResponse(q));
      setPhase('on_device');
      return;
    }

    const agentKeys = isSecondOp
      ? AGENTS.map(a => a.key)
      : (routing.agentsToShow.length > 0 ? routing.agentsToShow : AGENTS.map(a => a.key));

    const filteredAgents = AGENTS
      .filter(a => agentKeys.includes(a.key))
      .map((a, i) => ({ ...a, status: (i === 0 ? 'live' : 'waiting') as AgentStatus }));

    resetThinkingRefs();
    setAgents(filteredAgents);
    setPhase('thinking');

    const classJson = cls && !isSecondOp ? JSON.stringify({
      intents:           [{ agent: cls.agent, confidence: cls.confidence }],
      scope:             cls.scope,
      scope_confidence:  cls.confidence,
      complexity:        cls.complexity ?? 'simple',
      needs_action:      cls.agent === 'appointment',
      safety_category:   cls.safety ?? 'routine',
      multilingual_lang: null,
    }) : undefined;

    try {
      const memberId = typeof window !== 'undefined'
        ? (localStorage.getItem('pal_user_id') || undefined)
        : undefined;

      const result = isSecondOp
        ? await apiSecondOpinion(q, sessionIdRef.current, conversationIdRef.current, { memberId })
        : await apiSearch(q, sessionIdRef.current, {
            memberId,
            conversationId: conversationIdRef.current || undefined,
            onDeviceClassificationJson: classJson,
          });

      if (result.conversation_id)           conversationIdRef.current = result.conversation_id;
      if (result.thread_summary_for_router)  threadSummaryRef.current  = result.thread_summary_for_router;

      pendingAnswerRef.current = {
        text:                   result.answer_text,
        agentKeys,
        citations:              result.citations || [],
        provenanceSummary:      result.provenance_summary || '',
        pendingActions:         result.pending_actions || [],
        conversationId:         result.conversation_id || null,
        threadSummaryForRouter: result.thread_summary_for_router || null,
        scope:                  cls?.scope === 'personal' ? 'personal' : 'generic',
        isMock:                 false,
      };
    } catch {
      pendingAnswerRef.current = {
        ...MOCK_ANSWER,
        agentKeys,
        scope: cls?.scope === 'personal' ? 'personal' : 'generic',
      };
    }

    apiDoneRef.current = true;
    checkBothDone();
  }

  function handleSearch(q: string) {
    const trimmed = q.trim();
    if (!trimmed) return;
    setQuery(trimmed);
    isSecondOpRef.current = false;
    runSearch(trimmed, false);
  }

  function handleSecondOpinion() {
    isSecondOpRef.current = true;
    runSearch(query, true);
  }

  async function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (fileInputRef.current) fileInputRef.current.value = '';
    if (!file) return;
    setPhase('uploading');
    try {
      const result = await uploadMedicalDocument(file);
      if (result.type === 'pending_verification') {
        setVerifyData(result);
        setPhase('verifying');
      } else {
        // document_accepted (MDT disabled) or unsupported_format — silent back to idle
        setPhase('idle');
      }
    } catch {
      setPhase('idle');
    }
  }

  async function handleDocSave() {
    if (!verifyData?.raw_source_id) return;
    setSavingDoc(true);
    try {
      await confirmMedicalDocument({
        rawSourceId: verifyData.raw_source_id,
        observations: verifyData.observations ?? [],
        reportDate: verifyData.report_date ?? null,
      });
      setVerifyData(null);
      setPhase('idle');
    } catch {
      // Leave card visible so user can retry
    } finally {
      setSavingDoc(false);
    }
  }

  // ── Text-to-speech ────────────────────────────────────────────────
  const speakText = useCallback((text: string) => {
    if (!KOKORO_TTS_LANGS.has(userLang)) return;
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) return;
    window.speechSynthesis.cancel();
    const clean = text
      .replace(/\n+/g, '. ')
      .replace(/[#*`[\]]/g, '')
      .replace(/\(https?:[^)]+\)/g, '')
      .slice(0, 400);
    const utt  = new SpeechSynthesisUtterance(clean);
    utt.lang   = SPEECH_LANG[userLang] ?? 'en-IN';
    utt.rate   = 0.92;
    utt.onstart = () => setIsSpeaking(true);
    utt.onend   = () => setIsSpeaking(false);
    utt.onerror = () => setIsSpeaking(false);
    window.speechSynthesis.speak(utt);
  }, [userLang]);

  // Speak answer/on-device response when it arrives
  useEffect(() => {
    if (phase === 'answer'    && answer)        speakText(answer.text);
    if (phase === 'on_device' && onDeviceText)  speakText(onDeviceText);
    return () => { if (typeof window !== 'undefined') window.speechSynthesis?.cancel(); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, answer, onDeviceText]);

  // ── Speech-to-text ────────────────────────────────────────────────
  function startVoiceInput(onFinal?: (text: string) => void) {
    if (typeof window === 'undefined') return;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const SR = (window as any).SpeechRecognition ?? (window as any).webkitSpeechRecognition;
    if (!SR) return;

    if (isRecording) {
      recognizerRef.current?.abort();
      setIsRecording(false);
      setSttInterim('');
      return;
    }

    const rec = new SR();
    recognizerRef.current = rec;
    rec.lang            = SPEECH_LANG[userLang] ?? 'en-IN';
    rec.continuous      = false;
    rec.interimResults  = true;
    rec.maxAlternatives = 1;

    rec.onstart  = () => setIsRecording(true);
    rec.onend    = () => { setIsRecording(false); setSttInterim(''); };
    rec.onerror  = () => { setIsRecording(false); setSttInterim(''); };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    rec.onresult = (e: any) => {
      let interim = '', final = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const t = e.results[i][0].transcript;
        if (e.results[i].isFinal) final += t; else interim += t;
      }
      setSttInterim(interim || final);
      if (final.trim()) {
        const text = final.trim();
        setSttInterim('');
        rec.stop();
        if (onFinal) {
          onFinal(text);
        } else {
          setQuery(text);
          setTimeout(() => handleSearch(text), 150);
        }
      }
    };

    try { rec.start(); } catch { setIsRecording(false); }
  }

  const greeting = getGreeting();

  return (
    <PhoneShell>
      {/* Hidden file input for MDT document upload */}
      <input
        ref={fileInputRef}
        type="file"
        accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png"
        style={{ display: 'none' }}
        onChange={handleFileSelect}
      />
      <div style={{ height: 28 }} />

      {/* ── IDLE — matches HTML Screen 01 ──────────────────────────── */}
      {phase === 'idle' && (
        <>
          {/* AppBar */}
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            padding: '10px 18px 6px', flexShrink: 0,
          }}>
            {/* Left: avatar + name + add "+" */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <button onClick={() => setShowSheet(true)} style={{
                display: 'flex', alignItems: 'center', gap: 9,
                background: 'none', border: 'none', cursor: 'pointer', padding: 0,
              }}>
                <div style={{
                  width: 34, height: 34, borderRadius: 11,
                  background: 'linear-gradient(150deg, var(--jade), var(--jade-deep))',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  color: '#fff', fontFamily: 'var(--serif)', fontWeight: 600, fontSize: 15,
                }}>
                  {userName ? userName[0].toUpperCase() : 'A'}
                </div>
                <div style={{ textAlign: 'left' }}>
                  <div style={{ fontWeight: 700, fontSize: '0.92rem', color: 'var(--ink)', lineHeight: 1.2 }}>
                    {userName || 'Anil'}
                  </div>
                  <div style={{ fontFamily: 'var(--mono)', fontSize: '0.6rem', color: 'var(--ink)', opacity: 0.5 }}>
                    your record · active
                  </div>
                </div>
              </button>
              {/* + Add family member shortcut */}
              <button
                onClick={() => router.push('/family')}
                style={{
                  background: 'none', border: 'none', cursor: 'pointer',
                  padding: '2px 3px', lineHeight: 1, color: 'var(--jade-deep)',
                  opacity: 0.6, fontSize: '1.15rem', fontWeight: 300, marginLeft: 2,
                }}
              >
                +
              </button>
            </div>

            {/* Right: family hub + settings gear + bell */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
              <FamilyHubButton />
              <button
                onClick={() => router.push('/history/settings')}
                style={{
                  width: 32, height: 32, borderRadius: 10,
                  border: '1px solid rgba(13,31,36,.10)', background: '#fff',
                  cursor: 'pointer', display: 'grid', placeItems: 'center',
                  fontSize: '0.85rem', color: 'rgba(13,31,36,0.45)',
                }}
              >
                ⚙
              </button>
              <button style={{
                width: 34, height: 34, borderRadius: 11,
                border: '1px solid rgba(13,31,36,.10)', background: '#fff',
                cursor: 'pointer', display: 'grid', placeItems: 'center',
                position: 'relative', flexShrink: 0,
              }}>
                <svg width="18" height="18" viewBox="0 0 20 20" fill="none">
                  <path d="M8.5 17.5h3M10 3C7 3 4.5 5.5 4.5 8.5V13l-1.5 2.5h14L15.5 13V8.5C15.5 5.5 13 3 10 3z"
                    stroke="#0d1f24" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
                <span style={{
                  position: 'absolute', top: -4, right: -4,
                  width: 16, height: 16, borderRadius: '50%',
                  background: '#c2675e', color: '#fff',
                  fontFamily: "'Space Mono', monospace",
                  fontSize: '0.54rem', fontWeight: 700,
                  display: 'grid', placeItems: 'center',
                }}>
                  3
                </span>
              </button>
            </div>
          </div>

          {/* Scrollable content */}
          <div style={{ flex: 1, overflowY: 'auto', padding: '6px 18px 84px', display: 'flex', flexDirection: 'column', gap: 14 }}>

            {/* .hello greeting */}
            <p style={{ fontFamily: 'var(--serif)', fontWeight: 300, fontSize: '1.7rem', color: 'var(--ink)', lineHeight: 1.35 }}>
              {greeting}{userName ? `, ${userName}` : ''}.
              <br />
              What&apos;s on your{' '}
              <em style={{ fontStyle: 'italic', color: 'var(--jade-deep)' }}>mind?</em>
            </p>
            {/* .hello-sub */}
            <p style={{ fontSize: '0.86rem', opacity: 0.6, marginTop: -6 }}>
              Ask anything — general, or about you.
            </p>

            {/* .searchbox */}
            <div style={{
              background: '#fff', border: '1px solid var(--line-2)', borderRadius: 16,
              padding: '15px 16px', display: 'flex', alignItems: 'center', gap: 10,
              boxShadow: '0 1px 4px rgba(13,31,36,.06)',
            }}>
              <span style={{ color: 'rgba(13,31,36,0.3)', fontSize: 17, lineHeight: 1 }}>⌕</span>
              <input
                value={query}
                onChange={e => setQuery(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); handleSearch(query); } }}
                placeholder="Ask about your health…"
                style={{
                  flex: 1, background: 'none', border: 'none', outline: 'none',
                  fontFamily: 'var(--serif)', fontSize: 14, color: 'var(--ink)',
                }}
              />
              {/* Paperclip — MDT document upload */}
              <button
                onClick={() => fileInputRef.current?.click()}
                title="Upload lab report or medical document"
                style={{
                  width: 32, height: 32, borderRadius: 10, flexShrink: 0,
                  background: 'var(--mist)', border: 'none', cursor: 'pointer',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  transition: 'background 0.2s',
                }}
              >
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="rgba(13,31,36,0.45)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/>
                </svg>
              </button>
              <button
                onClick={() => startVoiceInput()}
                title={langHasTTS ? 'Tap to speak' : 'Tap to type by voice'}
                style={{
                  width: 32, height: 32, borderRadius: 10, flexShrink: 0,
                  background: isRecording ? 'var(--rose)' : 'var(--jade)',
                  border: 'none', cursor: 'pointer',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  transition: 'background 0.2s',
                  boxShadow: isRecording ? '0 0 0 4px rgba(194,103,94,.22)' : 'none',
                }}
              >
                {isRecording ? (
                  <svg width="11" height="11" viewBox="0 0 11 11" fill="none">
                    <rect x="1.5" y="1.5" width="8" height="8" rx="2" fill="#fff"/>
                  </svg>
                ) : (
                  <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                    <rect x="4" y="1" width="6" height="8" rx="3" fill="#fff"/>
                    <path d="M2 7c0 2.76 2.24 5 5 5s5-2.24 5-5" stroke="#fff" strokeWidth="1.3" strokeLinecap="round" fill="none"/>
                    <line x1="7" y1="12" x2="7" y2="13.5" stroke="#fff" strokeWidth="1.3" strokeLinecap="round"/>
                  </svg>
                )}
              </button>
            </div>
            {/* Interim STT transcript */}
            {sttInterim && (
              <p style={{
                fontFamily: 'var(--mono)', fontSize: '0.68rem', color: 'var(--jade-deep)',
                marginTop: -8, paddingLeft: 2, animation: 'fadeIn 0.15s ease',
              }}>
                {sttInterim}…
              </p>
            )}

            {/* .hint — dynamic based on lang TTS + recording state */}
            <p style={{ fontFamily: 'var(--mono)', fontSize: '0.6rem', opacity: 0.45, textAlign: 'center', marginTop: -6 }}>
              {isRecording
                ? '● listening…'
                : langHasTTS
                  ? 'tap mic to speak · or type'
                  : 'tap mic to type by voice · text response'}
            </p>

            {/* Continue section (.lbl + .sugg) */}
            {recentConvs.length > 0 && (
              <>
                <p style={{ fontFamily: 'var(--mono)', fontSize: '0.62rem', letterSpacing: '0.14em', textTransform: 'uppercase', opacity: 0.5, marginBottom: -5 }}>
                  Continue
                </p>
                {recentConvs.map(conv => (
                  <button
                    key={conv.id}
                    onClick={() => router.push('/history')}
                    style={{
                      background: '#fff', border: '1px solid var(--line)', borderRadius: 13,
                      padding: '13px 14px', display: 'flex', alignItems: 'center', gap: 10,
                      cursor: 'pointer', textAlign: 'left', width: '100%',
                    }}
                  >
                    <div style={{
                      width: 22, height: 22, borderRadius: 7, flexShrink: 0,
                      background: conv.scope_tag === 'personal' ? 'rgba(55,181,155,.14)' : 'rgba(13,31,36,.07)',
                      color: conv.scope_tag === 'personal' ? 'var(--jade-deep)' : 'rgba(13,31,36,0.4)',
                      display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12,
                    }}>
                      {conv.scope_tag === 'personal' ? '☘' : '⌕'}
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <p style={{ fontSize: 13, fontWeight: 500, color: 'var(--ink)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {conv.title || 'Untitled conversation'}
                      </p>
                      <p style={{ fontFamily: 'var(--mono)', fontSize: '0.6rem', color: 'rgba(13,31,36,0.4)', marginTop: 2 }}>
                        {conv.scope_tag === 'personal' ? 'uses your record' : 'general'} · {formatRelTime(conv.updated_at)}
                      </p>
                    </div>
                    <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                      <path d="M5 3l4 4-4 4" stroke="var(--ink)" strokeWidth="1.5" strokeLinecap="round" strokeOpacity="0.3"/>
                    </svg>
                  </button>
                ))}
              </>
            )}

            {/* Try asking (.lbl + .quick) */}
            <p style={{ fontFamily: 'var(--mono)', fontSize: '0.62rem', letterSpacing: '0.14em', textTransform: 'uppercase', opacity: 0.5, marginBottom: -5 }}>
              Try asking
            </p>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 9 }}>
              {QUICK_ITEMS.map(item => (
                <button key={item.text} onClick={() => handleSearch(item.text)} style={{
                  background: 'linear-gradient(180deg, #fff, var(--paper-soft))',
                  borderRadius: 13, padding: '13px', border: '1px solid var(--line)',
                  cursor: 'pointer', textAlign: 'left', display: 'flex', flexDirection: 'column', gap: 4,
                }}>
                  <span style={{ fontSize: 15, lineHeight: 1 }}>{item.icon}</span>
                  <span style={{ fontSize: '0.78rem', fontWeight: 500, color: 'var(--ink)', lineHeight: 1.3 }}>
                    {item.text}
                  </span>
                  <span style={{ fontFamily: 'var(--mono)', fontSize: '0.58rem', color: 'rgba(13,31,36,0.4)' }}>
                    {item.sub}
                  </span>
                </button>
              ))}
            </div>
          </div>
        </>
      )}

      {/* ── NON-IDLE ─────────────────────────────────────────────────── */}
      {phase === 'thinking'  && <ThinkingView query={query} agents={agents} />}
      {phase === 'on_device' && <OnDeviceView query={query} response={onDeviceText} onBack={handleNew} />}
      {phase === 'safety'    && <SafetyView   query={query} kind={safetyKind}      onBack={handleNew} />}
      {phase === 'uploading' && <UploadingView />}
      {phase === 'verifying' && verifyData?.type === 'pending_verification' && (
        <VerificationCard
          data={verifyData as MedicalDocVerifyResult & { type: 'pending_verification' }}
          onSave={handleDocSave}
          onCancel={() => { setVerifyData(null); setPhase('idle'); }}
          saving={savingDoc}
        />
      )}
      {phase === 'answer' && answer && (
        <AnswerView query={query} data={answer} onBack={handleNew} onSecondOpinion={handleSecondOpinion} />
      )}

      {/* Speaking banner — floats above follow-up bar when TTS is active */}
      {isSpeaking && (
        <div style={{
          position: 'absolute', bottom: phase === 'answer' ? 152 : 80, left: 14, right: 14,
          background: 'var(--jade)', borderRadius: 11, padding: '8px 14px',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          zIndex: 20, boxShadow: '0 4px 16px rgba(55,181,155,.35)',
          animation: 'fadeIn 0.2s ease',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{
              width: 8, height: 8, borderRadius: '50%', background: '#fff',
              display: 'inline-block', animation: 'pulse-dot 1s infinite',
            }} />
            <span style={{ fontFamily: 'var(--mono)', fontSize: '0.62rem', color: '#fff', fontWeight: 700 }}>
              PAL is speaking
            </span>
          </div>
          <button
            onClick={() => { window.speechSynthesis?.cancel(); setIsSpeaking(false); }}
            style={{
              background: 'rgba(255,255,255,.22)', border: 'none', borderRadius: 7,
              padding: '4px 9px', cursor: 'pointer',
              fontFamily: 'var(--mono)', fontSize: '0.6rem', color: '#fff', fontWeight: 700,
            }}
          >
            stop
          </button>
        </div>
      )}

      {/* Follow-up input — pinned above TabBar, visible during answer phase */}
      {phase === 'answer' && (
        <div style={{
          position: 'absolute', bottom: 72, left: 0, right: 0,
          padding: '10px 14px',
          background: 'rgba(246,243,236,.96)',
          backdropFilter: 'blur(12px)',
          borderTop: '1px solid var(--line)',
          zIndex: 10,
        }}>
          <div style={{
            background: '#fff', border: '1px solid var(--line-2)', borderRadius: 13,
            padding: '9px 12px', display: 'flex', alignItems: 'center', gap: 8,
            boxShadow: '0 1px 4px rgba(13,31,36,.05)',
          }}>
            {/* Follow-up mic button */}
            <button
              onClick={() => startVoiceInput(text => {
                setFollowUpText(text);
                setTimeout(() => handleSearch(text), 150);
              })}
              title={langHasTTS ? 'Speak your follow-up' : 'Speak to type'}
              style={{
                width: 26, height: 26, borderRadius: 8, flexShrink: 0,
                background: isRecording ? 'var(--rose)' : 'var(--mist)',
                border: 'none', cursor: 'pointer',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                transition: 'background 0.2s',
                boxShadow: isRecording ? '0 0 0 3px rgba(194,103,94,.2)' : 'none',
              }}
            >
              {isRecording ? (
                <svg width="9" height="9" viewBox="0 0 9 9" fill="none">
                  <rect x="1" y="1" width="7" height="7" rx="1.5" fill="var(--rose)"/>
                </svg>
              ) : (
                <svg width="12" height="12" viewBox="0 0 14 14" fill="none">
                  <rect x="4" y="1" width="6" height="8" rx="3" fill="rgba(13,31,36,0.4)"/>
                  <path d="M2 7c0 2.76 2.24 5 5 5s5-2.24 5-5" stroke="rgba(13,31,36,0.4)" strokeWidth="1.3" strokeLinecap="round" fill="none"/>
                  <line x1="7" y1="12" x2="7" y2="13.5" stroke="rgba(13,31,36,0.4)" strokeWidth="1.3" strokeLinecap="round"/>
                </svg>
              )}
            </button>

            <input
              value={sttInterim && isRecording ? sttInterim + '…' : followUpText}
              onChange={e => { if (!isRecording) setFollowUpText(e.target.value); }}
              onKeyDown={e => {
                if (e.key === 'Enter' && followUpText.trim()) {
                  e.preventDefault();
                  const q = followUpText.trim();
                  setFollowUpText('');
                  handleSearch(q);
                }
              }}
              placeholder="Ask a follow-up…"
              style={{
                flex: 1, background: 'none', border: 'none', outline: 'none',
                fontFamily: 'var(--serif)', fontSize: 13, color: 'var(--ink)',
                fontStyle: isRecording ? 'italic' : 'normal',
              }}
            />
            <button
              onClick={() => {
                const q = followUpText.trim();
                if (!q) return;
                setFollowUpText('');
                handleSearch(q);
              }}
              style={{
                width: 26, height: 26, borderRadius: 8, flexShrink: 0,
                background: followUpText.trim() ? 'var(--jade)' : 'var(--mist)',
                border: 'none', cursor: followUpText.trim() ? 'pointer' : 'default',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                transition: 'background 0.2s',
              }}
            >
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                <path d="M2 6h8M6 2l4 4-4 4"
                  stroke={followUpText.trim() ? 'var(--deep-2)' : 'rgba(13,31,36,0.3)'}
                  strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </button>
          </div>
        </div>
      )}

      <TabBar />

      {showSheet && <PersonSheet onClose={() => setShowSheet(false)} />}
    </PhoneShell>
  );
}

export default function SearchPage() {
  return (
    <Suspense>
      <SearchContent />
    </Suspense>
  );
}

'use client';

import type { MedicalDocObservation, MedicalDocVerifyResult } from '@/lib/api';

interface Props {
  data: MedicalDocVerifyResult & { type: 'pending_verification' };
  onSave: () => Promise<void>;
  onCancel: () => void;
  saving?: boolean;
}

const MATCH_STYLE = {
  match:    { bg: 'rgba(55,181,155,.12)',  border: 'rgba(55,181,155,.4)',   text: 'var(--jade-deep)',  label: 'Patient match' },
  partial:  { bg: 'rgba(216,162,74,.10)', border: 'rgba(216,162,74,.45)',  text: 'var(--amber-deep)', label: 'Name differs — check before saving' },
  no_match: { bg: 'rgba(194,103,94,.08)', border: 'rgba(194,103,94,.40)',  text: 'var(--rose)',       label: 'Name mismatch — wrong patient?' },
};

function ObsRow({ obs, isLast }: { obs: MedicalDocObservation; isLast: boolean }) {
  return (
    <div style={{
      padding: '10px 14px',
      borderBottom: isLast ? undefined : '1px solid var(--line)',
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    }}>
      <div style={{ flex: 1, minWidth: 0, paddingRight: 10 }}>
        <p style={{ fontSize: '0.82rem', fontWeight: 500, color: 'var(--ink)', marginBottom: 1, lineHeight: 1.3 }}>
          {obs.display}
        </p>
        {obs.loinc_code && (
          <p style={{ fontFamily: 'var(--mono)', fontSize: '0.56rem', color: 'rgba(13,31,36,0.35)' }}>
            LOINC {obs.loinc_code}
          </p>
        )}
      </div>
      <div style={{ textAlign: 'right', flexShrink: 0 }}>
        <p style={{ fontWeight: 700, fontSize: '0.9rem', color: 'var(--ink)', lineHeight: 1.3 }}>
          {obs.value ?? '—'}{obs.unit ? ` ${obs.unit}` : ''}
        </p>
        {obs.reference_range && (
          <p style={{ fontFamily: 'var(--mono)', fontSize: '0.56rem', color: 'rgba(13,31,36,0.4)' }}>
            ref {obs.reference_range}
          </p>
        )}
      </div>
    </div>
  );
}

export function VerificationCard({ data, onSave, onCancel, saving }: Props) {
  const matchStatus = data.name_match_status ?? 'no_match';
  const mc = MATCH_STYLE[matchStatus];
  const obs = data.observations ?? [];

  return (
    <div style={{ flex: 1, overflowY: 'auto', padding: '12px 16px 144px', animation: 'fadeIn 0.2s ease' }}>

      {/* Back / cancel */}
      <button onClick={onCancel} style={{
        background: 'none', border: 'none', cursor: 'pointer',
        display: 'flex', alignItems: 'center', gap: 6, marginBottom: 14, padding: 0,
      }}>
        <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
          <path d="M11 4l-5 5 5 5" stroke="var(--ink)" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" strokeOpacity="0.5"/>
        </svg>
        <span style={{ fontSize: 12, color: 'rgba(13,31,36,0.5)', fontWeight: 500 }}>Cancel upload</span>
      </button>

      {/* Header */}
      <div style={{ marginBottom: 13 }}>
        <p style={{ fontFamily: 'var(--mono)', fontSize: '0.58rem', letterSpacing: '0.12em', textTransform: 'uppercase', opacity: 0.4, marginBottom: 4 }}>
          Review before saving
        </p>
        <p style={{ fontFamily: 'var(--serif)', fontSize: 15, fontWeight: 600, color: 'var(--ink)', lineHeight: 1.35 }}>
          {data.report_title || data.filename}
        </p>
        {data.report_date && (
          <p style={{ fontFamily: 'var(--mono)', fontSize: '0.63rem', color: 'rgba(13,31,36,0.45)', marginTop: 3 }}>
            Report date: {new Date(data.report_date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
          </p>
        )}
      </div>

      {/* Patient name verification badge */}
      <div style={{
        border: `1px solid ${mc.border}`, borderRadius: 12,
        padding: '12px 14px', background: mc.bg, marginBottom: 12,
      }}>
        <p style={{
          fontFamily: 'var(--mono)', fontSize: '0.66rem', fontWeight: 700,
          color: mc.text, marginBottom: 8, letterSpacing: '0.04em',
        }}>
          {mc.label}
        </p>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10 }}>
          <div>
            <p style={{ fontFamily: 'var(--mono)', fontSize: '0.56rem', opacity: 0.45, marginBottom: 2 }}>ON DOCUMENT</p>
            <p style={{ fontSize: '0.82rem', fontWeight: 500, color: 'var(--ink)' }}>
              {data.patient_name_on_doc || 'Not found'}
            </p>
          </div>
          <div style={{ textAlign: 'right' }}>
            <p style={{ fontFamily: 'var(--mono)', fontSize: '0.56rem', opacity: 0.45, marginBottom: 2 }}>YOUR PROFILE</p>
            <p style={{ fontSize: '0.82rem', fontWeight: 500, color: 'var(--ink)' }}>
              {data.patient_name_on_profile || 'Not set'}
            </p>
          </div>
        </div>
      </div>

      {/* Extracted lab values */}
      {obs.length > 0 ? (
        <div style={{ background: '#fff', borderRadius: 14, border: '1px solid var(--line)', overflow: 'hidden', marginBottom: 12 }}>
          <div style={{ padding: '10px 14px', borderBottom: '1px solid var(--line)' }}>
            <p style={{ fontFamily: 'var(--mono)', fontSize: '0.58rem', letterSpacing: '0.1em', textTransform: 'uppercase', opacity: 0.4 }}>
              {obs.length} value{obs.length !== 1 ? 's' : ''} extracted
            </p>
          </div>
          {obs.map((o, i) => <ObsRow key={i} obs={o} isLast={i === obs.length - 1} />)}
        </div>
      ) : (
        <div style={{
          background: '#fff', borderRadius: 13, border: '1px solid var(--line)',
          padding: '14px 16px', marginBottom: 12, textAlign: 'center',
        }}>
          <p style={{ fontFamily: 'var(--mono)', fontSize: '0.68rem', color: 'rgba(13,31,36,0.4)', lineHeight: 1.5 }}>
            No structured lab values extracted.{'\n'}
            Document will be saved as a reference file.
          </p>
        </div>
      )}

      {/* Action buttons */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <button
          onClick={onSave}
          disabled={saving}
          style={{
            width: '100%', padding: '12px', borderRadius: 12,
            background: matchStatus === 'no_match' ? 'transparent' : 'var(--jade)',
            border: matchStatus === 'no_match' ? `1px solid rgba(194,103,94,.5)` : 'none',
            cursor: saving ? 'default' : 'pointer',
            color: matchStatus === 'no_match' ? 'var(--rose)' : 'var(--deep-2)',
            fontSize: 13, fontWeight: 700,
            opacity: saving ? 0.6 : 1,
            transition: 'opacity 0.2s',
          }}
        >
          {saving
            ? 'Saving…'
            : matchStatus === 'no_match'
              ? 'Save anyway (this is my document)'
              : 'Save to my record'}
        </button>
        <button
          onClick={onCancel}
          disabled={saving}
          style={{
            width: '100%', padding: '10px', borderRadius: 12,
            border: '1px solid var(--line-2)', background: 'transparent',
            cursor: 'pointer', fontSize: 12, color: 'rgba(13,31,36,0.5)',
            fontFamily: 'var(--mono)',
          }}
        >
          Discard
        </button>
      </div>

      {/* PHI note */}
      <p style={{
        fontFamily: 'var(--mono)', fontSize: '0.56rem',
        color: 'rgba(13,31,36,0.28)', textAlign: 'center', marginTop: 14, lineHeight: 1.5,
      }}>
        Saved data is encrypted and stays in your account.{'\n'}PHI never leaves without your consent.
      </p>
    </div>
  );
}

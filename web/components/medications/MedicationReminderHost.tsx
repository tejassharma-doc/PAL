'use client';

/**
 * Global medication-reminder surface.
 *
 * Mounted once in the root layout. It:
 *   - listens on the shared chat socket for `medication_reminder` (a brief toast)
 *     and `medication_ack_prompt` (a modal with the four response buttons);
 *   - on load / focus, fetches any unanswered dose for the active patient so a
 *     prompt missed while the tab was closed still gets shown;
 *   - posts the patient's choice to /medications/doses/{id}/respond.
 *
 * Renders nothing until there is something to show, and stays dormant for signed
 * -out users or when no active patient is selected.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useChatSocket, type ChatFrame } from '@/lib/useChatSocket';
import {
  pendingDoses,
  respondToDose,
  type DoseResponse,
} from '@/lib/medications-api';

interface AckOption {
  value: DoseResponse;
  label: string;
}

interface AckPrompt {
  doseId: string;
  title: string;
  body: string;
  medicine: string;
  options: AckOption[];
}

const DEFAULT_OPTIONS: AckOption[] = [
  { value: 'yes', label: 'Yes' },
  { value: 'no', label: 'No' },
  { value: 'take_now', label: 'Will take now' },
  { value: 'snooze_10', label: 'Will take in 10 mins' },
];

function activePatientId(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem('pal_patient_id');
}

export default function MedicationReminderHost() {
  const [signedIn, setSignedIn] = useState(false);
  const [queue, setQueue] = useState<AckPrompt[]>([]);
  const [toast, setToast] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const chat = useChatSocket({ enabled: signedIn });

  useEffect(() => {
    const token = typeof window === 'undefined' ? null : localStorage.getItem('pal_token');
    if (token) setSignedIn(true);
  }, []);

  const enqueue = useCallback((p: AckPrompt) => {
    setQueue((q) => (q.some((x) => x.doseId === p.doseId) ? q : [...q, p]));
  }, []);

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 8000);
  }, []);

  // Live frames.
  useEffect(() => {
    if (!signedIn) return;
    return chat.onMessage((f: ChatFrame) => {
      const frame = f as ChatFrame & {
        dose_event_id?: string;
        body?: string;
        medicine_name?: string;
        title?: string;
        options?: AckOption[];
      };
      if (frame.type === 'medication_reminder') {
        showToast(frame.body || 'Time to take your medicine');
      } else if (frame.type === 'medication_ack_prompt' && frame.dose_event_id) {
        enqueue({
          doseId: frame.dose_event_id,
          title: frame.title || 'Did you take your medicine?',
          body: frame.body || 'Did you take your medicine?',
          medicine: frame.medicine_name || '',
          options: frame.options?.length ? frame.options : DEFAULT_OPTIONS,
        });
      }
    });
  }, [signedIn, chat, enqueue, showToast]);

  // Re-surface anything missed while away.
  const syncPending = useCallback(async () => {
    const pid = activePatientId();
    if (!pid) return;
    try {
      const doses = await pendingDoses(pid);
      doses
        .filter((d) => d.status === 'awaiting_ack')
        .forEach((d) =>
          enqueue({
            doseId: d.id,
            title: 'Did you take your medicine?',
            body: 'Did you take your medicine?',
            medicine: '',
            options: DEFAULT_OPTIONS,
          }),
        );
    } catch {
      /* non-fatal: live frames remain the primary path */
    }
  }, [enqueue]);

  useEffect(() => {
    if (!signedIn || typeof window === 'undefined') return;
    void syncPending();
    const onVisible = () => {
      if (document.visibilityState === 'visible') void syncPending();
    };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', onVisible);
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', onVisible);
    };
  }, [signedIn, syncPending]);

  const answer = useCallback(async (doseId: string, value: DoseResponse) => {
    setBusy(true);
    try {
      await respondToDose(doseId, value);
    } catch {
      /* leave the prompt up so the user can retry */
      setBusy(false);
      return;
    }
    setQueue((q) => q.filter((x) => x.doseId !== doseId));
    setBusy(false);
  }, []);

  const current = queue[0];

  if (!signedIn) return null;

  return (
    <>
      {toast && !current && (
        <div
          role="status"
          style={{
            position: 'fixed',
            bottom: 88,
            left: '50%',
            transform: 'translateX(-50%)',
            zIndex: 1000,
            maxWidth: 'min(92vw, 420px)',
            padding: '12px 16px',
            borderRadius: 12,
            background: 'var(--deep-1, #11201c)',
            color: 'var(--ink, #eaf5f1)',
            border: '1px solid var(--line, #27423a)',
            boxShadow: '0 8px 30px rgba(0,0,0,0.35)',
            fontSize: 14,
          }}
        >
          💊 {toast}
        </div>
      )}

      {current && (
        <div
          role="dialog"
          aria-modal="true"
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 1100,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 16,
            background: 'rgba(0,0,0,0.5)',
          }}
        >
          <div
            style={{
              width: 'min(92vw, 420px)',
              borderRadius: 16,
              background: 'var(--deep-1, #11201c)',
              color: 'var(--ink, #eaf5f1)',
              border: '1px solid var(--line, #27423a)',
              padding: 20,
              boxShadow: '0 20px 60px rgba(0,0,0,0.5)',
            }}
          >
            <h3 style={{ margin: '0 0 8px', fontSize: 18 }}>{current.title}</h3>
            <p style={{ margin: '0 0 18px', fontSize: 15, opacity: 0.85 }}>
              {current.medicine ? `Did you take ${current.medicine}?` : current.body}
            </p>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              {current.options.map((opt) => (
                <button
                  key={opt.value}
                  disabled={busy}
                  onClick={() => void answer(current.doseId, opt.value)}
                  style={{
                    padding: '12px 10px',
                    borderRadius: 10,
                    border: '1px solid var(--line, #27423a)',
                    background:
                      opt.value === 'yes' || opt.value === 'take_now'
                        ? 'var(--accent, #37b59b)'
                        : 'transparent',
                    color:
                      opt.value === 'yes' || opt.value === 'take_now'
                        ? '#06201a'
                        : 'var(--ink, #eaf5f1)',
                    fontSize: 14,
                    fontWeight: 600,
                    cursor: busy ? 'default' : 'pointer',
                    opacity: busy ? 0.6 : 1,
                  }}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </>
  );
}

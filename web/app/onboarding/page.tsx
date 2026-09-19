'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { translations } from '../../lib/i18n';
import { SUPPORTED_LANGUAGES, type LangCode } from '../../lib/languages';

// ─── Design tokens ─────────────────────────────────────────────────────────────
const c = {
  ink: '#0d1f24', deep: '#13343b', deep2: '#0c2429',
  paper: '#f6f3ec', soft: '#fbf9f4', jade: '#37b59b',
  jadeD: '#1f7d6b', rose: '#c2675e',
};
const mono = "'Space Mono', monospace";
const serif = "'Newsreader', serif";
const sans = "'Space Grotesk', sans-serif";

// ─── Small helpers ──────────────────────────────────────────────────────────────
function Label({ text }: { text: string }) {
  return (
    <div style={{ fontFamily: mono, fontSize: '.57rem', letterSpacing: '.1em', textTransform: 'uppercase', color: c.ink, opacity: .5, marginBottom: 5 }}>
      {text}
    </div>
  );
}

function FieldInput({ label, type = 'text', value, onChange, placeholder, prefix, error }: {
  label: string; type?: string; value: string; onChange: (v: string) => void;
  placeholder?: string; prefix?: string; error?: string;
}) {
  return (
    <div style={{ marginBottom: 14 }}>
      <Label text={label} />
      <div style={{ display: 'flex', alignItems: 'center', background: '#fff', border: `1px solid ${error ? c.rose : 'rgba(13,31,36,.16)'}`, borderRadius: 11, overflow: 'hidden' }}>
        {prefix && <span style={{ fontFamily: mono, fontSize: '.7rem', color: c.ink, opacity: .5, paddingLeft: 12, paddingRight: 4, whiteSpace: 'nowrap' }}>{prefix}</span>}
        <input type={type} value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder}
          style={{ flex: 1, border: 'none', outline: 'none', padding: '11px 12px', fontFamily: sans, fontSize: '.88rem', color: c.ink, background: 'transparent' }} />
      </div>
      {error && <div style={{ fontFamily: mono, fontSize: '.6rem', color: c.rose, marginTop: 4 }}>{error}</div>}
    </div>
  );
}

function PrimaryBtn({ label, onClick, disabled }: { label: string; onClick: () => void; disabled?: boolean }) {
  return (
    <button onClick={onClick} disabled={disabled} style={{
      width: '100%', background: disabled ? 'rgba(13,31,36,.12)' : c.jade,
      color: disabled ? 'rgba(13,31,36,.35)' : '#fff',
      border: 'none', fontFamily: sans, fontWeight: 600, fontSize: '.9rem',
      padding: 14, borderRadius: 13, cursor: disabled ? 'default' : 'pointer',
      transition: 'background .2s, color .2s', marginTop: 4,
    }}>
      {label}
    </button>
  );
}

function ErrorMsg({ msg }: { msg: string }) {
  return <div style={{ fontFamily: mono, fontSize: '.62rem', color: c.rose, marginBottom: 10, textAlign: 'center' }}>{msg}</div>;
}

const DEV_BYPASS = process.env.NODE_ENV === 'development';

// ─── Main component ─────────────────────────────────────────────────────────────
export default function Onboarding() {
  const router = useRouter();

  // Redirect based on auth state
  useEffect(() => {
    const token = localStorage.getItem('pal_token');
    const lang = localStorage.getItem('pal_preferred_lang');

    if (!token) {
      // No token - should go to login instead
      window.location.replace('/login');
    } else if (token && lang) {
      // Fully authenticated - go to main app
      window.location.replace('/');
    }
    // If token exists but no lang, stay on onboarding
  }, []);

  const [step, setStep] = useState<1 | 2 | 3>(1);

  // Step 1
  const [phone, setPhone] = useState(
    process.env.NODE_ENV === 'development' ? '9876543210' : ''
  );
  const [useEmail, setUseEmail] = useState(false);
  const [email, setEmail] = useState('');
  const [step1Err, setStep1Err] = useState('');
  const [sending, setSending] = useState(false);

  // Step 2
  const [otp, setOtp] = useState(['', '', '', '', '', '']);
  const [deliveryHint, setDeliveryHint] = useState('');
  const [verifying, setVerifying] = useState(false);
  const [step2Err, setStep2Err] = useState('');
  const [resend, setResend] = useState(0);
  const [ehrFound, setEhrFound] = useState(false);
  // Six individual refs (hooks must not be called conditionally)
  const o0 = useRef<HTMLInputElement>(null);
  const o1 = useRef<HTMLInputElement>(null);
  const o2 = useRef<HTMLInputElement>(null);
  const o3 = useRef<HTMLInputElement>(null);
  const o4 = useRef<HTMLInputElement>(null);
  const o5 = useRef<HTMLInputElement>(null);
  const otpRefs = [o0, o1, o2, o3, o4, o5];
  const verifyBtnRef = useRef<HTMLButtonElement>(null);

  // Step 3
  const [fullName, setFullName] = useState(DEV_BYPASS ? 'Anil Sharma' : '');
  const [lang, setLang] = useState<LangCode | null>(null);
  const [step3Err, setStep3Err] = useState('');
  const [completing, setCompleting] = useState(false);
  const [authToken, setAuthToken] = useState('');

  // Resend countdown
  useEffect(() => {
    if (resend <= 0) return;
    const t = setTimeout(() => setResend(r => r - 1), 1000);
    return () => clearTimeout(t);
  }, [resend]);

  // Auto-focus verify button when all 6 OTP digits filled
  useEffect(() => {
    if (step === 2 && otp.every(d => d !== '')) {
      verifyBtnRef.current?.focus();
    }
  }, [otp, step]);

  // ── Step 1: Send OTP ──────────────────────────────────────────────────────
  async function handleSendOtp() {
    const digits = phone.replace(/\D/g, '');
    if (digits.length < 10) { setStep1Err('Enter a valid 10-digit mobile number'); return; }
    if (useEmail && (!email.trim() || !email.includes('@'))) { setStep1Err('Enter a valid email address'); return; }
    setStep1Err('');

    if (DEV_BYPASS) {
      setDeliveryHint(useEmail ? `Sent to ${email.trim().toLowerCase()}` : `Sent to +91 ${digits.slice(0, 5)}·····`);
      setOtp(['1', '2', '3', '4', '5', '6']);
      setResend(30);
      setStep(2);
      return;
    }

    setSending(true);
    try {
      const body: Record<string, string> = {
        phone: digits,
        delivery_channel: useEmail ? 'email' : 'sms',
      };
      if (useEmail) body.email = email.trim().toLowerCase();

      const res = await fetch('/api/auth/request-otp', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || 'Could not send OTP');

      setDeliveryHint(useEmail
        ? `Sent to ${email.trim().toLowerCase()}`
        : `Sent to +91 ${digits.slice(0, 5)}·····`
      );
      if (data.dev_otp && typeof data.dev_otp === 'string') {
        setOtp(data.dev_otp.split(''));
      }
      setResend(30);
      setStep(2);
    } catch (e) {
      setStep1Err(e instanceof Error ? e.message : 'Something went wrong');
    } finally {
      setSending(false);
    }
  }

  // ── Step 2: Verify OTP ───────────────────────────────────────────────────
  async function handleVerify() {
    const code = otp.join('');
    if (code.length < 6) { setStep2Err('Enter the 6-digit code'); return; }
    setStep2Err('');

    if (DEV_BYPASS) {
      setAuthToken('dev-mock-token');
      localStorage.setItem('pal_token', 'dev-mock-token');
      setStep(3);
      return;
    }

    setVerifying(true);
    try {
      const res = await fetch('/api/auth/verify-otp', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone: phone.replace(/\D/g, ''), otp_code: code }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || 'Verification failed');

      const token: string = data.access_token;
      setAuthToken(token);
      localStorage.setItem('pal_token', token);
      if (data.user?.id) localStorage.setItem('pal_user_id', data.user.id);

      if (data.has_ehr) setEhrFound(true);

      if (data.is_new_user) {
        setStep(3);
      } else {
        const lang = data.user.preferred_language || 'en';
        localStorage.setItem('pal_preferred_lang', lang);
        setTimeout(() => router.push('/'), data.has_ehr ? 1600 : 0);
      }
    } catch (e) {
      setStep2Err(e instanceof Error ? e.message : 'Verification failed');
    } finally {
      setVerifying(false);
    }
  }

  // ── Step 2: Resend OTP ───────────────────────────────────────────────────
  const handleResend = useCallback(async () => {
    if (resend > 0) return;
    setOtp(['', '', '', '', '', '']);
    setStep2Err('');
    setSending(true);
    try {
      const digits = phone.replace(/\D/g, '');
      const body: Record<string, string> = { phone: digits, delivery_channel: useEmail ? 'email' : 'sms' };
      if (useEmail) body.email = email.trim().toLowerCase();
      const res = await fetch('/api/auth/request-otp', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      });
      const data = await res.json();
      if (data.dev_otp) setOtp(data.dev_otp.split(''));
      setResend(30);
      otpRefs[0].current?.focus();
    } catch {
      setStep2Err('Could not resend OTP');
    } finally {
      setSending(false);
    }
  }, [resend, phone, email, useEmail]);

  // ── Step 3: Complete profile ──────────────────────────────────────────────
  async function handleCompleteProfile() {
    if (!fullName.trim()) { setStep3Err('Name is required'); return; }
    if (!lang) { setStep3Err('Please pick a language'); return; }
    setStep3Err('');

    if (DEV_BYPASS) {
      localStorage.setItem('pal_preferred_lang', lang);
      router.push('/');
      return;
    }

    setCompleting(true);
    try {
      await fetch('/api/auth/profile', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${authToken}` },
        body: JSON.stringify({ full_name: fullName.trim(), preferred_language: lang }),
      });
      localStorage.setItem('pal_preferred_lang', lang);
      router.push('/');
    } catch {
      setStep3Err('Could not save profile. Try again.');
    } finally {
      setCompleting(false);
    }
  }

  // ── OTP box handlers ─────────────────────────────────────────────────────
  function handleOtpChange(idx: number, val: string) {
    const digit = val.replace(/\D/g, '').slice(-1);
    const next = [...otp]; next[idx] = digit; setOtp(next);
    if (digit && idx < 5) otpRefs[idx + 1].current?.focus();
  }

  function handleOtpKeyDown(idx: number, e: React.KeyboardEvent) {
    if (e.key === 'Backspace' && !otp[idx] && idx > 0) {
      otpRefs[idx - 1].current?.focus();
    }
  }

  function handleOtpPaste(e: React.ClipboardEvent, startIdx: number) {
    e.preventDefault();
    const digits = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, 6 - startIdx);
    const next = [...otp];
    for (let i = 0; i < digits.length; i++) next[startIdx + i] = digits[i];
    setOtp(next);
    const focusIdx = Math.min(startIdx + digits.length, 5);
    otpRefs[focusIdx].current?.focus();
  }

  // ── Progress % ──────────────────────────────────────────────────────────
  const progress = step === 1 ? '33%' : step === 2 ? '66%' : '100%';

  const ot = (key: string) => {
    const row = (translations as Record<string, Record<string, string>>)[key];
    const l = lang ?? 'en';
    return row?.[l] ?? row?.['en'] ?? key;
  };

  // ─── Render ──────────────────────────────────────────────────────────────
  return (
    <div style={{
      minHeight: '100vh',
      background: 'radial-gradient(120% 80% at 50% -10%, #18454e 0%, #13343b 38%, #0c2429 100%)',
      display: 'flex', flexDirection: 'column', alignItems: 'center',
      justifyContent: 'center', padding: '20px 16px 48px', fontFamily: sans,
    }}>
      <div style={{ fontFamily: mono, fontSize: '.62rem', letterSpacing: '.2em', textTransform: 'uppercase', color: c.jade, marginBottom: 20 }}>PAL</div>

      {/* Phone shell */}
      <div style={{ width: 344, background: c.paper, borderRadius: 40, padding: 11, boxShadow: '0 1px 2px rgba(13,31,36,.06),0 30px 70px -22px rgba(0,0,0,.6),0 0 0 2px rgba(255,255,255,.06)', flexShrink: 0 }}>
        <div style={{ width: '100%', background: c.soft, borderRadius: 30, overflow: 'hidden', position: 'relative', display: 'flex', flexDirection: 'column', color: c.ink, minHeight: 620 }}>

          {/* Notch */}
          <div style={{ position: 'absolute', top: 0, left: '50%', transform: 'translateX(-50%)', width: 122, height: 24, background: c.paper, borderRadius: '0 0 16px 16px', zIndex: 10 }} />

          {/* Progress bar */}
          <div style={{ height: 3, background: 'rgba(13,31,36,.08)', flexShrink: 0, marginTop: 24 }}>
            <div style={{ height: '100%', width: progress, background: c.jade, borderRadius: 2, transition: 'width .35s ease' }} />
          </div>

          <div style={{ flex: 1, overflowY: 'auto', overflowX: 'hidden', padding: '24px 20px 28px' }}>

            {/* ── STEP 1: Phone entry ─────────────────────────────────────── */}
            {step === 1 && (
              <>
                <div style={{ fontFamily: serif, fontWeight: 300, fontSize: '1.4rem', lineHeight: 1.2, marginBottom: 4 }}>
                  Verify your number
                </div>
                <div style={{ fontFamily: mono, fontSize: '.57rem', opacity: .45, marginBottom: 24, letterSpacing: '.04em' }}>
                  Your phone is your patient ID. No password needed.
                </div>

                {!useEmail ? (
                  <FieldInput label="Mobile number" type="tel" value={phone} onChange={setPhone}
                    placeholder="9876543210" prefix="+91" />
                ) : (
                  <>
                    <FieldInput label="Mobile number" type="tel" value={phone} onChange={setPhone}
                      placeholder="9876543210" prefix="+91" />
                    <FieldInput label="Email for OTP" type="email" value={email} onChange={setEmail}
                      placeholder="you@example.com" />
                  </>
                )}

                {/* Toggle: SMS ↔ email */}
                <button onClick={() => { setUseEmail(u => !u); setStep1Err(''); }}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '0 0 18px', fontFamily: mono, fontSize: '.58rem', color: c.jade, textDecoration: 'underline dotted', display: 'block' }}>
                  {useEmail ? '← Receive OTP via SMS instead' : 'Travelling abroad? Receive OTP on email →'}
                </button>

                {step1Err && <ErrorMsg msg={step1Err} />}

                <PrimaryBtn label={sending ? 'Sending…' : 'Send OTP'} onClick={handleSendOtp} disabled={sending} />
              </>
            )}

            {/* ── STEP 2: OTP entry ───────────────────────────────────────── */}
            {step === 2 && (
              <>
                <button onClick={() => { setStep(1); setOtp(['', '', '', '', '', '']); setEhrFound(false); }}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '0 0 16px', display: 'flex', alignItems: 'center', gap: 5 }}>
                  <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                    <path d="M10 3L6 8l4 5" stroke={c.ink} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" strokeOpacity=".5"/>
                  </svg>
                  <span style={{ fontFamily: mono, fontSize: '.6rem', color: c.ink, opacity: .5 }}>Back</span>
                </button>

                <div style={{ fontFamily: serif, fontWeight: 300, fontSize: '1.4rem', lineHeight: 1.2, marginBottom: 4 }}>
                  Enter the code
                </div>
                <div style={{ fontFamily: mono, fontSize: '.57rem', opacity: .45, marginBottom: 24, letterSpacing: '.04em' }}>
                  {deliveryHint}
                </div>

                {/* 6-box OTP input */}
                <div style={{ display: 'flex', gap: 8, marginBottom: 24 }}>
                  {[o0, o1, o2, o3, o4, o5].map((ref, i) => (
                    <input
                      key={i}
                      ref={ref}
                      type="text"
                      inputMode="numeric"
                      maxLength={1}
                      value={otp[i]}
                      onChange={e => handleOtpChange(i, e.target.value)}
                      onKeyDown={e => handleOtpKeyDown(i, e)}
                      onPaste={e => handleOtpPaste(e, i)}
                      style={{
                        flex: 1, minWidth: 0, height: 52, textAlign: 'center',
                        fontFamily: mono, fontSize: '1.3rem', fontWeight: 700,
                        color: c.ink, background: '#fff',
                        border: `1.5px solid ${otp[i] ? c.jade : 'rgba(13,31,36,.18)'}`,
                        borderRadius: 11, outline: 'none', transition: 'border-color .15s',
                      }}
                    />
                  ))}
                </div>

                {/* EHR found banner */}
                {ehrFound && (
                  <div style={{ background: 'rgba(55,181,155,.12)', border: `1px solid ${c.jade}`, borderRadius: 10, padding: '10px 14px', marginBottom: 16, display: 'flex', alignItems: 'center', gap: 10 }}>
                    <span style={{ fontSize: '1.1rem' }}>🗂</span>
                    <div>
                      <div style={{ fontFamily: sans, fontWeight: 600, fontSize: '.82rem', color: c.jade }}>Health record found</div>
                      <div style={{ fontFamily: mono, fontSize: '.54rem', color: c.ink, opacity: .6 }}>Your existing records will be loaded.</div>
                    </div>
                  </div>
                )}

                {step2Err && <ErrorMsg msg={step2Err} />}

                <button
                  ref={verifyBtnRef}
                  onClick={handleVerify}
                  disabled={verifying || otp.join('').length < 6}
                  style={{
                    width: '100%',
                    background: otp.join('').length === 6 && !verifying ? c.jade : 'rgba(13,31,36,.12)',
                    color: otp.join('').length === 6 && !verifying ? '#fff' : 'rgba(13,31,36,.35)',
                    border: 'none', fontFamily: sans, fontWeight: 600, fontSize: '.9rem',
                    padding: 14, borderRadius: 13, cursor: otp.join('').length === 6 && !verifying ? 'pointer' : 'default',
                    transition: 'background .2s, color .2s',
                  }}
                >
                  {verifying ? 'Verifying…' : 'Verify'}
                </button>

                {/* Resend */}
                <div style={{ textAlign: 'center', marginTop: 16 }}>
                  <button onClick={handleResend} disabled={resend > 0 || sending}
                    style={{ background: 'none', border: 'none', cursor: resend > 0 ? 'default' : 'pointer', fontFamily: mono, fontSize: '.58rem', color: resend > 0 ? 'rgba(13,31,36,.3)' : c.jade, textDecoration: resend > 0 ? 'none' : 'underline dotted' }}>
                    {resend > 0 ? `Resend in ${resend}s` : 'Resend OTP'}
                  </button>
                </div>
              </>
            )}

            {/* ── STEP 3: Profile (new users only) ────────────────────────── */}
            {step === 3 && (
              <>
                <div style={{ fontFamily: serif, fontWeight: 300, fontSize: '1.4rem', lineHeight: 1.2, marginBottom: 4 }}>
                  {ot('onboard_tell_us')}
                </div>
                <div style={{ fontFamily: mono, fontSize: '.57rem', opacity: .45, marginBottom: 24, letterSpacing: '.04em' }}>
                  {ot('onboard_subtitle')}
                </div>

                {ehrFound && (
                  <div style={{ background: 'rgba(55,181,155,.12)', border: `1px solid ${c.jade}`, borderRadius: 10, padding: '10px 14px', marginBottom: 18, display: 'flex', alignItems: 'center', gap: 10 }}>
                    <span style={{ fontSize: '1.1rem' }}>🗂</span>
                    <div>
                      <div style={{ fontFamily: sans, fontWeight: 600, fontSize: '.82rem', color: c.jade }}>Health record found</div>
                      <div style={{ fontFamily: mono, fontSize: '.54rem', color: c.ink, opacity: .6 }}>Your records will be ready once you sign in.</div>
                    </div>
                  </div>
                )}

                <FieldInput label={ot('onboard_name_label')} value={fullName} onChange={setFullName} placeholder="Priya Sharma" />

                <Label text="Language" />
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8, marginBottom: 20 }}>
                  {SUPPORTED_LANGUAGES.map(l => {
                    const selected = lang === l.code;
                    return (
                      <button key={l.code} onClick={() => setLang(l.code as LangCode)}
                        style={{
                          background: selected ? c.jade : 'rgba(13,31,36,.07)',
                          color: selected ? '#fff' : c.ink,
                          border: `1.5px solid ${selected ? c.jade : 'transparent'}`,
                          borderRadius: 11, padding: '10px 6px', cursor: 'pointer',
                          fontFamily: sans, fontSize: '.78rem', fontWeight: selected ? 600 : 500,
                          lineHeight: 1.3, textAlign: 'center', transition: 'background .15s, color .15s',
                        }}>
                        <div style={{ fontSize: '1rem', marginBottom: 2 }}>{l.native}</div>
                        {l.code !== 'en' && <div style={{ fontFamily: mono, fontSize: '.52rem', opacity: selected ? .8 : .45 }}>{l.name}</div>}
                      </button>
                    );
                  })}
                </div>

                {step3Err && <ErrorMsg msg={step3Err} />}

                <PrimaryBtn
                  label={completing ? 'Saving…' : ot('onboard_start')}
                  onClick={handleCompleteProfile}
                  disabled={!fullName.trim() || !lang || completing}
                />
              </>
            )}

          </div>
        </div>
      </div>
    </div>
  );
}

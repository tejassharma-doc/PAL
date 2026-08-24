'use client';

import { useState, useRef } from 'react';
import { useRouter } from 'next/navigation';

export default function UploadPage() {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [phase, setPhase] = useState<'idle' | 'uploading' | 'verifying' | 'success' | 'error'>('idle');
  const [error, setError] = useState('');
  const [verifyData, setVerifyData] = useState<any>(null);

  async function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) {
      console.log('No file selected');
      return;
    }

    console.log('File selected:', file.name, file.type, file.size);

    // Check file size
    if (file.size > 20 * 1024 * 1024) {
      setError('File too large (max 20 MB)');
      setPhase('error');
      return;
    }

    // Check file type
    const validTypes = ['application/pdf', 'image/jpeg', 'image/jpg', 'image/png'];
    if (!validTypes.includes(file.type)) {
      setError('Please upload PDF, JPEG, or PNG files only');
      setPhase('error');
      return;
    }

    setPhase('uploading');
    setError('');

    try {
      // Get auth token
      const token = localStorage.getItem('pal_token');
      const userId = localStorage.getItem('pal_user_id');
      const patientId = localStorage.getItem('pal_patient_id'); // ← Get patient ID


      console.log('Auth check:', { hasToken: !!token, hasUserId: !!userId, hasPatientId: !!patientId, tokenPreview: token?.substring(0, 20) });

      if (!token || !userId) {
        console.error('Missing auth credentials - redirecting to login');
        router.push('/login');
        return;
      }

      if (!patientId) {
        console.error('Missing patient ID - user needs to create patient profile');
        setError('Please create your patient profile first');
        setPhase('error');
        return;
      }

      console.log('Starting upload to /api/medical/upload');

      // Create form data
      const formData = new FormData();
      formData.append('file', file);
      formData.append('patient_id', patientId); // ← Use patient ID, not user ID!

      // Upload to backend
      const response = await fetch('/api/medical/upload', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
        },
        body: formData,
      });

      console.log('Upload response status:', response.status);

      if (!response.ok) {
        const errorText = await response.text();
        console.error('Upload failed:', response.status, errorText);
        throw new Error(`Upload failed: ${response.status}`);
      }

      const result = await response.json();
      console.log('Upload result:', result);

      if (result.type === 'pending_verification') {
        console.log('Success: pending verification');
        setVerifyData(result);
        setPhase('verifying');
      } else if (result.type === 'document_accepted') {
        console.log('Success: document accepted (MDT disabled)');
        setPhase('success');
        setTimeout(() => router.push('/records'), 2000);
      } else {
        console.error('Unexpected result type:', result.type);
        setError(result.message || 'Upload failed');
        setPhase('error');
      }
    } catch (err: any) {
      console.error('Upload error:', err);
      setError(err.message || 'Upload failed. Please try again.');
      setPhase('error');
    }
  }

  async function handleConfirm() {
    if (!verifyData) return;

    setPhase('uploading');

    try {
      const token = localStorage.getItem('pal_token');
      const userId = localStorage.getItem('pal_user_id');
      const patientId = localStorage.getItem('pal_patient_id'); // ← Get patient ID


      const response = await fetch('/api/medical/confirm', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({
          raw_source_id: verifyData.raw_source_id,
          patient_id: patientId, // Backend uses current_user.id
          observations: verifyData.observations || [],
          report_date: verifyData.report_date,
          report_title: verifyData.report_title,
          fhir_bundle: null,
        }),
      });

      if (!response.ok) {
        throw new Error(`Confirm failed: ${response.status}`);
      }

      const result = await response.json();
      console.log('Confirm result:', result);

      setPhase('success');
      setTimeout(() => router.push('/records'), 2000);
    } catch (err: any) {
      console.error('Confirm error:', err);
      setError(err.message || 'Failed to save lab report');
      setPhase('error');
    }
  }

  return (
    <div style={{
      position: 'fixed',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      background: '#fbf9f4',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      padding: 24,
    }}>
      <input
        ref={fileInputRef}
        type="file"
        accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png"
        style={{ display: 'none' }}
        onChange={handleFileSelect}
      />

      {/* IDLE STATE */}
      {phase === 'idle' && (
        <div style={{ textAlign: 'center', maxWidth: 400 }}>
          <h1 style={{
            fontFamily: 'Georgia, serif',
            fontSize: '1.75rem',
            fontWeight: 700,
            color: '#0d1f24',
            marginBottom: 12,
          }}>
            Upload Lab Report
          </h1>
          <p style={{
            fontFamily: 'Georgia, serif',
            fontSize: '0.95rem',
            color: '#0d1f24',
            opacity: 0.6,
            marginBottom: 32,
          }}>
            Upload your medical reports for automatic processing
          </p>

          <button
            onClick={() => fileInputRef.current?.click()}
            style={{
              width: '100%',
              padding: '20px 24px',
              background: 'linear-gradient(150deg, #37b59b, #2a9d85)',
              color: '#fff',
              border: 'none',
              borderRadius: 14,
              fontFamily: 'Georgia, serif',
              fontSize: '1.05rem',
              fontWeight: 600,
              cursor: 'pointer',
              marginBottom: 16,
            }}
          >
            📁 Choose File
          </button>

          <button
            onClick={() => router.push('/')}
            style={{
              width: '100%',
              padding: '16px 24px',
              background: '#fff',
              color: '#0d1f24',
              border: '1px solid rgba(13,31,36,0.2)',
              borderRadius: 14,
              fontFamily: 'Georgia, serif',
              fontSize: '0.95rem',
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            ← Back
          </button>
        </div>
      )}

      {/* UPLOADING STATE */}
      {phase === 'uploading' && (
        <div style={{ textAlign: 'center' }}>
          <div style={{
            width: 56,
            height: 56,
            borderRadius: '50%',
            border: '3px solid rgba(13,31,36,0.1)',
            borderTopColor: '#37b59b',
            animation: 'spin 1s linear infinite',
            margin: '0 auto 16px',
          }} />
          <p style={{
            fontFamily: 'Georgia, serif',
            fontSize: '1.05rem',
            fontWeight: 600,
            color: '#0d1f24',
          }}>
            Processing...
          </p>
        </div>
      )}

      {/* VERIFYING STATE */}
      {phase === 'verifying' && verifyData && (
        <div style={{ textAlign: 'center', maxWidth: 500, width: '100%' }}>
          <h2 style={{
            fontFamily: 'Georgia, serif',
            fontSize: '1.5rem',
            fontWeight: 700,
            color: '#0d1f24',
            marginBottom: 16,
          }}>
            Review Lab Report
          </h2>

          <div style={{
            background: '#fff',
            borderRadius: 14,
            padding: 20,
            marginBottom: 16,
            textAlign: 'left',
            border: '1px solid rgba(13,31,36,0.1)',
          }}>
            <p style={{ fontFamily: 'Georgia, serif', marginBottom: 8 }}>
              <strong>Report:</strong> {verifyData.report_title || verifyData.filename}
            </p>
            <p style={{ fontFamily: 'Georgia, serif', marginBottom: 8 }}>
              <strong>Date:</strong> {verifyData.report_date || 'Not specified'}
            </p>
            <p style={{ fontFamily: 'Georgia, serif', marginBottom: 8 }}>
              <strong>Patient:</strong> {verifyData.patient_name_on_doc || 'Not extracted'}
            </p>
            {verifyData.observations && verifyData.observations.length > 0 && (
              <div style={{ marginTop: 16 }}>
                <strong style={{ fontFamily: 'Georgia, serif' }}>Lab Values:</strong>
                <div style={{ marginTop: 8 }}>
                  {verifyData.observations.slice(0, 5).map((obs: any, i: number) => (
                    <div key={i} style={{
                      padding: '8px 12px',
                      background: '#fbf9f4',
                      borderRadius: 8,
                      marginBottom: 8,
                      fontSize: '0.9rem',
                      fontFamily: 'monospace',
                    }}>
                      {obs.display}: {obs.value} {obs.unit}
                    </div>
                  ))}
                  {verifyData.observations.length > 5 && (
                    <p style={{ fontSize: '0.85rem', opacity: 0.6, marginTop: 8 }}>
                      + {verifyData.observations.length - 5} more values
                    </p>
                  )}
                </div>
              </div>
            )}
          </div>

          <button
            onClick={handleConfirm}
            style={{
              width: '100%',
              padding: '16px 24px',
              background: 'linear-gradient(150deg, #37b59b, #2a9d85)',
              color: '#fff',
              border: 'none',
              borderRadius: 14,
              fontFamily: 'Georgia, serif',
              fontSize: '1.05rem',
              fontWeight: 600,
              cursor: 'pointer',
              marginBottom: 12,
            }}
          >
            ✓ Save to Record
          </button>

          <button
            onClick={() => setPhase('idle')}
            style={{
              width: '100%',
              padding: '12px 24px',
              background: '#fff',
              color: '#0d1f24',
              border: '1px solid rgba(13,31,36,0.2)',
              borderRadius: 14,
              fontFamily: 'Georgia, serif',
              fontSize: '0.95rem',
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            Cancel
          </button>
        </div>
      )}

      {/* SUCCESS STATE */}
      {phase === 'success' && (
        <div style={{ textAlign: 'center' }}>
          <div style={{
            width: 72,
            height: 72,
            borderRadius: '50%',
            background: '#D1FAE5',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: '2.5rem',
            margin: '0 auto 16px',
          }}>
            ✓
          </div>
          <h2 style={{
            fontFamily: 'Georgia, serif',
            fontSize: '1.5rem',
            fontWeight: 700,
            color: '#0d1f24',
            marginBottom: 8,
          }}>
            Report Saved!
          </h2>
          <p style={{
            fontFamily: 'Georgia, serif',
            fontSize: '0.95rem',
            color: '#0d1f24',
            opacity: 0.7,
          }}>
            Redirecting to records...
          </p>
        </div>
      )}

      {/* ERROR STATE */}
      {phase === 'error' && (
        <div style={{ textAlign: 'center', maxWidth: 400 }}>
          <div style={{
            width: 72,
            height: 72,
            borderRadius: '50%',
            background: '#FEF2F2',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: '2rem',
            margin: '0 auto 16px',
          }}>
            ⚠️
          </div>
          <h2 style={{
            fontFamily: 'Georgia, serif',
            fontSize: '1.25rem',
            fontWeight: 700,
            color: '#0d1f24',
            marginBottom: 8,
          }}>
            Upload Failed
          </h2>
          <p style={{
            fontFamily: 'Georgia, serif',
            fontSize: '0.9rem',
            color: '#0d1f24',
            opacity: 0.7,
            marginBottom: 24,
          }}>
            {error}
          </p>
          <button
            onClick={() => {
              setError('');
              setPhase('idle');
            }}
            style={{
              padding: '12px 32px',
              background: '#37b59b',
              color: '#fff',
              border: 'none',
              borderRadius: 10,
              fontFamily: 'Georgia, serif',
              fontSize: '0.95rem',
              fontWeight: 600,
              cursor: 'pointer',
              marginRight: 12,
            }}
          >
            Try Again
          </button>
          <button
            onClick={() => router.push('/')}
            style={{
              padding: '12px 32px',
              background: '#fff',
              color: '#0d1f24',
              border: '1px solid rgba(13,31,36,0.2)',
              borderRadius: 10,
              fontFamily: 'Georgia, serif',
              fontSize: '0.95rem',
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            Cancel
          </button>
        </div>
      )}

      <style jsx>{`
        @keyframes spin {
          0% { transform: rotate(0deg); }
          100% { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
}

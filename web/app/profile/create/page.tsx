'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'

// Design tokens (matching login page)
const c = {
  ink: '#0d1f24',
  deep: '#13343b',
  paper: '#f6f3ec',
  soft: '#fbf9f4',
  jade: '#37b59b',
  jadeD: '#1f7d6b',
  rose: '#c2675e',
}
const mono = "'Space Mono', monospace"
const serif = "'Newsreader', serif"
const sans = "'Space Grotesk', sans-serif"

export default function CreateProfilePage() {
  const router = useRouter()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [isEditMode, setIsEditMode] = useState(false)

  const [formData, setFormData] = useState({
    // Personal Info
    full_name: '',
    phone: '',
    date_of_birth: '',
    gender: '',
    blood_group: '',
    address: '',

    // Healthcare IDs (optional)
    mrn: '',
    abha_id: '',
    abha_address: '',

    // Medical Info (mandatory - use NA if not applicable)
    allergies: '',
    chronic_conditions: '',
    current_medications: '',

    // Emergency Contact (mandatory)
    emergency_contact_name: '',
    emergency_contact_relationship: '',
    emergency_contact_phone: '',
  })

  // Load existing profile data for editing
  useEffect(() => {
    const patientId = localStorage.getItem('pal_patient_id')
    if (patientId) {
      setIsEditMode(true)
      // Load existing profile data
      loadExistingProfile()
    } else {
      setIsEditMode(false)
    }
  }, [])

  async function loadExistingProfile() {
    try {
      const token = localStorage.getItem('pal_token')
      const response = await fetch('/api/user/profile', {
        headers: {
          'Authorization': `Bearer ${token}`,
        },
      })

      if (response.ok) {
        const data = await response.json()
        if (data.patient) {
          const p = data.patient
          setFormData({
            full_name: p.full_name || '',
            phone: p.phone || '',
            date_of_birth: p.date_of_birth || '',
            gender: p.gender || '',
            blood_group: p.blood_group || '',
            address: p.address || '',
            mrn: p.mrn || '',
            abha_id: p.abha_id || '',
            abha_address: p.abha_address || '',
            allergies: p.allergies || '',
            chronic_conditions: p.chronic_conditions || '',
            current_medications: p.current_medications || '',
            emergency_contact_name: p.emergency_contact?.name || '',
            emergency_contact_relationship: p.emergency_contact?.relationship || '',
            emergency_contact_phone: p.emergency_contact?.phone || '',
          })
        }
      }
    } catch (err) {
      console.error('Failed to load existing profile:', err)
    }
  }

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
    setFormData(prev => ({
      ...prev,
      [e.target.name]: e.target.value
    }))
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')

    // Validate mandatory fields
    if (!formData.full_name) {
      setError('Full name is required')
      return
    }
    if (!formData.phone) {
      setError('Phone is required')
      return
    }
    if (!formData.date_of_birth) {
      setError('Date of birth is required')
      return
    }
    if (!formData.gender) {
      setError('Gender is required')
      return
    }
    if (!formData.blood_group) {
      setError('Blood group is required')
      return
    }
    if (!formData.allergies) {
      setError('Allergies field is required (enter NA if none)')
      return
    }
    if (!formData.chronic_conditions) {
      setError('Chronic conditions field is required (enter NA if none)')
      return
    }
    if (!formData.current_medications) {
      setError('Current medications field is required (enter NA if none)')
      return
    }
    if (!formData.emergency_contact_name) {
      setError('Emergency contact name is required')
      return
    }
    if (!formData.emergency_contact_relationship) {
      setError('Emergency contact relationship is required')
      return
    }
    if (!formData.emergency_contact_phone) {
      setError('Emergency contact phone is required')
      return
    }

    setLoading(true)

    try {
      // Get auth credentials
      const token = localStorage.getItem('pal_token')
      const userId = localStorage.getItem('pal_user_id')
      const userEmail = localStorage.getItem('pal_username') // This might be email from login

      // Debug logging
      console.log('Profile create - Auth check:', {
        hasToken: !!token,
        tokenPreview: token ? token.substring(0, 20) + '...' : 'null',
        userId,
        userEmail
      })

      // Check if token exists
      if (!token) {
        setError('Not authenticated. Please login again.')
        setTimeout(() => router.push('/'), 2000)
        setLoading(false)
        return
      }

      // Build emergency contact object
      const emergencyContact = (formData.emergency_contact_name || formData.emergency_contact_phone)
        ? {
            name: formData.emergency_contact_name,
            relationship: formData.emergency_contact_relationship,
            phone: formData.emergency_contact_phone,
          }
        : null

      const patientId = localStorage.getItem('pal_patient_id')
      const isUpdate = !!patientId

      // Create or update patient record
      const url = isUpdate ? `/api/patients/${patientId}` : '/api/patients'
      const method = isUpdate ? 'PUT' : 'POST'

      console.log('Sending request:', { url, method, hasToken: !!token })

      const response = await fetch(url, {
        method,
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({
          full_name: formData.full_name,
          phone: formData.phone || null,
          email: userEmail || null,
          date_of_birth: formData.date_of_birth || null,
          gender: formData.gender || null,
          blood_group: formData.blood_group || null,
          address: formData.address || null,
          // Healthcare IDs - send null if empty or "NA"
          mrn: (formData.mrn && formData.mrn !== 'NA') ? formData.mrn : null,
          abha_id: (formData.abha_id && formData.abha_id !== 'NA') ? formData.abha_id : null,
          abha_address: (formData.abha_address && formData.abha_address !== 'NA') ? formData.abha_address : null,
          // Medical info - keep "NA" as valid text for these fields
          allergies: formData.allergies || 'NA',
          chronic_conditions: formData.chronic_conditions || 'NA',
          current_medications: formData.current_medications || 'NA',
          emergency_contact: emergencyContact,
          is_active: true,
        }),
      })

      if (!response.ok) {
        const data = await response.json()
        console.error('API Error:', data)

        // Handle validation errors
        if (data.detail && Array.isArray(data.detail)) {
          const errors = data.detail.map((e: any) => `${e.loc.join('.')}: ${e.msg}`).join(', ')
          throw new Error(errors)
        }

        throw new Error(data.detail || `Failed to ${isUpdate ? 'update' : 'create'} profile`)
      }

      const data = await response.json()

      // Store patient ID and set language preference
      localStorage.setItem('pal_patient_id', data.id)
      localStorage.setItem('pal_preferred_lang', 'en')
      localStorage.setItem('pal_user_name', formData.full_name)

      // Redirect to home
      router.push('/')
    } catch (err: any) {
      console.error('Submit Error:', err)
      setError(err.message || 'Something went wrong')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div
      style={{
        minHeight: '100vh',
        background: 'radial-gradient(120% 80% at 50% -10%, #18454e 0%, #13343b 38%, #0c2429 100%)',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '40px 16px',
      }}
    >
      <div
        style={{
          fontFamily: mono,
          fontSize: '.62rem',
          letterSpacing: '.2em',
          textTransform: 'uppercase',
          color: c.jade,
          marginBottom: 20,
        }}
      >
        PAL
      </div>

      <div
        style={{
          width: 680,
          maxWidth: '100%',
          background: c.soft,
          borderRadius: 24,
          padding: '32px 28px',
          boxShadow: '0 1px 2px rgba(13,31,36,.06), 0 30px 70px -22px rgba(0,0,0,.6)',
        }}
      >
        <h1
          style={{
            fontFamily: serif,
            fontWeight: 300,
            fontSize: '1.8rem',
            lineHeight: 1.2,
            color: c.ink,
            marginBottom: 8,
          }}
        >
          {isEditMode ? 'Edit your profile' : 'Create your profile'}
        </h1>
        <p
          style={{
            fontFamily: mono,
            fontSize: '.6rem',
            opacity: 0.5,
            marginBottom: 28,
            letterSpacing: '.04em',
          }}
        >
          {isEditMode ? 'Update your health information' : 'Please provide your health information'}
        </p>

        <form onSubmit={handleSubmit}>
          {/* Personal Information */}
          <div style={{ marginBottom: 24 }}>
            <h3 style={{ fontFamily: sans, fontSize: '.9rem', fontWeight: 600, color: c.ink, marginBottom: 4 }}>
              Personal Information
            </h3>
            <p style={{ fontFamily: mono, fontSize: '.55rem', opacity: 0.4, marginBottom: 16 }}>
              * All fields are mandatory
            </p>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
              <div style={{ gridColumn: '1 / -1' }}>
                <label style={{ fontFamily: mono, fontSize: '.57rem', letterSpacing: '.1em', textTransform: 'uppercase', color: c.ink, opacity: 0.5, marginBottom: 6, display: 'block' }}>
                  Full Name *
                </label>
                <input
                  type="text"
                  name="full_name"
                  required
                  value={formData.full_name}
                  onChange={handleChange}
                  style={{ width: '100%', padding: '12px 14px', fontFamily: sans, fontSize: '.9rem', color: c.ink, background: '#fff', border: `1px solid ${error ? c.rose : 'rgba(13,31,36,.16)'}`, borderRadius: 11, outline: 'none' }}
                />
              </div>

              <div>
                <label style={{ fontFamily: mono, fontSize: '.57rem', letterSpacing: '.1em', textTransform: 'uppercase', color: c.ink, opacity: 0.5, marginBottom: 6, display: 'block' }}>
                  Phone *
                </label>
                <input
                  type="tel"
                  name="phone"
                  required
                  value={formData.phone}
                  onChange={handleChange}
                  style={{ width: '100%', padding: '12px 14px', fontFamily: sans, fontSize: '.9rem', color: c.ink, background: '#fff', border: '1px solid rgba(13,31,36,.16)', borderRadius: 11, outline: 'none' }}
                />
              </div>

              <div>
                <label style={{ fontFamily: mono, fontSize: '.57rem', letterSpacing: '.1em', textTransform: 'uppercase', color: c.ink, opacity: 0.5, marginBottom: 6, display: 'block' }}>
                  Date of Birth *
                </label>
                <input
                  type="date"
                  name="date_of_birth"
                  required
                  value={formData.date_of_birth}
                  onChange={handleChange}
                  style={{ width: '100%', padding: '12px 14px', fontFamily: sans, fontSize: '.9rem', color: c.ink, background: '#fff', border: '1px solid rgba(13,31,36,.16)', borderRadius: 11, outline: 'none' }}
                />
              </div>

              <div>
                <label style={{ fontFamily: mono, fontSize: '.57rem', letterSpacing: '.1em', textTransform: 'uppercase', color: c.ink, opacity: 0.5, marginBottom: 6, display: 'block' }}>
                  Gender *
                </label>
                <select
                  name="gender"
                  required
                  value={formData.gender}
                  onChange={handleChange}
                  style={{ width: '100%', padding: '12px 14px', fontFamily: sans, fontSize: '.9rem', color: c.ink, background: '#fff', border: '1px solid rgba(13,31,36,.16)', borderRadius: 11, outline: 'none' }}
                >
                  <option value="">Select...</option>
                  <option value="Male">Male</option>
                  <option value="Female">Female</option>
                  <option value="Other">Other</option>
                </select>
              </div>

              <div>
                <label style={{ fontFamily: mono, fontSize: '.57rem', letterSpacing: '.1em', textTransform: 'uppercase', color: c.ink, opacity: 0.5, marginBottom: 6, display: 'block' }}>
                  Blood Group *
                </label>
                <select
                  name="blood_group"
                  required
                  value={formData.blood_group}
                  onChange={handleChange}
                  style={{ width: '100%', padding: '12px 14px', fontFamily: sans, fontSize: '.9rem', color: c.ink, background: '#fff', border: '1px solid rgba(13,31,36,.16)', borderRadius: 11, outline: 'none' }}
                >
                  <option value="">Select...</option>
                  <option value="A+">A+</option>
                  <option value="A-">A-</option>
                  <option value="B+">B+</option>
                  <option value="B-">B-</option>
                  <option value="AB+">AB+</option>
                  <option value="AB-">AB-</option>
                  <option value="O+">O+</option>
                  <option value="O-">O-</option>
                </select>
              </div>

              <div style={{ gridColumn: '1 / -1' }}>
                <label style={{ fontFamily: mono, fontSize: '.57rem', letterSpacing: '.1em', textTransform: 'uppercase', color: c.ink, opacity: 0.5, marginBottom: 6, display: 'block' }}>
                  Address *
                </label>
                <input
                  type="text"
                  name="address"
                  required
                  value={formData.address}
                  onChange={handleChange}
                  style={{ width: '100%', padding: '12px 14px', fontFamily: sans, fontSize: '.9rem', color: c.ink, background: '#fff', border: '1px solid rgba(13,31,36,.16)', borderRadius: 11, outline: 'none' }}
                />
              </div>
            </div>
          </div>

          {/* Healthcare IDs */}
          <div style={{ marginBottom: 24 }}>
            <h3 style={{ fontFamily: sans, fontSize: '.9rem', fontWeight: 600, color: c.ink, marginBottom: 16 }}>
              Healthcare IDs (Optional)
            </h3>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
              <div>
                <label style={{ fontFamily: mono, fontSize: '.57rem', letterSpacing: '.1em', textTransform: 'uppercase', color: c.ink, opacity: 0.5, marginBottom: 6, display: 'block' }}>
                  MRN
                </label>
                <input
                  type="text"
                  name="mrn"
                  value={formData.mrn}
                  onChange={handleChange}
                  placeholder="Medical Record Number"
                  style={{ width: '100%', padding: '12px 14px', fontFamily: sans, fontSize: '.9rem', color: c.ink, background: '#fff', border: '1px solid rgba(13,31,36,.16)', borderRadius: 11, outline: 'none' }}
                />
              </div>

              <div>
                <label style={{ fontFamily: mono, fontSize: '.57rem', letterSpacing: '.1em', textTransform: 'uppercase', color: c.ink, opacity: 0.5, marginBottom: 6, display: 'block' }}>
                  ABHA ID
                </label>
                <input
                  type="text"
                  name="abha_id"
                  value={formData.abha_id}
                  onChange={handleChange}
                  placeholder="Ayushman Bharat Health Account"
                  style={{ width: '100%', padding: '12px 14px', fontFamily: sans, fontSize: '.9rem', color: c.ink, background: '#fff', border: '1px solid rgba(13,31,36,.16)', borderRadius: 11, outline: 'none' }}
                />
              </div>

              <div style={{ gridColumn: '1 / -1' }}>
                <label style={{ fontFamily: mono, fontSize: '.57rem', letterSpacing: '.1em', textTransform: 'uppercase', color: c.ink, opacity: 0.5, marginBottom: 6, display: 'block' }}>
                  ABHA Address
                </label>
                <input
                  type="text"
                  name="abha_address"
                  value={formData.abha_address}
                  onChange={handleChange}
                  style={{ width: '100%', padding: '12px 14px', fontFamily: sans, fontSize: '.9rem', color: c.ink, background: '#fff', border: '1px solid rgba(13,31,36,.16)', borderRadius: 11, outline: 'none' }}
                />
              </div>
            </div>
          </div>

          {/* Medical Information */}
          <div style={{ marginBottom: 24 }}>
            <h3 style={{ fontFamily: sans, fontSize: '.9rem', fontWeight: 600, color: c.ink, marginBottom: 4 }}>
              Medical Information
            </h3>
            <p style={{ fontFamily: mono, fontSize: '.55rem', opacity: 0.4, marginBottom: 16 }}>
              * All fields are mandatory (enter "NA" if not applicable)
            </p>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <div>
                <label style={{ fontFamily: mono, fontSize: '.57rem', letterSpacing: '.1em', textTransform: 'uppercase', color: c.ink, opacity: 0.5, marginBottom: 6, display: 'block' }}>
                  Allergies *
                </label>
                <textarea
                  name="allergies"
                  required
                  value={formData.allergies}
                  onChange={handleChange}
                  rows={2}
                  placeholder="List any allergies or enter NA"
                  style={{ width: '100%', padding: '12px 14px', fontFamily: sans, fontSize: '.9rem', color: c.ink, background: '#fff', border: '1px solid rgba(13,31,36,.16)', borderRadius: 11, outline: 'none', resize: 'vertical' }}
                />
              </div>

              <div>
                <label style={{ fontFamily: mono, fontSize: '.57rem', letterSpacing: '.1em', textTransform: 'uppercase', color: c.ink, opacity: 0.5, marginBottom: 6, display: 'block' }}>
                  Chronic Conditions *
                </label>
                <textarea
                  name="chronic_conditions"
                  required
                  value={formData.chronic_conditions}
                  onChange={handleChange}
                  rows={2}
                  placeholder="List any chronic conditions or enter NA"
                  style={{ width: '100%', padding: '12px 14px', fontFamily: sans, fontSize: '.9rem', color: c.ink, background: '#fff', border: '1px solid rgba(13,31,36,.16)', borderRadius: 11, outline: 'none', resize: 'vertical' }}
                />
              </div>

              <div>
                <label style={{ fontFamily: mono, fontSize: '.57rem', letterSpacing: '.1em', textTransform: 'uppercase', color: c.ink, opacity: 0.5, marginBottom: 6, display: 'block' }}>
                  Current Medications *
                </label>
                <textarea
                  name="current_medications"
                  required
                  value={formData.current_medications}
                  onChange={handleChange}
                  rows={2}
                  placeholder="List current medications or enter NA"
                  style={{ width: '100%', padding: '12px 14px', fontFamily: sans, fontSize: '.9rem', color: c.ink, background: '#fff', border: '1px solid rgba(13,31,36,.16)', borderRadius: 11, outline: 'none', resize: 'vertical' }}
                />
              </div>
            </div>
          </div>

          {/* Emergency Contact */}
          <div style={{ marginBottom: 24 }}>
            <h3 style={{ fontFamily: sans, fontSize: '.9rem', fontWeight: 600, color: c.ink, marginBottom: 4 }}>
              Emergency Contact
            </h3>
            <p style={{ fontFamily: mono, fontSize: '.55rem', opacity: 0.4, marginBottom: 16 }}>
              * All fields are mandatory
            </p>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
              <div>
                <label style={{ fontFamily: mono, fontSize: '.57rem', letterSpacing: '.1em', textTransform: 'uppercase', color: c.ink, opacity: 0.5, marginBottom: 6, display: 'block' }}>
                  Name *
                </label>
                <input
                  type="text"
                  name="emergency_contact_name"
                  required
                  value={formData.emergency_contact_name}
                  onChange={handleChange}
                  style={{ width: '100%', padding: '12px 14px', fontFamily: sans, fontSize: '.9rem', color: c.ink, background: '#fff', border: '1px solid rgba(13,31,36,.16)', borderRadius: 11, outline: 'none' }}
                />
              </div>

              <div>
                <label style={{ fontFamily: mono, fontSize: '.57rem', letterSpacing: '.1em', textTransform: 'uppercase', color: c.ink, opacity: 0.5, marginBottom: 6, display: 'block' }}>
                  Relationship *
                </label>
                <input
                  type="text"
                  name="emergency_contact_relationship"
                  required
                  value={formData.emergency_contact_relationship}
                  onChange={handleChange}
                  placeholder="e.g. Spouse, Parent"
                  style={{ width: '100%', padding: '12px 14px', fontFamily: sans, fontSize: '.9rem', color: c.ink, background: '#fff', border: '1px solid rgba(13,31,36,.16)', borderRadius: 11, outline: 'none' }}
                />
              </div>

              <div style={{ gridColumn: '1 / -1' }}>
                <label style={{ fontFamily: mono, fontSize: '.57rem', letterSpacing: '.1em', textTransform: 'uppercase', color: c.ink, opacity: 0.5, marginBottom: 6, display: 'block' }}>
                  Phone *
                </label>
                <input
                  type="tel"
                  name="emergency_contact_phone"
                  required
                  value={formData.emergency_contact_phone}
                  onChange={handleChange}
                  style={{ width: '100%', padding: '12px 14px', fontFamily: sans, fontSize: '.9rem', color: c.ink, background: '#fff', border: '1px solid rgba(13,31,36,.16)', borderRadius: 11, outline: 'none' }}
                />
              </div>
            </div>
          </div>

          {error && (
            <div style={{ fontFamily: mono, fontSize: '.6rem', color: c.rose, marginBottom: 12, textAlign: 'center' }}>
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            style={{
              width: '100%',
              background: loading ? 'rgba(13,31,36,.12)' : c.jade,
              color: loading ? 'rgba(13,31,36,.35)' : '#fff',
              border: 'none',
              fontFamily: sans,
              fontWeight: 600,
              fontSize: '.9rem',
              padding: 14,
              borderRadius: 13,
              cursor: loading ? 'default' : 'pointer',
              transition: 'background .2s',
            }}
          >
            {loading
              ? (isEditMode ? 'Updating profile...' : 'Creating profile...')
              : (isEditMode ? 'Update Profile' : 'Create Profile')
            }
          </button>
        </form>
      </div>

      <p style={{ fontFamily: mono, fontSize: '.55rem', color: 'rgba(255,255,255,.3)', marginTop: 24, textAlign: 'center' }}>
        Your health information is secure and encrypted
      </p>
    </div>
  )
}

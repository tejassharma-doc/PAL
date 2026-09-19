'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { getUserProfile } from '../../lib/api-auth'

export default function ProfilePage() {
  const router = useRouter()
  const [loading, setLoading] = useState(true)
  const [profile, setProfile] = useState<any>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    loadProfile()
  }, [])

  async function loadProfile() {
    try {
      const data = await getUserProfile()
      setProfile(data)
    } catch (err: any) {
      setError(err.message || 'Failed to load profile')
      if (err.message?.includes('401')) {
        router.push('/login')
      }
    } finally {
      setLoading(false)
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
          <p className="text-gray-600">Loading profile...</p>
        </div>
      </div>
    )
  }

  if (error || !profile?.patient) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
        <div className="max-w-md w-full bg-white rounded-lg shadow p-6">
          <h2 className="text-xl font-semibold text-gray-900 mb-4">Profile Not Found</h2>
          <p className="text-gray-600 mb-6">
            {error || 'No profile found. Please create your profile first.'}
          </p>
          <button
            onClick={() => router.push('/profile/create')}
            className="w-full bg-blue-600 text-white py-2 px-4 rounded-lg hover:bg-blue-700"
          >
            Create Profile
          </button>
        </div>
      </div>
    )
  }

  const { user, patient, credits } = profile

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-white border-b">
        <div className="max-w-4xl mx-auto px-4 py-4 flex items-center justify-between">
          <button
            onClick={() => router.push('/')}
            className="text-gray-600 hover:text-gray-900"
          >
            ← Back
          </button>
          <h1 className="text-xl font-semibold text-gray-900">My Profile</h1>
          <button
            onClick={() => router.push('/profile/edit')}
            className="text-blue-600 hover:text-blue-700 font-medium"
          >
            Edit
          </button>
        </div>
      </div>

      {/* Profile Content */}
      <div className="max-w-4xl mx-auto px-4 py-8">
        {/* Profile Header */}
        <div className="bg-white rounded-lg shadow-sm p-6 mb-6">
          <div className="flex items-center gap-6">
            {/* Avatar */}
            <div className="w-24 h-24 rounded-full bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center text-white text-3xl font-bold">
              {patient.full_name?.charAt(0).toUpperCase() || 'P'}
            </div>

            {/* Basic Info */}
            <div className="flex-1">
              <h2 className="text-2xl font-bold text-gray-900 mb-1">
                {patient.full_name || 'No name set'}
              </h2>
              <p className="text-gray-600 mb-2">
                {patient.email || user.email}
              </p>
              {patient.phone && (
                <p className="text-gray-600">📱 {patient.phone}</p>
              )}
            </div>

            {/* Credits */}
            <div className="bg-blue-50 rounded-lg p-4 text-center">
              <div className="text-3xl font-bold text-blue-600">
                {credits.balance}
              </div>
              <div className="text-sm text-gray-600">Credits</div>
            </div>
          </div>
        </div>

        {/* Personal Information */}
        <div className="bg-white rounded-lg shadow-sm p-6 mb-6">
          <h3 className="text-lg font-semibold text-gray-900 mb-4">Personal Information</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <InfoField label="MRN" value={patient.mrn} />
            <InfoField label="ABHA ID" value={patient.abha_id} />
            <InfoField label="ABHA Address" value={patient.abha_address} />
            <InfoField label="Date of Birth" value={patient.date_of_birth} />
            <InfoField label="Gender" value={patient.gender} />
            <InfoField label="Blood Group" value={patient.blood_group} />
            <InfoField label="Phone" value={patient.phone} />
            <InfoField label="Email" value={patient.email} />
          </div>
        </div>

        {/* Address */}
        {patient.address && (
          <div className="bg-white rounded-lg shadow-sm p-6 mb-6">
            <h3 className="text-lg font-semibold text-gray-900 mb-4">Address</h3>
            <p className="text-gray-700">{patient.address}</p>
          </div>
        )}

        {/* Medical Information */}
        <div className="bg-white rounded-lg shadow-sm p-6 mb-6">
          <h3 className="text-lg font-semibold text-gray-900 mb-4">Medical Information</h3>
          <div className="space-y-4">
            <MedicalField
              label="Allergies"
              value={patient.allergies}
              empty="No known allergies"
            />
            <MedicalField
              label="Chronic Conditions"
              value={patient.chronic_conditions}
              empty="No chronic conditions"
            />
            <MedicalField
              label="Current Medications"
              value={patient.current_medications}
              empty="No current medications"
            />
          </div>
        </div>

        {/* Emergency Contact */}
        {patient.emergency_contact && (
          <div className="bg-white rounded-lg shadow-sm p-6 mb-6">
            <h3 className="text-lg font-semibold text-gray-900 mb-4">Emergency Contact</h3>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <InfoField
                label="Name"
                value={patient.emergency_contact.name}
              />
              <InfoField
                label="Relationship"
                value={patient.emergency_contact.relationship}
              />
              <InfoField
                label="Phone"
                value={patient.emergency_contact.phone}
              />
            </div>
          </div>
        )}

        {/* Account Information */}
        <div className="bg-white rounded-lg shadow-sm p-6">
          <h3 className="text-lg font-semibold text-gray-900 mb-4">Account Information</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <InfoField label="Username" value={user.username} />
            <InfoField label="Account Status" value={user.is_active ? 'Active' : 'Inactive'} />
            <InfoField
              label="Member Since"
              value={
                user.created_at
                  ? new Date(user.created_at).toLocaleDateString()
                  : 'N/A'
              }
            />
            <InfoField label="Patient ID" value={patient.id} />
          </div>
        </div>

        {/* Credits Info */}
        <div className="bg-blue-50 rounded-lg p-6 mt-6">
          <h3 className="text-lg font-semibold text-gray-900 mb-4">Credits Summary</h3>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <div className="text-sm text-gray-600">Current Balance</div>
              <div className="text-2xl font-bold text-blue-600">{credits.balance}</div>
            </div>
            <div>
              <div className="text-sm text-gray-600">Total Purchased</div>
              <div className="text-2xl font-bold text-gray-900">{credits.total_purchased}</div>
            </div>
            <div>
              <div className="text-sm text-gray-600">Total Used</div>
              <div className="text-2xl font-bold text-gray-900">{credits.total_used}</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

function InfoField({ label, value }: { label: string; value?: string | null }) {
  return (
    <div>
      <div className="text-sm text-gray-600 mb-1">{label}</div>
      <div className="text-gray-900 font-medium">
        {value || <span className="text-gray-400">Not set</span>}
      </div>
    </div>
  )
}

function MedicalField({
  label,
  value,
  empty,
}: {
  label: string
  value?: string | null
  empty: string
}) {
  return (
    <div>
      <div className="text-sm font-medium text-gray-700 mb-2">{label}</div>
      <div className="text-gray-900">
        {value ? (
          <div className="bg-gray-50 rounded p-3">{value}</div>
        ) : (
          <div className="text-gray-400 italic">{empty}</div>
        )}
      </div>
    </div>
  )
}

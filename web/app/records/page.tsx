'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'

interface Prescription {
  id: string
  created_at: string
  items: Array<{
    name: string
    generic_name: string
    dosage: string
    frequency: string
    duration: string
    quantity: string
    instructions: string
    reason: string
    type: string
  }>
  refillable: boolean
  refills_remaining: number
}

interface LabTest {
  id: string
  report_name: string
  test_category: string
  ordered_date: string
  result_date: string | null
  status: string
  results: any
  has_abnormal_values: boolean
  interpretation: string | null
}

interface ClinicalOutput {
  id: string
  soap_note: string
  management_plan: string
  patient_summary: string
  created_at: string
}

export default function RecordsPage() {
  const router = useRouter()
  const [loading, setLoading] = useState(true)
  const [prescription, setPrescription] = useState<Prescription | null>(null)
  const [labTests, setLabTests] = useState<LabTest[]>([])
  const [clinicalOutput, setClinicalOutput] = useState<ClinicalOutput | null>(null)
  const [expandedSection, setExpandedSection] = useState<string | null>(null)

  useEffect(() => {
    loadRecords()
  }, [])

  async function loadRecords() {
    try {
      const patientId = localStorage.getItem('pal_patient_id')
      const token = localStorage.getItem('pal_token')

      if (!patientId || !token) {
        router.push('/login')
        return
      }

      const headers = { Authorization: `Bearer ${token}` }

      // Load prescriptions
      const prescriptionRes = await fetch(`/api/prescriptions/patient/${patientId}/latest`, { headers })
      if (prescriptionRes.ok) {
        const prescriptionData = await prescriptionRes.json()
        setPrescription(prescriptionData.prescription)
        setClinicalOutput(prescriptionData.clinical_output)
      }

      // Load lab tests
      const labRes = await fetch(`/api/lab-tests/patient/${patientId}`, { headers })
      if (labRes.ok) {
        const labData = await labRes.json()
        setLabTests(labData.lab_tests || [])
      }
    } catch (err) {
      console.error('Failed to load records:', err)
    } finally {
      setLoading(false)
    }
  }

  const toggleSection = (section: string) => {
    setExpandedSection(expandedSection === section ? null : section)
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
          <p className="text-gray-600">Loading records...</p>
        </div>
      </div>
    )
  }

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
          <h1 className="text-xl font-semibold text-gray-900">Medical Records</h1>
          <div className="w-16"></div>
        </div>
      </div>

      {/* Content */}
      <div className="max-w-4xl mx-auto px-4 py-8 space-y-6">

        {/* Latest Prescription */}
        {prescription && (
          <div className="bg-white rounded-lg shadow-sm border border-gray-200">
            <div
              onClick={() => toggleSection('prescription')}
              className="p-6 cursor-pointer hover:bg-gray-50"
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-12 h-12 bg-blue-100 rounded-full flex items-center justify-center">
                    <span className="text-2xl">💊</span>
                  </div>
                  <div>
                    <h2 className="text-lg font-semibold text-gray-900">
                      Latest Prescription
                    </h2>
                    <p className="text-sm text-gray-600">
                      {prescription.items.length} medication{prescription.items.length !== 1 ? 's' : ''} • {new Date(prescription.created_at).toLocaleDateString()}
                    </p>
                  </div>
                </div>
                <span className="text-gray-400">
                  {expandedSection === 'prescription' ? '▼' : '▶'}
                </span>
              </div>
            </div>

            {expandedSection === 'prescription' && (
              <div className="border-t border-gray-200 p-6 bg-gray-50">
                {/* SOAP Notes Section */}
                {clinicalOutput && (
                  <div className="mb-6 p-4 bg-blue-50 border-l-4 border-blue-500 rounded">
                    <h3 className="font-semibold text-gray-900 mb-3 flex items-center gap-2">
                      <span>📋</span> Clinical Notes (SOAP)
                    </h3>
                    <div className="text-sm text-gray-700 whitespace-pre-wrap">
                      {clinicalOutput.soap_note}
                    </div>

                    {clinicalOutput.management_plan && (
                      <div className="mt-4 pt-4 border-t border-blue-200">
                        <h4 className="font-semibold text-gray-900 mb-2">Management Plan:</h4>
                        <p className="text-sm text-gray-700">{clinicalOutput.management_plan}</p>
                      </div>
                    )}
                  </div>
                )}

                {/* Medications */}
                <h3 className="font-semibold text-gray-900 mb-4">Prescribed Medications:</h3>
                <div className="space-y-4">
                  {prescription.items.map((item, idx) => (
                    <div
                      key={idx}
                      className="bg-white border border-gray-200 rounded-lg p-4"
                    >
                      <div className="flex items-start justify-between mb-2">
                        <div>
                          <h4 className="font-semibold text-gray-900 text-lg">
                            {item.name}
                          </h4>
                          <p className="text-sm text-gray-600">{item.generic_name}</p>
                        </div>
                        <span className="px-3 py-1 bg-blue-100 text-blue-800 text-xs font-medium rounded-full">
                          {item.type}
                        </span>
                      </div>

                      <div className="grid grid-cols-2 gap-3 my-3 text-sm">
                        <div>
                          <span className="text-gray-600">Dosage:</span>
                          <span className="ml-2 font-medium text-gray-900">{item.dosage}</span>
                        </div>
                        <div>
                          <span className="text-gray-600">Frequency:</span>
                          <span className="ml-2 font-medium text-gray-900">{item.frequency}</span>
                        </div>
                        <div>
                          <span className="text-gray-600">Duration:</span>
                          <span className="ml-2 font-medium text-gray-900">{item.duration}</span>
                        </div>
                        <div>
                          <span className="text-gray-600">Quantity:</span>
                          <span className="ml-2 font-medium text-gray-900">{item.quantity}</span>
                        </div>
                      </div>

                      <div className="bg-yellow-50 border-l-4 border-yellow-400 p-3 mb-2">
                        <p className="text-sm font-medium text-gray-900 mb-1">Instructions:</p>
                        <p className="text-sm text-gray-700">{item.instructions}</p>
                      </div>

                      <div className="bg-green-50 p-3 rounded">
                        <p className="text-sm font-medium text-gray-900 mb-1">Reason:</p>
                        <p className="text-sm text-gray-700">{item.reason}</p>
                      </div>
                    </div>
                  ))}
                </div>

                {prescription.refillable && (
                  <div className="mt-4 p-3 bg-blue-50 rounded text-sm">
                    <span className="font-medium">Refills:</span> {prescription.refills_remaining} remaining
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* Lab Reports Summary */}
        {labTests.length > 0 && (
          <div className="bg-white rounded-lg shadow-sm border border-gray-200">
            <div
              onClick={() => toggleSection('labs')}
              className="p-6 cursor-pointer hover:bg-gray-50"
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-12 h-12 bg-green-100 rounded-full flex items-center justify-center">
                    <span className="text-2xl">🔬</span>
                  </div>
                  <div>
                    <h2 className="text-lg font-semibold text-gray-900">
                      Lab Reports
                    </h2>
                    <p className="text-sm text-gray-600">
                      {labTests.length} test{labTests.length !== 1 ? 's' : ''} • Latest: {labTests[0]?.result_date || 'Pending'}
                    </p>
                  </div>
                </div>
                <span className="text-gray-400">
                  {expandedSection === 'labs' ? '▼' : '▶'}
                </span>
              </div>
            </div>

            {expandedSection === 'labs' && (
              <div className="border-t border-gray-200 p-6 bg-gray-50 space-y-3">
                {labTests.map((test) => (
                  <div
                    key={test.id}
                    className={`bg-white border rounded-lg p-4 ${
                      test.has_abnormal_values ? 'border-red-300' : 'border-gray-200'
                    }`}
                  >
                    <div className="flex items-start justify-between">
                      <div className="flex-1">
                        <h4 className="font-semibold text-gray-900 flex items-center gap-2">
                          {test.report_name}
                          {test.has_abnormal_values && (
                            <span className="px-2 py-1 text-xs font-medium bg-red-100 text-red-800 rounded">
                              ⚠️ Abnormal
                            </span>
                          )}
                        </h4>
                        <p className="text-sm text-gray-600 mt-1">
                          {test.result_date || 'Pending'} • {test.status}
                        </p>
                        {test.interpretation && (
                          <p className="text-sm text-gray-700 mt-2 bg-blue-50 p-2 rounded">
                            {test.interpretation}
                          </p>
                        )}
                      </div>
                    </div>
                  </div>
                ))}

                <button
                  onClick={() => router.push('/lab-reports')}
                  className="w-full mt-4 bg-blue-600 text-white py-2 px-4 rounded-lg hover:bg-blue-700"
                >
                  View Detailed Lab Reports →
                </button>
              </div>
            )}
          </div>
        )}

        {/* Empty State */}
        {!prescription && labTests.length === 0 && (
          <div className="bg-white rounded-lg shadow-sm p-12 text-center">
            <div className="text-6xl mb-4">📋</div>
            <h2 className="text-xl font-semibold text-gray-900 mb-2">
              No Medical Records Yet
            </h2>
            <p className="text-gray-600">
              Your prescriptions and lab reports will appear here.
            </p>
          </div>
        )}
      </div>
    </div>
  )
}

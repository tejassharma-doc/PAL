'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'

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
  ordered_by: string | null
  lab_name: string | null
}

export default function LabReportsPage() {
  const router = useRouter()
  const [labTests, setLabTests] = useState<LabTest[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [expandedTest, setExpandedTest] = useState<string | null>(null)

  useEffect(() => {
    loadLabReports()
  }, [])

  async function loadLabReports() {
    try {
      const patientId = localStorage.getItem('pal_patient_id')
      const token = localStorage.getItem('pal_token')

      if (!patientId || !token) {
        router.push('/login')
        return
      }

      const response = await fetch(`/api/lab-tests/patient/${patientId}`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      })

      if (!response.ok) {
        throw new Error('Failed to load lab reports')
      }

      const data = await response.json()
      setLabTests(data.lab_tests || [])
    } catch (err: any) {
      setError(err.message || 'Failed to load lab reports')
    } finally {
      setLoading(false)
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
          <p className="text-gray-600">Loading lab reports...</p>
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
        <div className="max-w-md w-full bg-white rounded-lg shadow p-6">
          <h2 className="text-xl font-semibold text-red-600 mb-4">Error</h2>
          <p className="text-gray-600 mb-6">{error}</p>
          <button
            onClick={() => loadLabReports()}
            className="w-full bg-blue-600 text-white py-2 px-4 rounded-lg hover:bg-blue-700"
          >
            Retry
          </button>
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
          <h1 className="text-xl font-semibold text-gray-900">Lab Reports</h1>
          <div className="w-16"></div>
        </div>
      </div>

      {/* Content */}
      <div className="max-w-4xl mx-auto px-4 py-8">
        {labTests.length === 0 ? (
          <div className="bg-white rounded-lg shadow-sm p-12 text-center">
            <div className="text-6xl mb-4">🔬</div>
            <h2 className="text-xl font-semibold text-gray-900 mb-2">
              No Lab Reports
            </h2>
            <p className="text-gray-600">
              You don't have any lab reports yet.
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            {labTests.map((test) => {
              const isExpanded = expandedTest === test.id
              const hasResults = test.results && Object.keys(test.results).length > 0

              return (
                <div
                  key={test.id}
                  className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden"
                >
                  {/* Test Header */}
                  <div
                    onClick={() => hasResults && setExpandedTest(isExpanded ? null : test.id)}
                    className={`p-4 ${hasResults ? 'cursor-pointer hover:bg-gray-50' : ''}`}
                  >
                    <div className="flex items-start justify-between mb-2">
                      <div className="flex-1">
                        <h3 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
                          {test.report_name}
                          {test.has_abnormal_values && (
                            <span className="px-2 py-1 text-xs font-medium bg-red-100 text-red-800 rounded">
                              ⚠️ Abnormal
                            </span>
                          )}
                        </h3>
                        <p className="text-sm text-gray-600 mt-1">
                          {test.lab_name || 'Laboratory'}
                        </p>
                      </div>
                      <div className="text-right">
                        <div className={`px-3 py-1 text-xs font-medium rounded-full ${
                          test.status === 'completed'
                            ? 'bg-green-100 text-green-800'
                            : 'bg-yellow-100 text-yellow-800'
                        }`}>
                          {test.status}
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-4 text-sm text-gray-600">
                      <span>📅 Ordered: {test.ordered_date}</span>
                      {test.result_date && (
                        <span>✅ Results: {test.result_date}</span>
                      )}
                      {test.ordered_by && (
                        <span>👨‍⚕️ {test.ordered_by}</span>
                      )}
                    </div>

                    {test.interpretation && !isExpanded && (
                      <p className="mt-3 text-sm text-gray-700 bg-blue-50 p-3 rounded">
                        {test.interpretation}
                      </p>
                    )}

                    {hasResults && (
                      <div className="mt-3 flex items-center gap-2 text-sm text-blue-600 font-medium">
                        <span>{isExpanded ? '▼' : '▶'}</span>
                        <span>{isExpanded ? 'Hide' : 'View'} Detailed Results</span>
                      </div>
                    )}
                  </div>

                  {/* Expanded Results */}
                  {isExpanded && hasResults && (
                    <div className="border-t border-gray-200 p-4 bg-gray-50">
                      {test.interpretation && (
                        <div className="mb-4 p-3 bg-blue-50 border-l-4 border-blue-500 rounded">
                          <h4 className="font-semibold text-sm text-gray-900 mb-1">
                            Interpretation
                          </h4>
                          <p className="text-sm text-gray-700">{test.interpretation}</p>
                        </div>
                      )}

                      <h4 className="font-semibold text-sm text-gray-900 mb-3">
                        Test Results
                      </h4>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                        {Object.entries(test.results).map(([key, value]: [string, any]) => {
                          const isAbnormal = value.abnormal === true
                          return (
                            <div
                              key={key}
                              className={`p-3 rounded border ${
                                isAbnormal
                                  ? 'bg-red-50 border-red-200'
                                  : 'bg-white border-gray-200'
                              }`}
                            >
                              <div className="flex items-start justify-between">
                                <div className="flex-1">
                                  <div className="font-medium text-sm text-gray-900">
                                    {key.replace(/_/g, ' ')}
                                    {isAbnormal && (
                                      <span className="ml-2 text-xs text-red-600">⚠️</span>
                                    )}
                                  </div>
                                  <div className="text-lg font-bold text-gray-900 mt-1">
                                    {value.value} {value.unit}
                                  </div>
                                  {value.range && (
                                    <div className="text-xs text-gray-600 mt-1">
                                      Normal: {value.range}
                                    </div>
                                  )}
                                </div>
                              </div>
                            </div>
                          )
                        })}
                      </div>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}

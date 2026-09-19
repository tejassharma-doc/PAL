'use client'

interface Props {
  onGrant: () => void
}

export function ScopeConsentBanner({ onGrant }: Props) {
  return (
    <div className="w-full bg-jade/10 border border-jade/30 rounded-xl p-4 flex items-center justify-between gap-4">
      <div className="space-y-0.5">
        <p className="text-jade text-sm font-medium">Use your records for this session?</p>
        <p className="text-surface/50 text-xs">Personalises answers using your health data. Session only — ends when you close this conversation.</p>
      </div>
      <button
        onClick={onGrant}
        className="px-4 py-2 bg-jade text-white text-sm rounded-lg flex-shrink-0 hover:bg-jade-dark transition-colors"
      >
        Allow this session
      </button>
    </div>
  )
}

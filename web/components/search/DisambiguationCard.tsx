'use client'

interface Props {
  question: string
  onGeneric: () => void
  onPersonal: () => void
}

export function DisambiguationCard({ question, onGeneric, onPersonal }: Props) {
  return (
    <div className="w-full bg-ground-light rounded-2xl p-6 space-y-4 border border-surface/15">
      <p className="font-serif text-surface text-lg">{question}</p>
      <div className="flex flex-col sm:flex-row gap-3">
        <button
          onClick={onGeneric}
          className="flex-1 py-3 border border-surface/20 text-surface/70 rounded-xl hover:border-surface/40 transition-colors text-sm"
        >
          General information — don&apos;t use my records
        </button>
        <button
          onClick={onPersonal}
          className="flex-1 py-3 bg-jade text-white rounded-xl hover:bg-jade-dark transition-colors text-sm font-medium"
        >
          Make it personal — use my records for this session
        </button>
      </div>
      <p className="text-surface/30 text-xs">
        Record access is session-scoped by default. You can revoke it at any time.
      </p>
    </div>
  )
}

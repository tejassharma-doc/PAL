'use client'

interface Citation {
  title: string
  source: string
  url?: string
}

interface PendingAction {
  type: string
  description: string
  confirm_token_required: boolean
}

interface AnswerResult {
  answer: {
    answer_text: string
    evidence_classes: Record<string, string>
    citations: Citation[]
    pending_actions: PendingAction[]
    provenance_summary: string
    clinical_disagreement?: string
  }
  scope: string
  agents_used: string[]
  consent_basis?: string
}

interface Props {
  result: AnswerResult
  onSecondOpinion: () => void
}

const AGENT_LABELS: Record<string, string> = {
  records: 'Your Records',
  medication: 'Medications',
  appointment: 'Appointments',
  diet: 'Diet & Nutrition',
  evidence: 'Medical Literature',
}

export function AnswerCard({ result, onSecondOpinion }: Props) {
  const { answer, scope, agents_used } = result

  return (
    <div className="w-full space-y-4">
      {/* Answer text */}
      <div className="bg-ground-light rounded-2xl p-6 space-y-4">
        <p className="font-serif text-surface text-lg leading-relaxed">
          {answer.answer_text}
        </p>

        {/* Clinical disagreement warning */}
        {answer.clinical_disagreement && (
          <div className="border border-rose/40 rounded-xl p-4 space-y-1">
            <p className="text-rose text-sm font-medium">Note: conflicting information</p>
            <p className="text-surface/70 text-sm">{answer.clinical_disagreement}</p>
            <p className="text-surface/50 text-xs">We recommend discussing this with your clinician.</p>
          </div>
        )}

        {/* Pending actions (confirm-token gated) */}
        {answer.pending_actions?.length > 0 && (
          <div className="space-y-2">
            {answer.pending_actions.map((action, i) => (
              <div key={i} className="bg-jade/10 border border-jade/30 rounded-xl p-4 flex items-center justify-between gap-4">
                <div>
                  <p className="text-jade text-sm font-medium capitalize">{action.type}</p>
                  <p className="text-surface/70 text-sm">{action.description}</p>
                </div>
                <button
                  className="px-4 py-2 bg-jade text-white text-sm rounded-lg font-medium hover:bg-jade-dark transition-colors flex-shrink-0"
                  onClick={() => alert('Confirm token flow — authenticate to proceed.')}
                >
                  Confirm
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Agents used */}
      <div className="flex flex-wrap gap-2">
        {agents_used.map((a) => (
          <span key={a} className="font-mono text-xs bg-ground-light border border-surface/10 text-jade px-3 py-1 rounded-full">
            {AGENT_LABELS[a] ?? a}
          </span>
        ))}
        {scope === 'personal' && (
          <span className="font-mono text-xs bg-jade/10 border border-jade/30 text-jade px-3 py-1 rounded-full">
            Personalised to your records
          </span>
        )}
      </div>

      {/* Citations */}
      {answer.citations?.length > 0 && (
        <div className="bg-ground-light rounded-xl p-4 space-y-2">
          <p className="text-amber text-xs font-mono uppercase tracking-wider">Sources</p>
          <ul className="space-y-1">
            {answer.citations.map((c, i) => (
              <li key={i} className="text-sm text-surface/60">
                {c.url ? (
                  <a href={c.url} target="_blank" rel="noopener noreferrer" className="hover:text-amber transition-colors underline underline-offset-2">
                    {c.title} — {c.source}
                  </a>
                ) : (
                  <span>{c.title} — {c.source}</span>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Provenance */}
      {answer.provenance_summary && (
        <details className="text-surface/40 text-xs">
          <summary className="cursor-pointer hover:text-surface/60 transition-colors">Why do I think this?</summary>
          <p className="mt-2 pl-4 border-l border-surface/10">{answer.provenance_summary}</p>
        </details>
      )}

      {/* Second opinion */}
      <div className="flex justify-end">
        <button
          onClick={onSecondOpinion}
          className="text-surface/40 text-xs hover:text-surface/70 transition-colors underline underline-offset-2"
        >
          This doesn&apos;t seem right — get a second look
        </button>
      </div>
    </div>
  )
}

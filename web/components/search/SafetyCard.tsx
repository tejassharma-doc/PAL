'use client'

interface Props {
  data: { category: string; message: string; action: string }
}

export function SafetyCard({ data }: Props) {
  const isEmergency = data.category === 'emergency'

  return (
    <div className={`w-full rounded-2xl p-6 space-y-4 border-2 ${isEmergency ? 'bg-rose/10 border-rose/60' : 'bg-amber/10 border-amber/40'}`}>
      <div className="flex items-start gap-3">
        <span className="text-2xl" aria-hidden>{isEmergency ? '🚨' : '💙'}</span>
        <div className="space-y-2">
          <p className={`font-semibold text-lg ${isEmergency ? 'text-rose' : 'text-amber'}`}>
            {isEmergency ? 'This may be a medical emergency' : 'You matter — help is available'}
          </p>
          <p className="text-surface/80 leading-relaxed font-serif">{data.message}</p>
        </div>
      </div>

      {isEmergency && (
        <a
          href="tel:112"
          className="block w-full text-center py-3 bg-rose text-white rounded-xl font-semibold hover:bg-rose-light transition-colors"
          aria-label="Call emergency services"
        >
          Call 112 (Emergency)
        </a>
      )}
    </div>
  )
}

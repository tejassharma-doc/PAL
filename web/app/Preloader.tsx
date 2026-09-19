'use client'

import { useEffect } from 'react'
import { usePathname } from 'next/navigation'

// Set NEXT_PUBLIC_DISABLE_WORKERS=true in .env.development.local to skip all
// ML model preloading during development (saves RAM/CPU on dev machines).
const WORKERS_DISABLED = process.env.NEXT_PUBLIC_DISABLE_WORKERS === 'true'

// Pages where we never want to burn RAM loading models
const SKIP_ROUTES = new Set(['/onboarding', '/login'])

export default function Preloader() {
  const pathname = usePathname()

  useEffect(() => {
    if (WORKERS_DISABLED) return
    if (SKIP_ROUTES.has(pathname)) return

    // Capability detection runs first; model selection follows from the result.
    // Workers are staggered so they don't all thrash RAM/CPU at once.
    import('../lib/deviceCapabilities').then(({ getOrDetectCapabilities }) =>
      getOrDetectCapabilities()
    ).then((caps) => {
      // Mobile: no ONNX models at all — Web Speech API + Claude Haiku handle everything.
      // Classifier is null on mobile (cloud routing); STT uses Web Speech API (zero RAM).
      if (caps.classifier_model) {
        import('../lib/classifier').then(({ preloadClassifier }) =>
          preloadClassifier(caps.classifier_model!)
        )
      }

      // STT — skip on mobile (Web Speech API used instead); 2s delay on desktop
      if (!caps.use_web_speech) {
        setTimeout(() => {
          import('../lib/stt').then(({ preloadSTT }) => preloadSTT(caps.stt_model))
        }, 2_000)
      }

      // EHR summary — high-end desktop only (8GB+ RAM + WebGPU), 5s delay
      if (caps.ehr_summary_model) {
        setTimeout(() => {
          import('../lib/ehrSummary').then(({ preloadEHRSummary }) => preloadEHRSummary())
        }, 5_000)
      }

      // Multilingual e5-small (117 MB) — mid/high desktop tier, 8s delay
      if (!caps.is_mobile && caps.tier !== 'low') {
        setTimeout(() => {
          import('../lib/multilingualClassifier').then(({ preloadMultilingualClassifier }) =>
            preloadMultilingualClassifier()
          )
        }, 8_000)
      }
    }).catch(() => {
      // Detection failed — skip everything on mobile, safe defaults on desktop
      const isMobile = typeof navigator !== 'undefined' &&
        /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent)
      if (isMobile) return
      import('../lib/classifier').then(({ preloadClassifier }) => preloadClassifier())
      setTimeout(() => {
        import('../lib/stt').then(({ preloadSTT }) => preloadSTT())
      }, 3_000)
    })
  }, [pathname])

  return null
}

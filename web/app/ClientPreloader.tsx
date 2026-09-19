'use client'

import dynamic from 'next/dynamic'

// ssr: false must live in a client component (not in layout.tsx which is a Server Component).
// Keeps the entire worker dependency graph (transformers.js WASM refs) out of the server bundle.
const Preloader = dynamic(() => import('./Preloader'), { ssr: false })

export default function ClientPreloader() {
  return <Preloader />
}

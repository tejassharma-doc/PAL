/**
 * Device capability detection for PAL on-device model selection.
 *
 * WHY THIS EXISTS:
 *   Running SmolLM2-1.7B or whisper-small on a 3GB-RAM Android causes thermal
 *   throttling within a few turns — the phone gets hot and the app slows to a crawl.
 *   This module probes the device once at startup, picks the right model tier,
 *   and caches the result so we never re-probe unnecessarily.
 *
 * TIER SUMMARY:
 *   low  (<4GB RAM or no WebGPU) — whisper-tiny (39MB), no EHR summary
 *   mid  (4–7GB RAM, WebGPU)    — whisper-small (244MB), no EHR summary
 *   high (8GB+ RAM, WebGPU)     — whisper-small, SmolLM2-1.7B EHR summary
 *
 * REACT NATIVE NOTE (Phase 4):
 *   This file is web-only (navigator APIs). The React Native equivalent is
 *   lib/deviceCapabilities.native.ts and uses react-native-device-info
 *   (totalMemory, maxMemory) + the ExecuTorch model-tier table from
 *   PAL_MOBILE_MODEL_RUNTIME_SPEC.md. The exported interface is identical
 *   so the Preloader can use the same import.
 */

export type DeviceTier = 'low' | 'mid' | 'high'

export interface DeviceCapabilities {
  tier: DeviceTier
  /** RAM in GB (from navigator.deviceMemory, or estimated from cores) */
  ram_gb: number
  cpu_cores: number
  has_webgpu: boolean
  /** Max WebGPU buffer in MB — useful VRAM proxy. 0 when WebGPU absent. */
  webgpu_max_buffer_mb: number
  /** True when running in a mobile browser (iOS Safari, Android Chrome, Capacitor WebView) */
  is_mobile: boolean
  /** True → use Web Speech API for STT instead of Whisper worker (zero RAM, built-in) */
  use_web_speech: boolean
  /** null on mobile — routing goes to Claude Haiku instead of on-device model */
  classifier_model: string | null
  stt_model: string
  /** null = EHR summary disabled (device too constrained) */
  ehr_summary_model: string | null
  detected_at: number
}

const STORAGE_KEY = 'pal_device_caps_v2'
// Re-probe after 7 days (catches OS updates, new browser GPU drivers)
const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000

// Canonical model IDs — env vars take precedence for classifier + STT
// (operator may pin models for compliance / offline-only deployments).
const CLASSIFIER_MODEL = 'HuggingFaceTB/SmolLM2-360M-Instruct'
const STT_TINY  = 'onnx-community/whisper-tiny'   //  39 MB — fast, all languages
const STT_SMALL = 'onnx-community/whisper-small'  // 244 MB — better Indian language accuracy
const EHR_1B7   = 'HuggingFaceTB/SmolLM2-1.7B-Instruct'

// ── Mobile browser detection ──────────────────────────────────────────────────

function isMobileBrowser(): boolean {
  if (typeof navigator === 'undefined') return false
  return /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent)
}

// ── WebGPU probe ─────────────────────────────────────────────────────────────

async function probeWebGPU(): Promise<{ available: boolean; maxBufferMb: number }> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const gpu = (navigator as any).gpu
  if (!gpu) return { available: false, maxBufferMb: 0 }
  try {
    const adapter = await gpu.requestAdapter()
    if (!adapter) return { available: false, maxBufferMb: 0 }
    const maxBufferMb = Math.round((adapter.limits?.maxBufferSize ?? 0) / (1024 * 1024))
    return { available: true, maxBufferMb }
  } catch {
    return { available: false, maxBufferMb: 0 }
  }
}

// ── RAM estimate ─────────────────────────────────────────────────────────────

function estimateRam(): number {
  // navigator.deviceMemory: Chrome/Edge, Android Chrome. Safari/Firefox return undefined.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mem = (navigator as any).deviceMemory as number | undefined
  if (mem !== undefined) return mem

  // Fallback heuristic: CPU cores as a rough RAM proxy.
  // 4 cores → likely 4 GB, 8 cores → likely 8 GB (conservative).
  const cores = navigator.hardwareConcurrency ?? 2
  if (cores >= 8) return 6
  if (cores >= 4) return 4
  return 2
}

// ── Tier classification ───────────────────────────────────────────────────────

function classifyTier(
  ram: number,
  hasWebGPU: boolean,
  maxBufferMb: number,
): DeviceTier {
  // High-end: enough RAM + WebGPU with at least 1 GB addressable buffer
  // (maxBufferSize ≥ 1 GB is a reliable indicator of a desktop/flagship GPU)
  if (ram >= 8 && hasWebGPU && maxBufferMb >= 1024) return 'high'

  // Mid: 4–7 GB with WebGPU (mid-range phones, MacBook Air M1, low-spec laptops)
  if (ram >= 4 && hasWebGPU) return 'mid'

  // Low: everything else — old phones, no WebGPU, RAM < 4 GB
  return 'low'
}

// ── Model selection ───────────────────────────────────────────────────────────

function selectModels(tier: DeviceTier, isMobile: boolean): Pick<
  DeviceCapabilities,
  'classifier_model' | 'stt_model' | 'ehr_summary_model' | 'use_web_speech'
> {
  // Mobile: zero ONNX models — Web Speech API handles STT, Claude Haiku handles routing.
  // Even flagship phones (6-8 GB) benefit from this: Web Speech is free, instant, and
  // natively multilingual; Whisper-small (244 MB) in a WebView eats battery and RAM.
  if (isMobile) {
    return {
      classifier_model: null,
      stt_model: STT_TINY,       // unused when use_web_speech=true; kept as emergency fallback
      ehr_summary_model: null,
      use_web_speech: true,
    }
  }

  // Env vars let operators pin a specific model (compliance, offline-only deploys).
  const envClassifier = process.env.NEXT_PUBLIC_CLASSIFIER_MODEL
  const envSTT = process.env.NEXT_PUBLIC_STT_MODEL
  const envEHR = process.env.NEXT_PUBLIC_EHR_SUMMARY_MODEL

  const classifier = envClassifier || CLASSIFIER_MODEL

  switch (tier) {
    case 'high':
      return {
        classifier_model: classifier,
        stt_model: envSTT || STT_SMALL,
        ehr_summary_model: envEHR || EHR_1B7,
        use_web_speech: false,
      }
    case 'mid':
      return {
        classifier_model: classifier,
        stt_model: envSTT || STT_SMALL,
        ehr_summary_model: null,
        use_web_speech: false,
      }
    case 'low':
    default:
      return {
        classifier_model: classifier,
        stt_model: STT_TINY,
        ehr_summary_model: null,
        use_web_speech: false,
      }
  }
}

// ── Detection ─────────────────────────────────────────────────────────────────

export async function detectDeviceCapabilities(): Promise<DeviceCapabilities> {
  const isMobile = isMobileBrowser()
  const ram = estimateRam()
  const cores = navigator.hardwareConcurrency ?? 2
  const { available: hasWebGPU, maxBufferMb } = await probeWebGPU()
  const tier = classifyTier(ram, hasWebGPU, maxBufferMb)
  const models = selectModels(tier, isMobile)

  return {
    tier,
    ram_gb: ram,
    cpu_cores: cores,
    has_webgpu: hasWebGPU,
    webgpu_max_buffer_mb: maxBufferMb,
    is_mobile: isMobile,
    ...models,
    detected_at: Date.now(),
  }
}

// ── Cache (localStorage) ──────────────────────────────────────────────────────

export function getCachedCapabilities(): DeviceCapabilities | null {
  if (typeof localStorage === 'undefined') return null
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const caps: DeviceCapabilities = JSON.parse(raw)
    if (Date.now() - caps.detected_at > CACHE_TTL_MS) return null
    return caps
  } catch {
    return null
  }
}

function saveCachedCapabilities(caps: DeviceCapabilities): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(caps))
  } catch {
    // localStorage unavailable (private browsing quota, etc.) — fine, just re-detect next time
  }
}

/**
 * Return cached capabilities if fresh; otherwise detect and cache.
 * Safe to call multiple times — detection runs at most once per session.
 */
let _detectPromise: Promise<DeviceCapabilities> | null = null

export function getOrDetectCapabilities(): Promise<DeviceCapabilities> {
  if (typeof window === 'undefined') {
    // SSR — return a safe low-tier default that won't load any model
    return Promise.resolve({
      tier: 'low' as DeviceTier,
      ram_gb: 0,
      cpu_cores: 0,
      has_webgpu: false,
      webgpu_max_buffer_mb: 0,
      is_mobile: false,
      use_web_speech: false,
      classifier_model: CLASSIFIER_MODEL,
      stt_model: STT_TINY,
      ehr_summary_model: null,
      detected_at: 0,
    })
  }

  const cached = getCachedCapabilities()
  if (cached) return Promise.resolve(cached)

  if (_detectPromise) return _detectPromise

  _detectPromise = detectDeviceCapabilities().then((caps) => {
    saveCachedCapabilities(caps)
    _detectPromise = null
    return caps
  })

  return _detectPromise
}

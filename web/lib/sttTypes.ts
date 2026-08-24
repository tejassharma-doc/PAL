// BCP-47 codes for languages Whisper supports that are used in India
export const INDIAN_LANGUAGE_CODES = new Set([
  'hi', // Hindi
  'ta', // Tamil
  'te', // Telugu
  'kn', // Kannada
  'ml', // Malayalam
  'bn', // Bengali / Assamese (same script)
  'mr', // Marathi (Devanagari, same as Hindi)
  'gu', // Gujarati
  'pa', // Punjabi (Gurmukhi)
  'ur', // Urdu (Nastaliq/Arabic script)
  'or', // Odia
  'as', // Assamese
  'ne', // Nepali (Devanagari)
  'si', // Sinhala (Sri Lanka, but handled)
])

export interface TranscriptionResult {
  text: string
  /** BCP-47 code detected from Unicode script ranges, e.g. 'hi', 'ta', 'en' */
  language: string
  /** True when language is in INDIAN_LANGUAGE_CODES */
  is_indian_language: boolean
}

// Worker → main thread
export type STTWorkerToMain =
  | { type: 'progress'; status: 'loading' | 'ready'; progress?: number }
  | { type: 'result'; id: string; text: string; language: string }
  | { type: 'error'; id: string; error: string }

// Main thread → worker
export type STTMainToWorker =
  | {
      type: 'init'
      /** Pre-load this model without transcribing anything. */
      model?: string
    }
  | {
      type: 'transcribe'
      id: string
      audio: Float32Array
      model?: string
    }

/**
 * Detect the dominant script in a string and return a BCP-47 language code.
 * Used as a reliable heuristic after Whisper transcription because Whisper
 * outputs native script (e.g. Devanagari for Hindi, Tamil for Tamil).
 */
export function detectScript(text: string): string {
  const counts: Record<string, number> = {
    hi: 0, ta: 0, te: 0, kn: 0, ml: 0,
    bn: 0, gu: 0, pa: 0, ur: 0, or: 0,
  }
  for (const ch of text) {
    const cp = ch.codePointAt(0) ?? 0
    // Unicode block ranges — one language per block (dominant assignment)
    if (cp >= 0x0900 && cp <= 0x097F) counts.hi++  // Devanagari → Hindi/Marathi/Nepali
    else if (cp >= 0x0980 && cp <= 0x09FF) counts.bn++ // Bengali → Bengali/Assamese
    else if (cp >= 0x0A00 && cp <= 0x0A7F) counts.pa++ // Gurmukhi → Punjabi
    else if (cp >= 0x0A80 && cp <= 0x0AFF) counts.gu++ // Gujarati
    else if (cp >= 0x0B00 && cp <= 0x0B7F) counts.or++ // Odia
    else if (cp >= 0x0B80 && cp <= 0x0BFF) counts.ta++ // Tamil
    else if (cp >= 0x0C00 && cp <= 0x0C7F) counts.te++ // Telugu
    else if (cp >= 0x0C80 && cp <= 0x0CFF) counts.kn++ // Kannada
    else if (cp >= 0x0D00 && cp <= 0x0D7F) counts.ml++ // Malayalam
    else if (cp >= 0x0600 && cp <= 0x06FF) counts.ur++ // Arabic/Nastaliq → Urdu
  }

  let dominant = 'en'
  let max = 0
  for (const [lang, count] of Object.entries(counts)) {
    if (count > max) { max = count; dominant = lang }
  }
  // Any non-Latin character detected → return that language
  // Zero non-Latin → Latin script → English (or transliterated Indian language)
  return dominant
}

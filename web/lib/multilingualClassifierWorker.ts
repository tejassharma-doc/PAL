/**
 * Multilingual intent + complexity classifier — runs in a Web Worker.
 * Implements the Fugu-style on-device router: one forward pass, no text generation.
 *
 * Model: Xenova/multilingual-e5-small (117 MB, ONNX, 100+ languages).
 * WebGPU → WASM fallback (both supported).
 *
 * HOW IT WORKS:
 *   1. At init, embed representative phrases for each agent class AND each complexity
 *      level → average into one centroid vector per class.
 *   2. For each query: embed once → cosine similarity vs ALL centroids (agents + complexity)
 *      → pick the top agent + complexity bucket from scores alone.
 *   3. Scope (personal vs generic) is determined by keyword matching (no model call needed).
 *
 * This is the Fugu fast variant: ONE forward pass yields intent + complexity + scope.
 * No text is generated — the routing decision comes purely from similarity scores.
 *
 * WHY NOT ZERO-SHOT NLI:
 *   mDeBERTa NLI runs 5 separate forward passes (one per class label).
 *   e5-small runs one forward pass + dot products → 5x faster at inference
 *   and more accurate for Indian language scripts where NLI transfer is weak.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const wSelf = self as any

import { pipeline, type FeatureExtractionPipeline } from '@huggingface/transformers'
import type { MLWorkerToMain, MLMainToWorker, MLAgentName, MLClassificationResult, MLComplexity } from './multilingualClassifierTypes'

const MODEL = 'Xenova/multilingual-e5-small'

// Representative phrases per agent class — English + key Indian language paraphrases.
// More phrases per class = more robust centroid; keep balanced across classes.
const CLASS_PHRASES: Record<MLAgentName, string[]> = {
  appointment: [
    'book a medical appointment', 'schedule a doctor visit', 'see a doctor',
    'clinic appointment booking', 'hospital appointment', 'consultation schedule',
    // Hindi
    'अपॉइंटमेंट बुक करना', 'डॉक्टर से मिलना', 'अस्पताल अपॉइंटमेंट',
    // Tamil
    'சந்திப்பு பதிவு செய்', 'டாக்டர் சந்திப்பு',
    // Telugu
    'అపాయింట్‌మెంట్ బుక్', 'డాక్టర్ సందర్శన',
    // Kannada
    'ಅಪಾಯಿಂಟ್‌ಮೆಂಟ್ ಬುಕ್', 'ವೈದ್ಯರ ಭೇಟಿ',
    // Malayalam
    'അപ്പോയ്‌ൻ്റ്‌മെൻ്റ് ബുക്ക്', 'ഡോക്ടറെ കാണുക', 'ആശുപത്രി സന്ദർശനം',
    // Gujarati
    'ડૉક્ટર અપૉઇન્ટમેન્ટ', 'ક્લિનિક બુકિંગ', 'ડૉક્ટર સાથે મળવું',
    // Bengali
    'ডাক্তারের সাথে দেখা', 'অ্যাপয়েন্টমেন্ট',
    // Marathi
    'डॉक्टरांची भेट', 'अपॉइंटमेंट बुक',
    // Punjabi
    'ਡਾਕਟਰ ਨਾਲ ਮੁਲਾਕਾਤ', 'ਅਪਾਇੰਟਮੈਂਟ ਬੁੱਕ',
    // Urdu
    'ڈاکٹر سے ملاقات', 'اپائنٹمنٹ بک کریں',
  ],
  medication: [
    'medicine dosage', 'drug side effects', 'tablet prescription',
    'pharmacy medication', 'pill reminder adherence', 'drug interaction',
    // Hindi
    'दवा की खुराक', 'दवाई के साइड इफेक्ट', 'दवा लेने का समय',
    // Tamil
    'மருந்து அளவு', 'மருந்தின் பக்க விளைவுகள்',
    // Telugu
    'మందుల మోతాదు', 'ఔషధ దుష్ప్రభావాలు',
    // Kannada
    'ಮಾತ್ರೆ ಪ್ರಮಾಣ', 'ಔಷಧದ ಅಡ್ಡ ಪರಿಣಾಮ',
    // Malayalam
    'മരുന്നിന്റെ അളവ്', 'മരുന്നിന്റെ പാർശ്വഫലം', 'ഔഷധം',
    // Gujarati
    'દવાની માત્રા', 'દવાની આડ અસર', 'ગોળી',
    // Bengali
    'ওষুধের মাত্রা', 'ওষুধের পার্শ্বপ্রতিক্রিয়া',
    // Marathi
    'औषधाचा डोस', 'गोळ्यांचे दुष्परिणाम',
    // Punjabi
    'ਦਵਾਈ ਦੀ ਖੁਰਾਕ', 'ਦਵਾਈ ਦੇ ਮਾੜੇ ਪ੍ਰਭਾਵ',
    // Urdu
    'دوائی کی خوراک', 'دوائی کے مضر اثرات',
  ],
  diet: [
    'diet nutrition food', 'meal plan healthy eating', 'recipe for health condition',
    'calorie intake food restriction', 'diabetic diet', 'weight loss nutrition',
    // Hindi
    'खाने की जानकारी', 'आहार योजना', 'स्वस्थ भोजन', 'मधुमेह आहार',
    // Tamil
    'உணவு திட்டம்', 'ஆரோக்கியமான உணவு', 'நீரிழிவு உணவு',
    // Telugu
    'ఆహార ప్రణాళిక', 'ఆరోగ్యకరమైన ఆహారం',
    // Kannada
    'ಆಹಾರ ಯೋಜನೆ', 'ಆರೋಗ್ಯಕರ ಊಟ', 'ಮಧುಮೇಹ ಆಹಾರ',
    // Malayalam
    'ഭക്ഷണ പദ്ധതി', 'ആരോഗ്യകരമായ ഭക്ഷണം', 'പ്രമേഹ ഭക്ഷണക്രമം',
    // Gujarati
    'ખોરાક યોજના', 'સ્વસ્થ ભોજન', 'ડાયાબિટીક આહાર',
    // Bengali
    'খাদ্য পরিকল্পনা', 'স্বাস্থ্যকর খাবার',
    // Marathi
    'आहार योजना', 'निरोगी जेवण',
    // Punjabi
    'ਖੁਰਾਕ ਯੋਜਨਾ', 'ਸਿਹਤਮੰਦ ਖਾਣਾ',
    // Urdu
    'خوراک کا منصوبہ', 'صحت مند کھانا', 'ذیابیطس غذا',
  ],
  records: [
    'my health records', 'lab test results', 'blood test report',
    'medical history diagnosis', 'vitals blood pressure', 'past clinic visit',
    // Hindi
    'मेरी रिपोर्ट', 'खून की जांच', 'मेरा स्वास्थ्य इतिहास',
    // Tamil
    'என் ஆய்வக முடிவுகள்', 'இரத்த பரிசோதனை',
    // Telugu
    'నా ల్యాబ్ రిపోర్ట్', 'రక్త పరీక్ష',
    // Kannada
    'ನನ್ನ ಆರೋಗ್ಯ ದಾಖಲೆ', 'ರಕ್ತ ಪರೀಕ್ಷೆ',
    // Malayalam
    'എന്റെ ആരോഗ്യ രേഖകൾ', 'രക്ത പരിശോധന', 'ലാബ് ഫലം',
    // Gujarati
    'મારા આરોગ્ય રેકોર્ડ', 'લોહી પરીક્ષણ', 'લેબ રિપોર્ટ',
    // Bengali
    'আমার স্বাস্থ্য রেকর্ড', 'রক্ত পরীক্ষার ফলাফল',
    // Marathi
    'माझे आरोग्य रेकॉर्ड', 'रक्त तपासणी',
    // Punjabi
    'ਮੇਰੇ ਸਿਹਤ ਰਿਕਾਰਡ', 'ਖੂਨ ਦੀ ਜਾਂਚ',
    // Urdu
    'میرے صحت کے ریکارڈ', 'خون کا ٹیسٹ',
  ],
  evidence: [
    'medical research evidence', 'health information guidelines',
    'what does research say about', 'clinical study treatment', 'symptoms causes disease',
    // Hindi
    'स्वास्थ्य जानकारी', 'बीमारी के लक्षण', 'चिकित्सा अनुसंधान',
    // Tamil
    'மருத்துவ ஆராய்ச்சி', 'நோயின் அறிகுறிகள்',
    // Telugu
    'వైద్య పరిశోధన', 'వ్యాధి లక్షణాలు',
    // Kannada
    'ವೈದ್ಯಕೀಯ ಸಂಶೋಧನೆ', 'ರೋಗದ ಲಕ್ಷಣಗಳು',
    // Malayalam
    'വൈദ്യ ഗവേഷണം', 'രോഗ ലക്ഷണങ്ങൾ', 'ആരോഗ്യ വിവരം',
    // Gujarati
    'તબીબી સંશોધન', 'રોગના લક્ષણો', 'સ્વાસ્થ્ય માહિતી',
    // Bengali
    'চিকিৎসা গবেষণা', 'রোগের লক্ষণ',
    // Marathi
    'वैद्यकीय संशोधन', 'आजाराची लक्षणे',
    // Punjabi
    'ਡਾਕਟਰੀ ਖੋਜ', 'ਬਿਮਾਰੀ ਦੇ ਲੱਛਣ',
    // Urdu
    'طبی تحقیق', 'بیماری کی علامات',
  ],
}

// Complexity bucket prototypes for Fugu-style routing.
// One embedding forward pass + cosine similarity selects the complexity bucket.
const COMPLEXITY_PHRASES: Record<MLComplexity, string[]> = {
  trivial: [
    'hello', 'hi', 'thank you', 'thanks', 'ok', 'okay', 'got it', 'alright',
    'what can you do', 'what are your features', 'help me', 'yes', 'no', 'sure',
    'good morning', 'good evening', 'bye', 'goodbye',
    // Hindi
    'नमस्ते', 'धन्यवाद', 'ठीक है', 'हाँ', 'नहीं', 'शुक्रिया',
    // Tamil
    'வணக்கம்', 'நன்றி', 'சரி', 'ஆம்', 'இல்லை',
    // Telugu
    'నమస్కారం', 'ధన్యవాదాలు', 'సరే', 'అవును', 'కాదు',
    // Kannada
    'ನಮಸ್ಕಾರ', 'ಧನ್ಯವಾದ', 'ಸರಿ', 'ಹೌದು',
    // Malayalam
    'നമസ്കാരം', 'നന്ദി', 'ശരി', 'അതെ',
    // Bengali
    'নমস্কার', 'ধন্যবাদ', 'ঠিক আছে', 'হ্যাঁ',
    // Gujarati
    'નમસ્તે', 'આભાર', 'ઠીક છે', 'હા',
  ],
  simple: [
    'what is diabetes', 'how does metformin work', 'what is high blood pressure',
    'what are statins', 'what is a normal blood sugar level', 'explain cholesterol',
    'what is HbA1c', 'what causes anemia', 'what are symptoms of thyroid',
    'how does aspirin work', 'what is blood pressure', 'tell me about hypertension',
    'what is a CBC blood test', 'what does creatinine mean', 'explain BMI',
    // Hindi
    'मधुमेह क्या है', 'मेटफॉर्मिन कैसे काम करता है', 'उच्च रक्तचाप के लक्षण',
    'कोलेस्ट्रॉल क्या है', 'एचबीए1सी क्या होता है',
    // Tamil
    'நீரிழிவு என்றால் என்ன', 'ரத்த அழுத்தம் என்றால் என்ன', 'மருந்து எப்படி வேலை செய்கிறது',
    // Telugu
    'మధుమేహం అంటే ఏమిటి', 'రక్తపోటు ఏమిటి', 'మందు ఎలా పనిచేస్తుందో',
    // Kannada
    'ಮಧುಮೇಹ ಎಂದರೇನು', 'ರಕ್ತದ ಒತ್ತಡ ಎಂದರೇನು',
  ],
  complex: [
    'what should I eat given my cholesterol and my medication',
    'are my current medications interacting based on my lab results',
    'I have diabetes and want to know the best diet and also check my recent labs',
    'should I be concerned about my blood pressure given my family history and meds',
    'how should I manage my condition with my current prescriptions and diet',
    'what do my lab results mean and how does it affect my medication',
    'book appointment and advise on diet for my diabetes condition',
    'explain my test results and suggest changes to my treatment',
    // Hindi
    'मेरे कोलेस्ट्रॉल और दवाओं को देखते हुए मुझे क्या खाना चाहिए',
    'मेरी दवाएं और मेरे लैब रिजल्ट में क्या संबंध है',
    'मेरी बीमारी के लिए सही आहार और दवाएं क्या हैं',
    // Tamil
    'என் மருந்துகளும் என் ஆய்வக முடிவுகளும் எப்படி தொடர்புடையவை',
    'என் நோய்க்கு சரியான உணவு திட்டம் என்ன',
  ],
  call: [
    'book an appointment', 'schedule a doctor visit', 'make an appointment',
    'see a doctor', 'book a consultation', 'message my doctor',
    'send a message to the clinic', 'contact clinic', 'book a follow-up',
    'cancel my appointment', 'reschedule my appointment',
    'I want to see a specialist', 'refer me to a doctor',
    // Hindi
    'अपॉइंटमेंट बुक करो', 'डॉक्टर से मिलना है', 'डॉक्टर को संदेश भेजो',
    'क्लिनिक में संदेश भेजें', 'फॉलो अप बुक करो',
    // Tamil
    'சந்திப்பு பதிவு செய்', 'மருத்துவரை சந்திக்க வேண்டும்',
    'மருத்துவருக்கு செய்தி அனுப்பு',
    // Telugu
    'అపాయింట్‌మెంట్ బుక్ చేయి', 'డాక్టర్‌కు సందేశం పంపు',
    // Kannada
    'ಅಪಾಯಿಂಟ್‌ಮೆಂಟ್ ಬುಕ್ ಮಾಡಿ', 'ವೈದ್ಯರಿಗೆ ಸಂದೇಶ ಕಳಿಸಿ',
    // Malayalam
    'അപ്പോയ്‌ൻ്റ്‌മെൻ്റ് ബുക്ക് ചെയ്യുക', 'ഡോക്ടർക്ക് സന്ദേശം അയക്കുക',
    // Bengali
    'অ্যাপয়েন্টমেন্ট বুক করুন', 'ডাক্তারকে বার্তা পাঠান',
    // Gujarati
    'ડૉક્ટર અપૉઇન્ટમેન્ટ', 'ક્લિનિકને સંદેશ મોકલો',
  ],
}

// Personal-scope keywords across all 14 supported Indian languages + English.
const PERSONAL_KEYWORDS = [
  // English
  'my ', 'my\t', 'i have', 'i am', "i've", 'for me',
  // Hindi/Devanagari
  'मेरा', 'मेरी', 'मुझे', 'मैंने', 'मुझ', 'मैं ',
  // Tamil
  'என்', 'எனக்கு', 'என்னிடம்',
  // Telugu
  'నా', 'నాకు', 'నన్ను',
  // Kannada
  'ನನ್ನ', 'ನನಗೆ',
  // Malayalam
  'എന്റെ', 'എനിക്ക്',
  // Bengali
  'আমার', 'আমি',
  // Marathi
  'माझे', 'मला',
  // Gujarati
  'મારી', 'મારો', 'મને',
  // Punjabi
  'ਮੇਰਾ', 'ਮੇਰੀ', 'ਮੈਨੂੰ',
  // Urdu
  'میرا', 'میری', 'مجھے',
  // Odia
  'ମୋର', 'ମୋ',
  // Assamese
  'মোৰ', 'মই',
]

function detectScope(query: string): 'personal' | 'generic' {
  const q = query.toLowerCase()
  return PERSONAL_KEYWORDS.some(kw => q.includes(kw)) ? 'personal' : 'generic'
}

// ── Model + centroid state ──────────────────────────────────────────────────

let embedder: FeatureExtractionPipeline | null = null
let loadingPromise: Promise<FeatureExtractionPipeline> | null = null
let centroids: Record<string, Float32Array> | null = null
let complexityCentroids: Record<MLComplexity, Float32Array> | null = null

function post(msg: MLWorkerToMain) {
  wSelf.postMessage(msg)
}

async function loadModel(): Promise<FeatureExtractionPipeline> {
  if (embedder) return embedder
  if (loadingPromise) return loadingPromise

  loadingPromise = (async () => {
    post({ type: 'progress', status: 'loading', progress: 0 })

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const progressCb = (info: any) => {
      post({ type: 'progress', status: 'loading', progress: info?.progress ?? 0 })
    }

    try {
      embedder = await pipeline('feature-extraction', MODEL, {
        device: 'webgpu',
        dtype: 'fp32',
        progress_callback: progressCb,
      }) as FeatureExtractionPipeline
    } catch {
      embedder = await pipeline('feature-extraction', MODEL, {
        device: 'wasm',
        dtype: 'fp32',
        progress_callback: progressCb,
      }) as FeatureExtractionPipeline
    }

    // Pre-compute agent centroids + complexity centroids (Fugu Router).
    centroids = await buildCentroids(embedder)
    complexityCentroids = await buildComplexityCentroids()
    post({ type: 'progress', status: 'ready' })
    return embedder!
  })()

  return loadingPromise
}

async function embed(texts: string[]): Promise<Float32Array[]> {
  if (!embedder) throw new Error('Model not loaded')
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const out = await (embedder as any)(texts, { pooling: 'mean', normalize: true }) as any
  const data: Float32Array = out.data as Float32Array
  const dim = data.length / texts.length
  return texts.map((_, i) => data.slice(i * dim, (i + 1) * dim))
}

async function buildCentroids(
  _emb: FeatureExtractionPipeline,
): Promise<Record<string, Float32Array>> {
  const result: Record<string, Float32Array> = {}
  for (const [cls, phrases] of Object.entries(CLASS_PHRASES)) {
    const vecs = await embed(phrases)
    const dim = vecs[0].length
    const centroid = new Float32Array(dim)
    for (const v of vecs) {
      for (let j = 0; j < dim; j++) centroid[j] += v[j]
    }
    // Average + normalize
    let norm = 0
    for (let j = 0; j < dim; j++) {
      centroid[j] /= vecs.length
      norm += centroid[j] * centroid[j]
    }
    norm = Math.sqrt(norm)
    for (let j = 0; j < dim; j++) centroid[j] /= norm
    result[cls] = centroid
  }
  return result
}

async function buildComplexityCentroids(): Promise<Record<MLComplexity, Float32Array>> {
  const result = {} as Record<MLComplexity, Float32Array>
  for (const [bucket, phrases] of Object.entries(COMPLEXITY_PHRASES) as [MLComplexity, string[]][]) {
    const vecs = await embed(phrases)
    const dim = vecs[0].length
    const centroid = new Float32Array(dim)
    for (const v of vecs) {
      for (let j = 0; j < dim; j++) centroid[j] += v[j]
    }
    let norm = 0
    for (let j = 0; j < dim; j++) {
      centroid[j] /= vecs.length
      norm += centroid[j] * centroid[j]
    }
    norm = Math.sqrt(norm)
    for (let j = 0; j < dim; j++) centroid[j] /= norm
    result[bucket] = centroid
  }
  return result
}

function dotProduct(a: Float32Array, b: Float32Array): number {
  let s = 0
  for (let i = 0; i < a.length; i++) s += a[i] * b[i]
  return s
}

function classifyComplexity(queryVec: Float32Array): MLComplexity {
  if (!complexityCentroids) return 'simple'
  let best: MLComplexity = 'simple'
  let bestSim = -1
  for (const [bucket, centroid] of Object.entries(complexityCentroids) as [MLComplexity, Float32Array][]) {
    const sim = dotProduct(queryVec, centroid)
    if (sim > bestSim) {
      bestSim = sim
      best = bucket
    }
  }
  return best
}

function classify(queryVec: Float32Array): MLClassificationResult | null {
  if (!centroids) return null
  let bestAgent: MLAgentName = 'evidence'
  let bestSim = -1
  for (const [cls, centroid] of Object.entries(centroids)) {
    const sim = dotProduct(queryVec, centroid)
    if (sim > bestSim) {
      bestSim = sim
      bestAgent = cls as MLAgentName
    }
  }
  return {
    agent: bestAgent,
    confidence: Math.max(0, Math.min(1, bestSim)),
    scope: 'generic',        // overwritten per-query by detectScope()
    complexity: classifyComplexity(queryVec),
  }
}

// ── Message handler ──────────────────────────────────────────────────────────

wSelf.addEventListener('message', async (e: MessageEvent<MLMainToWorker>) => {
  if (e.data.type === 'ping') {
    await loadModel()
    return
  }

  if (e.data.type !== 'classify') return
  const { id, query } = e.data

  try {
    await loadModel()
    const [queryVec] = await embed([query])
    const raw = classify(queryVec)
    if (!raw) {
      post({ type: 'error', id, error: 'centroids not ready' })
      return
    }
    const result: MLClassificationResult = {
      ...raw,
      scope: detectScope(query),
    }
    post({ type: 'result', id, result })
  } catch (err) {
    post({ type: 'error', id, error: String(err) })
  }
})

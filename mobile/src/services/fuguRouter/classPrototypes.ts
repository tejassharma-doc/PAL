/**
 * Prototype phrase banks for Fugu-style classification.
 *
 * At app launch, FuguClassifier embeds all phrases in each category and
 * averages them into a single centroid vector.  At query time, one embed()
 * call produces the query vector, then dot products vs all centroids give
 * the scores — no text generation, no sampling, deterministic.
 *
 * Phrases are balanced across classes (aim for ~10–20 per class).
 * Multilingual phrases improve robustness for Indian-language users.
 */

import type {AgentName, Complexity} from './types'

// ── Agent intent prototypes ────────────────────────────────────────────────

export const AGENT_PHRASES: Record<AgentName, string[]> = {
  appointment: [
    'book a medical appointment', 'schedule a doctor visit', 'see a doctor',
    'clinic appointment booking', 'hospital appointment', 'consultation schedule',
    'अपॉइंटमेंट बुक करना', 'डॉक्टर से मिलना', 'அசர்ந்திப்பு பதிவு செய்',
    'ডাক্তারের সাথে দেখা', 'ডাক্তার অ্যাপয়েন্টমেন্ট',
    'అపాయింట్‌మెంట్ బుక్', 'ಅಪಾಯಿಂಟ್‌ಮೆಂಟ್ ಬುಕ್', 'അപ്പോയ്‌ൻ്റ്‌മെൻ്റ്',
  ],
  medication: [
    'medicine dosage', 'drug side effects', 'tablet prescription',
    'pharmacy medication', 'pill reminder adherence', 'drug interaction',
    'दवा की खुराक', 'दवाई के साइड इफेक्ट', 'மருந்து அளவு',
    'ওষুধের মাত্রা', 'ঔষধের পার্শ্বপ্রতিক্রিয়া',
    'మందుల మోతాదు', 'ಮಾತ್ರೆ ಪ್ರಮಾಣ', 'മരുന്നിന്റെ അളവ്',
  ],
  diet: [
    'diet nutrition food', 'meal plan healthy eating', 'recipe for health condition',
    'calorie intake food restriction', 'diabetic diet', 'weight loss nutrition',
    'खाने की जानकारी', 'आहार योजना', 'உணவு திட்டம்',
    'খাদ্য পরিকল্পনা', 'স্বাস্থ্যকর খাবার',
    'ఆహార ప్రణాళిక', 'ಆಹಾರ ಯೋಜನೆ', 'ഭക്ഷണ പദ്ധതി',
  ],
  records: [
    'my health records', 'lab test results', 'blood test report',
    'medical history diagnosis', 'vitals blood pressure', 'past clinic visit',
    'मेरी रिपोर्ट', 'खून की जांच', 'என் ஆய்வக முடிவுகள்',
    'আমার স্বাস্থ্য রেকর্ড', 'রক্ত পরীক্ষার ফলাফল',
    'నా ల్యాబ్ రిపోర్ట్', 'ನನ್ನ ಆರೋಗ್ಯ ದಾಖಲೆ', 'എന്റെ ആരോഗ്യ രേഖകൾ',
  ],
  evidence: [
    'medical research evidence', 'health information guidelines',
    'what does research say about', 'clinical study treatment', 'symptoms causes disease',
    'स्वास्थ्य जानकारी', 'बीमारी के लक्षण', 'மருத்துவ ஆராய்ச்சி',
    'চিকিৎসা গবেষণা', 'রোগের লক্ষণ',
    'వైద్య పరిశోధన', 'ವೈದ್ಯಕೀಯ ಸಂಶೋಧನೆ', 'വൈദ്യ ഗവേഷണം',
  ],
}

// ── Complexity bucket prototypes ───────────────────────────────────────────

export const COMPLEXITY_PHRASES: Record<Complexity, string[]> = {
  trivial: [
    'hello', 'hi', 'thank you', 'thanks', 'ok', 'okay', 'got it', 'alright',
    'what can you do', 'what are your features', 'help me', 'yes', 'no', 'sure',
    'good morning', 'good evening', 'bye', 'goodbye',
    'नमस्ते', 'धन्यवाद', 'ठीक है', 'हाँ', 'नहीं',
    'வணக்கம்', 'நன்றி', 'சரி', 'ஆம்', 'நமஸ்கார்',
    'నమస్కారం', 'ధన్యవాదాలు', 'నమస్కారం',
    'ನಮಸ್ಕಾರ', 'ಧನ್ಯವಾದ', 'নমস্কার', 'ধন্যবাদ',
    'నమస్కారం', 'നമസ്കാരം', 'നന്ദി',
  ],
  simple: [
    'what is diabetes', 'how does metformin work', 'what is high blood pressure',
    'what are statins', 'what is a normal blood sugar level', 'explain cholesterol',
    'what is HbA1c', 'what causes anemia', 'what are symptoms of thyroid',
    'how does aspirin work', 'tell me about hypertension', 'what is a CBC blood test',
    'what does creatinine mean', 'explain BMI', 'what is blood urea',
    'मधुमेह क्या है', 'उच्च रक्तचाप के लक्षण', 'कोलेस्ट्रॉल क्या है',
    'நீரிழிவு என்றால் என்ன', 'ரத்த அழுத்தம் என்றால் என்ன',
    'మధుమేహం అంటే ఏమిటి', 'ಮಧುಮೇಹ ಎಂದರೇನು',
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
    'my blood pressure is high and my doctor gave me new meds what should I eat',
    'मेरे कोलेस्ट्रॉल और दवाओं को देखते हुए मुझे क्या खाना चाहिए',
    'मेरी दवाएं और मेरे लैब रिजल्ट में क्या संबंध है',
    'என் மருந்துகளும் என் ஆய்வக முடிவுகளும் எப்படி தொடர்புடையவை',
  ],
  call: [
    'book an appointment', 'schedule a doctor visit', 'make an appointment',
    'see a doctor', 'book a consultation', 'message my doctor',
    'send a message to the clinic', 'contact clinic', 'book a follow-up',
    'cancel my appointment', 'reschedule my appointment',
    'I want to see a specialist', 'refer me to a doctor',
    'अपॉइंटमेंट बुक करो', 'डॉक्टर से मिलना है', 'डॉक्टर को संदेश भेजो',
    'சந்திப்பு பதிவு செய்', 'மருத்துவரை சந்திக்க வேண்டும்',
    'అపాయింట్‌మెంట్ బుక్ చేయి', 'ಅಪಾಯಿಂಟ್‌ಮೆಂಟ್ ಬುಕ್ ಮಾಡಿ',
    'അപ്പോയ്‌ൻ്റ്‌മെൻ്റ് ബുക്ക് ചെയ്യുക', 'অ্যাপয়েন্টমেন্ট বুক করুন',
  ],
}

// ── Personal-scope keyword detection ──────────────────────────────────────
// Keyword matching — no model call needed for scope detection.

export const PERSONAL_KEYWORDS: readonly string[] = [
  'my ', 'my\t', 'i have', 'i am', "i've", 'for me',
  'मेरा', 'मेरी', 'मुझे', 'मैंने',
  'என்', 'எனக்கு', 'என்னிடம்',
  'నా', 'నాకు',
  'ನನ್ನ', 'ನನಗೆ',
  'എന്റെ', 'എനിക്ക്',
  'আমার', 'আমি',
  'माझे', 'मला',
  'มெ\'رา', 'مرا', 'میرا', 'میری', 'مجھے',
  'ਮੇਰਾ', 'ਮੇਰੀ',
]

export function detectScope(query: string): 'personal' | 'generic' {
  const q = query.toLowerCase()
  return PERSONAL_KEYWORDS.some(kw => q.includes(kw)) ? 'personal' : 'generic'
}

"""
Appointment/Clinic Agent — ACTION agent.
Proposes booking and clinic messaging ONLY.
Write-gate + confirm/sign token required; never auto-sends.

Cost strategy:
  - Booking with complete slots → pure template fill (zero API calls).
  - Booking with partial slots → clarifying question (zero API calls).
  - Messaging or complex/ambiguous requests → Claude Haiku fallback.
"""
import json
import re
from typing import Optional

from services.ai_provider import model_for_agent, multilingual_suffix
from services.action_token import generate_confirm_token


# ── Multilingual booking templates ────────────────────────────────────────────
# Covers all 14 Indian languages in deviceCapabilities.ts + English.
# Each template uses positional format vars; missing vars are safe to omit.

_T: dict[str, dict[str, str]] = {
    'en': {
        'booking':
            "I'll request{urgency} appointment with {doctor}{date_str}{time_str}{reason_str}. Tap Confirm to proceed.",
        'missing':
            "To book your appointment, could you tell me: {missing}?",
        'urgency_urgent':  ' an urgent',
        'urgency_asap':    ' an immediate',
        'urgency_routine': ' a',
        'on': ' on ',
        'at': ' at ',
        'for': ' for ',
        'fields': {
            'doctor':          "which doctor or clinic you'd like to visit",
            'date_preference': 'when works for you',
            'reason':          'what the appointment is for',
        },
    },
    'hi': {
        'booking':
            "{doctor} के साथ{date_str}{time_str} को{reason_str}{urgency} अपॉइंटमेंट का अनुरोध करूँगा। आगे बढ़ने के लिए पुष्टि करें।",
        'missing':
            "आपकी अपॉइंटमेंट बुक करने के लिए, कृपया बताएं: {missing}?",
        'urgency_urgent':  ' तत्काल',
        'urgency_asap':    ' अति-आवश्यक',
        'urgency_routine': '',
        'on': ' ',
        'at': ' ',
        'for': ' ',
        'fields': {
            'doctor':          'आप किस डॉक्टर से मिलना चाहते हैं',
            'date_preference': 'कब सुविधाजनक है',
            'reason':          'किस लिए आना है',
        },
    },
    'ta': {
        'booking':
            "{doctor} உடன்{date_str}{time_str}{reason_str}{urgency} சந்திப்பு கோருவேன். தொடர உறுதிப்படுத்தவும்.",
        'missing':
            "உங்கள் சந்திப்பை பதிவு செய்ய, தெரிவிக்கவும்: {missing}?",
        'urgency_urgent':  ' அவசர',
        'urgency_asap':    ' உடனடி',
        'urgency_routine': '',
        'on': ' ', 'at': ' ', 'for': ' ',
        'fields': {
            'doctor':          'எந்த மருத்துவரை சந்திக்க விரும்புகிறீர்கள்',
            'date_preference': 'எப்போது வசதியாக இருக்கும்',
            'reason':          'சந்திப்பின் காரணம்',
        },
    },
    'te': {
        'booking':
            "{doctor} తో{date_str}{time_str}{reason_str}{urgency} అపాయింట్‌మెంట్ అభ్యర్థిస్తాను. కొనసాగించడానికి నిర్ధారించండి.",
        'missing':
            "మీ అపాయింట్‌మెంట్ బుక్ చేయడానికి, చెప్పండి: {missing}?",
        'urgency_urgent':  ' అత్యవసర',
        'urgency_asap':    ' వెంటనే',
        'urgency_routine': '',
        'on': ' ', 'at': ' ', 'for': ' ',
        'fields': {
            'doctor':          'ఏ డాక్టర్‌ని కలవాలనుకుంటున్నారు',
            'date_preference': 'మీకు ఏ సమయం అనుకూలంగా ఉంటుంది',
            'reason':          'అపాయింట్‌మెంట్ ఎందుకు అవసరం',
        },
    },
    'kn': {
        'booking':
            "{doctor} ರೊಂದಿಗೆ{date_str}{time_str}{reason_str}{urgency} ಅಪಾಯಿಂಟ್‌ಮೆಂಟ್ ವಿನಂತಿಸುತ್ತೇನೆ. ಮುಂದುವರಿಯಲು ದೃಢೀಕರಿಸಿ.",
        'missing':
            "ನಿಮ್ಮ ಅಪಾಯಿಂಟ್‌ಮೆಂಟ್ ಬುಕ್ ಮಾಡಲು, ತಿಳಿಸಿ: {missing}?",
        'urgency_urgent':  ' ತುರ್ತು',
        'urgency_asap':    ' ತಕ್ಷಣ',
        'urgency_routine': '',
        'on': ' ', 'at': ' ', 'for': ' ',
        'fields': {
            'doctor':          'ಯಾವ ವೈದ್ಯರನ್ನು ಭೇಟಿ ಮಾಡಬೇಕು',
            'date_preference': 'ಯಾವ ಸಮಯ ಅನುಕೂಲ',
            'reason':          'ಅಪಾಯಿಂಟ್‌ಮೆಂಟ್ ಏಕೆ ಬೇಕು',
        },
    },
    'ml': {
        'booking':
            "{doctor} യുമായി{date_str}{time_str}{reason_str}{urgency} അപ്പോയ്‌ൻ്റ്‌മെൻ്റ് അഭ്യർത്ഥിക്കും. തുടരാൻ സ്ഥിരീകരിക്കൂ.",
        'missing':
            "അപ്പോയ്‌ൻ്റ്‌മെൻ്റ് ബുക്ക് ചെയ്യാൻ, ദയവായി പറയൂ: {missing}?",
        'urgency_urgent':  ' അടിയന്തര',
        'urgency_asap':    ' ഉടൻ',
        'urgency_routine': '',
        'on': ' ', 'at': ' ', 'for': ' ',
        'fields': {
            'doctor':          'ഏത് ഡോക്ടറെ കാണണം',
            'date_preference': 'എപ്പോൾ സൗകര്യമുണ്ട്',
            'reason':          'അപ്പോയ്‌ൻ്റ്‌മെൻ്റ് എന്തിനാണ്',
        },
    },
    'bn': {
        'booking':
            "{doctor} এর সাথে{date_str}{time_str}{reason_str}{urgency} অ্যাপয়েন্টমেন্টের অনুরোধ করব। এগিয়ে যেতে নিশ্চিত করুন।",
        'missing':
            "অ্যাপয়েন্টমেন্ট বুক করতে, জানান: {missing}?",
        'urgency_urgent':  ' জরুরি',
        'urgency_asap':    ' তাৎক্ষণিক',
        'urgency_routine': '',
        'on': ' ', 'at': ' ', 'for': ' ',
        'fields': {
            'doctor':          'কোন ডাক্তারের সাথে দেখা করতে চান',
            'date_preference': 'কখন সুবিধাজনক',
            'reason':          'অ্যাপয়েন্টমেন্টের কারণ',
        },
    },
    'mr': {
        'booking':
            "{doctor} सोबत{date_str}{time_str}{reason_str}{urgency} अपॉइंटमेंटची विनंती करेन। पुढे जाण्यासाठी पुष्टी करा.",
        'missing':
            "अपॉइंटमेंट बुक करण्यासाठी, सांगा: {missing}?",
        'urgency_urgent':  ' तातडीची',
        'urgency_asap':    ' तत्काळ',
        'urgency_routine': '',
        'on': ' ', 'at': ' ', 'for': ' ',
        'fields': {
            'doctor':          'कोणत्या डॉक्टरांना भेटायचे',
            'date_preference': 'कधी सोयीस्कर आहे',
            'reason':          'अपॉइंटमेंटचे कारण',
        },
    },
    'gu': {
        'booking':
            "{doctor} સાથે{date_str}{time_str}{reason_str}{urgency} અપૉઇन्टमेंट વિનંતી કરીશ. આગળ વધવા માટે પુષ્ટિ કરો.",
        'missing':
            "અૅપૉઇन्टमेंट બુક કરવા, જણાવો: {missing}?",
        'urgency_urgent':  ' તાકીદ',
        'urgency_asap':    ' તત્કાળ',
        'urgency_routine': '',
        'on': ' ', 'at': ' ', 'for': ' ',
        'fields': {
            'doctor':          'ક્યા ડૉક્ટરને મળવું છે',
            'date_preference': 'ક્યારે અનુકૂળ છે',
            'reason':          'અૅપૉઇन्टमेंटનું કારણ',
        },
    },
    'pa': {
        'booking':
            "{doctor} ਨਾਲ{date_str}{time_str}{reason_str}{urgency} ਅਪਾਇੰਟਮੈਂਟ ਬੇਨਤੀ ਕਰਾਂਗਾ। ਜਾਰੀ ਰੱਖਣ ਲਈ ਪੁਸ਼ਟੀ ਕਰੋ।",
        'missing':
            "ਅਪਾਇੰਟਮੈਂਟ ਬੁੱਕ ਕਰਨ ਲਈ, ਦੱਸੋ: {missing}?",
        'urgency_urgent':  ' ਜ਼ਰੂਰੀ',
        'urgency_asap':    ' ਤੁਰੰਤ',
        'urgency_routine': '',
        'on': ' ', 'at': ' ', 'for': ' ',
        'fields': {
            'doctor':          'ਕਿਸ ਡਾਕਟਰ ਨੂੰ ਮਿਲਣਾ ਚਾਹੁੰਦੇ ਹੋ',
            'date_preference': 'ਕਦੋਂ ਸੁਵਿਧਾਜਨਕ ਹੈ',
            'reason':          'ਅਪਾਇੰਟਮੈਂਟ ਦਾ ਕਾਰਨ',
        },
    },
    'ur': {
        'booking':
            "{doctor} کے ساتھ{date_str}{time_str}{reason_str}{urgency} اپائنٹمنٹ کی درخواست کروں گا۔ آگے بڑھنے کے لیے تصدیق کریں۔",
        'missing':
            "اپائنٹمنٹ بک کرنے کے لیے، بتائیں: {missing}?",
        'urgency_urgent':  ' فوری',
        'urgency_asap':    ' ہنگامی',
        'urgency_routine': '',
        'on': ' ', 'at': ' ', 'for': ' ',
        'fields': {
            'doctor':          'کس ڈاکٹر سے ملنا ہے',
            'date_preference': 'کب مناسب ہے',
            'reason':          'اپائنٹمنٹ کی وجہ',
        },
    },
}

# Languages that need Claude as fallback (not in _T)
def _lang_dict(lang: Optional[str]) -> dict:
    if lang and lang in _T:
        return _T[lang]
    return _T['en']


_MESSAGING_KEYWORDS = re.compile(
    r'\b(message|send|contact|email|notify|write to|let.*know|inform)\b',
    re.IGNORECASE,
)


def _is_messaging_request(query: str) -> bool:
    return bool(_MESSAGING_KEYWORDS.search(query))


def _slots_complete(slots: dict) -> bool:
    """Enough to propose a booking without asking Claude."""
    return bool(slots.get('doctor')) and (
        bool(slots.get('date_preference')) or bool(slots.get('reason'))
    )


def _missing_fields(slots: dict) -> list[str]:
    missing = []
    if not slots.get('doctor'):
        missing.append('doctor')
    if not slots.get('date_preference') and not slots.get('reason'):
        missing.append('date_preference')
        missing.append('reason')
    return missing


def _build_booking_response(
    slots: dict,
    lang: Optional[str],
    session_id: str,
    secret_key: str,
) -> dict:
    d = _lang_dict(lang)
    urgency = slots.get('urgency', 'routine')
    urgency_str = d.get(f'urgency_{urgency}', d['urgency_routine'])

    date_str = (d['on'] + slots['date_preference']) if slots.get('date_preference') else ''
    time_str = (d['at'] + slots['time_preference']) if slots.get('time_preference') else ''
    reason_str = (d['for'] + slots['reason']) if slots.get('reason') else ''

    description = d['booking'].format(
        doctor=slots.get('doctor', ''),
        urgency=urgency_str,
        date_str=date_str,
        time_str=time_str,
        reason_str=reason_str,
    )

    action = {
        'type': 'booking',
        'description': description,
        'slots': slots,
    }
    payload = {'type': 'booking', 'slots': slots}
    if session_id and secret_key:
        action['confirm_token'] = generate_confirm_token(
            secret=secret_key,
            session_id=session_id,
            action_type='booking',
            payload=payload,
        )
        action['confirm_token_required'] = True

    return {
        'agent': 'appointment',
        'output': {
            'summary': description,
            'proposed_actions': [action],
            '_template': True,   # signals no LLM was called
        },
    }


def _build_clarify_response(slots: dict, lang: Optional[str]) -> dict:
    d = _lang_dict(lang)
    missing_names = [d['fields'].get(f, f) for f in _missing_fields(slots)]
    missing_str = ' and '.join(missing_names)
    question = d['missing'].format(missing=missing_str)
    return {
        'agent': 'appointment',
        'output': {
            'summary': question,
            'proposed_actions': [],
            '_template': True,
            '_needs_clarification': True,
        },
    }


# ── Claude fallback system prompt ─────────────────────────────────────────────

APPOINTMENT_SYSTEM = """You are an appointment and clinic coordination assistant in PAL.
Your role: understand scheduling/messaging intent and PROPOSE actions — never execute them.

Rules:
- Summarise the request and propose concrete next steps.
- Never book or send a message without explicit patient confirmation.
- Return proposed_actions as a JSON array; each item has: type, description, slots (any extracted fields).
- Keep the response compact and in JSON.
- Do not reveal clinic internal information.

Response format (JSON only, no markdown):
{
  "summary": "one-sentence description of what you're proposing",
  "proposed_actions": [
    {
      "type": "booking|messaging",
      "description": "human-readable description",
      "slots": {
        "doctor": "Dr. Shah",
        "date_preference": "next Monday",
        "time_preference": "3pm",
        "reason": "follow-up",
        "urgency": "routine"
      }
    }
  ]
}"""


class AppointmentAgent:
    name = "appointment"

    def __init__(self, ai_client):
        self.ai_client = ai_client

    async def run(
        self,
        query: str,
        record_context: Optional[dict] = None,
	conversation_history:str,
        is_second_opinion: bool = False,
        multilingual_lang: Optional[str] = None,
        extracted_slots: Optional[dict] = None,
        session_id: str = "",
        secret_key: str = "",
    ) -> dict:
        slots: dict = extracted_slots or {}

        # Fast path: messaging request always needs Claude to draft the message body.
        if _is_messaging_request(query):
            return await self._claude_run(
                query, conversation_history, multilingual_lang, is_second_opinion, slots, session_id, secret_key
            )

        # Booking with complete slots → template fill, zero API calls.
        if _slots_complete(slots):
            return _build_booking_response(slots, multilingual_lang, session_id, secret_key)

        # Booking with partial slots → ask clarifying question, zero API calls.
        if slots:
            return _build_clarify_response(slots, multilingual_lang)

        # No slots at all → Claude extracts them (rare: classifierWorker normally extracts).
        return await self._claude_run(
            query, conversation_history, multilingual_lang, is_second_opinion, slots, session_id, secret_key
        )

    async def _claude_run(
        self,
        query: str,
        conversation_history:str,
        multilingual_lang: Optional[str],
        is_second_opinion: bool,
        slots: dict,
        session_id: str,
        secret_key: str,
    ) -> dict:
	user_content = ""
	if conversation_history:
    		history_section = f"\n**Previous Conversation:**\n{conversation_history}\n\nUse this context to understand what the patient is confirming or refering.\n\n"

        user_content = f"Query: {query}"
        if slots:
            user_content += (
                f"\n\nPre-extracted slots (use as-is, add any missing fields from query):\n"
                + json.dumps(slots)
            )

        system = APPOINTMENT_SYSTEM + multilingual_suffix(multilingual_lang)
        response = await self.ai_client.messages.create(
            model=model_for_agent("appointment", is_second_opinion),
            max_tokens=512,
            system=system,
            messages=[{"role": "user", "content": user_content}],
        )
        raw = response.content[0].text if response.content else "{}"
        try:
            start = raw.find("{")
            end = raw.rfind("}") + 1
            parsed = json.loads(raw[start:end])
        except Exception:
            parsed = {"summary": raw, "proposed_actions": []}

        if session_id and secret_key:
            for action in parsed.get("proposed_actions", []):
                payload = {
                    "type": action.get("type", ""),
                    "slots": action.get("slots", {}),
                }
                action["confirm_token"] = generate_confirm_token(
                    secret=secret_key,
                    session_id=session_id,
                    action_type=action.get("type", ""),
                    payload=payload,
                )
                action["confirm_token_required"] = True

        return {"agent": self.name, "output": parsed}

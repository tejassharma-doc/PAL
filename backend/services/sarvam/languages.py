"""
PAL × Sarvam AI — language matrix.

Single source of truth for every language PAL speaks. Covers all 22 languages in
the Eighth Schedule of the Indian Constitution, plus English and Hinglish
(Roman-script code-mixed Hindi/English).

Why this file is not just a list of codes
-----------------------------------------
Sarvam's three services do NOT cover the same set of languages:

  * Saaras v3 STT   -> 23 codes (all 22 scheduled languages + en-IN)
  * Bulbul v2/v3 TTS -> 11 codes only (bn, en, gu, hi, kn, ml, mr, od, pa, ta, te)
  * Sarvam-30B/105B LLM -> understands and writes all of them

So for the 12 languages Bulbul cannot speak natively we synthesise with the
closest script-compatible voice, transliterating first when the reply script
differs from the voice's script (e.g. Urdu -> Devanagari before hi-IN voice).
This keeps every language usable end-to-end instead of silently failing.

Fields
------
code             BCP-47 code used by Sarvam STT/LLM (canonical PAL identifier)
name_en          English name
name_native      Endonym, for the language picker UI
script           Unicode script of the native text
stt              STT language-code sent to Saaras (None -> 'unknown', autodetect)
stt_mode         Saaras output mode: transcribe | translate | verbatim | translit | codemix
tts              Bulbul target_language_code actually used for synthesis
tts_native       True when Bulbul speaks this language natively (no fallback)
translit_to      When set, transliterate LLM output into this language's script
                 before sending to TTS (Sarvam /transliterate)
speaker_f/_m     Default bulbul:v3 voices (female / male)
rtl              Right-to-left rendering in the UI
"""
from __future__ import annotations

from dataclasses import dataclass, field


@dataclass(frozen=True)
class Language:
    code: str
    name_en: str
    name_native: str
    script: str
    stt: str | None
    tts: str
    tts_native: bool = True
    stt_mode: str = "transcribe"
    translit_to: str | None = None
    speaker_f: str = "shruti"
    speaker_m: str = "shubh"
    rtl: bool = False
    aliases: tuple[str, ...] = field(default_factory=tuple)

    @property
    def needs_transliteration(self) -> bool:
        return self.translit_to is not None

    def speaker(self, gender: str = "female") -> str:
        return self.speaker_m if gender == "male" else self.speaker_f


# ── Natively supported by every Sarvam service ────────────────────────────────
_NATIVE: list[Language] = [
    Language("en-IN", "English", "English", "Latin", "en-IN", "en-IN",
             speaker_f="tanya", speaker_m="shubh", aliases=("en", "en-US", "en-GB")),
    Language("hi-IN", "Hindi", "हिन्दी", "Devanagari", "hi-IN", "hi-IN",
             speaker_f="shruti", speaker_m="shubh", aliases=("hi",)),
    Language("bn-IN", "Bengali", "বাংলা", "Bengali", "bn-IN", "bn-IN",
             speaker_f="ishita", speaker_m="soham", aliases=("bn",)),
    Language("gu-IN", "Gujarati", "ગુજરાતી", "Gujarati", "gu-IN", "gu-IN",
             speaker_f="roopa", speaker_m="advait", aliases=("gu",)),
    Language("kn-IN", "Kannada", "ಕನ್ನಡ", "Kannada", "kn-IN", "kn-IN",
             speaker_f="kavitha", speaker_m="gokul", aliases=("kn",)),
    Language("ml-IN", "Malayalam", "മലയാളം", "Malayalam", "ml-IN", "ml-IN",
             speaker_f="suhani", speaker_m="mani", aliases=("ml",)),
    Language("mr-IN", "Marathi", "मराठी", "Devanagari", "mr-IN", "mr-IN",
             speaker_f="rupali", speaker_m="mohit", aliases=("mr",)),
    Language("od-IN", "Odia", "ଓଡ଼ିଆ", "Odia", "od-IN", "od-IN",
             speaker_f="shreya", speaker_m="anand", aliases=("or", "or-IN", "od")),
    Language("pa-IN", "Punjabi", "ਪੰਜਾਬੀ", "Gurmukhi", "pa-IN", "pa-IN",
             speaker_f="simran", speaker_m="kabir", aliases=("pa",)),
    Language("ta-IN", "Tamil", "தமிழ்", "Tamil", "ta-IN", "ta-IN",
             speaker_f="kavya", speaker_m="vijay", aliases=("ta",)),
    Language("te-IN", "Telugu", "తెలుగు", "Telugu", "te-IN", "te-IN",
             speaker_f="priya", speaker_m="tarun", aliases=("te",)),
]

# ── Understood by STT + LLM, spoken through a script-compatible fallback voice ─
# Devanagari-script languages ride the Hindi voice; Bengali-script ones the
# Bengali voice. Perso-Arabic and Ol Chiki scripts are transliterated first.
_FALLBACK: list[Language] = [
    Language("as-IN", "Assamese", "অসমীয়া", "Bengali", "as-IN", "bn-IN",
             tts_native=False, speaker_f="ishita", speaker_m="soham", aliases=("as",)),
    Language("ur-IN", "Urdu", "اُردُو", "Perso-Arabic", "ur-IN", "hi-IN",
             tts_native=False, translit_to="hi-IN", rtl=True,
             speaker_f="neha", speaker_m="rehan", aliases=("ur",)),
    Language("ne-IN", "Nepali", "नेपाली", "Devanagari", "ne-IN", "hi-IN",
             tts_native=False, speaker_f="shruti", speaker_m="shubh", aliases=("ne",)),
    Language("kok-IN", "Konkani", "कोंकणी", "Devanagari", "kok-IN", "hi-IN",
             tts_native=False, speaker_f="roopa", speaker_m="advait", aliases=("kok",)),
    Language("ks-IN", "Kashmiri", "کٲشُر", "Perso-Arabic", "ks-IN", "hi-IN",
             tts_native=False, translit_to="hi-IN", rtl=True,
             speaker_f="neha", speaker_m="rehan", aliases=("ks",)),
    Language("sd-IN", "Sindhi", "سنڌي", "Perso-Arabic", "sd-IN", "hi-IN",
             tts_native=False, translit_to="hi-IN", rtl=True,
             speaker_f="neha", speaker_m="rehan", aliases=("sd",)),
    Language("sa-IN", "Sanskrit", "संस्कृतम्", "Devanagari", "sa-IN", "hi-IN",
             tts_native=False, speaker_f="shruti", speaker_m="ratan", aliases=("sa",)),
    Language("sat-IN", "Santali", "ᱥᱟᱱᱛᱟᱲᱤ", "Ol Chiki", "sat-IN", "hi-IN",
             tts_native=False, translit_to="hi-IN",
             speaker_f="shruti", speaker_m="shubh", aliases=("sat",)),
    Language("mni-IN", "Manipuri", "মৈতৈলোন্", "Bengali", "mni-IN", "bn-IN",
             tts_native=False, speaker_f="ishita", speaker_m="soham", aliases=("mni",)),
    Language("brx-IN", "Bodo", "बड़ो", "Devanagari", "brx-IN", "hi-IN",
             tts_native=False, speaker_f="shruti", speaker_m="shubh", aliases=("brx",)),
    Language("mai-IN", "Maithili", "मैथिली", "Devanagari", "mai-IN", "hi-IN",
             tts_native=False, speaker_f="shruti", speaker_m="shubh", aliases=("mai",)),
    Language("doi-IN", "Dogri", "डोगरी", "Devanagari", "doi-IN", "hi-IN",
             tts_native=False, speaker_f="shruti", speaker_m="shubh", aliases=("doi",)),
]

# ── Hinglish: Roman-script code-mixed Hindi/English ───────────────────────────
# STT runs Saaras in `translit` mode so "मुझे appointment चाहिए" comes back as
# "mujhe appointment chahiye". The LLM is instructed to answer in the same
# register, and Bulbul's hi-IN voice reads Roman Hinglish correctly because
# bulbul:v3 preprocessing handles code-mixed input.
HINGLISH = Language(
    "hi-Latn", "Hinglish", "Hinglish", "Latin", "hi-IN", "hi-IN",
    tts_native=False, stt_mode="translit",
    speaker_f="shruti", speaker_m="shubh",
    aliases=("hinglish", "hi-en", "hi_latn", "hien"),
)

# Auto-detect: let Saaras identify the language, then the orchestrator locks the
# session to whatever it found.
AUTO = Language(
    "auto", "Auto-detect", "स्वतः पहचान", "—", None, "hi-IN",
    tts_native=False, aliases=("unknown", "detect"),
)

LANGUAGES: list[Language] = [*_NATIVE, *_FALLBACK, HINGLISH]
ALL_WITH_AUTO: list[Language] = [AUTO, *LANGUAGES]

BY_CODE: dict[str, Language] = {}
for _lang in ALL_WITH_AUTO:
    BY_CODE[_lang.code.lower()] = _lang
    for _alias in _lang.aliases:
        BY_CODE.setdefault(_alias.lower(), _lang)

DEFAULT = BY_CODE["en-in"]

# Languages Bulbul speaks natively — useful for UI badges and QA.
TTS_NATIVE_CODES = tuple(lang.code for lang in LANGUAGES if lang.tts_native)


def get(code: str | None) -> Language:
    """Resolve any reasonable spelling of a language code. Never raises."""
    if not code:
        return DEFAULT
    key = code.strip().lower().replace("_", "-")
    if key in BY_CODE:
        return BY_CODE[key]
    # 'hi-IN-x-hinglish', 'en-US' etc. -> try the primary subtag
    primary = key.split("-")[0]
    return BY_CODE.get(primary, DEFAULT)


def picker_payload() -> list[dict]:
    """Shape consumed by the language picker in web + mobile clients."""
    return [
        {
            "code": lang.code,
            "label": lang.name_native,
            "labelEn": lang.name_en,
            "script": lang.script,
            "rtl": lang.rtl,
            "nativeVoice": lang.tts_native,
            "speakers": {"female": lang.speaker_f, "male": lang.speaker_m},
        }
        for lang in ALL_WITH_AUTO
    ]

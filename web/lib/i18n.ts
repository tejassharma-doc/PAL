type Dict = Record<string, string>;

export const translations: Record<string, { en: string; hi: string; gu: string }> = {
  greeting_morning: {
    en: 'Good morning',
    hi: 'शुभ प्रभात',
    gu: 'શુભ સવાર',
  },
  greeting_afternoon: {
    en: 'Good afternoon',
    hi: 'नमस्ते',
    gu: 'નમસ્તે',
  },
  greeting_evening: {
    en: 'Good evening',
    hi: 'शुभ संध्या',
    gu: 'શુભ સાંજ',
  },
  mind_question: {
    en: "What's on your mind?",
    hi: 'क्या जानना चाहते हैं?',
    gu: 'શું જાણવા ઇચ્છો છો?',
  },
  ask_subtitle: {
    en: 'Ask anything — general, or about you.',
    hi: 'कुछ भी पूछें — सामान्य, या आपके बारे में।',
    gu: 'કંઈ પણ પૂછો — સામાન્ય, અથવા તમારા વિશે.',
  },
  ask_placeholder: {
    en: 'Ask about your health…',
    hi: 'अपने स्वास्थ्य के बारे में पूछें…',
    gu: 'તમારા સ્વાસ્થ્ય વિશે પૂછો…',
  },
  tap_hint: {
    en: 'tap a question below to see PAL work',
    hi: 'नीचे एक प्रश्न चुनें',
    gu: 'નીચે પ્રશ્ન પસંદ કરો',
  },
  section_continue: {
    en: 'Continue',
    hi: 'जारी रखें',
    gu: 'ચાલુ રાખો',
  },
  section_try_asking: {
    en: 'Try asking',
    hi: 'ये पूछें',
    gu: 'આ પૂછો',
  },
  stt_heard: {
    en: 'I HEARD',
    hi: 'मैंने सुना',
    gu: 'મેં સાંભળ્યું',
  },
  stt_confirm: {
    en: 'Yes, search this',
    hi: 'हाँ, खोजें',
    gu: 'હા, શોધો',
  },
  stt_retry: {
    en: 'Try again',
    hi: 'फिर से',
    gu: 'ફરી પ્રયાસ',
  },
  consent_title: {
    en: 'This is about you',
    hi: 'यह आपके बारे में है',
    gu: 'આ તમારા વિશે છે',
  },
  consent_body: {
    en: 'To answer, PAL needs to read your record for this conversation. You can change this anytime.',
    hi: 'PAL को इस बातचीत के लिए आपका रिकॉर्ड पढ़ना होगा। आप इसे कभी भी बदल सकते हैं।',
    gu: 'PAL ને આ વાતચીત માટે તમારો રેકોર્ડ વાંચવો પડશે. તમે ગમે ત્યારે બદલી શકો છો.',
  },
  consent_use: {
    en: 'Use my record',
    hi: 'मेरा रिकॉर्ड उपयोग करें',
    gu: 'મારો રેકોર્ડ વાપરો',
  },
  consent_general: {
    en: 'Keep it general',
    hi: 'सामान्य रखें',
    gu: 'સામાન્ય રાખો',
  },
  tab_ask: {
    en: 'Ask',
    hi: 'पूछें',
    gu: 'પૂછો',
  },
  tab_history: {
    en: 'History',
    hi: 'इतिहास',
    gu: 'ઇતિહાસ',
  },
  tab_record: {
    en: 'Record',
    hi: 'रिकॉर्ड',
    gu: 'રેકોર્ડ',
  },
  tab_visits: {
    en: 'Visits',
    hi: 'दौरे',
    gu: 'મુલાકાત',
  },
  ask_something_else: {
    en: '← ask something else',
    hi: '← कुछ और पूछें',
    gu: '← બીજું પૂછો',
  },
  onboard_tell_us: {
    en: 'Tell us about you',
    hi: 'अपने बारे में बताएं',
    gu: 'તમારા વિશે જણાવો',
  },
  onboard_subtitle: {
    en: 'You can update these any time in Settings.',
    hi: 'आप इन्हें सेटिंग में कभी भी बदल सकते हैं।',
    gu: 'તમે આ ગમે ત્યારે સેટિંગ્સમાં અપડેટ કરી શકો છો.',
  },
  onboard_name_label: {
    en: 'Full name',
    hi: 'पूरा नाम',
    gu: 'પૂરું નામ',
  },
  onboard_start: {
    en: 'Start using PAL',
    hi: 'PAL शुरू करें',
    gu: 'PAL શરૂ કરો',
  },

  // ── Settings sheet ──────────────────────────────────────────────────────────
  settings_title:            { en: 'Settings',          hi: 'सेटिंग',                  gu: 'સેટિંગ્સ'              },
  settings_profile:          { en: 'Profile',            hi: 'प्रोफ़ाइल',               gu: 'પ્રોફાઇલ'              },
  settings_name_label:       { en: 'Full name',          hi: 'पूरा नाम',                gu: 'પૂરું નામ'             },
  settings_phone_label:      { en: 'Mobile',             hi: 'मोबाइल',                  gu: 'મોબાઇલ'               },
  settings_save:             { en: 'Save changes',       hi: 'बदलाव सहेजें',            gu: 'ફેરફાર સાચવો'         },
  settings_saved:            { en: 'Saved ✓',            hi: 'सहेजा गया ✓',             gu: 'સાચવ્યું ✓'            },
  settings_language:         { en: 'Language',           hi: 'भाषा',                    gu: 'ભાષા'                  },
  settings_privacy:          { en: 'Privacy & Consent',  hi: 'गोपनीयता और सहमति',      gu: 'ગોપનીયતા અને સંમતિ'   },
  settings_always_personalise: { en: 'Always personalise', hi: 'हमेशा व्यक्तिगत करें', gu: 'હંમેશા વ્યક્તિગત કરો' },
  settings_hindsight:        { en: 'Hindsight memory',   hi: 'Hindsight मेमोरी',        gu: 'Hindsight મેમોરી'      },
  settings_analytics:        { en: 'Usage analytics',    hi: 'उपयोग विश्लेषण',         gu: 'ઉપયોગ વિશ્લેષણ'       },
  settings_account:          { en: 'Account',            hi: 'खाता',                    gu: 'એકાઉન્ટ'               },
  settings_sign_out:         { en: 'Sign out',           hi: 'साइन आउट',               gu: 'સાઇન આઉટ'              },
};

// Unused variable suppression — Dict is used only as a type alias above.
void (undefined as unknown as Dict);

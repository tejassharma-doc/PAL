export const SUPPORTED_LANGUAGES = [
  { code: 'en', name: 'English',   native: 'English'   },
  { code: 'hi', name: 'Hindi',     native: 'हिंदी'      },
  { code: 'ta', name: 'Tamil',     native: 'தமிழ்'      },
  { code: 'te', name: 'Telugu',    native: 'తెలుగు'     },
  { code: 'kn', name: 'Kannada',   native: 'ಕನ್ನಡ'      },
  { code: 'ml', name: 'Malayalam', native: 'മലയാളം'     },
  { code: 'bn', name: 'Bengali',   native: 'বাংলা'      },
  { code: 'mr', name: 'Marathi',   native: 'मराठी'      },
  { code: 'gu', name: 'Gujarati',  native: 'ગુજરાતી'    },
  { code: 'pa', name: 'Punjabi',   native: 'ਪੰਜਾਬੀ'     },
  { code: 'ur', name: 'Urdu',      native: 'اردو'       },
  { code: 'or', name: 'Odia',      native: 'ଓଡ଼ିଆ'      },
  { code: 'as', name: 'Assamese',  native: 'অসমীয়া'    },
  { code: 'ne', name: 'Nepali',    native: 'नेपाली'     },
  { code: 'si', name: 'Sinhala',   native: 'සිංහල'      },
] as const;

export type LangCode = typeof SUPPORTED_LANGUAGES[number]['code'];

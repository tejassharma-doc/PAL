import { useState, useEffect } from 'react';
import { translations } from './i18n';

type Row = Record<string, string>;

export function useTranslation() {
  const [lang, setLang] = useState('en');

  useEffect(() => {
    const stored = localStorage.getItem('pal_preferred_lang');
    if (stored) setLang(stored);

    const onStorage = (e: StorageEvent) => {
      if (e.key === 'pal_preferred_lang' && e.newValue) setLang(e.newValue);
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  function t(key: string): string {
    const row = translations[key] as Row | undefined;
    return row?.[lang] ?? row?.['en'] ?? key;
  }

  return { t, lang };
}

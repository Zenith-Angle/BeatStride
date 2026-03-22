import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState
} from 'react';
import type { LanguageCode } from '@shared/types';
import { DEFAULT_LANGUAGE } from '@shared/constants';
import { MESSAGES } from './messages';

interface I18nContextValue {
  language: LanguageCode;
  setLanguage: (language: LanguageCode) => void;
  t: (key: string) => string;
}

const I18nContext = createContext<I18nContextValue | null>(null);

interface I18nProviderProps {
  language: LanguageCode;
  onLanguageChange: (language: LanguageCode) => void;
  children: React.ReactNode;
}

export function I18nProvider({
  language: incomingLanguage,
  onLanguageChange,
  children
}: I18nProviderProps) {
  const [language, setLanguageState] = useState<LanguageCode>(incomingLanguage);

  useEffect(() => {
    setLanguageState(incomingLanguage);
  }, [incomingLanguage]);

  useEffect(() => {
    document.documentElement.lang = language;
  }, [language]);

  const t = useCallback((key: string) => {
    const dict = MESSAGES[language] ?? MESSAGES[DEFAULT_LANGUAGE];
    return dict[key] ?? key;
  }, [language]);

  const setLanguage = useCallback(
    (next: LanguageCode) => {
      setLanguageState(next);
      onLanguageChange(next);
    },
    [onLanguageChange]
  );

  const value = useMemo<I18nContextValue>(
    () => ({ language, setLanguage, t }),
    [language, setLanguage, t]
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nContextValue {
  const context = useContext(I18nContext);
  if (!context) {
    throw new Error('useI18n must be used within I18nProvider');
  }
  return context;
}

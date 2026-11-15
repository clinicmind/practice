import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { en, type Strings } from './en';
import { zhHant } from './zh-Hant';

export type Locale = 'en' | 'zh-Hant';
export const LOCALES: readonly Locale[] = ['en', 'zh-Hant'];
export const LOCALE_KEY = 'cm.practice.locale';

/** What the switch button shows for each language: always the language's own name. */
export const LOCALE_NAME: Record<Locale, string> = { en: 'English', 'zh-Hant': '繁體中文' };

const STRINGS: Record<Locale, Strings> = { en, 'zh-Hant': zhHant };

export const isLocale = (v: unknown): v is Locale => v === 'en' || v === 'zh-Hant';

/** A saved choice wins. Otherwise a browser language starting with "zh" gives Traditional Chinese. */
export function detectLocale(
  storage: Pick<Storage, 'getItem'> | undefined = safeLocalStorage(),
  languages: readonly string[] = browserLanguages(),
): Locale {
  try {
    const saved = storage?.getItem(LOCALE_KEY);
    if (isLocale(saved)) return saved;
  } catch {
    // Storage can be blocked; fall through to the browser language.
  }
  return languages.some((l) => l.toLowerCase().startsWith('zh')) ? 'zh-Hant' : 'en';
}

function safeLocalStorage(): Storage | undefined {
  try { return globalThis.localStorage; } catch { return undefined; }
}
function browserLanguages(): readonly string[] {
  const n = globalThis.navigator;
  if (!n) return [];
  return n.languages?.length ? n.languages : n.language ? [n.language] : [];
}

interface LocaleValue { locale: Locale; setLocale: (l: Locale) => void }
const LocaleContext = createContext<LocaleValue>({ locale: 'en', setLocale: () => {} });

export function LocaleProvider({ children, initial }: { children: ReactNode; initial?: Locale }) {
  const [locale, setState] = useState<Locale>(() => initial ?? detectLocale());
  useEffect(() => { document.documentElement.lang = locale; }, [locale]);
  const setLocale = useCallback((l: Locale) => {
    setState(l);
    try { safeLocalStorage()?.setItem(LOCALE_KEY, l); } catch { /* the choice still applies for this visit */ }
  }, []);
  const value = useMemo(() => ({ locale, setLocale }), [locale, setLocale]);
  return <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>;
}

export const useLocale = (): LocaleValue => useContext(LocaleContext);
export const useT = (): Strings => STRINGS[useContext(LocaleContext).locale];

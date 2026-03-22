import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState
} from 'react';
import type { ThemeMode } from '@shared/types';
import { DEFAULT_THEME } from '@shared/constants';

interface ThemeContextValue {
  theme: ThemeMode;
  resolvedTheme: 'light' | 'dark';
  setTheme: (theme: ThemeMode) => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

interface ThemeProviderProps {
  theme: ThemeMode;
  onThemeChange: (theme: ThemeMode) => void;
  children: React.ReactNode;
}

function getSystemTheme(): 'light' | 'dark' {
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

export function ThemeProvider({
  theme: incomingTheme,
  onThemeChange,
  children
}: ThemeProviderProps) {
  const [theme, setThemeState] = useState<ThemeMode>(incomingTheme);
  const [systemTheme, setSystemTheme] = useState<'light' | 'dark'>(getSystemTheme());

  useEffect(() => {
    setThemeState(incomingTheme);
  }, [incomingTheme]);

  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const handler = () => setSystemTheme(media.matches ? 'dark' : 'light');
    media.addEventListener('change', handler);
    return () => media.removeEventListener('change', handler);
  }, []);

  const resolvedTheme = theme === 'system' ? systemTheme : theme;

  useEffect(() => {
    document.documentElement.dataset.theme = resolvedTheme;
  }, [resolvedTheme]);

  const setTheme = useCallback(
    (next: ThemeMode) => {
      setThemeState(next);
      onThemeChange(next);
    },
    [onThemeChange]
  );

  const value = useMemo<ThemeContextValue>(
    () => ({ theme, setTheme, resolvedTheme }),
    [resolvedTheme, setTheme, theme]
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error('useTheme must be used within ThemeProvider');
  }
  return context;
}

export function normalizeThemeMode(value?: string): ThemeMode {
  if (value === 'system' || value === 'light' || value === 'dark') {
    return value;
  }
  return DEFAULT_THEME;
}

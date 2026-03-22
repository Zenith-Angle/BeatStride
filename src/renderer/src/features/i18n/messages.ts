import type { LanguageCode } from '@shared/types';
import zhCN from './locales/zh-CN.json';
import zhTW from './locales/zh-TW.json';
import enUS from './locales/en-US.json';
import jaJP from './locales/ja-JP.json';
import frFR from './locales/fr-FR.json';

export type I18nDictionary = Record<string, string>;

export const MESSAGES: Record<LanguageCode, I18nDictionary> = {
  'zh-CN': zhCN,
  'zh-TW': zhTW,
  'en-US': enUS,
  'ja-JP': jaJP,
  'fr-FR': frFR
};

export const LANGUAGE_OPTIONS: Array<{ value: LanguageCode; label: string }> = [
  { value: 'zh-CN', label: '简体中文' },
  { value: 'zh-TW', label: '繁體中文' },
  { value: 'en-US', label: 'English' },
  { value: 'ja-JP', label: '日本語' },
  { value: 'fr-FR', label: 'Français' }
];

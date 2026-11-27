import {
  isTranslatorLanguage,
  TRANSLATOR_LANGUAGES,
  type TextMode,
  type TranslatorConfig,
  type TranslatorLanguage,
} from './types';
import { userErrorMessage } from '../../utils/userErrors';

export interface LanguageOption {
  code: TranslatorLanguage;
  name: string;
}

/**
 * The translator's languages in their fixed order (English variants first), named in the UI
 * language. The order does not follow the names, so it stays the same in every UI language.
 * `offered` narrows the list to what the server reports.
 */
export function languageOptions(t: (key: string) => string, offered?: readonly { code: string }[]): LanguageOption[] {
  const codes = TRANSLATOR_LANGUAGES.filter((code) => !offered || offered.some((o) => o.code === code));
  return codes.map((code) => ({ code, name: t(languageNameKey(code)) }));
}

/** Translation key of a language's name. */
export const languageNameKey = (code: TranslatorLanguage): string => `translatorLang_${code.replace('-', '_')}`;

/** A source language: `auto` lets the translator detect it. */
export type SourceLanguage = TranslatorLanguage | 'auto';

/**
 * The target that replaces one equal to the source: German, or British English for German, as
 * the translator picks it for its German-speaking users.
 */
export function alternativeTarget(collision: TranslatorLanguage): TranslatorLanguage {
  return collision === 'de' ? 'en-gb' : 'de';
}

/** The language users start with: the admin's default while it is one the translator offers. */
export function defaultTarget(config: Pick<TranslatorConfig, 'defaultTargetLanguage'> | null): TranslatorLanguage {
  const value = config?.defaultTargetLanguage;
  return isTranslatorLanguage(value) ? value : 'en-gb';
}

/** How long a failed request's message shows before the output is empty again. */
export const TEXT_ERROR_MS = 5000;

/** A text over a limit of the request, found before anything is sent. */
export class TextLimitError extends Error {
  constructor(readonly limit: 'text' | 'sentences') {
    super(`translator ${limit} limit`);
  }
}

/**
 * What a failed request of the page says. A refusal the shared list covers (a model that could
 * not answer, a disabled translator, 403, 429, an unreachable service) shows that message; a
 * 400 shows the page's own.
 */
export function textErrorMessage(error: unknown, mode: TextMode, t: (key: string) => string): string {
  if (error instanceof TextLimitError) {
    return t(error.limit === 'text' ? 'translatorErrorTextTooLong' : 'translatorErrorTooManySentences');
  }
  return userErrorMessage(error, t, {
    fallbackKey: mode === 'rephrase' ? 'translatorErrorRephraseFailed' : 'translatorErrorTranslateFailed',
  });
}

/** Ctrl+Enter, or Cmd+Enter on Apple keyboards: translate without leaving the text field. */
export function isTranslateShortcut(event: { key: string; ctrlKey: boolean; metaKey: boolean }): boolean {
  return event.key === 'Enter' && (event.ctrlKey || event.metaKey);
}

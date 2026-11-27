import { describe, expect, it } from 'vitest';
import { AxiosError, type AxiosResponse } from 'axios';
import { translations } from '../../i18n/translations';
import {
  alternativeTarget,
  defaultTarget,
  isTranslateShortcut,
  languageNameKey,
  languageOptions,
  textErrorMessage,
  TextLimitError,
} from './languages';
import { TRANSLATOR_LANGUAGES } from './types';

const de = (key: string): string => (translations as Record<string, { de: string }>)[key]?.de ?? `?${key}`;
const key = (k: string): string => k;

/** A failed request as axios reports it. */
function refused(status: number, code?: string): AxiosError {
  return new AxiosError('x', 'ERR_BAD_RESPONSE', undefined, undefined, {
    status,
    data: code ? { error: 'english text', code } : { error: 'english text' },
  } as AxiosResponse);
}

// Oracle: docs/api-contracts/translator.md "Languages": menu order en-gb, en-us, de, uk, fr, es,
// it, nl, pl, pt, ru, zh, ja.
describe('languageOptions', () => {
  it('lists the thirteen languages in the contract’s order, English variants first', () => {
    const options = languageOptions(de);
    expect(options.map((option) => option.code)).toEqual([
      'en-gb',
      'en-us',
      'de',
      'uk',
      'fr',
      'es',
      'it',
      'nl',
      'pl',
      'pt',
      'ru',
      'zh',
      'ja',
    ]);
    expect(options.slice(0, 3).map((option) => option.name)).toEqual(['Englisch (UK)', 'Englisch (US)', 'Deutsch']);
  });

  it('names every language in both UI languages', () => {
    for (const code of TRANSLATOR_LANGUAGES) {
      const entry = (translations as Record<string, { de: string; en: string }>)[languageNameKey(code)];
      expect(entry?.de, code).toBeTruthy();
      expect(entry?.en, code).toBeTruthy();
    }
  });

  it('keeps to what the server offers, in the fixed order', () => {
    const offered = [{ code: 'fr' }, { code: 'de' }, { code: 'xx' }];
    expect(languageOptions(key, offered).map((option) => option.code)).toEqual(['de', 'fr']);
  });
});

describe('defaultTarget', () => {
  it('takes the configured language while it is one the translator offers, else British English', () => {
    expect(defaultTarget({ defaultTargetLanguage: 'fr' })).toBe('fr');
    expect(defaultTarget({ defaultTargetLanguage: 'tlh' })).toBe('en-gb');
    expect(defaultTarget({ defaultTargetLanguage: '' })).toBe('en-gb');
    expect(defaultTarget(null)).toBe('en-gb');
  });
});

describe('alternativeTarget', () => {
  it('replaces a target equal to the source with German, or British English for German', () => {
    expect(alternativeTarget('en-gb')).toBe('de');
    expect(alternativeTarget('fr')).toBe('de');
    expect(alternativeTarget('de')).toBe('en-gb');
  });
});

describe('isTranslateShortcut', () => {
  it('accepts Ctrl+Enter and Cmd+Enter only', () => {
    expect(isTranslateShortcut({ key: 'Enter', ctrlKey: true, metaKey: false })).toBe(true);
    expect(isTranslateShortcut({ key: 'Enter', ctrlKey: false, metaKey: true })).toBe(true);
    expect(isTranslateShortcut({ key: 'Enter', ctrlKey: false, metaKey: false })).toBe(false);
    expect(isTranslateShortcut({ key: 'a', ctrlKey: true, metaKey: false })).toBe(false);
  });
});

// Oracle: API.md "Translator and glossaries" — errors: 400 refused request, 502
// translator_model_failed, 429 over the budget, 403 translator_disabled — and
// docs/user-error-messages.md for the shared messages.
describe('textErrorMessage', () => {
  it('says a model that could not answer with its own message', () => {
    expect(textErrorMessage(refused(502, 'translator_model_failed'), 'translate', key)).toBe(
      'errorTranslatorModelFailed',
    );
    expect(textErrorMessage(refused(502, 'translator_model_failed'), 'rephrase', key)).toBe(
      'errorTranslatorModelFailed',
    );
  });

  it('says a switched-off translator and a throttled request', () => {
    expect(textErrorMessage(refused(403, 'translator_disabled'), 'translate', key)).toBe('errorTranslatorDisabled');
    expect(textErrorMessage(refused(429), 'translate', key)).toBe('errorRateLimited');
  });

  it('uses the mode’s own message for a refused request and for a client error', () => {
    expect(textErrorMessage(refused(400), 'translate', key)).toBe('translatorErrorTranslateFailed');
    expect(textErrorMessage(refused(400), 'rephrase', key)).toBe('translatorErrorRephraseFailed');
    expect(textErrorMessage(new Error('boom'), 'translate', key)).toBe('translatorErrorTranslateFailed');
  });

  it('says a text over a limit', () => {
    expect(textErrorMessage(new TextLimitError('text'), 'translate', key)).toBe('translatorErrorTextTooLong');
    expect(textErrorMessage(new TextLimitError('sentences'), 'translate', key)).toBe('translatorErrorTooManySentences');
  });

  it('has the messages in both languages', () => {
    for (const k of [
      'errorTranslatorModelFailed',
      'errorTranslatorDisabled',
      'translatorErrorTranslateFailed',
      'translatorErrorRephraseFailed',
    ]) {
      const entry = (translations as Record<string, { de: string; en: string }>)[k];
      expect(entry?.de, k).toBeTruthy();
      expect(entry?.en, k).toBeTruthy();
    }
  });
});

import { useEffect, useState } from 'react';
import { translateText } from './api';
import { TEXT_ERROR_MS } from './languages';
import type { TranslateRequest, TranslateResponse, TranslatorLanguage } from './types';
import { DEFAULT_LIMITS } from './types';
import { useLatestRequest } from './useLatestRequest';

export interface TranslateResult {
  translation: string;
  /** The language translated into. */
  language: TranslatorLanguage;
}

export interface Translator {
  target: TranslatorLanguage;
  setTarget: (target: TranslatorLanguage) => void;
  /** The latest translation, kept while the text is edited until the next one arrives. */
  result: TranslateResult | null;
  pending: boolean;
  error: unknown;
  /** There is text to translate and no translation on its way. */
  canTranslate: boolean;
  /** Translates the text; a translation on its way is aborted. */
  translate: () => void;
}

interface TranslatorOptions {
  text: string;
  defaultTarget: TranslatorLanguage;
  /** The longest text one request takes; the contract's limit while left out. */
  textMax?: number;
  /** Sends a request; the translator's own route while left out (tests, stories). */
  send?: (request: TranslateRequest, signal: AbortSignal) => Promise<TranslateResponse>;
}

/**
 * A quick translation of one piece of text: the source language is detected, the text goes as
 * one piece. Changing the language while a translation is shown translates again. A failure
 * shows for `TEXT_ERROR_MS`, as on the page.
 */
export function useTranslator({
  text,
  defaultTarget,
  textMax = DEFAULT_LIMITS.textMax,
  send,
}: TranslatorOptions): Translator {
  const [target, setTargetState] = useState<TranslatorLanguage>(defaultTarget);
  const [result, setResult] = useState<TranslateResult | null>(null);
  const request = useLatestRequest<TranslateRequest, TranslateResponse>(
    send ?? ((req, signal) => translateText(req, signal)),
  );
  // A failure shows as long as on the page, then the output is empty again.
  const { error, reset } = request;
  useEffect(() => {
    if (!error) return;
    const timer = setTimeout(reset, TEXT_ERROR_MS);
    return () => clearTimeout(timer);
  }, [error, reset]);

  const trimmed = text.trim();
  const hasText = trimmed.length > 0 && [...trimmed].length <= textMax;

  const run = (nextTarget: TranslatorLanguage): void => {
    if (!hasText) return;
    request.run({ text: [trimmed], source: null, target: nextTarget }, (response) =>
      setResult({ translation: response.text.join(''), language: nextTarget }),
    );
  };

  return {
    target,
    setTarget: (next) => {
      setTargetState(next);
      if (result) run(next);
    },
    result,
    pending: request.pending,
    error: request.error,
    canTranslate: hasText && !request.pending,
    translate: () => run(target),
  };
}

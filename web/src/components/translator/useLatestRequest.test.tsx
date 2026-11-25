import { describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { useLatestRequest } from './useLatestRequest';
import { useTranslator } from './useTranslator';
import type { TranslateRequest, TranslateResponse } from './types';

/** A request whose answer the test hands out by hand, and which notices being aborted. */
function deferred() {
  const calls: Array<{
    request: string;
    signal: AbortSignal;
    resolve: (v: string) => void;
    reject: (e: unknown) => void;
  }> = [];
  const send = vi.fn(
    (request: string, signal: AbortSignal) =>
      new Promise<string>((resolve, reject) => {
        calls.push({ request, signal, resolve, reject });
      }),
  );
  return { send, calls };
}

// Oracle: the contract of the hook as documented — one request at a time: a newer request aborts
// the older, and an answer that arrives late never replaces a newer one.
describe('useLatestRequest', () => {
  it('aborts the request on its way and lets only the latest answer through', async () => {
    const { send, calls } = deferred();
    const { result } = renderHook(() => useLatestRequest<string, string>(send));
    const seen: string[] = [];
    act(() => result.current.run('first', (r) => seen.push(r)));
    act(() => result.current.run('second', (r) => seen.push(r)));
    expect(calls[0].signal.aborted).toBe(true);
    expect(calls[1].signal.aborted).toBe(false);

    // The older answer arrives late anyway.
    await act(async () => {
      calls[0].resolve('late first');
      calls[1].resolve('answer second');
    });
    expect(seen).toEqual(['answer second']);
    expect(result.current.pending).toBe(false);
  });

  it('reports a failure, and not the abort of a replaced request', async () => {
    const { send, calls } = deferred();
    const { result } = renderHook(() => useLatestRequest<string, string>(send));
    act(() => result.current.run('first', () => undefined));
    act(() => result.current.run('second', () => undefined));
    await act(async () => {
      calls[0].reject(new Error('aborted'));
    });
    expect(result.current.error).toBeNull();

    await act(async () => {
      calls[1].reject(new Error('refused'));
    });
    expect(result.current.error).toEqual(new Error('refused'));
    act(() => result.current.reset());
    expect(result.current.error).toBeNull();
  });

  it('cancels the request on its way and forgets the error', async () => {
    const { send, calls } = deferred();
    const { result } = renderHook(() => useLatestRequest<string, string>(send));
    const seen: string[] = [];
    act(() => result.current.run('only', (r) => seen.push(r)));
    expect(result.current.pending).toBe(true);
    act(() => result.current.cancel());
    expect(calls[0].signal.aborted).toBe(true);
    await act(async () => {
      calls[0].resolve('too late');
    });
    expect(seen).toEqual([]);
    expect(result.current.pending).toBe(false);
  });
});

describe('useTranslator', () => {
  const send = vi.fn(async (request: TranslateRequest): Promise<TranslateResponse> => ({
    text: [`${request.target}:${request.text.join('')}`],
    detectedSource: null,
  }));

  it('translates the trimmed text as one piece with the source detected', async () => {
    send.mockClear();
    const { result } = renderHook(() => useTranslator({ text: '  Hallo Welt.  ', defaultTarget: 'en-gb', send }));
    expect(result.current.canTranslate).toBe(true);
    act(() => result.current.translate());
    await waitFor(() => expect(result.current.result).toEqual({ translation: 'en-gb:Hallo Welt.', language: 'en-gb' }));
    expect(send.mock.calls[0][0]).toEqual({ text: ['Hallo Welt.'], source: null, target: 'en-gb' });
  });

  it('translates again into the new language while a translation is shown', async () => {
    send.mockClear();
    const { result } = renderHook(() => useTranslator({ text: 'Hallo', defaultTarget: 'en-gb', send }));
    act(() => result.current.translate());
    await waitFor(() => expect(result.current.result?.language).toBe('en-gb'));
    act(() => result.current.setTarget('fr'));
    await waitFor(() => expect(result.current.result).toEqual({ translation: 'fr:Hallo', language: 'fr' }));
    expect(send).toHaveBeenCalledTimes(2);
  });

  it('does not translate an empty text or one over the limit', () => {
    send.mockClear();
    const empty = renderHook(() => useTranslator({ text: '   ', defaultTarget: 'de', send }));
    expect(empty.result.current.canTranslate).toBe(false);
    act(() => empty.result.current.translate());
    const long = renderHook(() => useTranslator({ text: 'abcdef', defaultTarget: 'de', textMax: 5, send }));
    expect(long.result.current.canTranslate).toBe(false);
    expect(send).not.toHaveBeenCalled();
  });
});

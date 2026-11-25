import { useCallback, useEffect, useRef, useState } from 'react';

export interface LatestRequest<Req, Res> {
  /** Starts `request` and aborts the one on its way; only the latest answer reaches `onSuccess`. */
  run: (request: Req, onSuccess: (response: Res) => void) => void;
  /** Aborts the request on its way and forgets the last error. */
  cancel: () => void;
  /** Forgets the last error. */
  reset: () => void;
  pending: boolean;
  error: unknown;
}

/**
 * One translator request at a time. Live editing sends a request per pause in typing, so a newer
 * one aborts the older, and an answer that arrives late anyway never replaces a newer one.
 */
export function useLatestRequest<Req, Res>(
  send: (request: Req, signal: AbortSignal) => Promise<Res>,
): LatestRequest<Req, Res> {
  const controller = useRef<AbortController | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<unknown>(null);
  // The latest `send`, so `run` keeps one identity while the caller's closure changes.
  const sender = useRef(send);
  useEffect(() => {
    sender.current = send;
  });
  useEffect(() => () => controller.current?.abort(), []);

  const run = useCallback((request: Req, onSuccess: (response: Res) => void) => {
    controller.current?.abort();
    const current = new AbortController();
    controller.current = current;
    setPending(true);
    setError(null);
    sender
      .current(request, current.signal)
      .then((response) => {
        if (controller.current === current) onSuccess(response);
      })
      .catch((err: unknown) => {
        // An aborted request is not a failure; neither is one a newer request replaced.
        if (controller.current === current && !current.signal.aborted) setError(err);
      })
      .finally(() => {
        if (controller.current === current) {
          controller.current = null;
          setPending(false);
        }
      });
  }, []);

  const cancel = useCallback(() => {
    controller.current?.abort();
    controller.current = null;
    setPending(false);
    setError(null);
  }, []);

  const reset = useCallback(() => setError(null), []);

  return { run, cancel, reset, pending, error };
}

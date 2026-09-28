import { useCallback, useEffect, useRef, useState } from 'react';
import axios from 'axios';
import { API_BASE_URL } from '../api';
import type { SearchResponse } from '../types';

/**
 * The request half of the shell header's global search (card KI-837).
 *
 * THE ONE DEBOUNCE. `GlobalSearch` calls `search(text)` on every keystroke and
 * this hook alone decides when a request goes out: 250 ms after the last
 * keystroke, like `KbCatalogPanel` before it. Nothing else in the app delays
 * or re-issues `GET /api/search`.
 *
 * WHY IT IS EVENT-DRIVEN, NOT AN EFFECT ON THE QUERY. The DS `Combobox` in
 * server mode leaves the loading state, the minimum length and stale-response
 * handling to the consumer (DESIGN_SYSTEM.md, Combobox row). Driving them from
 * the keystroke handler means `loading` is set in the same event that changed
 * the text, so there is no render in which the field shows a new query next
 * to the previous query's results, and no `setState` inside an effect.
 *
 * STALE RESPONSES ARE DROPPED TWICE, deliberately:
 *  - every call to `search` bumps `requestId`, and a response is applied only
 *    if it still carries the current id — so a slow answer to „Re" can never
 *    overwrite the answer to „Recht", even if it resolves last;
 *  - the previous request is also aborted, which saves the server the work
 *    but is NOT what correctness rests on: a response can already be resolved
 *    and queued when the abort lands.
 *
 * 429 IS A STATE, NOT AN ERROR (API.md: 60/min per client IP, `Retry-After`
 * 1–60 s). The hook remembers until when the budget is spent; keystrokes
 * during that window only move the pending request to the window's end, and
 * the newest query is sent automatically once it has passed. The caller shows
 * a calm inline line; no toast is raised anywhere in this path.
 */

export const SEARCH_DEBOUNCE_MS = 250;
/** The server answers 400 below this many characters (trimmed). */
export const SEARCH_MIN_QUERY_CHARS = 2;
/** …and above this many. */
export const SEARCH_MAX_QUERY_CHARS = 200;
/** Used when a 429 carries no parseable `Retry-After`. */
const DEFAULT_RETRY_AFTER_S = 10;

export type GlobalSearchState =
  | { status: 'idle' }
  | { status: 'loading'; query: string }
  | { status: 'done'; query: string; results: SearchResponse }
  | { status: 'rate-limited'; query: string }
  /** 404 on a scoped search: the topic is gone or no longer visible (KI-838). */
  | { status: 'not-found'; query: string }
  | { status: 'error'; query: string };

/**
 * Whether `text` is a query the server accepts. Counted in characters (code
 * points), not UTF-16 units, because that is how API.md counts them: „ßü" is
 * two characters and a valid query.
 */
export function isSearchableQuery(text: string): boolean {
  const n = Array.from(text.trim()).length;
  return n >= SEARCH_MIN_QUERY_CHARS && n <= SEARCH_MAX_QUERY_CHARS;
}

/** Seconds from a `Retry-After` header, clamped to the documented 1–60. */
function retryAfterSeconds(headers: unknown): number {
  const h = (headers ?? {}) as Record<string, unknown> & { get?: (k: string) => unknown };
  const raw = typeof h.get === 'function' ? h.get('retry-after') : (h['retry-after'] ?? h['Retry-After']);
  const n = Number(raw);
  // TODO: an HTTP-date Retry-After (RFC 9110 allows it) falls back to the
  // default; API.md documents seconds only — not yet confirmed that the
  // backend never sends a date.
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_RETRY_AFTER_S;
  return Math.min(60, Math.max(1, Math.ceil(n)));
}

/** All four arrays, whatever arrived: API.md promises them, a proxy may not. */
function normalise(data: unknown, query: string): SearchResponse {
  const d = (data && typeof data === 'object' && !Array.isArray(data) ? data : {}) as Partial<SearchResponse>;
  return {
    query: typeof d.query === 'string' ? d.query : query,
    kbId: d.kbId ?? null,
    topics: Array.isArray(d.topics) ? d.topics : [],
    sources: Array.isArray(d.sources) ? d.sources : [],
    chats: Array.isArray(d.chats) ? d.chats : [],
    messages: Array.isArray(d.messages) ? d.messages : [],
  };
}

/**
 * THE SCOPE IS PER CALL, not per hook (KI-838). `search(text, kbId)` sends
 * `kb_id`, which restricts every group to that topic; `search(text)` searches
 * everything. The workspace search widens by repeating the same text without
 * the id, so the scope has to be an argument of the request rather than a
 * setting of the hook. A hidden, unknown or malformed topic id answers 404
 * (API.md — never 403), which becomes the `not-found` state.
 */
export function useGlobalSearch() {
  const [state, setState] = useState<GlobalSearchState>({ status: 'idle' });
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const controller = useRef<AbortController | null>(null);
  const requestId = useRef(0);
  const blockedUntil = useRef(0);
  /** The trimmed text of the last `search` call; null until the first one. */
  const lastIssued = useRef<string | null>(null);

  const send = useCallback((query: string, id: number, scopeKbId: string | undefined) => {
    // A named inner function so a 429 can schedule the same attempt again.
    function attempt() {
      controller.current?.abort();
      const ac = new AbortController();
      controller.current = ac;
      const params = new URLSearchParams({ q: query });
      if (scopeKbId) params.set('kb_id', scopeKbId);
      axios.get(`${API_BASE_URL}/api/search?${params}`, { signal: ac.signal })
        .then((res) => {
          if (id !== requestId.current) return;
          setState({ status: 'done', query, results: normalise(res?.data, query) });
        })
        .catch((err: unknown) => {
          // Superseded (which includes our own abort): the newer call owns the state.
          if (id !== requestId.current || ac.signal.aborted) return;
          const response = (err as { response?: { status?: number; headers?: unknown } })?.response;
          if (response?.status === 404 && scopeKbId) {
            setState({ status: 'not-found', query });
            return;
          }
          if (response?.status === 429) {
            const wait = retryAfterSeconds(response.headers) * 1000;
            blockedUntil.current = Date.now() + wait;
            setState({ status: 'rate-limited', query });
            // Retry the same (still newest) query once the window has passed.
            timer.current = setTimeout(attempt, wait);
            return;
          }
          console.error('Global search failed:', err);
          setState({ status: 'error', query });
        });
    }
    attempt();
  }, []);

  const search = useCallback((text: string, scopeKbId?: string) => {
    const query = text.trim();
    clearTimeout(timer.current);
    // Invalidates whatever is in flight BEFORE anything else can resolve.
    const id = ++requestId.current;
    controller.current?.abort();
    controller.current = null;
    lastIssued.current = query;
    if (!isSearchableQuery(query)) {
      setState({ status: 'idle' });
      return;
    }
    const blockedFor = blockedUntil.current - Date.now();
    if (blockedFor > 0) {
      // Still inside the rate-limit window: keep saying so, send at its end.
      setState({ status: 'rate-limited', query });
      timer.current = setTimeout(() => send(query, id, scopeKbId), blockedFor);
      return;
    }
    setState({ status: 'loading', query });
    timer.current = setTimeout(() => send(query, id, scopeKbId), SEARCH_DEBOUNCE_MS);
  }, [send]);

  /** False until this instance has been asked to search anything. */
  const hasSearched = useCallback(() => lastIssued.current !== null, []);

  // Unmount: nothing may resolve into a component that is gone. The ref
  // OBJECTS are captured so the cleanup reads their latest `.current` (the
  // same pattern as useChat's timer cleanup).
  useEffect(() => {
    const pendingTimer = timer;
    const inFlight = controller;
    return () => {
      clearTimeout(pendingTimer.current);
      inFlight.current?.abort();
    };
  }, []);

  return { state, search, hasSearched };
}

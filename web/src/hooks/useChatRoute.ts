import { useCallback, useEffect, useRef, useState } from 'react';
import axios from 'axios';
import type { ChatEntry } from '../types';
import type { AppNavigate } from '../routing/navigation';
import { API_BASE_URL } from '../api';
import { useTheme } from '../contexts/ThemeContext';
import { useToast } from '../contexts/ToastContext';

/** What a chat URL (`/c/<id>`) is known to belong to. */
export type ChatTopic =
  | { status: 'pending' }
  /** `entry` is the chat's row when it was fetched, null when the app made the URL itself. */
  | { status: 'found'; kbId: string; entry: ChatEntry | null }
  /** Not the caller's, gone, or not a topic's chat (a library chat). Already toasted. */
  | { status: 'missing' }
  /** The lookup failed (network, 5xx). Already toasted; the URL is replaced, and forgotten once it moves on, so a later visit asks again. */
  | { status: 'failed' };

export type FetchedChat = { kind: 'found'; entry: ChatEntry } | { kind: 'gone' } | { kind: 'failed' };

/** GET /api/chats/{id}. Only a 404 means the chat is not there; anything else may pass. */
export async function fetchChat(chatId: string): Promise<FetchedChat> {
  try {
    const res = await axios.get<ChatEntry>(`${API_BASE_URL}/api/chats/${encodeURIComponent(chatId)}`);
    const row: unknown = res.data;
    return row && typeof row === 'object' && (row as ChatEntry).id === chatId
      ? { kind: 'found', entry: row as ChatEntry }
      : { kind: 'gone' };
  } catch (err: unknown) {
    return axios.isAxiosError(err) && err.response?.status === 404 ? { kind: 'gone' } : { kind: 'failed' };
  }
}

/**
 * The topic of the chat the URL names. A chat URL carries the chat alone, so
 * its topic comes from GET /api/chats/{id} — or, for a URL the app wrote
 * itself (a chat picked in the history, a new chat's first answer), from
 * `remember`, called before that navigation so the workspace never waits on
 * a request for a chat it already shows.
 */
export function useChatTopic(routeChatId: string | null) {
  const { t } = useTheme();
  const toast = useToast();
  const [known, setKnown] = useState<ReadonlyMap<string, ChatTopic>>(new Map());
  const knownRef = useRef(known);
  useEffect(() => { knownRef.current = known; });
  const say = useRef({ t, toast });
  useEffect(() => { say.current = { t, toast }; });

  useEffect(() => {
    if (!routeChatId || knownRef.current.has(routeChatId)) return;
    let cancelled = false;
    void fetchChat(routeChatId).then((fetched) => {
      if (cancelled) return;
      const topic: ChatTopic = fetched.kind === 'failed' ? { status: 'failed' }
        : fetched.kind === 'found' && fetched.entry.kbId ? { status: 'found', kbId: fetched.entry.kbId, entry: fetched.entry }
        : { status: 'missing' };
      if (topic.status !== 'found') say.current.toast.error(say.current.t('chatLoadError'));
      setKnown((m) => new Map(m).set(routeChatId, topic));
    });
    return () => {
      cancelled = true;
      // A failed lookup is not an answer: the next visit asks again.
      setKnown((m) => {
        if (m.get(routeChatId)?.status !== 'failed') return m;
        const next = new Map(m);
        next.delete(routeChatId);
        return next;
      });
    };
  }, [routeChatId]);

  const remember = useCallback((chatId: string, kbId: string) => {
    setKnown((m) => (m.get(chatId)?.status === 'found' ? m : new Map(m).set(chatId, { status: 'found', kbId, entry: null })));
  }, []);

  const topic: ChatTopic | null = routeChatId ? known.get(routeChatId) ?? { status: 'pending' } : null;
  return { topic, remember };
}

interface UseChatRouteParams {
  /** The open topic, once it is the one the URL names (null while it loads, or on another view). */
  kbId: string | null;
  /** The chat the URL names (`/c/<id>`), or null for a topic's new chat (`/kb/<id>`). */
  routeChatId: string | null;
  /** The URL's chat row, when `useChatTopic` fetched it. */
  routeChatEntry: ChatEntry | null;
  /** The chat on screen (useChat). */
  activeChatId: string | null;
  /** The topic's chat list, when loaded — the first place a chat is looked up. */
  chats: ChatEntry[];
  /** A turn is being sent: a chat id that appears now is the new chat's own. */
  sending: boolean;
  selectChat: (entry: ChatEntry) => Promise<void> | void;
  newChat: () => void;
  /** `useChatTopic().remember`: the topic of a chat URL the app is about to write. */
  rememberTopic: (chatId: string, kbId: string) => void;
  navigateTo: AppNavigate;
}

/**
 * Keeps the chat on screen and the chat in the URL the same, in both
 * directions.
 *
 * WHO MOVED DECIDES. Each side remembers the value it had at the last sync:
 *  - the URL moved (back/forward, a link, a reload) → open what it names: the
 *    chat (its row from the list or GET /api/chats/{id}, which carries the
 *    sticky team/agent), or a new chat;
 *  - the chat moved (the history panel, a search hit, a branch, „Neuer
 *    Chat", a deleted chat) → write it into the URL.
 * Every chat change in the app goes through `useChat`, so none of its callers
 * had to learn about URLs.
 *
 * PUSH OR REPLACE. A chat change is a step of its own (back returns to the
 * previous chat), with one exception: the id a NEW chat receives with its
 * first answer replaces `/kb/<id>`, so back does not land on an empty chat.
 *
 * Waits while the topic is not yet the one the URL names: opening a topic
 * starts a new chat, which would otherwise undo a chat selected before it.
 * Only normal chats are shown in a topic; a URL naming a research session
 * falls back to the topic.
 */
export function useChatRoute(p: UseChatRouteParams) {
  const { t } = useTheme();
  const toast = useToast();
  const latest = useRef({ ...p, t, toast });
  useEffect(() => { latest.current = { ...p, t, toast }; });

  // undefined = never synced, so the URL a page loads with counts as a move.
  const synced = useRef<{ route: string | null | undefined; chat: string | null }>({ route: undefined, chat: p.activeChatId });
  // The chat list as of the last sync: a chat that was in it and has left it
  // was deleted (a chat never listed — a new one before the list refreshed,
  // one opened from search — is not).
  const listedBefore = useRef<ReadonlySet<string>>(new Set());

  const { kbId, routeChatId, activeChatId } = p;
  useEffect(() => {
    if (!kbId) return;
    const last = synced.current;
    const { selectChat, newChat, navigateTo, rememberTopic, chats, routeChatEntry, sending } = latest.current;

    if (last.route !== routeChatId && routeChatId !== activeChatId) {
      synced.current = { route: routeChatId, chat: activeChatId };
      if (!routeChatId) {
        newChat();
        return;
      }
      const wanted = routeChatId;
      void (async () => {
        let entry = chats.find((c) => c.id === wanted) ?? (routeChatEntry?.id === wanted ? routeChatEntry : null);
        let failed = false;
        if (!entry) {
          const fetched = await fetchChat(wanted);
          entry = fetched.kind === 'found' ? fetched.entry : null;
          failed = fetched.kind === 'failed';
        }
        if (synced.current.route !== wanted) return; // the URL moved on meanwhile
        if (failed) {
          // Not an answer about the chat: keep its URL, so a reload retries.
          latest.current.toast.error(latest.current.t('chatLoadError'));
          return;
        }
        if (!entry || (entry.type && entry.type !== 'chat')) {
          latest.current.toast.error(latest.current.t('chatLoadError'));
          navigateTo({ view: 'kb', kbId }, { replace: true });
          return;
        }
        await selectChat(entry);
      })();
      return;
    }

    if (last.chat !== activeChatId && activeChatId !== routeChatId) {
      const firstAnswer = last.chat === null && routeChatId === null && sending;
      if (activeChatId) {
        rememberTopic(activeChatId, kbId);
        // The first answer's URL change is not a step of the user's: it
        // replaces the entry and keeps any dialog open over the chat.
        navigateTo({ view: 'chat', chatId: activeChatId }, { replace: firstAnswer, keepSearch: firstAnswer });
      } else {
        // A chat that just left the list was deleted: replace its URL, so
        // back does not return to it.
        const deleted = last.chat !== null && listedBefore.current.has(last.chat) && !chats.some((c) => c.id === last.chat);
        navigateTo({ view: 'kb', kbId }, { replace: deleted });
      }
    }
    synced.current = { route: routeChatId, chat: activeChatId };
  }, [kbId, routeChatId, activeChatId]);

  // After the sync above, so it compares against the list of the previous run.
  useEffect(() => { listedBefore.current = new Set(p.chats.map((c) => c.id)); }, [p.chats]);
}

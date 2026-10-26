import { useCallback } from 'react';
import type { ChatEntry, KnowledgeBase, SearchChatType } from '../types';
import { kbSourceRights } from '../utils/kbAccess';
import { fetchChat } from './useChatRoute';

/**
 * Where a global-search hit takes you (card KI-837). A destination inside a
 * topic is the topic's URL plus state in `AuthenticatedApp` (the open chat,
 * the source preview), so these are sequences of the existing hook calls, in
 * the one order that works.
 *
 * THE ORDERING TRAP. Opening a topic (`handleOpenKbById` → `handleSelectKB`)
 * calls `onKBSelected`, which is `useChat.handleNewChat`: it resets the active
 * chat, the message tree and the agent selection to a fresh, empty chat. A
 * chat selected BEFORE that has run is therefore overwritten by an empty one.
 * So every in-topic destination AWAITS the topic first and only then acts,
 * and does nothing if the topic could not be opened (`handleOpenKbById` has
 * already toasted why). `App.authenticated-home.test.tsx` pins that the chosen
 * chat's messages are what ends up on screen.
 *
 * WHY A CHAT HIT IS RE-READ FROM `GET /api/chats/{id}`. `handleSelectChat`
 * restores the chat's sticky team/agent from `ChatEntry.teamId/agentId`, and a
 * search hit carries neither. Built from the hit alone, a chat bound to a team
 * would open with the selection cleared — and the next turn would send no
 * team, which the backend persists as a cleared binding
 * (`UpdateChatAgentSelection`: NULLs clear it). The route returns the chat's
 * row, the same shape as the sidebar's list, and is fetched in parallel with
 * the topic so it costs no extra wait. If it fails, the hit's own fields are
 * used — `type` is what `handleSelectChat` needs to route research sessions,
 * and the backend returns it for exactly that reason.
 *
 * Scrolling to the matched message is out of scope.
 * // TODO: jump to the message, not only the chat — not yet carded.
 */

export interface SearchChatTarget {
  chatId: string;
  kbId: string;
  title: string;
  type: SearchChatType;
  /** RFC 3339; used only if the chat list does not return the entry. */
  timestamp: string;
}

export interface SearchSourceTarget {
  id: string;
  name: string;
  kbId: string;
}

interface UseSearchNavigationParams {
  /** `useKnowledgeBases.handleOpenKbById` — resolves to the opened KB, or null. */
  openKbById: (id: string) => Promise<KnowledgeBase | null>;
  /** `useWebTools.handlePreviewSource`. */
  previewSource: (id: string, name: string) => void;
  /** `useChat.handleSelectChat`. */
  selectChat: (entry: ChatEntry) => Promise<void> | void;
}

/**
 * A `ChatEntry` built from a search hit alone — the fallback when the chat
 * list does not carry the chat. `type` is what `handleSelectChat` routes on;
 * `teamId`/`agentId` are unknown here (see the header above).
 */
export function chatEntryFromTarget(target: SearchChatTarget): ChatEntry {
  return {
    id: target.chatId,
    kbId: target.kbId,
    // Not in the hit; `handleSelectChat` does not read it.
    userId: '',
    title: target.title,
    type: target.type,
    createdAt: target.timestamp,
    updatedAt: target.timestamp,
  };
}

async function fetchChatEntry(chatId: string): Promise<ChatEntry | null> {
  const fetched = await fetchChat(chatId);
  return fetched.kind === 'found' ? fetched.entry : null;
}

export function useSearchNavigation({ openKbById, previewSource, selectChat }: UseSearchNavigationParams) {
  const openTopic = useCallback((kbId: string) => {
    void openKbById(kbId);
  }, [openKbById]);

  const openSource = useCallback(async (source: SearchSourceTarget) => {
    const kb = await openKbById(source.kbId);
    if (!kb) return;
    // The preview loads the file: without downloadSources the hit only opens
    // its topic. (The fallback ladder of kbSourceRights needs no role here —
    // without capabilities downloads are open to everyone.)
    if (!kbSourceRights(kb).downloadSources) return;
    previewSource(source.id, source.name);
  }, [openKbById, previewSource]);

  const openChat = useCallback(async (target: SearchChatTarget) => {
    const [opened, listed] = await Promise.all([
      openKbById(target.kbId),
      fetchChatEntry(target.chatId),
    ]);
    if (!opened) return;
    const entry: ChatEntry = listed ?? chatEntryFromTarget(target);
    // Only now: `handleNewChat` ran inside `openKbById`, so this selection is
    // the last write to the chat state rather than the first.
    await selectChat(entry);
  }, [openKbById, selectChat]);

  return { openTopic, openSource, openChat };
}

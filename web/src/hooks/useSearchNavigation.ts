import { useCallback } from 'react';
import axios from 'axios';
import { API_BASE_URL } from '../api';
import type { ChatEntry, SearchChatType } from '../types';

/**
 * Where a global-search hit takes you (card KI-837). The app has no router —
 * every destination is state in `AuthenticatedApp` — so these are sequences of
 * the existing hook calls, in the one order that works.
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
 * WHY A CHAT HIT IS RE-READ FROM `GET /api/kb/{id}/chats`. `handleSelectChat`
 * restores the chat's sticky team/agent from `ChatEntry.teamId/agentId`, and a
 * search hit carries neither. Built from the hit alone, a chat bound to a team
 * would open with the selection cleared — and the next turn would send no
 * team, which the backend persists as a cleared binding
 * (`UpdateChatAgentSelection`: NULLs clear it). The list is the sidebar's own
 * source for `ChatEntry`, fetched in parallel with the topic so it costs no
 * extra wait. If the chat is not in it (or the request fails), the hit's own
 * fields are used — `type` is what `handleSelectChat` needs to route research
 * sessions, and the backend returns it for exactly that reason.
 * // TODO: the list is fetched twice on this path (here and by
 * // useKbLifecycle's KB-change effect) — accepted for now, not yet measured.
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
  /** `useKnowledgeBases.handleOpenKbById` — resolves to whether it opened. */
  openKbById: (id: string) => Promise<boolean>;
  /** `useWebTools.handlePreviewSource`. */
  previewSource: (id: string, name: string) => void;
  /** `useChat.handleSelectChat`. */
  selectChat: (entry: ChatEntry) => Promise<void> | void;
}

async function fetchChatEntry(kbId: string, chatId: string): Promise<ChatEntry | null> {
  try {
    const res = await axios.get(`${API_BASE_URL}/api/kb/${kbId}/chats`);
    const list: unknown = res?.data;
    if (!Array.isArray(list)) return null;
    return (list as ChatEntry[]).find((c) => c && c.id === chatId) ?? null;
  } catch {
    return null;
  }
}

export function useSearchNavigation({ openKbById, previewSource, selectChat }: UseSearchNavigationParams) {
  const openTopic = useCallback((kbId: string) => {
    void openKbById(kbId);
  }, [openKbById]);

  const openSource = useCallback(async (source: SearchSourceTarget) => {
    if (!(await openKbById(source.kbId))) return;
    previewSource(source.id, source.name);
  }, [openKbById, previewSource]);

  const openChat = useCallback(async (target: SearchChatTarget) => {
    const [opened, listed] = await Promise.all([
      openKbById(target.kbId),
      fetchChatEntry(target.kbId, target.chatId),
    ]);
    if (!opened) return;
    const entry: ChatEntry = listed ?? {
      id: target.chatId,
      kbId: target.kbId,
      // Not in the hit; `handleSelectChat` does not read it.
      userId: '',
      title: target.title,
      type: target.type,
      createdAt: target.timestamp,
      updatedAt: target.timestamp,
    };
    // Only now: `handleNewChat` ran inside `openKbById`, so this selection is
    // the last write to the chat state rather than the first.
    await selectChat(entry);
  }, [openKbById, selectChat]);

  return { openTopic, openSource, openChat };
}

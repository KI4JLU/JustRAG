import { createContext, useContext, type ReactNode } from 'react';
import type { ChatListEntry, ChatSection } from '../types';
import type { TopicSection } from '../utils/topicSection';

/**
 * The sidebar's chat history: the user's chats across all topics, on every
 * view. Its own context rather than part of the topic workspace's, because
 * the sidebar is there when no topic is open.
 */
export interface ChatHistoryContextValue {
  /** The user's chats across topics, newest first. */
  chats: ChatListEntry[];
  /** The chat on screen; null when no topic is open. */
  activeChatId: string | null;
  /** The open topic; null on the overview pages. */
  openTopicId: string | null;
  /** The overview a chat's topic is listed in. */
  sectionOf: (chat: ChatListEntry) => TopicSection;
  /** Open a chat, in whichever topic it belongs to. */
  openChat: (chat: ChatListEntry) => void;
  /** Save the user's order of their sections: all ids, front to back. */
  reorderSections: (ids: string[]) => void;
  /** Ask once, then delete; resolves false when the user declined. */
  deleteChats: (ids: string[]) => Promise<boolean>;
  renameChat: (id: string, currentTitle: string) => void;
  /** Keep a chat at hand — in „Angepinnt", or in the section named — or let it go again. */
  pinChat: (id: string, pinned: boolean, sectionId?: string | null) => void;
  /** Save the user's own order of one section's chats („Angepinnt": null): all their ids, front to back. */
  reorderPinned: (ids: string[], sectionId: string | null) => void;
  /** File a chat at a place in a section („Angepinnt": null): `ids` is the section's new order, the chat in it. */
  fileChat: (id: string, sectionId: string | null, ids: string[]) => void;
  /** The user's own sections, oldest first. */
  sections: ChatSection[];
  /** Create a section under the default name; the panel then lets the user name it in place. Null when it failed. */
  createSection: () => Promise<ChatSection | null>;
  /** Give a section another name. */
  renameSection: (section: ChatSection, name: string) => void;
  /** Ask once, then delete; its chats go back to the plain history. */
  deleteSection: (section: ChatSection) => void;
  /** Start a chat in the open topic; null when no topic is open. */
  newChat: (() => void) | null;
  /** Create a topic: the sidebar's primary action while no topic is open. */
  newTopic: (() => void) | null;
}

/* Without a provider the history is empty: a page rendered on its own (a
   test, a story) has a sidebar, and no chats to list in it. */
const EMPTY: ChatHistoryContextValue = {
  chats: [],
  activeChatId: null,
  openTopicId: null,
  sectionOf: () => 'my-topics',
  openChat: () => {},
  deleteChats: async () => false,
  renameChat: () => {},
  pinChat: () => {},
  reorderPinned: () => {},
  fileChat: () => {},
  sections: [],
  createSection: async () => null,
  renameSection: () => {},
  reorderSections: () => {},
  deleteSection: () => {},
  newChat: null,
  newTopic: null,
};

const ChatHistoryContext = createContext<ChatHistoryContextValue>(EMPTY);

export function ChatHistoryProvider({ value, children }: { value: ChatHistoryContextValue; children: ReactNode }) {
  return <ChatHistoryContext.Provider value={value}>{children}</ChatHistoryContext.Provider>;
}

export function useChatHistory(): ChatHistoryContextValue {
  return useContext(ChatHistoryContext);
}

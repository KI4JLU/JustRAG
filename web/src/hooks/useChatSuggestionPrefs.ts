import { STORAGE_NAMESPACE, useSharedStoredChoice, useSharedStoredFlag } from './useStoredFlag';

/** User setting: starter suggestions under the composer of an empty chat. On by default. */
export const usePromptSuggestionsEnabled = () =>
    useSharedStoredFlag(`${STORAGE_NAMESPACE}chat.promptSuggestions`, true);

/** User setting: "Weiterfragen" follow-up questions under the latest answer. On by default. */
export const useFollowUpsEnabled = () =>
    useSharedStoredFlag(`${STORAGE_NAMESPACE}chat.followUps`, true);

/**
 * User setting: the transcript follows a streaming answer down to its end. Off by default —
 * the question then stays near the top and the answer grows below it, so reading is never
 * pulled away (the DS `MessageScroller`'s own default).
 */
export const useAutoScrollEnabled = () =>
    useSharedStoredFlag(`${STORAGE_NAMESPACE}chat.autoScroll`, false);

/** How wide the transcript and the composer may grow on a large screen. */
export const CHAT_WIDTHS = ['comfortable', 'wide', 'full'] as const;
export type ChatWidth = typeof CHAT_WIDTHS[number];

/**
 * User setting: the chat column's width. `comfortable` by default — a reading
 * column; the widths themselves are CSS (`.chat-column[data-chat-width]`).
 */
export const useChatWidth = () =>
    useSharedStoredChoice<ChatWidth>(`${STORAGE_NAMESPACE}chat.width`, CHAT_WIDTHS, 'comfortable');

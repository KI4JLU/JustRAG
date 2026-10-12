import { STORAGE_NAMESPACE, useSharedStoredFlag } from './useStoredFlag';

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

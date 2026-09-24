import { STORAGE_NAMESPACE, useSharedStoredFlag } from './useStoredFlag';

/** User setting: starter suggestions under the composer of an empty chat. On by default. */
export const usePromptSuggestionsEnabled = () =>
    useSharedStoredFlag(`${STORAGE_NAMESPACE}chat.promptSuggestions`, true);

/** User setting: "Weiterfragen" follow-up questions under the latest answer. On by default. */
export const useFollowUpsEnabled = () =>
    useSharedStoredFlag(`${STORAGE_NAMESPACE}chat.followUps`, true);

import { useCallback, useState } from 'react';

/**
 * Expandable sections inside an answer whose open/closed state changes the
 * message's rendered height.
 */
export type MessageSection = 'reasoning' | 'sources' | 'confidence' | 'conflicts';

/**
 * Per-message expand state, owned ABOVE the message list.
 *
 * Introduced for the old react-virtuoso list, which unmounted off-screen
 * messages: expand state held inside the message component (`useState`, or the
 * DOM state of a native `<details open>`) died with the node, and the height
 * change threw the scroll position. The DS MessageScroller keeps every row
 * mounted, but it still remounts the whole transcript on chat switch, and the
 * caller-owned state keeps the open/closed sections independent of that.
 */
export function useMessageSections() {
    const [openKeys, setOpenKeys] = useState<ReadonlySet<string>>(() => new Set());

    const isOpen = useCallback(
        (messageId: string | undefined, section: MessageSection) =>
            messageId ? openKeys.has(`${messageId}:${section}`) : false,
        [openKeys],
    );

    // Stable across renders (functional update, no deps) so it doesn't defeat
    // the memo() on MessageBubble.
    const toggle = useCallback((messageId: string, section: MessageSection) => {
        setOpenKeys(prev => {
            const next = new Set(prev);
            const key = `${messageId}:${section}`;
            if (!next.delete(key)) next.add(key);
            return next;
        });
    }, []);

    return { isOpen, toggle };
}

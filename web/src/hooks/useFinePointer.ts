import { useSyncExternalStore } from 'react';

const QUERY = '(hover: hover) and (pointer: fine)';

function subscribe(onChange: () => void): () => void {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return () => {};
    const mq = window.matchMedia(QUERY);
    mq.addEventListener?.('change', onChange);
    return () => mq.removeEventListener?.('change', onChange);
}

function snapshot(): boolean {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return true;
    return window.matchMedia(QUERY).matches;
}

/**
 * Whether the primary input can hover with a precise pointer (a mouse or a
 * trackpad). Decides by input, not by width: a source preview opens as a
 * hover popover there and as a bottom sheet everywhere else.
 */
export function useFinePointer(): boolean {
    return useSyncExternalStore(subscribe, snapshot, () => true);
}

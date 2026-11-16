/* ⌘K on Apple platforms, Ctrl+K elsewhere — the convention of every
   command-palette search (GitHub, Slack, Linear, the shadcn docs). Read once:
   the platform does not change while the page is open. */
export const IS_APPLE = typeof navigator !== 'undefined'
  && /Mac|iPhone|iPad|iPod/.test(navigator.platform || navigator.userAgent);

export function isSearchShortcut(e: KeyboardEvent): boolean {
  return e.key.toLowerCase() === 'k'
    && (IS_APPLE ? e.metaKey && !e.ctrlKey : e.ctrlKey && !e.metaKey)
    && !e.altKey && !e.shiftKey;
}

/** For `aria-keyshortcuts`. */
export const SEARCH_KEYSHORTCUT = IS_APPLE ? 'Meta+K' : 'Control+K';

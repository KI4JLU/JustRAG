/**
 * The desktop app's bridge (design system → Storybook „Native shell"). The
 * Electron host exposes it; in a browser it does not exist, so every call
 * site uses optional chaining and does nothing there.
 */
interface NativeShell {
  /** Mirrors the colour scheme to the window, so its material matches. */
  setTheme(theme: 'light' | 'dark' | 'system'): void;
  /** The system's name („RAG", „Atlas"): the host draws its app icon from the first letter. */
  setAppName?(name: string): void;
  /** The menu's „Neuer Chat" (⌘N / Ctrl+N) was chosen. Returns the unsubscribe. */
  onNewChat?(callback: () => void): () => void;
}

interface Window {
  nativeShell?: NativeShell;
}

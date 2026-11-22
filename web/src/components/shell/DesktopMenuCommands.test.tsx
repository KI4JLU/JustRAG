import { render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DesktopMenuCommands } from './DesktopMenuCommands';

const handleNewChat = vi.fn();
vi.mock('../../contexts/KbChatContext', () => ({ useKbChat: () => ({ chat: { handleNewChat } }) }));

/*
 * ORACLE: the bridge's contract (design system, „Native shell" → Menu
 * shortcuts): `onNewChat(callback)` subscribes and returns the unsubscribe;
 * in a browser `window.nativeShell` does not exist.
 */
afterEach(() => {
  delete window.nativeShell;
  vi.clearAllMocks();
});

describe('DesktopMenuCommands', () => {
  it('does nothing in a browser', () => {
    expect(() => render(<DesktopMenuCommands />)).not.toThrow();
    expect(handleNewChat).not.toHaveBeenCalled();
  });

  it('starts a new chat when the desktop menu reports it, and unsubscribes on unmount', () => {
    let reported: (() => void) | undefined;
    const unsubscribe = vi.fn();
    window.nativeShell = {
      setTheme: () => {},
      onNewChat: (callback) => { reported = callback; return unsubscribe; },
    };
    const { unmount } = render(<DesktopMenuCommands />);
    expect(handleNewChat).not.toHaveBeenCalled();
    reported?.();
    expect(handleNewChat).toHaveBeenCalledTimes(1);
    unmount();
    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });
});

import { useEffect } from 'react';
import { useKbCore } from '../contexts/KbCoreContext';
import { useKbChat } from '../contexts/KbChatContext';

/**
 * The desktop app's menu commands that act on the open topic. Today one:
 * „Neuer Chat" (⌘N / Ctrl+N), which does what the sidebar's row does. The
 * host owns the shortcut — a browser keeps ⌘N for a new window, so the
 * website has none — and reports it through the bridge; in a browser the
 * bridge does not exist and this renders and does nothing.
 */
export function DesktopMenuCommands() {
  const { setKbView } = useKbCore();
  const { chat } = useKbChat();
  const { handleNewChat } = chat;
  useEffect(
    () => window.nativeShell?.onNewChat?.(() => {
      handleNewChat();
      setKbView('chat');
    }),
    [handleNewChat, setKbView],
  );
  return null;
}

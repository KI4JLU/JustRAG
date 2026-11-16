import { Kbd, KbdGroup } from '@ki4jlu/design-system';
import { useTheme } from '../contexts/ThemeContext';
import { IS_APPLE } from '../utils/searchShortcut';

export interface ShortcutHintProps {
  /** The key pressed with ⌘ (Apple) or Ctrl (elsewhere). */
  letter: string;
  /**
   * The shortcut only exists in the desktop app (a browser keeps it for
   * itself). The design system then shows the hint there and nowhere else —
   * the app does not ask where it runs.
   */
  desktopOnly?: boolean;
}

/**
 * A row's shortcut — ⌘K, Ctrl N — at its end, shown while the row is hovered
 * or has keyboard focus. Decorative: the row carries `aria-keyshortcuts`.
 */
export function ShortcutHint({ letter, desktopOnly }: ShortcutHintProps) {
  const { t } = useTheme();
  return (
    <span
      aria-hidden="true"
      data-desktop-only={desktopOnly ? '' : undefined}
      className="ml-auto opacity-0 transition-opacity [button:focus-visible_&]:opacity-100 [button:hover_&]:opacity-100"
    >
      <KbdGroup>
        <Kbd>{IS_APPLE ? '⌘' : t('kbdCtrl')}</Kbd>
        <Kbd>{letter}</Kbd>
      </KbdGroup>
    </span>
  );
}

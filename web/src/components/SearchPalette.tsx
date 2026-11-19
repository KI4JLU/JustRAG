import { useEffect, type ReactNode } from 'react';
import {
  Dialog, DialogContent, DialogTitle, NavItem,
} from '@ki4jlu/design-system';
import { Search } from 'lucide-react';
import { useTheme } from '../contexts/ThemeContext';
import { ShortcutHint } from './ShortcutHint';
import { restoreSearchPaletteFocus, setSearchPaletteOpen, useSearchPaletteOpen } from '../hooks/useSearchPalette';
import { SEARCH_KEYSHORTCUT, isSearchShortcut } from '../utils/searchShortcut';

/**
 * The search as a palette: a dialog near the top of the window that is the
 * search field and its list. Opened by the sidebar's „Suchen" row
 * (`SearchNavRow`, `SearchActionRow`, `SearchRailButton`) or ⌘K / Ctrl+K;
 * closed by Escape, a click outside, or opening a hit — the field reports the
 * last two through `onClose` (see `GlobalSearch`).
 *
 * `children` is the view's search field (`GlobalSearch`, `WorkspaceSearch`),
 * mounted only while the palette is open, so it takes focus on open.
 */
export function SearchPalette({ children }: { children: ReactNode }) {
  const { t } = useTheme();
  const open = useSearchPaletteOpen();
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.defaultPrevented || !isSearchShortcut(e)) return;
      e.preventDefault();
      setSearchPaletteOpen(true);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);
  // The palette belongs to the view that mounted it: leaving the view closes it.
  useEffect(() => () => setSearchPaletteOpen(false), []);
  return (
    <Dialog open={open} onOpenChange={setSearchPaletteOpen}>
      <DialogContent
        showClose={false}
        aria-describedby={undefined}
        data-testid="search-palette"
        onCloseAutoFocus={(e) => {
          e.preventDefault();
          restoreSearchPaletteFocus();
        }}
        // The field and its list are the dialog's whole surface, so the box
        // itself paints nothing; near the top, so the list has room below.
        className="top-[12vh] block w-[calc(100vw-2rem)] max-w-[40rem] translate-y-0 border-0 bg-transparent p-0 shadow-none"
      >
        <DialogTitle className="sr-only">{t('searchPaletteTitle')}</DialogTitle>
        {children}
      </DialogContent>
    </Dialog>
  );
}

const openPalette = () => setSearchPaletteOpen(true);

/** „Suchen" as a row of the sidebar's primary navigation; icon-only in the rail. */
export function SearchNavRow() {
  const { t } = useTheme();
  return (
    <NavItem type="button" label={t('searchOpen')} aria-keyshortcuts={SEARCH_KEYSHORTCUT} aria-haspopup="dialog" onClick={openPalette}>
      <Search size={20} aria-hidden="true" />
      <span>{t('searchOpen')}</span>
      <ShortcutHint letter="K" />
    </NavItem>
  );
}

import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Input } from '@ki4jlu/design-system';
import { SearchNavRow, SearchPalette } from './SearchPalette';
import { setSearchPaletteOpen } from '../../hooks/useSearchPalette';

vi.mock('../../contexts/ThemeContext', () => ({ useTheme: () => ({ t: (k: string) => k }) }));

/*
 * ORACLE: the WAI-ARIA dialog pattern — a named modal dialog that takes
 * focus, closes on Escape and returns focus to what opened it — and the
 * command-palette convention ⌘K / Ctrl+K.
 */
afterEach(() => act(() => setSearchPaletteOpen(false)));

const field = () => screen.queryByRole('textbox', { name: 'Feld' });
const Palette = () => <SearchPalette><Input aria-label="Feld" /></SearchPalette>;

describe('SearchPalette', () => {
  it('is closed at rest and mounts no field', () => {
    render(<Palette />);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(field()).toBeNull();
  });

  it('opens from the nav row, focuses the field, and Escape gives focus back', async () => {
    render(<><SearchNavRow /><Palette /></>);
    const button = screen.getByRole('button', { name: /searchOpen/ });
    expect(button).toHaveAttribute('aria-haspopup', 'dialog');
    await userEvent.click(button);
    expect(screen.getByRole('dialog', { name: 'searchPaletteTitle' })).toBeInTheDocument();
    expect(field()).toHaveFocus();
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(button).toHaveFocus();
  });

  it('opens on the search shortcut', async () => {
    render(<Palette />);
    await userEvent.keyboard('{Control>}k{/Control}');
    expect(screen.getByRole('dialog', { name: 'searchPaletteTitle' })).toBeInTheDocument();
  });

  it('closes when the view that mounted it goes away', () => {
    const { unmount } = render(<Palette />);
    act(() => setSearchPaletteOpen(true));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    unmount();
    render(<Palette />);
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});

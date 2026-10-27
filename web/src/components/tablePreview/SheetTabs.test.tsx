import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Tabs } from '@ki4jlu/design-system';
import { SheetTabs } from './SheetTabs';

vi.mock('../../contexts/ThemeContext', () => ({
    useTheme: () => ({ t: (k: string) => k, language: 'de' }),
}));

const tabs = [
    { value: 'a', label: 'Bewertungskriterien', count: 9 },
    { value: 'b', label: 'Erhebung Nutzungsart', count: 15 },
    { value: 'c', label: 'Nutzungsarten' },
];

function renderTabs() {
    return render(<Tabs value="a"><SheetTabs tabs={tabs} active="a" /></Tabs>);
}

/** jsdom has no layout: give the strip a scroll geometry, then let it re-measure via a scroll event. */
function setGeometry(scrollLeft: number, clientWidth: number, scrollWidth: number) {
    const strip = screen.getByRole('tablist').parentElement!;
    Object.defineProperty(strip, 'scrollLeft', { configurable: true, value: scrollLeft });
    Object.defineProperty(strip, 'clientWidth', { configurable: true, value: clientWidth });
    Object.defineProperty(strip, 'scrollWidth', { configurable: true, value: scrollWidth });
    fireEvent.scroll(strip);
    return strip;
}

// Oracle: HANDOFF.md "Blatt-Tabs" — arrows only while the tabs overflow,
// disabled at the respective end, one click = 70 % of the visible width.
describe('SheetTabs', () => {
    beforeEach(() => {
        Element.prototype.scrollBy = vi.fn();
        Element.prototype.scrollIntoView = vi.fn();
    });

    it('shows every sheet with its non-empty row count, and no arrows without overflow', () => {
        renderTabs();
        expect(screen.getAllByRole('tab').map(tab => tab.textContent)).toEqual(['Bewertungskriterien9', 'Erhebung Nutzungsart15', 'Nutzungsarten']);
        setGeometry(0, 800, 800);
        expect(screen.queryByRole('button', { name: 'tpPrevSheets' })).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'tpNextSheets' })).not.toBeInTheDocument();
    });

    it('shows both arrows on overflow, the one at the current end disabled', () => {
        renderTabs();
        setGeometry(0, 400, 1000);
        expect(screen.getByRole('button', { name: 'tpPrevSheets' })).toBeDisabled();
        expect(screen.getByRole('button', { name: 'tpNextSheets' })).toBeEnabled();

        setGeometry(600, 400, 1000);
        expect(screen.getByRole('button', { name: 'tpPrevSheets' })).toBeEnabled();
        expect(screen.getByRole('button', { name: 'tpNextSheets' })).toBeDisabled();
    });

    it('pages by 70 % of the visible width', async () => {
        renderTabs();
        const strip = setGeometry(0, 400, 1000);
        await userEvent.click(screen.getByRole('button', { name: 'tpNextSheets' }));
        expect(strip.scrollBy).toHaveBeenCalledWith({ left: 280, behavior: 'smooth' });
    });
});

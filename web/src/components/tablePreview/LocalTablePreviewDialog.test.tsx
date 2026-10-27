import { describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { LocalTablePreviewDialog } from './LocalTablePreviewDialog';

vi.mock('../../contexts/ThemeContext', () => ({
    useTheme: () => ({ t: (k: string) => k, language: 'de' }),
}));

const CELLS = [
    ['Posten', 'Anzahl'],
    ['Schritt 10', '3'],
    ['Schritt 2', '12'],
    ['Übereinstimmung', ''],
];

// Oracle: the first data cell of each body row, in the order the table shows.
function firstColumn(): string[] {
    const table = within(screen.getByRole('dialog')).getByRole('table');
    return within(table).getAllByRole('row').slice(1).map(r => within(r).getAllByRole('cell')[1].textContent ?? '');
}

describe('LocalTablePreviewDialog', () => {
    it('shows every row in answer order with the counts', () => {
        render(<LocalTablePreviewDialog cells={CELLS} hasHeader onDownload={vi.fn()} onClose={vi.fn()} />);
        expect(firstColumn()).toEqual(['Schritt 10', 'Schritt 2', 'Übereinstimmung']);
        expect(screen.getByText('ltpFooterCounts')).toBeInTheDocument();
    });

    it('sorts on a header click and filters on search, client-side', async () => {
        render(<LocalTablePreviewDialog cells={CELLS} hasHeader onDownload={vi.fn()} onClose={vi.fn()} />);
        await userEvent.click(screen.getByRole('button', { name: /Anzahl/ }));
        expect(firstColumn()).toEqual(['Schritt 10', 'Schritt 2', 'Übereinstimmung']);
        await userEvent.click(screen.getByRole('button', { name: /Posten/ }));
        expect(firstColumn()).toEqual(['Schritt 2', 'Schritt 10', 'Übereinstimmung']);
        await userEvent.type(screen.getByRole('textbox', { name: 'tpSearchLabel' }), 'übereinst');
        expect(firstColumn()).toEqual(['Übereinstimmung']);
    });

    it('downloads through the footer export and closes', async () => {
        const onDownload = vi.fn();
        const onClose = vi.fn();
        render(<LocalTablePreviewDialog cells={CELLS} hasHeader onDownload={onDownload} onClose={onClose} />);
        await userEvent.click(screen.getByRole('button', { name: 'mdTableDownloadXlsx' }));
        expect(onDownload).toHaveBeenCalledOnce();
        await userEvent.click(screen.getByRole('button', { name: 'close' }));
        expect(onClose).toHaveBeenCalledOnce();
    });

    it('labels the row details with the answer row, not a SQL row', async () => {
        render(<LocalTablePreviewDialog cells={CELLS} hasHeader onDownload={vi.fn()} onClose={vi.fn()} />);
        await userEvent.click(screen.getByText('Schritt 2'));
        expect(screen.getByText('ltpSource')).toBeInTheDocument();
    });
});

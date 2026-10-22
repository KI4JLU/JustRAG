import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { MarkdownTable } from './MarkdownTable';

vi.mock('../contexts/ThemeContext', () => ({
    useTheme: () => ({ t: (k: string) => k, language: 'de' }),
}));
const exportRowsToXlsx = vi.fn();
vi.mock('../utils/exportXlsx', () => ({ exportRowsToXlsx: (...args: unknown[]) => exportRowsToXlsx(...args) }));

const MD = [
    '| Posten | Anzahl |',
    '| --- | ---: |',
    '| Einzelposten in Schritt 2 | 12 |',
    '| Klassifizierte Posten | 11 |',
].join('\n');

function renderTable() {
    return render(
        <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            components={{ table: ({ node, children }) => <MarkdownTable node={node as never} filename="table.xlsx">{children}</MarkdownTable> }}
        >
            {MD}
        </ReactMarkdown>,
    );
}

// A raw-HTML table without `th` (rehype-raw), as a hand-built hast node.
const td = (v: string) => ({ type: 'element', tagName: 'td', children: [{ type: 'text', value: v }] });
const headerless = {
    type: 'element', tagName: 'table', children: [{ type: 'element', tagName: 'tbody', children: [
        { type: 'element', tagName: 'tr', children: [td('Alice'), td('9')] },
        { type: 'element', tagName: 'tr', children: [td('Bob'), td('7')] },
    ] }],
};

describe('MarkdownTable footer', () => {
    beforeEach(() => exportRowsToXlsx.mockReset());

    it('shows the size, a download and a maximize button under every table', () => {
        renderTable();
        expect(screen.getByText(/mdTableRowsMany · mdTableColsMany/)).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'mdTableDownloadXlsx' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'mdTableMaximize' })).toBeInTheDocument();
    });

    it('downloads the extracted cells, header row first', async () => {
        renderTable();
        await userEvent.click(screen.getByRole('button', { name: 'mdTableDownloadXlsx' }));
        expect(exportRowsToXlsx).toHaveBeenCalledWith(
            [['Posten', 'Anzahl'], ['Einzelposten in Schritt 2', '12'], ['Klassifizierte Posten', '11']],
            { filename: 'table.xlsx' },
        );
    });

    it('counts and previews every row of a table without a header row', async () => {
        render(<MarkdownTable node={headerless} filename="table.xlsx"><tbody /></MarkdownTable>);
        expect(screen.getByText(/mdTableRowsMany · mdTableColsMany/)).toBeInTheDocument();
        await userEvent.click(screen.getByRole('button', { name: 'mdTableMaximize' }));
        const dialog = await screen.findByRole('dialog');
        expect(within(dialog).getByText('Alice')).toBeInTheDocument();
        expect(within(dialog).getByText('Bob')).toBeInTheDocument();
    });

    it('keeps a line break inside a cell as a space', async () => {
        const table = {
            type: 'element', tagName: 'table', children: [{ type: 'element', tagName: 'tr', children: [
                { type: 'element', tagName: 'td', children: [{ type: 'text', value: 'First' }, { type: 'element', tagName: 'br', children: [] }, { type: 'text', value: 'Second' }] },
            ] }],
        };
        render(<MarkdownTable node={table} filename="table.xlsx"><tbody /></MarkdownTable>);
        await userEvent.click(screen.getByRole('button', { name: 'mdTableDownloadXlsx' }));
        expect(exportRowsToXlsx).toHaveBeenCalledWith([['First Second']], { filename: 'table.xlsx' });
    });

    it('opens the table in the preview dialog on maximize', async () => {
        renderTable();
        await userEvent.click(screen.getByRole('button', { name: 'mdTableMaximize' }));
        const dialog = await screen.findByRole('dialog');
        expect(within(dialog).getByText('ltpTitle')).toBeInTheDocument();
        expect(within(dialog).getByText('Einzelposten in Schritt 2')).toBeInTheDocument();
        expect(within(dialog).getByText('Klassifizierte Posten')).toBeInTheDocument();
    });
});

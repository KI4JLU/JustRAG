import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import axios from 'axios';
import { TablePreviewDialog } from './TablePreviewDialog';
import { API_BASE_URL } from '../../api';
import type { TabularFileDetail, TabularRows, TabularTable } from '../../types';

vi.mock('axios');
vi.mock('../../contexts/ThemeContext', () => ({
    useTheme: () => ({ t: (k: string) => k, language: 'de' }),
}));
const toastError = vi.fn();
vi.mock('../../contexts/ToastContext', () => ({ useToast: () => ({ error: toastError }) }));

const col = (name: string, original: string, type: string) => ({ name, original, type, null_count: 0, distinct_count: 0, coercion_failed: 0 });
const table = (over: Partial<TabularTable>): TabularTable => ({
    sheet_index: 0, region_index: 0, sheet_name: 'Erhebung Nutzungsart', table_name: 'sheet_x_1_0',
    sheet_kind: 'table', hidden: false, header_row: 0, row_count: 200, columns: [], ...over,
});
const detail: TabularFileDetail = {
    report: null,
    tables: [
        table({ columns: [col('nr', 'Nr.', 'bigint'), col('gebaeude', 'Gebäude', 'text'), col('baujahr', 'Baujahr', 'numeric'), col('note', 'Note', 'numeric'), col('leer', 'Leer', 'text')] }),
        table({ sheet_index: 1, sheet_name: 'Nutzungsarten', table_name: 'sheet_x_2_0', row_count: 5, columns: [col('name', 'Name', 'text')] }),
    ],
};

type Params = { table: string; offset: number; limit: number; q?: string; sort?: string; dir?: string; show_empty?: boolean };

function rowsFor(p: Params): TabularRows {
    const base = { table_name: p.table, sheet_name: '', offset: p.offset, limit: p.limit, row_count: 200 };
    if (p.table === 'sheet_x_9_0') {
        return { ...base, columns: ['index', 'nutzungsart'], row_count: 2, matched: 2, empty_rows: 0, empty_columns: [],
            rows: [{ id: 1, empty: false, cells: ['1', 'gering'] }, { id: 2, empty: false, cells: ['2', 'sehr hoch'] }] };
    }
    if (p.table === 'sheet_x_8_0') {
        return { ...base, columns: ['gebaeude', 'nutzungsart'], row_count: 2, matched: 2, empty_rows: 0, empty_columns: [],
            rows: [{ id: 1, empty: false, cells: ['Aulweg 129', '2'] }, { id: 2, empty: false, cells: ['Klinik 29', '7'] }] };
    }
    if (p.table === 'sheet_x_2_0') {
        return { ...base, columns: ['name'], rows: [{ id: 1, empty: false, cells: ['Labor'] }], matched: 5, row_count: 5, empty_rows: 0, empty_columns: [] };
    }
    const filled = [
        { id: 1, empty: false, cells: ['1', 'Aulweg 129 Physiologie', '1968', '3.2', null] },
        { id: 2, empty: false, cells: ['2', 'Klinikstraße 29 MLZ', '2004', '2', null] },
    ];
    const empty = { id: 3, empty: true, cells: ['3', null, '0', '0', null] };
    let rows = p.show_empty ? [...filled, empty] : filled;
    if (p.q) rows = rows.filter(r => r.cells.some(c => c?.toLowerCase().includes(p.q!.toLowerCase())));
    if (p.sort === 'gebaeude' && p.dir === 'desc') rows = [...rows].reverse();
    return {
        ...base, columns: ['nr', 'gebaeude', 'baujahr', 'note', 'leer'], rows: rows.slice(0, p.limit), matched: rows.length,
        ...(p.offset === 0 ? { empty_rows: 185, empty_columns: ['leer'] } : {}),
    };
}

const tabularUrl = `${API_BASE_URL}/api/kb/kb1/files/f1/tabular`;
let rowCalls: Params[] = [];

function mockApi(over: { detail?: TabularFileDetail } = {}) {
    rowCalls = [];
    return vi.spyOn(axios, 'get').mockImplementation((url: string, config?: { params?: Params }) => {
        if (url === tabularUrl) return Promise.resolve({ data: over.detail ?? detail });
        if (url === `${tabularUrl}/rows`) {
            rowCalls.push(config!.params!);
            return Promise.resolve({ data: rowsFor(config!.params!) });
        }
        return Promise.resolve({ data: new Blob(['x']) });
    });
}

const props = { show: true, kbId: 'kb1', fileId: 'f1', fileName: 'gebaeude.xlsx', onClose: vi.fn() };
const lastPageCall = () => [...rowCalls].reverse().find(c => c.limit !== 1)!;

beforeEach(() => {
    vi.clearAllMocks();
    Element.prototype.scrollIntoView = vi.fn();
    Element.prototype.scrollBy = vi.fn();
});

// Oracle: the rows endpoint's contract (API.md) for the requests, and
// HANDOFF.md's "Soll-Verhalten" for what the dialog shows.
describe('TablePreviewDialog', () => {
    it('shows the sheets with non-empty counts and the first sheet without empty rows/columns', async () => {
        mockApi();
        render(<TablePreviewDialog {...props} />);

        expect(await screen.findByRole('dialog', { name: 'gebaeude.xlsx' })).toBeInTheDocument();
        await waitFor(() => expect(screen.getAllByRole('tab').map(t => t.textContent)).toEqual(['Erhebung Nutzungsart2', 'Nutzungsarten5']));

        const grid = await screen.findByRole('table');
        const headers = within(grid).getAllByRole('columnheader').map(h => h.textContent);
        expect(headers[1]).toBe('Nr.');
        expect(headers).toHaveLength(6); // #, four visible columns, detail chevron — "leer" is hidden
        expect(within(grid).getByText('1968')).toBeInTheDocument();
        expect(within(grid).getByText('3,2')).toBeInTheDocument();
        expect(within(grid).getByText('2,0')).toBeInTheDocument();
        // The view menu offers both toggles, off, with their counts.
        await userEvent.click(screen.getByRole('button', { name: 'tpView' }));
        expect(screen.getByRole('menuitemcheckbox', { name: /tpViewEmptyRows/ })).toHaveAttribute('aria-checked', 'false');
        expect(screen.getByRole('menuitemcheckbox', { name: /tpViewEmptyRows/ })).toHaveTextContent('185');
        expect(screen.getByRole('menuitemcheckbox', { name: /tpViewEmptyCols/ })).toHaveTextContent('1');
        expect(screen.getByRole('menuitemradio', { name: /tpDetailsInline/ })).toHaveAttribute('aria-checked', 'true');
        expect(lastPageCall()).toEqual({ table: 'sheet_x_1_0', offset: 0, limit: 200 });
    });

    it('asks the server for empty rows and shows them dimmed when toggled', async () => {
        mockApi();
        render(<TablePreviewDialog {...props} />);
        await userEvent.click(await screen.findByRole('button', { name: 'tpView' }));
        await userEvent.click(screen.getByRole('menuitemcheckbox', { name: /tpViewEmptyRows/ }));

        await waitFor(() => expect(lastPageCall().show_empty).toBe(true));
        // A toggle keeps the menu open and shows the check; the trigger says the view is customised.
        expect(screen.getByRole('menuitemcheckbox', { name: /tpViewEmptyRows/ })).toHaveAttribute('aria-checked', 'true');
        await userEvent.keyboard('{Escape}'); // the open menu hides the rest of the page from the a11y tree
        expect(screen.getByRole('button', { name: /tpView.*tpViewCustomised/ })).toBeInTheDocument();
        expect(document.querySelector('[data-row-id="3"]')).toHaveClass('text-on-surface-variant/60');
    });

    it('shows the empty column when toggled', async () => {
        mockApi();
        render(<TablePreviewDialog {...props} />);
        await userEvent.click(await screen.findByRole('button', { name: 'tpView' }));
        await userEvent.click(screen.getByRole('menuitemcheckbox', { name: /tpViewEmptyCols/ }));
        await userEvent.keyboard('{Escape}');
        expect(within(screen.getByRole('table')).getAllByRole('columnheader')).toHaveLength(7);
    });

    it('searches on the server and highlights the match', async () => {
        mockApi();
        render(<TablePreviewDialog {...props} />);
        await userEvent.type(await screen.findByRole('textbox', { name: 'tpSearchLabel' }), 'klinik');

        await waitFor(() => expect(lastPageCall().q).toBe('klinik'));
        const mark = await screen.findByText('Klinik', { selector: 'mark' });
        expect(mark.closest('tr')).toHaveAttribute('data-row-id', '2');
        expect(screen.queryByText('Aulweg 129 Physiologie')).not.toBeInTheDocument();
    });

    it('cycles the sort on a header click: asc, desc, off', async () => {
        mockApi();
        render(<TablePreviewDialog {...props} />);
        const header = () => within(screen.getByRole('table')).getAllByRole('columnheader')[2];

        await screen.findByRole('table');
        await userEvent.click(within(header()).getByRole('button'));
        await waitFor(() => expect(lastPageCall()).toMatchObject({ sort: 'gebaeude', dir: 'asc' }));
        expect(header()).toHaveAttribute('aria-sort', 'ascending');

        await userEvent.click(within(header()).getByRole('button'));
        await waitFor(() => expect(lastPageCall()).toMatchObject({ sort: 'gebaeude', dir: 'desc' }));
        expect(header()).toHaveAttribute('aria-sort', 'descending');

        await userEvent.click(within(header()).getByRole('button'));
        await waitFor(() => expect(lastPageCall().sort).toBeUndefined());
        expect(header()).not.toHaveAttribute('aria-sort');
    });

    it('moves the selection with ↓/↑ and j/k, opening the record under the row', async () => {
        mockApi();
        render(<TablePreviewDialog {...props} />);
        const region = await screen.findByRole('region', { name: 'tpTableLabel' });
        region.focus();

        await userEvent.keyboard('{ArrowDown}');
        expect(document.querySelector('[data-row-id="1"]')).toHaveAttribute('aria-selected', 'true');
        expect(screen.getByText('tpSource')).toBeInTheDocument();
        await userEvent.keyboard('j');
        expect(document.querySelector('[data-row-id="2"]')).toHaveAttribute('aria-selected', 'true');
        await userEvent.keyboard('k');
        expect(document.querySelector('[data-row-id="1"]')).toHaveAttribute('aria-selected', 'true');
    });

    it('does not move the selection while typing in the search field', async () => {
        mockApi();
        render(<TablePreviewDialog {...props} />);
        await userEvent.click(await screen.findByRole('textbox', { name: 'tpSearchLabel' }));
        await userEvent.keyboard('{ArrowDown}j');
        expect(document.querySelector('tr[aria-selected="true"]')).toBeNull();
    });

    it('closes the row details on Esc before the dialog', async () => {
        mockApi();
        render(<TablePreviewDialog {...props} />);
        await userEvent.click(await screen.findByText('Aulweg 129 Physiologie'));
        expect(screen.getByText('tpSource')).toBeInTheDocument();

        await userEvent.keyboard('{Escape}');
        expect(screen.queryByText('tpSource')).not.toBeInTheDocument();
        expect(props.onClose).not.toHaveBeenCalled();

        await userEvent.keyboard('{Escape}');
        expect(props.onClose).toHaveBeenCalled();
    });

    it('shows the record in the side panel in panel mode', async () => {
        mockApi();
        render(<TablePreviewDialog {...props} />);
        await userEvent.click(await screen.findByRole('button', { name: 'tpView' }));
        await userEvent.click(screen.getByRole('menuitemradio', { name: /tpDetailsPanel/ }));
        await userEvent.click(screen.getByText('Klinikstraße 29 MLZ'));

        const panel = screen.getByRole('complementary', { name: 'tpDetails' });
        expect(within(panel).getByText('tpRowOf')).toBeInTheDocument();
        expect(within(panel).getByText('tpNullDetail')).toBeInTheDocument();
    });

    it('clears search and sort when switching sheets', async () => {
        mockApi();
        render(<TablePreviewDialog {...props} />);
        await userEvent.type(await screen.findByRole('textbox', { name: 'tpSearchLabel' }), 'x');
        await userEvent.click(screen.getByRole('tab', { name: /Nutzungsarten/ }));
        expect(await screen.findByText('Labor')).toBeInTheDocument();
        expect(screen.getByRole('textbox', { name: 'tpSearchLabel' })).toHaveValue('');
        expect(lastPageCall()).toEqual({ table: 'sheet_x_2_0', offset: 0, limit: 200 });
    });

    it('leaves hidden helper sheets out by default and shows them dimmed on request', async () => {
        mockApi({ detail: { report: null, tables: [...detail.tables!, table({ sheet_index: 2, sheet_name: 'Prozent-Noten', table_name: 'sheet_x_3_0', hidden: true, columns: [col('name', 'Name', 'text')] })] } });
        render(<TablePreviewDialog {...props} />);
        await screen.findByRole('table');
        expect(screen.getAllByRole('tab').map(t => t.textContent?.replace(/\d+$/, ''))).toEqual(['Erhebung Nutzungsart', 'Nutzungsarten']);

        const toggle = screen.getByRole('button', { name: 'tpHiddenSheetHidden' });
        expect(toggle).toHaveAttribute('aria-pressed', 'false');
        // Visibly just the count; the sentence is the tooltip and the name.
        expect(toggle).toHaveTextContent(/^1$/);
        expect(toggle).toHaveAttribute('title', 'tpHiddenSheetHidden');
        await userEvent.click(toggle);
        expect(screen.getByRole('button', { name: 'tpHiddenSheetShown' })).toHaveAttribute('aria-pressed', 'true');
        const hiddenTab = screen.getByRole('tab', { name: /Prozent-Noten/ });

        // Hiding again while on a hidden sheet returns to the first visible one.
        await userEvent.click(hiddenTab);
        await waitFor(() => expect(lastPageCall().table).toBe('sheet_x_3_0'));
        await userEvent.click(screen.getByRole('button', { name: 'tpHiddenSheetShown' }));
        expect(screen.queryByRole('tab', { name: /Prozent-Noten/ })).not.toBeInTheDocument();
        await waitFor(() => expect(lastPageCall().table).toBe('sheet_x_1_0'));
    });

    it('shows all sheets without a toggle when every sheet is hidden', async () => {
        mockApi({ detail: { report: null, tables: detail.tables!.map(tbl => ({ ...tbl, hidden: true })) } });
        render(<TablePreviewDialog {...props} />);
        await screen.findByRole('table');
        expect(screen.getAllByRole('tab')).toHaveLength(2);
        expect(screen.queryByRole('button', { name: /tpHiddenSheet/ })).not.toBeInTheDocument();
    });

    it('resolves code columns through their lookup table and links to it', async () => {
        const lookupDetail: TabularFileDetail = { report: null, tables: [
            table({ sheet_name: 'Erhebung', table_name: 'sheet_x_8_0', row_count: 2, columns: [
                col('gebaeude', 'Gebäude', 'text'),
                { ...col('nutzungsart', 'Nutzungsart', 'numeric'), lookup: { table: 'sheet_x_9_0', key: 'index', label: 'nutzungsart', source: 'heuristic' } },
            ] }),
            table({ sheet_index: 1, sheet_name: 'Nutzungsarten', table_name: 'sheet_x_9_0', row_count: 2, hidden: true,
                columns: [col('index', 'Index', 'text'), col('nutzungsart', 'Nutzungsart', 'text')] }),
        ] };
        mockApi({ detail: lookupDetail });
        render(<TablePreviewDialog {...props} />);

        // Code 2 reads as its name; 7 is no key of the lookup table and stays a bare code.
        const cell = await screen.findByText(/sehr hoch/);
        expect(cell.closest('td')).toHaveTextContent('2 · sehr hoch');
        expect(screen.getByText('7').closest('td')).toHaveTextContent(/^7$/);

        // The header link opens the hidden lookup sheet and reveals it.
        expect(screen.queryByRole('tab', { name: /Nutzungsarten/ })).not.toBeInTheDocument();
        await userEvent.click(screen.getByRole('button', { name: 'tpOpenLookupInferred' }));
        expect(await screen.findByRole('tab', { name: /Nutzungsarten/ })).toHaveAttribute('aria-selected', 'true');
        await waitFor(() => expect(lastPageCall().table).toBe('sheet_x_9_0'));
    });

    it('shows the ingest message and fetches nothing while processing, then loads by itself', async () => {
        const getSpy = mockApi();
        const { rerender } = render(<TablePreviewDialog {...props} status="processing" />);
        expect(screen.getByText('tabularIngesting')).toBeInTheDocument();
        expect(getSpy).not.toHaveBeenCalled();

        rerender(<TablePreviewDialog {...props} status="completed" />);
        expect(await screen.findByText('Aulweg 129 Physiologie')).toBeInTheDocument();
    });

    it('explains a failed ingest and a file without SQL tables', async () => {
        mockApi();
        const { unmount } = render(<TablePreviewDialog {...props} status="error" />);
        expect(screen.getByText('tabularIngestFailed')).toBeInTheDocument();
        unmount();

        mockApi({ detail: { report: null, tables: [] } });
        render(<TablePreviewDialog {...props} />);
        expect(await screen.findByText('tabularNoPreview')).toBeInTheDocument();
    });

    it('downloads the original file through the authenticated client', async () => {
        const getSpy = mockApi();
        URL.createObjectURL = vi.fn(() => 'blob:x');
        URL.revokeObjectURL = vi.fn();
        const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
        render(<TablePreviewDialog {...props} />);
        await screen.findByRole('table'); // the button moves into the tab row once the sheets load

        await userEvent.click(screen.getByRole('button', { name: 'download gebaeude.xlsx' }));
        await waitFor(() => expect(click).toHaveBeenCalledTimes(1));
        expect(getSpy).toHaveBeenCalledWith(`${API_BASE_URL}/api/files/f1/download`, { responseType: 'blob' });
        click.mockRestore();
    });

    it('renders nothing when show is false', () => {
        const getSpy = mockApi();
        const { container } = render(<TablePreviewDialog {...props} show={false} />);
        expect(container).toBeEmptyDOMElement();
        expect(getSpy).not.toHaveBeenCalled();
    });
});

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import axios from 'axios';
import KBOverviewDashboard from './KBOverviewDashboard';

vi.mock('axios');
const mockedAxios = axios as unknown as {
    get: ReturnType<typeof vi.fn>;
    delete: ReturnType<typeof vi.fn>;
    patch: ReturnType<typeof vi.fn>;
    post: ReturnType<typeof vi.fn>;
};

vi.mock('./contexts/ThemeContext', () => ({ useTheme: () => ({ t: (k: string) => k, language: 'en' }) }));

// Role drives the actions column; each test sets it before rendering.
let mockRole = 'superadmin';
vi.mock('./contexts/AuthContext', () => ({ useAuth: () => ({ user: { id: 'op-1', role: mockRole } }) }));

/** Opens a row's ⋯ menu (named after its KB; `t` is the identity here) and returns the item labels. */
async function rowMenu(kbName: string) {
    await userEvent.click(screen.getByRole('button', { name: `kbActions: ${kbName}` }));
    return (await screen.findAllByRole('menuitem')).map(i => i.textContent);
}

beforeEach(() => {
    // Radix's dropdown trigger measures and captures pointers; jsdom implements neither.
    Element.prototype.hasPointerCapture = vi.fn(() => false);
    Element.prototype.setPointerCapture = vi.fn();
    Element.prototype.releasePointerCapture = vi.fn();
    Element.prototype.scrollIntoView = vi.fn();
});

const overview = {
    rows: [
        {
            id: 'kb-1', name: 'Alpha KB', ownerName: 'Ada Lovelace', ownerId: 'user-1', ownerUsername: 'ada',
            isGlobal: false, isPublished: true, fileCount: 2, totalSizeBytes: 1024, failedFileCount: 0,
            processingFileCount: 0, webTurns: 3, apiTurns: 1, chatCount: 1, createdAt: '2026-01-01T00:00:00Z',
        },
        {
            id: 'kb-2', name: 'Global KB', isGlobal: true, isPublished: true, fileCount: 1, totalSizeBytes: 512,
            failedFileCount: 0, processingFileCount: 0, webTurns: 0, apiTurns: 0, chatCount: 0, createdAt: '2026-01-01T00:00:00Z',
        },
    ],
    queueSummary: {},
    timestamp: '2026-01-01T00:00:00Z',
};

describe('KBOverviewDashboard superadmin actions', () => {
    beforeEach(() => {
        mockRole = 'superadmin';
        mockedAxios.get = vi.fn().mockResolvedValue({ data: overview });
        mockedAxios.delete = vi.fn().mockResolvedValue({});
        mockedAxios.patch = vi.fn().mockResolvedValue({ data: {} });
        mockedAxios.post = vi.fn().mockResolvedValue({ status: 204 });
    });

    // ORACLE: the rules of the old icon buttons, now the items of the row's ⋯ menu: delete for every
    // row, transfer and publish only for a personal (still private) KB, delete last.
    it('offers delete for every row and transfer only for personal KBs', async () => {
        render(<KBOverviewDashboard />);
        await waitFor(() => expect(screen.getByText('Alpha KB')).toBeTruthy());
        expect(await rowMenu('Alpha KB')).toEqual(['kbActionPublish', 'kbActionTransfer', 'kbActionDelete']);
        await userEvent.keyboard('{Escape}');
        expect(await rowMenu('Global KB')).toEqual(['kbActionDelete']);
    });

    // Delete und Transfer bleiben superadmin-only; Veroeffentlichen nicht — der
    // Endpunkt haengt an adminChain. Ein einfacher Systemadmin sieht also die
    // Aktionsspalte, aber nur diese eine Aktion darin.
    it('gives a non-superadmin admin the publish action and nothing else', async () => {
        mockRole = 'admin';
        render(<KBOverviewDashboard />);
        await waitFor(() => expect(screen.getByText('Alpha KB')).toBeTruthy());
        expect(await rowMenu('Alpha KB')).toEqual(['kbActionPublish']);
        await userEvent.keyboard('{Escape}');
        // Nothing to offer on a public KB, so it has no menu at all.
        expect(screen.queryByRole('button', { name: 'kbActions: Global KB' })).toBeNull();
    });
});

// POST /api/admin/kb/{id}/publish was registered, tested and audited on the
// backend but had no caller anywhere in the frontend — the KB-Übersicht row is
// its intended home, next to the published badge it already renders.
describe('KBOverviewDashboard publish action', () => {
    beforeEach(() => {
        mockRole = 'superadmin';
        mockedAxios.get = vi.fn().mockResolvedValue({ data: overview });
        mockedAxios.delete = vi.fn().mockResolvedValue({});
        mockedAxios.patch = vi.fn().mockResolvedValue({ data: {} });
        mockedAxios.post = vi.fn().mockResolvedValue({ status: 204 });
    });

    // kb-1 ist privat, kb-2 ist bereits oeffentlich: genau eine Schaltflaeche.
    it('offers publishing for a private KB and not for a public one', async () => {
        render(<KBOverviewDashboard />);
        await waitFor(() => expect(screen.getByText('Alpha KB')).toBeTruthy());

        // Die Aktion steht im Menue der privaten KB, nicht der globalen.
        expect(await rowMenu('Alpha KB')).toContain('kbActionPublish');
        await userEvent.keyboard('{Escape}');
        expect(await rowMenu('Global KB')).not.toContain('kbActionPublish');
    });

    it('POSTs to the publish endpoint once the dialog is confirmed', async () => {
        render(<KBOverviewDashboard />);
        await waitFor(() => expect(screen.getByText('Alpha KB')).toBeTruthy());

        await rowMenu('Alpha KB');
        await userEvent.click(screen.getByRole('menuitem', { name: 'kbActionPublish' }));
        // Der Dialog muss die Folge benennen, bevor irgendetwas rausgeht.
        const dialog = await screen.findByRole('dialog');
        expect(within(dialog).getByText('kbPublishWarning')).toBeTruthy();
        expect(mockedAxios.post).not.toHaveBeenCalled();

        await userEvent.click(within(dialog).getByRole('button', { name: 'kbActionPublish' }));

        await waitFor(() => expect(mockedAxios.post).toHaveBeenCalledWith(
            expect.stringContaining('/api/admin/kb/kb-1/publish'),
        ));
    });

    it('sends nothing when the dialog is cancelled', async () => {
        render(<KBOverviewDashboard />);
        await waitFor(() => expect(screen.getByText('Alpha KB')).toBeTruthy());

        await rowMenu('Alpha KB');
        await userEvent.click(screen.getByRole('menuitem', { name: 'kbActionPublish' }));
        const dialog = await screen.findByRole('dialog');
        await userEvent.click(within(dialog).getByRole('button', { name: 'cancel' }));

        expect(mockedAxios.post).not.toHaveBeenCalled();
        expect(screen.queryByRole('dialog')).toBeNull();
    });
});

// Stub Storage explicitly: local jsdom gives a bare {} while CI gives a working
// localStorage, and this component persists its optional-column visibility —
// that asymmetry is what made v0.4.0 red.
function installMemoryStorage() {
    const map = new Map<string, string>();
    const storage: Storage = {
        get length() { return map.size; },
        clear: () => map.clear(),
        getItem: (k) => (map.has(k) ? map.get(k)! : null),
        key: (i) => Array.from(map.keys())[i] ?? null,
        removeItem: (k) => { map.delete(k); },
        setItem: (k, v) => { map.set(k, v); },
    };
    Object.defineProperty(window, 'localStorage', { value: storage, configurable: true });
}

const activityOverview = {
    rows: [
        {
            id: 'kb-1', name: 'Alpha KB', ownerName: 'Ada Lovelace', ownerId: 'user-1', ownerUsername: 'ada',
            isGlobal: false, isPublished: true, fileCount: 2, totalSizeBytes: 1024, failedFileCount: 0,
            processingFileCount: 0, chatCount: 1, webTurns: 12, apiTurns: 5,
            lastFileUploadAt: '2026-08-01T00:00:00Z', lastTurnAt: '2026-08-17T10:00:00Z',
            createdAt: '2026-01-01T00:00:00Z',
        },
    ],
    queueSummary: {},
    timestamp: '2026-01-01T00:00:00Z',
};

function renderDashboard() {
    mockedAxios.get = vi.fn().mockResolvedValue({ data: activityOverview });
    mockedAxios.delete = vi.fn().mockResolvedValue({});
    mockedAxios.patch = vi.fn().mockResolvedValue({ data: {} });
    mockedAxios.post = vi.fn().mockResolvedValue({ status: 204 });
    render(<KBOverviewDashboard />);
}

// Pins the payoff of the whole usage_events plan: Aktivität sums web + API
// turns (previously only messages.created_at, blind to openaicompat/mcp
// traffic), and Letzte Aktivität follows the newer of upload/turn timestamps.
describe('KBOverviewDashboard Aktivität column', () => {
    beforeEach(() => {
        mockRole = 'superadmin';
    });

    // ORACLE: the fixture (webTurns 12, apiTurns 5) and the developer's ruling of 2026-10-26: no hover, both
    // numbers in the cell itself, web then API, the two words said once in the header and not on every row.
    it('shows the web and the API turns in the Aktivität cell, with no tooltip', async () => {
        installMemoryStorage();
        renderDashboard();

        const cell = (await screen.findByText('12 · 5')).closest('td')!;
        expect(cell).not.toHaveAttribute('title');
        expect(cell.textContent).not.toMatch(/Web|API/);
        expect(screen.getByRole('columnheader', { name: /colActivity/ })).toHaveTextContent('Web · API');
    });

    // ORACLE: the fixture (upload 2026-08-01, newest turn 2026-08-17) against a clock held at 2026-08-20, and
    // Intl.RelativeTimeFormat's own wording: the newer timestamp is 3 days back, the older one 19. The cell carries
    // no tooltip (it used to hold the exact timestamp).
    it('Letzte Aktivität shows the newest of upload and turn timestamps, without a tooltip', async () => {
        vi.useFakeTimers({ toFake: ['Date'] }); // the clock only: timers and promises keep running
        vi.setSystemTime(new Date('2026-08-20T12:00:00Z'));
        try {
            installMemoryStorage();
            renderDashboard();

            const row = (await screen.findByText('Alpha KB')).closest('tr')!;
            expect(row).toHaveTextContent('3 days ago');
            expect(row).not.toHaveTextContent('19 days ago');
            const cell = Array.from(row.querySelectorAll('td')).find((td) => td.textContent === '3 days ago')!;
            expect(cell).not.toHaveAttribute('title');
        } finally {
            vi.useRealTimers();
        }
    });
});

// Spec-mandated: "sorting orders by the sum" (webTurns + apiTurns), not by
// either turn count alone.
describe('KBOverviewDashboard Aktivität sort', () => {
    // webTurns-only, apiTurns-only and (webTurns+apiTurns) sort orders are
    // all made to disagree, so this only stays green if the sort is truly
    // keyed on the sum:
    //   webTurns:  Beta(0) < Gamma(1) < Alpha(10)  → Beta, Gamma, Alpha
    //   apiTurns:  Alpha(0) < Gamma(2) < Beta(8)    → Alpha, Gamma, Beta
    //   sum:       Gamma(3) < Beta(8) < Alpha(10)   → Gamma, Beta, Alpha
    const sortOverview = {
        rows: [
            {
                id: 'kb-1', name: 'Alpha KB', ownerName: 'Ada Lovelace', ownerId: 'user-1', ownerUsername: 'ada',
                isGlobal: false, isPublished: true, fileCount: 1, totalSizeBytes: 100, failedFileCount: 0,
                processingFileCount: 0, chatCount: 0, webTurns: 10, apiTurns: 0, createdAt: '2026-01-01T00:00:00Z',
            },
            {
                id: 'kb-2', name: 'Beta KB', ownerName: 'Bob', ownerId: 'user-2', ownerUsername: 'bob',
                isGlobal: false, isPublished: true, fileCount: 1, totalSizeBytes: 100, failedFileCount: 0,
                processingFileCount: 0, chatCount: 0, webTurns: 0, apiTurns: 8, createdAt: '2026-01-01T00:00:00Z',
            },
            {
                id: 'kb-3', name: 'Gamma KB', ownerName: 'Carol', ownerId: 'user-3', ownerUsername: 'carol',
                isGlobal: false, isPublished: true, fileCount: 1, totalSizeBytes: 100, failedFileCount: 0,
                processingFileCount: 0, chatCount: 0, webTurns: 1, apiTurns: 2, createdAt: '2026-01-01T00:00:00Z',
            },
        ],
        queueSummary: {},
        timestamp: '2026-01-01T00:00:00Z',
    };

    beforeEach(() => {
        mockRole = 'superadmin';
    });

    it('clicking the Aktivität header sorts rows by webTurns + apiTurns', async () => {
        installMemoryStorage();
        mockedAxios.get = vi.fn().mockResolvedValue({ data: sortOverview });
        mockedAxios.delete = vi.fn().mockResolvedValue({});
        mockedAxios.patch = vi.fn().mockResolvedValue({ data: {} });
        mockedAxios.post = vi.fn().mockResolvedValue({ status: 204 });
        render(<KBOverviewDashboard />);

        await screen.findByText('Alpha KB');

        const rowNames = () =>
            screen.getAllByRole('row')
                .slice(1) // drop the header row
                .map((row) => {
                    if (row.textContent?.includes('Alpha KB')) return 'Alpha';
                    if (row.textContent?.includes('Beta KB')) return 'Beta';
                    return 'Gamma';
                });

        // Default sort is by name ascending: Alpha, Beta, Gamma.
        expect(rowNames()).toEqual(['Alpha', 'Beta', 'Gamma']);

        await userEvent.click(screen.getByRole('button', { name: /colActivity/ }));

        // Ascending by webTurns + apiTurns: Gamma(3), Beta(8), Alpha(10).
        // The fixture above is chosen so a sort keyed on webTurns alone
        // (Beta, Gamma, Alpha) or apiTurns alone (Alpha, Gamma, Beta) would
        // both produce a different order, so this only passes for the sum.
        expect(rowNames()).toEqual(['Gamma', 'Beta', 'Alpha']);
    });
});

// ORACLE: docs/kb-access.md — `is_published` DEFAULTs to true (migration 0012) and only means something
// for a public KB (publishing is staged: public, but not live until an operator flips the catalog toggle).
// So the „Veröffentlicht" badge belongs to public KBs only, and a staged one says so.
describe('KBOverviewDashboard badges', () => {
    const row = (id: string, name: string, over: object) => ({
        id, name, ownerName: 'Ada', isGlobal: false, isPublished: true, fileCount: 1, totalSizeBytes: 1,
        failedFileCount: 0, processingFileCount: 0, webTurns: 0, apiTurns: 0, chatCount: 0, createdAt: '2026-01-01T00:00:00Z', ...over,
    });

    it('shows Global and Veröffentlicht on a live public KB, Global and Nicht live on a staged one, neither on a private KB', async () => {
        mockRole = 'superadmin';
        installMemoryStorage();
        mockedAxios.get = vi.fn().mockResolvedValue({ data: {
            rows: [
                row('p', 'Private KB', {}),
                row('l', 'Live KB', { isGlobal: true, isPublished: true }),
                row('s', 'Staged KB', { isGlobal: true, isPublished: false }),
            ],
            queueSummary: {}, timestamp: '2026-01-01T00:00:00Z',
        } });
        render(<KBOverviewDashboard />);
        const cellOf = async (name: string) => (await screen.findByText(name)).closest('td')!;

        const priv = await cellOf('Private KB');
        expect(priv).not.toHaveTextContent('globalBadge');
        expect(priv).not.toHaveTextContent('published');

        const live = await cellOf('Live KB');
        expect(live).toHaveTextContent('globalBadge');
        expect(live).toHaveTextContent('published');

        const staged = await cellOf('Staged KB');
        expect(staged).toHaveTextContent('globalBadge');
        expect(staged).toHaveTextContent('kbStagedBadge');
        expect(staged).not.toHaveTextContent(/^.*\bpublished\b/);
    });
});

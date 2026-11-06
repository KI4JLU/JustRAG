import { describe, it, expect, beforeEach, vi, type Mock } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import axios from 'axios';
import { AdminHarness } from './test/AdminHarness';
import { ADMIN_SEARCH_KEYS } from './components/admin/adminSearchKeywords';
import { ADMIN_SECTIONS } from './hooks/adminDialog';
import { translations } from './translations';

/* ---------------------------------------------------------------------------
 * Every section of the admin dialog is searchable by what is inside it, not only by its name
 * (developer, 2026-10-26). ORACLE: the translation table for the words
 * (every keyword key must exist in it), and the DS dialog's search contract (sections whose label or
 * keywords match stay, the rest drop out of the nav).
 * ------------------------------------------------------------------------- */

vi.mock('axios', () => ({ default: { get: vi.fn(), post: vi.fn() } }));
const themeMock = { t: (k: string) => k, language: 'en' as const };
vi.mock('./contexts/ThemeContext', () => ({ useTheme: () => themeMock }));
const toastMock = { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() };
vi.mock('./contexts/ToastContext', () => ({ useToast: () => toastMock }));
const authMock = { user: { id: 'op-1', role: 'superadmin' } };
vi.mock('./contexts/AuthContext', () => ({ useAuth: () => authMock }));
const modalMock = { showConfirm: vi.fn(), showAlert: vi.fn(), showPrompt: vi.fn() };
vi.mock('./contexts/ModalContext', () => ({ useModalContext: () => modalMock }));
vi.mock('./hooks/useReducedMotion', () => ({ useReducedMotion: () => false, getMotionProps: () => ({}) }));

beforeEach(() => {
    vi.clearAllMocks();
    // The KB overview (mounted when search narrows the dialog to it) reads an object, the other tabs lists.
    (axios.get as unknown as Mock).mockImplementation((url: string) =>
        Promise.resolve({ data: String(url).includes('/admin/kb-overview') ? { rows: [], queueSummary: {}, timestamp: '2026-01-01T00:00:00Z' } : [] }));
});

describe('admin search keywords', () => {
    it('cover every section', () => {
        expect(Object.keys(ADMIN_SEARCH_KEYS).sort()).toEqual([...ADMIN_SECTIONS].sort());
        for (const section of ADMIN_SECTIONS) expect(ADMIN_SEARCH_KEYS[section].length).toBeGreaterThan(0);
    });

    it('name only translations that exist', () => {
        const missing = ADMIN_SECTIONS.flatMap(s => ADMIN_SEARCH_KEYS[s].filter(k => !(k in translations)).map(k => `${s}: ${k}`));
        expect(missing).toEqual([]);
    });
});

describe('AdminUI search', () => {
    const navNames = () => screen.getAllByRole('button').map(b => b.textContent).filter(n => /^adminTab|^evalRunner/.test(n ?? ''));

    it('finds a section by a field inside it', async () => {
        render(<AdminHarness userRole="superadmin" />);
        await userEvent.type(screen.getByRole('searchbox'), 'googleSearchApiKey');
        // The open section stays listed until its rows have had their moment to match (DS 0.71).
        await waitFor(() => expect(navNames()).toEqual(['adminTabSearch']));
    });

    it('finds the agent section by one of its many settings', async () => {
        render(<AdminHarness userRole="superadmin" />);
        await userEvent.type(screen.getByRole('searchbox'), 'defaultTopK');
        await waitFor(() => expect(navNames()).toEqual(['adminTabAgents']));
    });

    it('finds the KB overview by one of its columns', async () => {
        render(<AdminHarness userRole="superadmin" />);
        await userEvent.type(screen.getByRole('searchbox'), 'colStaleShare');
        await waitFor(() => expect(navNames()).toEqual(['adminTabKbOverview']));
    });
});

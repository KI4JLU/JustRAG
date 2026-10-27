import { describe, it, expect, beforeEach, vi, type Mock } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import axios from 'axios';
import { AdminHarness } from './test/AdminHarness';

/* ---------------------------------------------------------------------------
 * The Rollen tab's per-role user counts come from the same GET
 * /api/admin/users fetch the Benutzerverwaltung tab uses. When that fetch
 * fails, the list stays empty, and "0 users" under every role would read as
 * a fact about the deployment. ORACLE: AdminRolesTab's contract — `users`
 * is null while the list is not known, and null renders no count badges.
 * ------------------------------------------------------------------------- */

vi.mock('axios', () => ({
    default: { get: vi.fn(), post: vi.fn() },
}));

// One stable object per mocked context (see AdminUI.headings.test.tsx).
const themeMock = { t: (k: string) => k, language: 'en' as const };
vi.mock('./contexts/ThemeContext', () => ({ useTheme: () => themeMock }));
const toastMock = { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() };
vi.mock('./contexts/ToastContext', () => ({ useToast: () => toastMock }));
const modalMock = { showConfirm: vi.fn(), showAlert: vi.fn(), showPrompt: vi.fn() };
vi.mock('./contexts/ModalContext', () => ({ useModalContext: () => modalMock }));
vi.mock('./hooks/useReducedMotion', () => ({
    useReducedMotion: () => false,
    getMotionProps: () => ({}),
}));

const mockedGet = axios.get as unknown as Mock;

function respondUsers(users: () => Promise<unknown>) {
    mockedGet.mockImplementation((url: string) =>
        String(url).includes('/admin/users') ? users() : Promise.resolve({ data: [] }));
}

async function openRolesTab() {
    render(<AdminHarness userRole="admin" />);
    await userEvent.click(screen.getByRole('button', { name: 'adminTabRoles' }));
    await screen.findByRole('table', { name: 'arSystemRolesTitle' });
}

beforeEach(() => {
    vi.clearAllMocks();
});

describe('AdminUI → Rollen user counts', () => {
    it('shows no counts when the user list fails to load', async () => {
        respondUsers(() => Promise.reject(new Error('boom')));
        await openRolesTab();
        await vi.waitFor(() => expect(toastMock.error).toHaveBeenCalledWith('usersFetchError'));
        expect(screen.queryByText(/arUserCount/)).toBeNull();
    });

    it('shows the counts once the user list loads', async () => {
        respondUsers(() => Promise.resolve({ data: [{ id: 'u-1', role: 'admin' }] }));
        await openRolesTab();
        expect(await screen.findByText('arUserCountOne')).toBeTruthy();
    });
});

import { describe, it, expect, beforeEach, vi, type Mock } from 'vitest';
import { render, screen } from '@testing-library/react';
import axios from 'axios';
import AdminUI from './AdminUI';

/* ---------------------------------------------------------------------------
 * The Authentication tab is superadmin-only.
 *
 * ORACLE: go-backend/internal/app/routes.go — registerAuthProviderRoutes puts
 * every /api/admin/auth-providers route on superadminChain (pinned there by
 * TestAuthProviderRoutesAreSuperadminOnly). Whoever configures a login
 * provider decides which identities the app trusts, so a plain admin may not.
 * An admin who saw the tab would only collect 403s; this pins that the nav
 * follows the route.
 * ------------------------------------------------------------------------- */

vi.mock('axios', () => ({
    default: { get: vi.fn(), post: vi.fn() },
}));

// One stable object per mocked context: `t` and `toast` sit in AdminUI's
// fetch callbacks' dependency lists (see AdminUI.headings.test.tsx).
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

beforeEach(() => {
    vi.clearAllMocks();
    mockedGet.mockResolvedValue({ data: [] });
});

function renderAs(role: string) {
    return render(<AdminUI onBack={() => {}} user={{ id: 'op-1', username: 'ada', role }} />);
}

describe('AdminUI navigation — authentication providers', () => {
    it('hides the Authentication tab from an admin', () => {
        renderAs('admin');
        expect(screen.queryByRole('button', { name: 'adminTabAuth' })).toBeNull();
        // Contrast: the same nav group still renders for an admin.
        expect(screen.getByRole('button', { name: 'adminTabAiModels' })).toBeTruthy();
    });

    it('shows the Authentication tab to a superadmin', () => {
        renderAs('superadmin');
        expect(screen.getByRole('button', { name: 'adminTabAuth' })).toBeTruthy();
    });
});

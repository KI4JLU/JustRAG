import { describe, it, expect, beforeEach, vi, type Mock } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import axios from 'axios';
import { AdminHarness } from './test/AdminHarness';
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
    return render(<AdminHarness userRole={role} />);
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

/* ---------------------------------------------------------------------------
 * The sections sit under group headings, KB overview before the public KBs.
 *
 * ORACLE: the old page's nav groups (configuration, users, monitoring) plus the
 * developer's decision of 2026-10-26 that the two KB sections are one group,
 * overview first; WAI-ARIA's group role for the heading. Needs design-system
 * >= 0.67.0 (`SettingsSection.group`).
 * ------------------------------------------------------------------------- */
describe('AdminUI navigation — groups', () => {
    const rowsOf = (group: string) =>
        within(screen.getByRole('group', { name: group })).getAllByRole('button').map((b) => b.textContent);

    it('groups the sections for a superadmin', () => {
        renderAs('superadmin');
        expect(rowsOf('adminNavGroupConfig')).toEqual(['adminTabAiModels', 'adminTabAuth', 'adminTabSearch', 'adminTabAgents', 'adminTabSettings']);
        expect(rowsOf('adminNavGroupKbs')).toEqual(['adminTabKbOverview', 'adminTabGlobalKbs']);
        expect(rowsOf('adminNavGroupUsers')).toEqual(['adminTabUsers', 'adminTabRoles']);
        expect(rowsOf('adminNavGroupMonitoring')).toEqual(['adminTabHealth', 'evalRunner']);
    });

    it('leaves out what an admin may not use, and keeps the groups', () => {
        renderAs('admin');
        expect(rowsOf('adminNavGroupConfig')).toEqual(['adminTabAiModels']);
        expect(rowsOf('adminNavGroupKbs')).toEqual(['adminTabKbOverview', 'adminTabGlobalKbs']);
        expect(rowsOf('adminNavGroupMonitoring')).toEqual(['adminTabHealth']);
    });
});

/* ---------------------------------------------------------------------------
 * A link to a section the user may not see (`?admin=auth` for a plain admin) shows the first section, and
 * the dialog reports that, so the URL names what is on screen. ORACLE: the route rule above (auth is
 * superadmin-only) and the rights rule of the `?admin=` link.
 * ------------------------------------------------------------------------- */
describe('AdminUI navigation — a section the user may not see', () => {
    it('falls back to the first section and says so', () => {
        const onSectionChange = vi.fn();
        render(<AdminUI open onOpenChange={() => {}} section="auth" onSectionChange={onSectionChange} user={{ id: 'op-1', username: 'ada', role: 'admin' }} />);
        expect(onSectionChange).toHaveBeenCalledWith('configs');
        expect(screen.getByRole('heading', { level: 2, name: 'adminTabAiModels' })).toBeTruthy();
    });

    it('leaves a visible section alone', () => {
        const onSectionChange = vi.fn();
        render(<AdminUI open onOpenChange={() => {}} section="auth" onSectionChange={onSectionChange} user={{ id: 'op-1', username: 'ada', role: 'superadmin' }} />);
        expect(onSectionChange).not.toHaveBeenCalled();
    });
});

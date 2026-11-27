import { describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import AdminRolesTab from './AdminRolesTab';

const themeMock = { t: (k: string) => k, language: 'en' as const };
vi.mock('../../contexts/ThemeContext', () => ({ useTheme: () => themeMock }));

// Oracle: the card's requirements — a read-only overview (no form controls,
// no save), a notice that roles are code, user counts per system role reduced
// from GET /api/admin/users. Counts are computed by hand from the fixture.
const USERS = [
    { id: '1', role: 'superadmin' }, { id: '2', role: 'admin' }, { id: '3', role: 'admin' },
    { id: '4', role: 'user' }, { id: '5', role: 'user' }, { id: '6', role: 'user' },
];

describe('AdminRolesTab', () => {
    it('is read-only: no checkbox, switch, text field or save button', () => {
        render(<AdminRolesTab users={USERS} />);
        expect(screen.queryAllByRole('checkbox')).toHaveLength(0);
        expect(screen.queryAllByRole('switch')).toHaveLength(0);
        expect(screen.queryAllByRole('textbox')).toHaveLength(0);
        // The only buttons are the role headers' info triggers.
        for (const b of screen.queryAllByRole('button')) expect(b).toHaveAccessibleName(/rrRoleInfo$/);
        expect(screen.getByText('arNotice')).toBeInTheDocument();
    });

    it('shows the users per system role in the column headers', () => {
        render(<AdminRolesTab users={USERS} />);
        const table = screen.getByRole('table', { name: 'arSystemRolesTitle' });
        const headers = within(table).getAllByRole('columnheader');
        // [Recht, superadmin, admin, api-user, user]
        expect(headers[1]).toHaveTextContent('arUserCountOne');
        expect(headers[2]).toHaveTextContent('arUserCountOther');
        expect(headers[3]).toHaveTextContent('arUserCountOther');
        expect(headers[4]).toHaveTextContent('arUserCountOther');
        // The header's aria-label replaces its content for assistive tech, so
        // the count has to be part of that name, not only of the badge.
        expect(headers[1]).toHaveAccessibleName(/arUserCountOne/);
        expect(headers[2]).toHaveAccessibleName(/arUserCountOther/);
    });

    it('gives each right its explanation as an accessible description', () => {
        render(<AdminRolesTab users={USERS} />);
        const sys = screen.getByRole('table', { name: 'arSystemRolesTitle' });
        // The row header's title is its accessible description (HTML-AAM), so
        // the explanation and the routes reach screen readers as well as the
        // hover tooltip. Pins that the hint stays attached to the header.
        const auth = within(sys).getByRole('rowheader', { name: 'arRightAuthProviders' });
        expect(auth).toHaveAccessibleDescription(/arRightAuthProvidersHint\s+arRoutes: \/api\/admin\/auth-providers/);
        const kb = screen.getByRole('table', { name: 'arKbRolesTitle' });
        expect(within(kb).getByRole('rowheader', { name: 'rrRightInvite' })).toHaveAccessibleDescription('rrRightInviteHint');
    });

    it('omits the count badges while the users are not loaded', () => {
        render(<AdminRolesTab users={null} />);
        expect(screen.queryByText(/arUserCount/)).toBeNull();
    });

    it('renders the system and the topic matrix', () => {
        render(<AdminRolesTab users={USERS} />);
        const sys = screen.getByRole('table', { name: 'arSystemRolesTitle' });
        // 14 rights + 4 group headings (scope="rowgroup" is a row header too).
        expect(within(sys).getAllByRole('rowheader')).toHaveLength(18);
        const kb = screen.getByRole('table', { name: 'arKbRolesTitle' });
        // 7 rights + 3 group headings.
        expect(within(kb).getAllByRole('rowheader')).toHaveLength(10);
        // Per-topic switches are named, not shown as a fixed value.
        expect(within(kb).getAllByText('arPerTopic').length).toBeGreaterThan(0);
    });

    // ORACLE: docs/glossary-access.md — owner, admin, editor, viewer, with the rights written out by hand.
    it('renders the glossary roles beside the topic roles', () => {
        render(<AdminRolesTab users={USERS} />);
        const table = screen.getByRole('table', { name: 'arGlossaryRolesTitle' });
        const headers = within(table).getAllByRole('columnheader');
        // [Recht, owner, admin, editor, viewer]
        expect(headers.slice(1).map(h => h.getAttribute('aria-label'))).toEqual(['kbRoleOwner', 'kbRoleAdmin', 'kbRoleEdit', 'kbRoleView']);
        // 8 rights + 3 group headings; a CSV import is no right of a glossary that exists.
        expect(within(table).getAllByRole('rowheader')).toHaveLength(11);
        expect(within(table).queryByRole('rowheader', { name: 'arGlossaryRightImport' })).toBeNull();

        const row = (right: string) => within(table).getByRole('rowheader', { name: right }).closest('tr') as HTMLElement;
        const marks = (right: string) => within(row(right)).getAllByRole('img').map(m => m.getAttribute('aria-label') ?? '');
        // Columns: owner, admin, editor, viewer. A viewer reads; only the owner deletes.
        expect(marks('arGlossaryRightRead').map(l => l.includes('rrGranted'))).toEqual([true, true, true, true]);
        expect(marks('arGlossaryRightEditEntries').map(l => l.includes('rrGranted'))).toEqual([true, true, true, false]);
        expect(marks('arGlossaryRightMembers').map(l => l.includes('rrGranted'))).toEqual([true, true, false, false]);
        expect(marks('arGlossaryRightDelete').map(l => l.includes('rrGranted'))).toEqual([true, false, false, false]);
    });

    it('has the extension right for all four system roles, in a group of its own', () => {
        render(<AdminRolesTab users={USERS} />);
        const sys = screen.getByRole('table', { name: 'arSystemRolesTitle' });
        expect(within(sys).getByRole('rowheader', { name: /arGroupExtensions/ })).toBeInTheDocument();
        const row = within(sys).getByRole('rowheader', { name: 'arRightUseTranslation' }).closest('tr') as HTMLElement;
        const granted = within(row).getAllByRole('img').map(m => (m.getAttribute('aria-label') ?? '').includes('rrGranted'));
        expect(granted).toEqual([true, true, true, true]);
    });
});

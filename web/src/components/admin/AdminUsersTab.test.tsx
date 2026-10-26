import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import AdminUsersTab from './AdminUsersTab';
import { translations } from '../../translations';

// Real English strings, so the assertions read like the screen (and the range label's placeholders resolve).
const t = (k: string) => (translations as Record<string, { en: string }>)[k]?.en ?? k;
const themeMock = { t, language: 'en' as const };
vi.mock('../../contexts/ThemeContext', () => ({ useTheme: () => themeMock }));

const handleRoleChange = vi.fn();
const handleDeleteUser = vi.fn();

const user = (n: number, over: Partial<{ role: string; firstName: string; lastName: string; username: string }> = {}) => ({
    id: `id-${n}`, username: `user${n}`, role: 'user', firstName: `First${n}`, lastName: `Last${n}`, ...over,
});

const ME = { id: 'me', username: 'root', role: 'superadmin' };

function renderTab(users: ReturnType<typeof user>[], currentUser = ME) {
    return render(
        <AdminUsersTab usersList={users} currentUser={currentUser} handleRoleChange={handleRoleChange} handleDeleteUser={handleDeleteUser} loading={false} />,
    );
}

beforeEach(() => {
    vi.clearAllMocks();
    // Radix's Select trigger measures and captures pointers; jsdom implements neither.
    Element.prototype.hasPointerCapture = vi.fn(() => false);
    Element.prototype.setPointerCapture = vi.fn();
    Element.prototype.releasePointerCapture = vi.fn();
    Element.prototype.scrollIntoView = vi.fn();
});

/* ORACLE for the permission cases: the rule the page had before the list moved onto the shared person
 * rows (and that the routes enforce): superadmins and oneself are never editable, an admin may not touch
 * another admin, only a superadmin hands out `admin` and deletes. */
describe('AdminUsersTab — rows', () => {
    it('shows name and @username, with a role select for an editable user', () => {
        renderTab([user(1)]);
        const row = within(screen.getByTestId('user-row-id-1'));
        expect(row.getByText('First1 Last1')).toBeInTheDocument();
        expect(row.getByText('@user1')).toBeInTheDocument();
        expect(row.getByRole('combobox', { name: 'Select role: @user1' })).toHaveTextContent('User');
    });

    it('shows a role badge instead of a select for oneself, another superadmin and (to an admin) another admin', () => {
        const users = [user(1, { role: 'superadmin' }), { ...user(2), id: 'me' }, user(3, { role: 'admin' })];
        renderTab(users, { id: 'me', username: 'root', role: 'superadmin' });
        expect(within(screen.getByTestId('user-row-id-1')).queryByRole('combobox')).toBeNull();
        expect(within(screen.getByTestId('user-row-id-1')).getByText('Superadmin')).toBeInTheDocument();
        expect(within(screen.getByTestId('user-row-me')).queryByRole('combobox')).toBeNull();
        expect(within(screen.getByTestId('user-row-id-3')).getByRole('combobox')).toBeInTheDocument();
    });

    it('lets an admin neither edit another admin nor assign admin', async () => {
        renderTab([user(1, { role: 'admin' }), user(2)], { id: 'me', username: 'ada', role: 'admin' });
        expect(within(screen.getByTestId('user-row-id-1')).queryByRole('combobox')).toBeNull();
        await userEvent.click(within(screen.getByTestId('user-row-id-2')).getByRole('combobox'));
        const options = (await screen.findAllByRole('option')).map(o => o.textContent);
        expect(options).toEqual(['User', 'API User']);
    });

    it('reports a role change with the user id and the chosen role', async () => {
        renderTab([user(1)]);
        await userEvent.click(within(screen.getByTestId('user-row-id-1')).getByRole('combobox'));
        await userEvent.click(await screen.findByRole('option', { name: 'API User' }));
        expect(handleRoleChange).toHaveBeenCalledWith('id-1', 'api-user');
    });

    it('offers delete in the actions menu to a superadmin, on users whose role is editable', async () => {
        const { unmount } = renderTab([user(1), user(2, { role: 'superadmin' })]);
        await userEvent.click(screen.getByRole('button', { name: 'Actions for user1' }));
        expect((await screen.findAllByRole('menuitem')).map(i => i.textContent)).toEqual(['User info', 'Delete user']);
        await userEvent.click(screen.getByRole('menuitem', { name: 'Delete user' }));
        expect(handleDeleteUser).toHaveBeenCalledWith('id-1', 'user1');
        unmount();

        // Another superadmin cannot be deleted from here; the info is still there.
        renderTab([user(2, { role: 'superadmin' })]);
        await userEvent.click(screen.getByRole('button', { name: 'Actions for user2' }));
        expect((await screen.findAllByRole('menuitem')).map(i => i.textContent)).toEqual(['User info']);
    });

    it('offers an admin the info and nothing destructive', async () => {
        renderTab([user(1)], { id: 'me', username: 'ada', role: 'admin' });
        await userEvent.click(screen.getByRole('button', { name: 'Actions for user1' }));
        expect((await screen.findAllByRole('menuitem')).map(i => i.textContent)).toEqual(['User info']);
    });
});

describe('AdminUsersTab — user info', () => {
    // ORACLE: the fixture (what the list endpoint returns: name, username, role, id, createdAt) and the
    // sub-screen pattern of „Mitglieder hinzufügen" (breadcrumb back to the list, title).
    const withDate = { ...user(1, { firstName: 'Grace', lastName: 'Hopper', username: 'ghopper', role: 'api-user' }), createdAt: '2025-03-14T09:30:00Z' };

    it('shows the facts of the chosen user in place of the list, and returns to it', async () => {
        renderTab([withDate, user(2)]);
        await userEvent.click(screen.getByRole('button', { name: 'Actions for ghopper' }));
        await userEvent.click(await screen.findByRole('menuitem', { name: 'User info' }));

        expect(screen.getByRole('heading', { level: 3, name: 'User info' })).toBeInTheDocument();
        expect(screen.getByText('Grace')).toBeInTheDocument();
        expect(screen.getByText('Hopper')).toBeInTheDocument();
        expect(screen.getByText('@ghopper')).toBeInTheDocument();
        expect(screen.getByText('API User')).toBeInTheDocument();
        expect(screen.getByText('id-1')).toBeInTheDocument();
        expect(screen.getByText(/2025/)).toBeInTheDocument();
        // The list is gone while the info is open.
        expect(screen.queryByTestId('user-row-id-2')).toBeNull();

        await userEvent.click(screen.getByRole('button', { name: /Back to.*Users/ }));
        expect(screen.getByTestId('user-row-id-2')).toBeInTheDocument();
    });

    it('shows a dash for what the account does not have', async () => {
        renderTab([{ id: 'x', username: 'nobody', role: 'user' } as ReturnType<typeof user>]);
        await userEvent.click(screen.getByRole('button', { name: 'Actions for nobody' }));
        await userEvent.click(await screen.findByRole('menuitem', { name: 'User info' }));
        expect(screen.getAllByText('–').length).toBeGreaterThanOrEqual(3); // first name, last name, member since
    });
});

describe('AdminUsersTab — search and filter', () => {
    const users = [
        user(1, { firstName: 'Grace', lastName: 'Hopper', username: 'ghopper' }),
        user(2, { firstName: 'Ada', lastName: 'Lovelace', username: 'alovelace', role: 'api-user' }),
        user(3, { firstName: 'Alan', lastName: 'Turing', username: 'aturing', role: 'admin' }),
    ];

    it('narrows the list by name or username, case-insensitively', async () => {
        renderTab(users);
        await userEvent.type(screen.getByRole('searchbox', { name: 'Search users' }), 'LOVE');
        expect(screen.getAllByRole('listitem')).toHaveLength(1);
        expect(screen.getByText('Ada Lovelace')).toBeInTheDocument();

        await userEvent.clear(screen.getByRole('searchbox'));
        await userEvent.type(screen.getByRole('searchbox'), 'aturing');
        expect(screen.getByText('Alan Turing')).toBeInTheDocument();
        expect(screen.getAllByRole('listitem')).toHaveLength(1);
    });

    it('says so when nothing matches', async () => {
        renderTab(users);
        await userEvent.type(screen.getByRole('searchbox'), 'zzz');
        expect(screen.queryAllByRole('listitem')).toHaveLength(0);
        expect(screen.getByText(t('adminUsersNoMatch'))).toBeInTheDocument();
    });

    it('filters by role', async () => {
        renderTab(users);
        await userEvent.click(screen.getByRole('combobox', { name: t('adminUsersFilterRole') }));
        await userEvent.click(await screen.findByRole('option', { name: 'API User' }));
        expect(screen.getAllByRole('listitem')).toHaveLength(1);
        expect(screen.getByText('Ada Lovelace')).toBeInTheDocument();
    });
});

describe('AdminUsersTab — pagination', () => {
    const many = Array.from({ length: 25 }, (_, i) => user(i + 1));

    it('pages ten at a time, with the range and previous/next', async () => {
        renderTab(many);
        expect(screen.getAllByRole('listitem')).toHaveLength(10);
        expect(screen.getByText('1–10 of 25')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Previous page' })).toBeDisabled();

        await userEvent.click(screen.getByRole('button', { name: 'Next page' }));
        expect(screen.getByText('11–20 of 25')).toBeInTheDocument();
        expect(screen.getByTestId('user-row-id-11')).toBeInTheDocument();

        await userEvent.click(screen.getByRole('button', { name: 'Next page' }));
        expect(screen.getAllByRole('listitem')).toHaveLength(5);
        expect(screen.getByText('21–25 of 25')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Next page' })).toBeDisabled();
    });

    it('returns to the first page when the search changes', async () => {
        renderTab(many);
        await userEvent.click(screen.getByRole('button', { name: 'Next page' }));
        await userEvent.type(screen.getByRole('searchbox'), 'user1');
        // user1, user10–user19: 11 matches, on page one again.
        expect(screen.getByText('1–10 of 11')).toBeInTheDocument();
    });

    it('shows no pager while everything fits on one page', () => {
        renderTab(many.slice(0, 10));
        expect(screen.queryByRole('button', { name: 'Next page' })).toBeNull();
    });
});

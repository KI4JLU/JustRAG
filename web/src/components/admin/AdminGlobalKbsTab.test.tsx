import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import axios from 'axios';
import AdminGlobalKbsTab from './AdminGlobalKbsTab';
import { translations } from '../../translations';

vi.mock('axios');
const mockedAxios = vi.mocked(axios, true);

// Real translated text (English) so button/switch accessible names actually
// contain the words the tests match on ("make private", "overview") — a
// plain key-echo mock would not. See KbAgentsSection.test.tsx for the same
// pattern.
const tMock = (key: string) => {
    const entry = translations[key as keyof typeof translations];
    return entry ? entry.en : key;
};
const themeMock = { t: tMock };
const toastMock = { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() };
const showPrompt = vi.fn();
const showConfirm = vi.fn();
const modalMock = { showPrompt, showConfirm };
const authMock = { user: { id: 'admin-1', username: 'admin', role: 'admin' }, token: 'tok' };

// Hoisted, module-level singleton mocks — a fresh object literal per call
// would change identity on every render and destabilize effect deps.
vi.mock('../../contexts/ThemeContext', () => ({ useTheme: () => themeMock }));
vi.mock('../../contexts/ToastContext', () => ({ useToast: () => toastMock }));
vi.mock('../../contexts/ModalContext', () => ({ useModalContext: () => modalMock }));
vi.mock('../../contexts/AuthContext', () => ({ useAuth: () => authMock }));

describe('AdminGlobalKbsTab', () => {
    beforeEach(() => {
        vi.resetAllMocks();
        // Radix's Select trigger measures and captures pointers; jsdom implements neither.
        Element.prototype.hasPointerCapture = vi.fn(() => false);
        Element.prototype.setPointerCapture = vi.fn();
        Element.prototype.releasePointerCapture = vi.fn();
        Element.prototype.scrollIntoView = vi.fn();
        mockedAxios.get.mockImplementation((url: string) => {
            if (url.includes('/unpublish-impact')) {
                return Promise.resolve({
                    data: { subscribers: 4, candidates: [{ userId: 'u1', username: 'alice' }] },
                });
            }
            if (url.includes('/api/admin/kb-categories')) {
                return Promise.resolve({ data: [] });
            }
            return Promise.resolve({
                data: [{ id: 'kb-1', name: 'IT-Handbuch', createdAt: '2026-01-01T00:00:00Z', autoSubscribe: false }],
            });
        });
    });

    it('states the subscriber count before unpublishing', async () => {
        renderTab();
        await openUnpublishDialog();
        expect(await screen.findByText(/4/)).toBeInTheDocument();
    });

    it('requires an owner and posts it', async () => {
        mockedAxios.post.mockResolvedValue({ status: 204 });
        renderTab();

        await openUnpublishDialog();
        const dialog = await screen.findByRole('dialog');
        await chooseOwner(dialog, 'alice');
        await userEvent.click(within(dialog).getByRole('button', { name: /zurücknehmen|make private/i }));

        await waitFor(() => {
            expect(mockedAxios.post).toHaveBeenCalledWith(
                expect.stringContaining('/api/admin/kb/kb-1/unpublish'),
                { newOwnerId: 'u1' }
            );
        });

        // The KB is no longer public — the row (and the dialog) disappear.
        await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
        expect(screen.queryByText('IT-Handbuch')).toBeNull();
    });

    // ORACLE: the developer's ruling of 2026-10-26: the „show in everyone's overview" switch is an entry of the
    // row's ⋮ menu (a checked item is its current state), and the row says so with a badge.
    it('toggles auto_subscribe from the row menu through the global-kbs PATCH', async () => {
        mockedAxios.patch.mockResolvedValue({ data: { id: 'kb-1', autoSubscribe: true } });
        renderTab();

        await openRowMenu();
        const item = await screen.findByRole('menuitem', { name: /overview/i });
        expect(item).not.toHaveAttribute('aria-current');
        expect(screen.queryByText(translations.autoSubscribeBadge.en)).toBeNull();
        await userEvent.click(item);

        await waitFor(() => {
            expect(mockedAxios.patch).toHaveBeenCalledWith(
                expect.stringContaining('/api/admin/global-kbs/kb-1'),
                expect.objectContaining({ autoSubscribe: true })
            );
        });
        // On now: the row carries the badge, and the menu item is the checked one.
        expect(await screen.findByText(translations.autoSubscribeBadge.en)).toBeInTheDocument();
        await openRowMenu();
        expect(await screen.findByRole('menuitem', { name: /overview/i })).toHaveAttribute('aria-current', 'true');
    });

    // ORACLE: docs/kb-access.md — a staged public KB (is_published = false) is not live until an operator publishes it,
    // and PATCH /api/admin/global-kbs/{id} accepts `isPublished`. The row says it is not live, and „Veröffentlichen" in the menu goes live.
    it('shows a staged KB as not live and publishes it from the row menu', async () => {
        mockedAxios.get.mockImplementation((url: string) => {
            if (url.includes('/api/admin/kb-categories')) return Promise.resolve({ data: [] });
            return Promise.resolve({
                data: [{ id: 'kb-1', name: 'IT-Handbuch', createdAt: '2026-01-01T00:00:00Z', autoSubscribe: false, isPublished: false }],
            });
        });
        mockedAxios.patch.mockResolvedValue({ data: {} });
        renderTab();

        expect(await screen.findByText(translations.kbStagedBadge.en)).toBeInTheDocument();
        await openRowMenu();
        await userEvent.click(await screen.findByRole('menuitem', { name: translations.kbActionPublishLive.en }));

        await waitFor(() => {
            expect(mockedAxios.patch).toHaveBeenCalledWith(
                expect.stringContaining('/api/admin/global-kbs/kb-1'),
                { isPublished: true },
            );
        });
        await waitFor(() => expect(screen.queryByText(translations.kbStagedBadge.en)).toBeNull());
    });

    // ORACLE: a second change to the same KB while the first request is still in flight must not go out: on failure it
    // would roll back to an optimistic value the server never had.
    it('allows one change per KB at a time', async () => {
        mockedAxios.patch.mockReturnValue(new Promise(() => {})); // never settles
        renderTab();

        await openRowMenu();
        await userEvent.click(await screen.findByRole('menuitem', { name: translations.kbActionPublishLive.en }));
        await waitFor(() => expect(mockedAxios.patch).toHaveBeenCalledTimes(1));

        await openRowMenu();
        const again = await screen.findByRole('menuitem', { name: translations.kbActionPublishLive.en });
        expect(again).toHaveAttribute('aria-disabled', 'true');
        fireEvent.click(again); // bypassing the disabled state: the handler refuses as well
        expect(mockedAxios.patch).toHaveBeenCalledTimes(1);
    });

    it('blocks confirmation until an owner is chosen when candidates exist', async () => {
        renderTab();
        await openUnpublishDialog();
        const dialog = await screen.findByRole('dialog');
        await screen.findByText(/4/);

        const confirmButton = within(dialog).getByRole('button', { name: /zurücknehmen|make private/i });
        expect(confirmButton).toBeDisabled();

        await chooseOwner(dialog, 'alice');
        expect(confirmButton).toBeEnabled();
    });

    it('offers the acting admin as owner and enables confirmation immediately when there are no candidates', async () => {
        mockedAxios.get.mockImplementation((url: string) => {
            if (url.includes('/unpublish-impact')) {
                return Promise.resolve({ data: { subscribers: 0, candidates: [] } });
            }
            if (url.includes('/api/admin/kb-categories')) {
                return Promise.resolve({ data: [] });
            }
            return Promise.resolve({
                data: [{ id: 'kb-1', name: 'IT-Handbuch', createdAt: '2026-01-01T00:00:00Z', autoSubscribe: false }],
            });
        });
        mockedAxios.post.mockResolvedValue({ status: 204 });
        renderTab();

        await openUnpublishDialog();
        const dialog = await screen.findByRole('dialog');
        await screen.findByText(translations.unpublishNoCandidates.en);
        expect(within(dialog).queryByRole('combobox')).toBeNull();

        const confirmButton = within(dialog).getByRole('button', { name: /zurücknehmen|make private/i });
        expect(confirmButton).toBeEnabled();

        await userEvent.click(confirmButton);
        await waitFor(() => {
            expect(mockedAxios.post).toHaveBeenCalledWith(
                expect.stringContaining('/api/admin/kb/kb-1/unpublish'),
                { newOwnerId: 'admin-1' }
            );
        });
        await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    });

    it('disables a row\'s categories instead of risking a wipe when its assignment fetch fails', async () => {
        mockedAxios.get.mockImplementation((url: string) => {
            if (url.includes('/unpublish-impact')) {
                return Promise.resolve({
                    data: { subscribers: 4, candidates: [{ userId: 'u1', username: 'alice' }] },
                });
            }
            if (url.includes('/api/admin/kb-categories')) {
                return Promise.resolve({ data: [{ id: 'cat-1', name: 'Security', sortOrder: 0 }] });
            }
            if (url.includes('/api/kb/kb-1/categories')) {
                return Promise.reject(new Error('boom'));
            }
            return Promise.resolve({
                data: [{ id: 'kb-1', name: 'IT-Handbuch', createdAt: '2026-01-01T00:00:00Z', autoSubscribe: false }],
            });
        });
        renderTab();

        // The row says so, and its categories are not offered for change.
        expect(await screen.findByText(translations.categoriesLoadError.en)).toBeInTheDocument();
        await openCategories();
        const security = await screen.findByRole('menuitem', { name: /Security/i });
        expect(security).toHaveAttribute('aria-disabled', 'true');

        // Even a click that reaches the item bypassing the disabled state (fireEvent dispatches directly
        // on the node) must not be able to issue the wiping PUT: the handler itself refuses once the row
        // is marked as failed-to-load.
        fireEvent.click(security);
        expect(mockedAxios.put).not.toHaveBeenCalled();
    });

    // The chips replaced a <select multiple>; the submenu replaces the chips. Both directions are pinned,
    // since "assignments can be removed again" is the whole point of the control.
    it('assigns a category from the menu and removes it with a second choice', async () => {
        mockedAxios.get.mockImplementation((url: string) => {
            if (url.includes('/api/admin/kb-categories')) {
                return Promise.resolve({ data: [{ id: 'cat-1', name: 'Security', sortOrder: 0 }] });
            }
            if (url.includes('/api/kb/kb-1/categories')) {
                return Promise.resolve({ data: [] });
            }
            return Promise.resolve({
                data: [{ id: 'kb-1', name: 'IT-Handbuch', createdAt: '2026-01-01T00:00:00Z', autoSubscribe: false }],
            });
        });
        mockedAxios.put.mockResolvedValue({ status: 204 });
        renderTab();

        await openCategories();
        const security = await screen.findByRole('menuitem', { name: /Security/i });
        expect(security).not.toHaveAttribute('aria-current');
        await userEvent.click(security);
        await waitFor(() => {
            expect(mockedAxios.put).toHaveBeenCalledWith(
                expect.stringContaining('/api/kb/kb-1/categories'),
                { categoryIds: ['cat-1'] }
            );
        });

        await openCategories();
        const assigned = await screen.findByRole('menuitem', { name: /Security/i });
        expect(assigned).toHaveAttribute('aria-current', 'true');
        await userEvent.click(assigned);
        await waitFor(() => {
            expect(mockedAxios.put).toHaveBeenLastCalledWith(
                expect.stringContaining('/api/kb/kb-1/categories'),
                { categoryIds: [] }
            );
        });
    });
});

// Unpublish sits in the row's actions menu (Edit / Make private / Delete), so
// the dialog is reached through the menu rather than a row-level button.
async function openUnpublishDialog() {
    await openRowMenu();
    await userEvent.click(await screen.findByRole('menuitem', { name: /zurücknehmen|make private/i }));
}

/** Opens the ⋮ menu of the (only) row. */
async function openRowMenu() {
    await userEvent.click(await screen.findByRole('button', { name: /^(actions|aktionen)/i }));
}

/** Opens the row menu and its Categories submenu. */
async function openCategories() {
    await openRowMenu();
    await userEvent.click(await screen.findByRole('menuitem', { name: new RegExp(translations.categories.en, 'i') }));
}

// The owner picker is a DS (Radix) Select: open the combobox, click the option.
async function chooseOwner(dialog: HTMLElement, optionName: string) {
    await userEvent.click(within(dialog).getByRole('combobox'));
    await userEvent.click(await screen.findByRole('option', { name: optionName }));
}

// renderTab wraps the component in the same context mocks the sibling admin
// tests use (KbAgentsSection.test.tsx / KbDeleteDialog.test.tsx) — the mocks
// above stand in for ThemeProvider/ToastProvider/ModalProvider/AuthProvider.
function renderTab() {
    return render(<AdminGlobalKbsTab />);
}

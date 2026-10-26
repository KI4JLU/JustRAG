import { describe, it, expect, beforeEach, vi, type Mock } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import axios from 'axios';
import { AdminHarness } from './test/AdminHarness';

/* ---------------------------------------------------------------------------
 * Adding or editing an AI configuration or an auth provider is a sub-screen of
 * its section, the way „Mitglieder hinzufügen" is of the KB settings: the form
 * replaces the list and the dialog's footer carries the form's own actions
 * instead of „Hinzufügen".
 *
 * ORACLE: the KB settings pattern (KbSettingsDialog + KbMembersPanel) as the
 * developer specified it on 2026-10-26 — the form's Abbrechen/Speichern sit in
 * the DS footer (`data-slot="settings-dialog-footer"`), a breadcrumb leads back,
 * and the section's one action is the footer's. The slot name is the design
 * system's documented hook for the footer; roles and names are WAI-ARIA.
 * ------------------------------------------------------------------------- */

vi.mock('axios', () => ({
    default: { get: vi.fn(), post: vi.fn() },
}));

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

beforeEach(() => {
    vi.clearAllMocks();
    (axios.get as unknown as Mock).mockResolvedValue({ data: [] });
});

const footer = () => {
    const el = document.querySelector<HTMLElement>('[data-slot="settings-dialog-footer"]');
    if (!el) throw new Error('the dialog rendered no footer');
    return within(el);
};

describe.each([
    { section: 'configs', add: 'addConfig', newTitle: 'newConfig', save: 'saveConfig', nav: 'adminTabAiModels', nameField: 'configName' },
    { section: 'auth', add: 'addProvider', newTitle: 'newAuthProvider', save: 'saveProvider', nav: 'adminTabAuth', nameField: 'providerName' },
])('AdminUI → $section sub-screen', ({ section, add, newTitle, save, nav, nameField }) => {
    const open = async () => {
        render(<AdminHarness userRole="superadmin" section={section as 'configs' | 'auth'} />);
        await userEvent.click(footer().getByRole('button', { name: add }));
    };

    it('replaces the list with the form and moves the actions into the footer', async () => {
        await open();

        expect(screen.getByRole('heading', { level: 3, name: newTitle })).toBeInTheDocument();
        expect(screen.getByLabelText(nameField)).toBeInTheDocument();
        // The footer holds the form's actions, not „Hinzufügen" any more.
        expect(footer().queryByRole('button', { name: add })).toBeNull();
        expect(footer().getByRole('button', { name: save })).toBeInTheDocument();
        expect(footer().getByRole('button', { name: 'cancel' })).toBeInTheDocument();
    });

    it('returns to the list from Abbrechen and from the breadcrumb, with „Hinzufügen" back', async () => {
        await open();
        await userEvent.click(footer().getByRole('button', { name: 'cancel' }));
        expect(screen.queryByRole('heading', { level: 3, name: newTitle })).toBeNull();
        expect(footer().getByRole('button', { name: add })).toBeInTheDocument();

        await userEvent.click(footer().getByRole('button', { name: add }));
        await userEvent.click(screen.getByRole('button', { name: new RegExp(`backTo.*${nav}`) }));
        expect(screen.queryByRole('heading', { level: 3, name: newTitle })).toBeNull();
        expect(footer().getByRole('button', { name: add })).toBeInTheDocument();
    });

    it('submits the form from the footer button', async () => {
        await open();
        // Required fields empty: validation refuses, and shows its error instead of posting.
        await userEvent.click(footer().getByRole('button', { name: save }));
        expect(axios.post).not.toHaveBeenCalled();
        expect(await screen.findAllByRole('alert')).not.toHaveLength(0);
    });
});

/* ---------------------------------------------------------------------------
 * Every section's actions are in the dialog footer, none in the section.
 *
 * ORACLE: the dialog rule (actions in the footer, never in the header or the
 * body) as the developer set it for the console on 2026-10-26, and the DS
 * footer's documented hook `data-slot="settings-dialog-footer"`. The button
 * names are the translation keys the mock `t` returns.
 * ------------------------------------------------------------------------- */
describe('AdminUI → where each section keeps its actions', () => {
    // The section is a region named by its heading; the footer is outside it.
    const body = (label: string) => within(screen.getByRole('region', { name: label }));

    it.each([
        ['site', 'adminTabSettings', 'saveSettings'],
        ['search', 'adminTabSearch', 'saveSearchProviders'],
        ['agent', 'adminTabAgents', 'saveSettings'],
    ] as const)('puts %s Speichern in the footer, and nowhere else', async (section, label, save) => {
        render(<AdminHarness userRole="superadmin" section={section} />);
        expect(footer().getByRole('button', { name: save })).toBeInTheDocument();
        expect(body(label).queryByRole('button', { name: save })).toBeNull();
    });

    it('submits the site settings from the footer button', async () => {
        render(<AdminHarness userRole="superadmin" section="site" />);
        await userEvent.click(footer().getByRole('button', { name: 'saveSettings' }));
        expect(axios.post).toHaveBeenCalledWith(expect.stringContaining('/api/site-config'), expect.anything());
    });

    it('keeps „hinzufügen" and the per-job Speichern side by side in KI-Modelle', () => {
        render(<AdminHarness userRole="superadmin" section="configs" />);
        expect(footer().getByRole('button', { name: 'addConfig' })).toBeInTheDocument();
        expect(footer().getByRole('button', { name: 'saveSettings' })).toBeInTheDocument();
        expect(body('adminTabAiModels').queryByRole('button', { name: 'saveSettings' })).toBeNull();
    });

    it('has only „hinzufügen" in Auth-Anbieter, and no footer at all where nothing is saved', async () => {
        const { unmount } = render(<AdminHarness userRole="superadmin" section="auth" />);
        expect(footer().getAllByRole('button').map(b => b.textContent)).toEqual(['addProvider']);
        unmount();

        render(<AdminHarness userRole="superadmin" section="roles" />);
        expect(document.querySelector('[data-slot="settings-dialog-footer"]')).toBeNull();
    });
});

/* ---------------------------------------------------------------------------
 * The cards of the lists are the app's cards: one ⋮ menu per card. ORACLE: the topic
 * cards' pattern (ActionMenu named „Aktionen: <name>") and the pre-card buttons' names.
 * ------------------------------------------------------------------------- */
describe('AdminUI → auth provider cards', () => {
    const provider = { id: 'p-1', type: 'ldap', name: 'Campus LDAP', isActive: true, config: { url: 'ldap://x' } };

    beforeEach(() => {
        Element.prototype.hasPointerCapture = vi.fn(() => false);
        Element.prototype.setPointerCapture = vi.fn();
        Element.prototype.releasePointerCapture = vi.fn();
        Element.prototype.scrollIntoView = vi.fn();
        (axios.get as unknown as Mock).mockImplementation((url: string) =>
            Promise.resolve({ data: String(url).includes('/admin/auth-providers') ? [provider] : [] }));
    });

    it('lists the provider with a menu of edit and delete, delete last', async () => {
        render(<AdminHarness userRole="superadmin" section="auth" />);
        await userEvent.click(await screen.findByRole('button', { name: 'kbActions: Campus LDAP' }));
        expect((await screen.findAllByRole('menuitem')).map(i => i.textContent)).toEqual(['editProvider', 'deleteProvider']);
    });

    it('opens the edit sub-screen from the menu', async () => {
        render(<AdminHarness userRole="superadmin" section="auth" />);
        await userEvent.click(await screen.findByRole('button', { name: 'kbActions: Campus LDAP' }));
        await userEvent.click(await screen.findByRole('menuitem', { name: 'editProvider' }));
        expect(screen.getByRole('heading', { level: 3, name: 'editAuthProvider' })).toBeInTheDocument();
    });
});

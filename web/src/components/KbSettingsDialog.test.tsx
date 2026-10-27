import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, it, expect, vi } from 'vitest';
import { KbSettingsDialog } from './KbSettingsDialog';
import { SOURCE_FLAG_DEFAULTS } from '../utils/kbRoleRights';
import type { KnowledgeBase } from '../types';
import axios from 'axios';
import { createPortal } from 'react-dom';

const showConfirm = vi.fn<(message: string, title?: string) => Promise<boolean>>();
vi.mock('../contexts/ThemeContext', () => ({ useTheme: () => ({ t: (k: string) => k, language: 'de' }) }));
vi.mock('../contexts/ModalContext', () => ({ useModalContext: () => ({ showConfirm }) }));
vi.mock('axios', () => ({ default: { get: vi.fn(() => Promise.resolve({ data: { prompt: '' } })), put: vi.fn() } }));
// The members panel has its own suite (kbSettings/KbMembersPanel.test.tsx); here only where it shows.
vi.mock('./kbSettings/KbMembersPanel', () => ({
    KbMembersPanel: ({ kb, roleDrafts, onRoleDraftChange, revision, view, onViewChange, footerSlot }: {
        kb: { id: string }; roleDrafts: Record<string, string>;
        onRoleDraftChange: (userId: string, role: string | null) => void; revision: number;
        view: string; onViewChange: (view: 'members' | 'add') => void; footerSlot?: HTMLElement | null;
    }) => (
        <div>
            <p>members-panel {kb.id} {view}</p>
            <p>drafts {JSON.stringify(roleDrafts)} revision {revision}</p>
            {/* eslint-disable design-system/no-raw-ui-elements -- test stub of the panel, not UI */}
            <button type="button" onClick={() => onRoleDraftChange('u3', 'edit')}>draft-role</button>
            <button type="button" onClick={() => onRoleDraftChange('u3', 'admin')}>draft-admin</button>
            <button type="button" onClick={() => onViewChange('add')}>open-add</button>
            {view === 'add' && footerSlot && createPortal(
                <button type="button" onClick={() => onViewChange('members')}>add-view-action</button>, footerSlot)}
            {/* eslint-enable design-system/no-raw-ui-elements */}
        </div>
    ),
}));

beforeEach(() => { showConfirm.mockReset(); vi.mocked(axios.put).mockReset(); });

const renderDialog = ({
    dirty = false,
    onSave = vi.fn(() => Promise.resolve(true)),
    onDelete = vi.fn(() => Promise.resolve(true)),
    onClose = vi.fn(),
} = {}) => {
    const props = {
        draft: '', onDraftChange: vi.fn(), onSave, onDelete, onClose,
        kb: { id: 'kb-1', myRole: 'owner' } as KnowledgeBase,
        flags: { ...SOURCE_FLAG_DEFAULTS }, onFlagsChange: vi.fn(), dirty,
    };
    const view = render(<KbSettingsDialog {...props} />);
    return { ...view, props, onSave, onClose };
};

// Oracle: Sten's mockup of 2026-10-16 — "Keine Änderungen" on the left while
// nothing changed, Speichern disabled until something did; Löschen only on
// the Verhalten section.
describe('KbSettingsDialog footer', () => {
    it('says nothing changed and keeps Speichern disabled while clean', () => {
        renderDialog();
        expect(screen.getByText('kbSettingsNoChanges')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /save/ })).toBeDisabled();
    });

    it('enables Speichern once something changed', () => {
        renderDialog({ dirty: true });
        expect(screen.queryByText('kbSettingsNoChanges')).toBeNull();
        expect(screen.getByRole('button', { name: /save/ })).toBeEnabled();
    });

    it('offers Löschen on Verhalten only', async () => {
        renderDialog();
        expect(screen.getByRole('button', { name: /delete/ })).toBeInTheDocument();
        await userEvent.click(screen.getByRole('button', { name: 'kbSettingsTabRoles' }));
        expect(screen.queryByRole('button', { name: /delete/ })).toBeNull();
    });
});

// Oracle: KI-904 acceptance — Speichern keeps the dialog open on the same section
// with a visible saved state; a failed save keeps it open with the error.
describe('KbSettingsDialog saving', () => {
    it('stays open on the same section and says Gespeichert after a save', async () => {
        const { props, rerender, onSave, onClose } = renderDialog({ dirty: true });
        await userEvent.click(screen.getByRole('button', { name: 'kbSettingsTabRoles' }));
        await userEvent.click(screen.getByRole('button', { name: /save/ }));
        // The parent's drafts reset to the stored values once the save landed.
        rerender(<KbSettingsDialog {...props} dirty={false} />);
        expect(onSave).toHaveBeenCalledTimes(1);
        expect(onClose).not.toHaveBeenCalled();
        expect(screen.getByRole('dialog', { name: 'kbSettingsTitle' })).toBeInTheDocument();
        expect(screen.getByRole('heading', { level: 2, name: 'kbSettingsTabRoles' })).toBeInTheDocument();
        expect(screen.getByText('kbSettingsSaved')).toBeInTheDocument();
    });

    it('keeps the dialog open and shows the error when the save fails', async () => {
        const { onClose } = renderDialog({ dirty: true, onSave: vi.fn(() => Promise.resolve(false)) });
        await userEvent.click(screen.getByRole('button', { name: /save/ }));
        expect(await screen.findByRole('alert')).toHaveTextContent('settingsUpdateError');
        expect(onClose).not.toHaveBeenCalled();
        expect(screen.getByRole('button', { name: /save/ })).toBeEnabled();
    });
});

// Oracle: KI-904 acceptance — closing with unsaved changes asks for
// confirmation; without changes it closes directly.
describe('KbSettingsDialog closing', () => {
    it('closes without asking when nothing changed', async () => {
        const { onClose } = renderDialog();
        await userEvent.click(screen.getByRole('button', { name: 'cancel' }));
        expect(showConfirm).not.toHaveBeenCalled();
        expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('asks before discarding changes and stays open when the user declines', async () => {
        showConfirm.mockResolvedValue(false);
        const { onClose } = renderDialog({ dirty: true });
        await userEvent.keyboard('{Escape}');
        expect(showConfirm).toHaveBeenCalledWith('kbSettingsDiscardMessage', 'kbSettingsDiscardTitle', {
            tone: 'destructive', confirmLabel: 'kbSettingsDiscardConfirm',
        });
        expect(onClose).not.toHaveBeenCalled();
    });

    it('discards and closes when the user confirms', async () => {
        showConfirm.mockResolvedValue(true);
        const { onClose } = renderDialog({ dirty: true });
        await userEvent.click(screen.getByRole('button', { name: 'close' }));
        expect(showConfirm).toHaveBeenCalledTimes(1);
        expect(onClose).toHaveBeenCalledTimes(1);
    });
});

// Oracle: the developer's ask of 2026-10-20 — the topic settings are searchable
// like the user settings.
describe('KbSettingsDialog search', () => {
    it('finds Rollen & Rechte by one of its rights', async () => {
        renderDialog();
        await userEvent.type(screen.getByRole('searchbox', { name: 'settingsSearch' }), 'kbSettingsKeywordsRoles');
        expect(screen.queryByRole('button', { name: 'kbSettingsTabBehavior' })).toBeNull();
        expect(screen.getByRole('heading', { level: 2, name: 'kbSettingsTabRoles' })).toBeInTheDocument();
    });
});

// Oracle: the developer's ask of 2026-10-20 — the members dialog's settings
// move into this window as a "Mitglieder" section.
describe('KbSettingsDialog members', () => {
    it('opens straight on Mitglieder when asked to („Teilen" on a card)', async () => {
        render(
            <KbSettingsDialog
                kb={{ id: 'kb-1', myRole: 'owner' } as KnowledgeBase} initialSection="members"
                draft="" onDraftChange={vi.fn()} onSave={vi.fn(() => Promise.resolve(true))} onDelete={vi.fn(() => Promise.resolve(true))}
                onClose={vi.fn()} flags={{ ...SOURCE_FLAG_DEFAULTS }} onFlagsChange={vi.fn()} dirty={false}
            />,
        );
        expect(screen.getByRole('heading', { level: 2, name: 'members' })).toBeInTheDocument();
        expect(await screen.findByText('members-panel kb-1 members')).toBeInTheDocument();
    });

    it('shows the members panel for this KB in the Mitglieder section', async () => {
        renderDialog();
        await userEvent.click(screen.getByRole('button', { name: 'members' }));
        expect(screen.getByRole('heading', { level: 2, name: 'members' })).toBeInTheDocument();
        expect(await screen.findByText('members-panel kb-1 members')).toBeInTheDocument();
    });

    it('goes to Mitglieder from the assign button in Rollen & Rechte', async () => {
        renderDialog();
        await userEvent.click(screen.getByRole('button', { name: 'kbSettingsTabRoles' }));
        await userEvent.click(screen.getAllByRole('button', { name: 'rrAssignPeople' })[0]);
        expect(screen.getByRole('heading', { level: 2, name: 'members' })).toBeInTheDocument();
    });
});

// Oracle: the developer's report of 2026-10-20 — changing a member's role must
// enable Speichern like any other edit, and Speichern applies it.
describe('KbSettingsDialog member roles', () => {
    const draftRole = async () => {
        await userEvent.click(screen.getByRole('button', { name: 'members' }));
        await userEvent.click(await screen.findByRole('button', { name: 'draft-role' }));
    };

    it('enables Speichern for a role draft and PUTs it on save', async () => {
        vi.mocked(axios.put).mockResolvedValue({ status: 204 });
        const { onSave } = renderDialog();
        await draftRole();
        expect(screen.getByRole('button', { name: /save/ })).toBeEnabled();
        await userEvent.click(screen.getByRole('button', { name: /save/ }));
        expect(axios.put).toHaveBeenCalledWith(expect.stringContaining('/api/kb/kb-1/members/u3'), { role: 'edit' });
        // Nothing else was dirty, so the KB itself was not patched.
        expect(onSave).not.toHaveBeenCalled();
        expect(await screen.findByText('kbSettingsSaved')).toBeInTheDocument();
        expect(screen.getByText('drafts {} revision 1')).toBeInTheDocument();
    });

    it('keeps a draft whose save failed and reports the error', async () => {
        vi.mocked(axios.put).mockRejectedValue(new Error('boom'));
        renderDialog();
        await draftRole();
        await userEvent.click(screen.getByRole('button', { name: /save/ }));
        expect(await screen.findByRole('alert')).toHaveTextContent('settingsUpdateError');
        expect(screen.getByText('drafts {"u3":"edit"} revision 1')).toBeInTheDocument();
    });

    it('keeps a role changed while the save was in flight', async () => {
        let finish: (v: unknown) => void = () => {};
        vi.mocked(axios.put).mockImplementation(() => new Promise(resolve => { finish = resolve; }));
        renderDialog();
        await draftRole();
        await userEvent.click(screen.getByRole('button', { name: /save/ }));
        // A second change to the same member while the PUT for 'edit' is pending.
        await userEvent.click(screen.getByRole('button', { name: 'draft-admin' }));
        await act(async () => { finish({ status: 204 }); });
        expect(await screen.findByText('drafts {"u3":"admin"} revision 1')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /save/ })).toBeEnabled();
    });

    it('asks before discarding a role draft', async () => {
        showConfirm.mockResolvedValue(false);
        const { onClose } = renderDialog();
        await draftRole();
        await userEvent.click(screen.getByRole('button', { name: 'cancel' }));
        expect(showConfirm).toHaveBeenCalledTimes(1);
        expect(onClose).not.toHaveBeenCalled();
    });
});

// Oracle: the developer's report of 2026-10-20 — one row of actions per
// screen: while „Mitglieder hinzufügen" is open its actions own the footer.
describe('KbSettingsDialog adding members', () => {
    it('hands the footer to the add view and takes it back afterwards', async () => {
        renderDialog({ dirty: true });
        await userEvent.click(screen.getByRole('button', { name: 'members' }));
        await userEvent.click(await screen.findByRole('button', { name: 'open-add' }));
        expect(await screen.findByRole('button', { name: 'add-view-action' })).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /save/ })).toBeNull();
        expect(screen.queryByRole('button', { name: 'cancel' })).toBeNull();
        await userEvent.click(screen.getByRole('button', { name: 'add-view-action' }));
        expect(screen.getByRole('button', { name: /save/ })).toBeEnabled();
    });

    it('returns to the member list when another section is chosen', async () => {
        renderDialog();
        await userEvent.click(screen.getByRole('button', { name: 'members' }));
        await userEvent.click(await screen.findByRole('button', { name: 'open-add' }));
        await userEvent.click(screen.getByRole('button', { name: 'kbSettingsTabRoles' }));
        await userEvent.click(screen.getByRole('button', { name: 'members' }));
        expect(await screen.findByText('members-panel kb-1 members')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /save/ })).toBeInTheDocument();
    });
});

import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi } from 'vitest';
import { KbRolesRightsTab } from './KbRolesRightsTab';
import { SOURCE_FLAG_DEFAULTS } from '../../utils/kbRoleRights';
import type { KbSourceFlags } from '../../types';

vi.mock('../../contexts/ThemeContext', () => ({ useTheme: () => ({ t: (k: string) => k }) }));

const defaults: KbSourceFlags = { ...SOURCE_FLAG_DEFAULTS };
const renderTab = (flags: KbSourceFlags = defaults, onFlagsChange = vi.fn(), onAssignPeople = vi.fn()) => {
    render(<KbRolesRightsTab flags={flags} onFlagsChange={onFlagsChange} onAssignPeople={onAssignPeople} />);
    return { onFlagsChange, onAssignPeople };
};
// jsdom applies no CSS, so both layouts are in the DOM; each test scopes to one.
const wide = () => within(screen.getByTestId('rr-wide'));
const narrow = () => within(screen.getByTestId('rr-narrow'));
const box = (role: string, right: string) => wide().getByRole('checkbox', { name: `${role}: ${right}` });
const fixedIn = (scope: ReturnType<typeof wide>, role: string, right: string) =>
    scope.getByRole('img', { name: new RegExp(`^${role}: ${right} — `) });

// Oracle: Sten's mockup and decisions of 2026-10-16 (rotated matrix, owner and
// admin muted with plain marks, "Rechte vergeben" and the "Fest" badge gone,
// viewers never add or edit, the pyramid: add/download/edit need "see"), and
// the source-permission spec (API.md "Source permissions") — written out by
// hand, not read back from the model.
describe('KbRolesRightsTab — wide (rotated matrix)', () => {
    it('has rights as rows in three groups and roles as columns', () => {
        renderTab();
        const w = wide();
        const heads = w.getAllByRole('columnheader');
        expect(heads).toHaveLength(5);
        ['rrColRight', 'kbRoleOwner', 'kbRoleAdmin', 'kbRoleEdit', 'kbRoleView']
            .forEach((name, i) => expect(heads[i]).toHaveAccessibleName(name));
        const rows = w.getAllByRole('rowheader');
        expect(rows).toHaveLength(9);
        [
            'rrGroupTopic, 1', 'rrRightInvite',
            'rrGroupSidebar, 4', 'rrRightSeeSources', 'rrRightAddSources', 'rrRightDownloadSources', 'rrRightEditSources',
            'rrGroupAnswers, 1', 'rrRightSeeCitations',
        ].forEach((name, i) => expect(rows[i]).toHaveAccessibleName(name));
        // Group headings: row groups with their item count in the name.
        for (const [group, n] of [['rrGroupTopic', 1], ['rrGroupSidebar', 4], ['rrGroupAnswers', 1]] as const) {
            expect(w.getByRole('rowheader', { name: `${group}, ${n}` })).toHaveAttribute('scope', 'rowgroup');
        }
        expect(screen.queryByText('rrColRights')).toBeNull();
        expect(screen.queryByText('rrFixed')).toBeNull();
    });

    it('shows owner and admin as muted columns with plain marks, no checkboxes', () => {
        renderTab();
        const w = wide();
        for (const role of ['kbRoleOwner', 'kbRoleAdmin']) {
            expect(w.queryAllByRole('checkbox', { name: new RegExp(`^${role}:`) })).toHaveLength(0);
            for (const right of ['rrRightSeeSources', 'rrRightAddSources', 'rrRightDownloadSources', 'rrRightEditSources', 'rrRightSeeCitations']) {
                const mark = fixedIn(w, role, right);
                expect(mark.getAttribute('aria-label')).toContain('rrGranted');
                expect(mark.closest('td')).toHaveAttribute('data-muted');
            }
        }
        expect(fixedIn(w, 'kbRoleOwner', 'rrRightInvite')).toHaveTextContent('rrScopeAllRoles');
        expect(fixedIn(w, 'kbRoleAdmin', 'rrRightInvite')).toHaveTextContent('rrScopeUpToAdmin');
        expect(w.getByRole('columnheader', { name: 'kbRoleOwner' })).toHaveAttribute('data-muted');
        // One band: owner and admin are joined at their shared side.
        expect(w.getByRole('columnheader', { name: 'kbRoleOwner' })).toHaveAttribute('data-muted-join', 'start');
        expect(w.getByRole('columnheader', { name: 'kbRoleAdmin' })).toHaveAttribute('data-muted-join', 'end');
        expect(w.getByRole('columnheader', { name: 'kbRoleEdit' })).not.toHaveAttribute('data-muted');
    });

    it('makes exactly the seven flag cells editable; the rest are fixed or not applicable', () => {
        renderTab();
        const w = wide();
        const editable = w.getAllByRole('checkbox').filter(el => !el.hasAttribute('data-locked'));
        expect(editable.map(el => el.getAttribute('aria-label')).sort()).toEqual([
            'kbRoleEdit: rrRightAddSources', 'kbRoleEdit: rrRightDownloadSources',
            'kbRoleEdit: rrRightSeeCitations', 'kbRoleEdit: rrRightSeeSources',
            'kbRoleView: rrRightDownloadSources', 'kbRoleView: rrRightSeeCitations', 'kbRoleView: rrRightSeeSources',
        ]);
        // Editing is fixed for editors (a locked, granted checkbox) …
        const edit = w.getByRole('checkbox', { name: /^kbRoleEdit: rrRightEditSources — / });
        expect(edit).toHaveAttribute('data-locked');
        expect(edit).toHaveAttribute('data-state', 'checked');
        // … and not applicable to viewers, like adding.
        for (const right of ['rrRightAddSources', 'rrRightEditSources']) {
            const na = fixedIn(w, 'kbRoleView', right);
            expect(na).toHaveTextContent('–');
            expect(na.getAttribute('aria-label')).toContain('rrNotApplicable');
        }
        // Inviting: plain "Nein" for editors and viewers, no control yet.
        for (const role of ['kbRoleEdit', 'kbRoleView']) {
            expect(fixedIn(w, role, 'rrRightInvite')).toHaveTextContent('rrNo');
        }
    });

    it('turning editor "see" off disables add and download and withdraws editing', () => {
        renderTab({ ...defaults, editorSeeSources: false });
        for (const right of ['rrRightAddSources', 'rrRightDownloadSources']) {
            expect(box('kbRoleEdit', right)).toBeDisabled();
            expect(box('kbRoleEdit', right)).toHaveAttribute('data-state', 'unchecked');
            expect(box('kbRoleEdit', right)).toHaveAttribute('title', 'rrRequiresSee');
        }
        const edit = wide().getByRole('checkbox', { name: /^kbRoleEdit: rrRightEditSources — / });
        expect(edit).toHaveAttribute('data-state', 'unchecked');
        expect(edit.getAttribute('aria-label')).toContain('rrDenied');
        expect(edit.getAttribute('aria-label')).toContain('rrRequiresSee');
        // Citations are independent of "see"; owner and admin are unaffected.
        expect(box('kbRoleEdit', 'rrRightSeeCitations')).toBeEnabled();
        expect(fixedIn(wide(), 'kbRoleAdmin', 'rrRightEditSources').getAttribute('aria-label')).toContain('rrGranted');
    });

    it('disables viewer download until viewers see the list', () => {
        renderTab({ ...defaults, viewerDownloadSources: true });
        expect(box('kbRoleView', 'rrRightDownloadSources')).toBeDisabled();
        expect(box('kbRoleView', 'rrRightDownloadSources')).toHaveAttribute('data-state', 'unchecked');
    });

    it('reports a toggled flag', async () => {
        const { onFlagsChange } = renderTab();
        await userEvent.click(box('kbRoleEdit', 'rrRightSeeCitations'));
        expect(onFlagsChange).toHaveBeenCalledWith({ ...defaults, editorSeeCitations: false });
    });
});

describe('KbRolesRightsTab — role headers', () => {
    it('describes each role on its header info button, fixed roles as not changeable', async () => {
        renderTab();
        const w = wide();
        const owner = w.getByRole('button', { name: 'kbRoleOwner: rrRoleInfo' });
        expect(owner).toHaveAccessibleDescription(
            'rrRoleOwnerTipLead. rrTipAlwaysAll. rrTipOwnerInvite. rrTipOwnerGrant. rrTipNotChangeable');
        expect(w.getByRole('button', { name: 'kbRoleAdmin: rrRoleInfo' })).toHaveAccessibleDescription(/rrTipAdminGrant\. rrTipNotChangeable$/);
        expect(w.getByRole('button', { name: 'kbRoleEdit: rrRoleInfo' })).toHaveAccessibleDescription(
            'rrRoleEditTipLead. rrTipConfigurable. rrTipNoRoles');
        expect(w.getByRole('button', { name: 'kbRoleView: rrRoleInfo' })).toHaveAccessibleDescription(
            'rrRoleViewTipLead. rrTipConfigurable. rrTipNeverEdit. rrTipNoRoles');
        // Keyboard focus opens the rich tooltip.
        owner.focus();
        expect(await screen.findByRole('list')).toHaveTextContent('rrTipOwnerInvite');
    });
});

describe('KbRolesRightsTab — narrow (one role at a time)', () => {
    it('switches between editor and viewer and shows one switch per editable right', async () => {
        renderTab({ ...defaults, viewerSeeSources: true });
        const n = narrow();
        const editor = n.getByRole('button', { name: 'kbRoleEdit' });
        expect(editor).toHaveAttribute('aria-pressed', 'true');
        // Icon and visible label in the switcher.
        expect(editor.querySelector('svg')).not.toBeNull();
        expect(editor).toHaveTextContent('kbRoleEdit');
        expect(n.getAllByRole('switch').map(el => el.getAttribute('aria-label'))).toEqual([
            'kbRoleEdit: rrRightSeeSources', 'kbRoleEdit: rrRightAddSources',
            'kbRoleEdit: rrRightDownloadSources', 'kbRoleEdit: rrRightSeeCitations',
        ]);
        expect(n.getByText('rrRoleEditDesc')).toBeInTheDocument();
        // Owner and admin are not in the narrow layout.
        expect(n.queryByRole('button', { name: 'kbRoleOwner' })).toBeNull();

        await userEvent.click(n.getByRole('button', { name: 'kbRoleView' }));
        expect(n.getAllByRole('switch').map(el => el.getAttribute('aria-label'))).toEqual([
            'kbRoleView: rrRightSeeSources', 'kbRoleView: rrRightDownloadSources', 'kbRoleView: rrRightSeeCitations',
        ]);
        expect(n.getByText('rrRoleViewDesc')).toBeInTheDocument();
        expect(fixedIn(n, 'kbRoleView', 'rrRightAddSources')).toHaveTextContent('–');
        expect(fixedIn(n, 'kbRoleView', 'rrRightInvite')).toHaveTextContent('rrNo');
    });

    it('applies the pyramid to the switches too', async () => {
        const { onFlagsChange } = renderTab({ ...defaults, editorSeeSources: false });
        const n = narrow();
        expect(n.getByRole('switch', { name: 'kbRoleEdit: rrRightAddSources' })).toBeDisabled();
        expect(fixedIn(n, 'kbRoleEdit', 'rrRightEditSources')).toHaveTextContent('rrNo');
        await userEvent.click(n.getByRole('switch', { name: 'kbRoleEdit: rrRightSeeSources' }));
        expect(onFlagsChange).toHaveBeenCalledWith({ ...defaults, editorSeeSources: true });
    });
});

describe('KbRolesRightsTab — around the matrix', () => {
    it('has the subtitle, no heading of its own, and opens the members dialog', async () => {
        const { onAssignPeople } = renderTab();
        // No title of its own: the only headings are the narrow layout's group titles.
        expect(wide().queryByRole('heading')).toBeNull();
        expect(narrow().getAllByRole('heading').map(el => el.textContent)).toEqual(['rrGroupTopic', 'rrGroupSidebar', 'rrGroupAnswers']);
        expect(wide().getByText('rrSubtitle')).toBeInTheDocument();
        await userEvent.click(wide().getByRole('button', { name: /rrAssignPeople/ }));
        await userEvent.click(narrow().getByRole('button', { name: /rrAssignPeople/ }));
        expect(onAssignPeople).toHaveBeenCalledTimes(2);
    });

    it('explains owner and admin in one hint box, names in bold', () => {
        renderTab();
        const hint = wide().getByText(/rrAlwaysAll/).closest('p') as HTMLElement;
        expect([...hint.querySelectorAll('strong')].map(el => el.textContent)).toEqual(['kbRoleOwner', 'kbRoleAdmin']);
        expect(screen.queryByText('rrPyramidNote')).toBeNull();
    });
});

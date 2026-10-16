import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi } from 'vitest';
import { KbRolesRightsTab } from './KbRolesRightsTab';
import { SOURCE_FLAG_DEFAULTS } from '../../utils/kbRoleRights';
import type { KbSourceFlags } from '../../types';

vi.mock('../../contexts/ThemeContext', () => ({ useTheme: () => ({ t: (k: string) => k }) }));

const defaults: KbSourceFlags = { ...SOURCE_FLAG_DEFAULTS };
const box = (role: string, col: string) => screen.getByRole('checkbox', { name: `${role}: ${col}` });
const fixed = (role: string, col: string) => screen.getByRole('img', { name: new RegExp(`^${role}: ${col} — `) });

// Oracle: the source-permission spec (API.md "Source permissions") and the
// member route gates — which cells a KB admin can change and which the role
// ladder fixes — written out by hand.
describe('KbRolesRightsTab', () => {
    it('shows owner and admin cells as fixed, granted marks (not checkboxes)', () => {
        render(<KbRolesRightsTab flags={defaults} onFlagsChange={vi.fn()} onAssignPeople={vi.fn()} />);
        for (const role of ['kbRoleOwner', 'kbRoleAdmin']) {
            for (const col of ['rrColInvite', 'rrColRights', 'rrColSeeSources', 'rrColEditSources', 'rrColSeeCitations']) {
                expect(fixed(role, col).getAttribute('aria-label')).toContain('rrGranted');
            }
        }
        expect(fixed('kbRoleAdmin', 'rrColRights').getAttribute('aria-label')).toContain('rrScopeUpToAdmin');
    });

    it('makes exactly the eight flag cells editable', () => {
        render(<KbRolesRightsTab flags={defaults} onFlagsChange={vi.fn()} onAssignPeople={vi.fn()} />);
        expect(screen.getAllByRole('checkbox').map(el => el.getAttribute('aria-label')).sort()).toEqual([
            'kbRoleEdit: rrColDownloadSources', 'kbRoleEdit: rrColSeeCitations',
            'kbRoleEdit: rrColSeeSources', 'kbRoleEdit: rrColSelectSources',
            'kbRoleView: rrColDownloadSources', 'kbRoleView: rrColSeeCitations',
            'kbRoleView: rrColSeeSources', 'kbRoleView: rrColSelectSources',
        ]);
        // Editing sources is fixed by role: editors always, viewers never.
        expect(fixed('kbRoleEdit', 'rrColEditSources').getAttribute('aria-label')).toContain('rrGranted');
        expect(fixed('kbRoleView', 'rrColEditSources').getAttribute('aria-label')).toContain('rrDenied');
        // Inviting is admin-only for now.
        expect(fixed('kbRoleEdit', 'rrColInvite').getAttribute('aria-label')).toContain('rrDenied');
    });

    it('shows the saved values and disables select and download while "see" is off', () => {
        render(<KbRolesRightsTab
            flags={{ ...defaults, viewerSelectSources: true, editorSeeSources: false }}
            onFlagsChange={vi.fn()} onAssignPeople={vi.fn()} />);
        expect(box('kbRoleEdit', 'rrColSeeCitations')).toHaveAttribute('data-state', 'checked');
        expect(box('kbRoleView', 'rrColSelectSources')).toBeDisabled();
        expect(box('kbRoleView', 'rrColSelectSources')).toHaveAttribute('data-state', 'unchecked');
        expect(box('kbRoleEdit', 'rrColDownloadSources')).toBeDisabled();
        expect(box('kbRoleView', 'rrColSeeCitations')).toBeEnabled();
    });

    it('reports a toggled flag and opens the members dialog', async () => {
        const onFlagsChange = vi.fn();
        const onAssignPeople = vi.fn();
        render(<KbRolesRightsTab flags={defaults} onFlagsChange={onFlagsChange} onAssignPeople={onAssignPeople} />);
        await userEvent.click(box('kbRoleEdit', 'rrColSeeCitations'));
        expect(onFlagsChange).toHaveBeenCalledWith({ ...defaults, editorSeeCitations: false });
        await userEvent.click(screen.getByRole('button', { name: /rrAssignPeople/ }));
        expect(onAssignPeople).toHaveBeenCalledTimes(1);
    });
});

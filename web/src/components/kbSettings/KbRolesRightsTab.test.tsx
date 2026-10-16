import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi } from 'vitest';
import { KbRolesRightsTab } from './KbRolesRightsTab';
import type { KbSourceFlags } from '../../types';

vi.mock('../../contexts/ThemeContext', () => ({ useTheme: () => ({ t: (k: string) => k }) }));

const defaults: KbSourceFlags = {
    viewerSeeSources: false, viewerSelectSources: false, viewerDownloadSources: false,
    viewerSeeCitations: false, editorManageSources: true,
};
const box = (role: string, col: string) => screen.getByRole('checkbox', { name: `${role}: ${col}` });

// Oracle: the KI-869 spec (API.md "Source permissions") — which cells a KB
// admin can change and which the role ladder fixes — written out by hand.
describe('KbRolesRightsTab', () => {
    it('locks every owner and admin cell as granted', () => {
        render(<KbRolesRightsTab flags={defaults} onFlagsChange={vi.fn()} onAssignPeople={vi.fn()} />);
        for (const role of ['kbRoleOwner', 'kbRoleAdmin']) {
            for (const col of ['rrColRead', 'rrColMembers', 'rrColRights', 'rrColSeeSources', 'rrColEdit']) {
                expect(box(role, col)).toBeDisabled();
                expect(box(role, col)).toHaveAttribute('data-state', 'checked');
            }
        }
    });

    it('makes exactly the five flag cells editable, with their saved values', () => {
        render(<KbRolesRightsTab flags={{ ...defaults, viewerSeeSources: true }} onFlagsChange={vi.fn()} onAssignPeople={vi.fn()} />);
        const editable = screen.getAllByRole('checkbox').filter(el => !(el as HTMLButtonElement).disabled);
        expect(editable.map(el => el.getAttribute('aria-label')).sort()).toEqual([
            'kbRoleEdit: rrColEdit',
            'kbRoleView: rrColDownloadSources',
            'kbRoleView: rrColSeeCitations',
            'kbRoleView: rrColSeeSources',
            'kbRoleView: rrColSelectSources',
        ]);
        expect(box('kbRoleView', 'rrColSeeSources')).toHaveAttribute('data-state', 'checked');
        expect(box('kbRoleEdit', 'rrColEdit')).toHaveAttribute('data-state', 'checked');
        // Viewers can never edit; editors never manage members.
        expect(box('kbRoleView', 'rrColEdit')).toBeDisabled();
        expect(box('kbRoleEdit', 'rrColMembers')).toHaveAttribute('data-state', 'unchecked');
    });

    it('disables select and download while "see sources" is off', () => {
        render(<KbRolesRightsTab flags={{ ...defaults, viewerSelectSources: true }} onFlagsChange={vi.fn()} onAssignPeople={vi.fn()} />);
        expect(box('kbRoleView', 'rrColSelectSources')).toBeDisabled();
        expect(box('kbRoleView', 'rrColSelectSources')).toHaveAttribute('data-state', 'unchecked');
        expect(box('kbRoleView', 'rrColDownloadSources')).toBeDisabled();
        expect(box('kbRoleView', 'rrColSeeCitations')).toBeEnabled();
    });

    it('reports a toggled flag and opens the members dialog', async () => {
        const onFlagsChange = vi.fn();
        const onAssignPeople = vi.fn();
        render(<KbRolesRightsTab flags={defaults} onFlagsChange={onFlagsChange} onAssignPeople={onAssignPeople} />);
        await userEvent.click(box('kbRoleEdit', 'rrColEdit'));
        expect(onFlagsChange).toHaveBeenCalledWith({ ...defaults, editorManageSources: false });
        await userEvent.click(screen.getByRole('button', { name: /rrAssignPeople/ }));
        expect(onAssignPeople).toHaveBeenCalledTimes(1);
    });
});

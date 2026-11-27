import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { JoinGlossaryDialog } from './JoinGlossaryDialog';
import type { GlossaryInvitePreview } from '../translator/types';

vi.mock('../../contexts/ThemeContext', () => ({ useTheme: () => ({ t: (k: string) => k }) }));

// Oracle: the contract (docs/api-contracts/translator.md "Invite links"): the dialog shows what
// joining means and only the accepted dialog joins; a link never changes a membership; a revoked
// link joins nothing.
const base: GlossaryInvitePreview = {
    status: 'invite', glossaryId: 'g-9', glossaryName: 'Hochschulbegriffe', description: 'Fachwörter',
    linkRole: 'editor', role: '',
};

function renderDialog(invite: GlossaryInvitePreview | null) {
    const props = { busy: false, onAccept: vi.fn(), onClose: vi.fn(), onOpen: vi.fn() };
    render(<JoinGlossaryDialog invite={invite} {...props} />);
    return props;
}

describe('JoinGlossaryDialog', () => {
    it('shows nothing without an invitation', () => {
        renderDialog(null);
        expect(screen.queryByRole('dialog')).toBeNull();
    });

    it('an invitation names the glossary and the role, and asks before joining', async () => {
        const props = renderDialog(base);
        expect(screen.getByRole('dialog')).toHaveAccessibleName('Hochschulbegriffe');
        expect(screen.getByText('Fachwörter')).toBeInTheDocument();
        // What the role lets the joiner do.
        expect(screen.getByText('joinGlossaryAccessTitle')).toBeInTheDocument();
        expect(screen.getByText('joinGlossaryAccessEditor')).toBeInTheDocument();

        await userEvent.click(screen.getByRole('button', { name: 'joinInviteDecline' }));
        expect(props.onClose).toHaveBeenCalled();
        expect(props.onAccept).not.toHaveBeenCalled();

        await userEvent.click(screen.getByRole('button', { name: 'joinInviteAccept' }));
        expect(props.onAccept).toHaveBeenCalledTimes(1);
    });

    it('explains each of the three roles a link can grant', () => {
        for (const [linkRole, text] of [['viewer', 'joinGlossaryAccessViewer'], ['editor', 'joinGlossaryAccessEditor'], ['admin', 'joinGlossaryAccessAdmin']] as const) {
            const { unmount } = render(<JoinGlossaryDialog invite={{ ...base, linkRole }} busy={false} onAccept={vi.fn()} onClose={vi.fn()} onOpen={vi.fn()} />);
            expect(screen.getByText(text)).toBeInTheDocument();
            unmount();
        }
    });

    it('a member is offered the translator, never a join', async () => {
        const props = renderDialog({ ...base, status: 'member', role: 'viewer' });
        expect(screen.queryByRole('button', { name: 'joinInviteAccept' })).toBeNull();
        expect(screen.getByText('joinGlossaryMemberTitle')).toBeInTheDocument();
        await userEvent.click(screen.getByRole('button', { name: 'joinGlossaryOpen' }));
        expect(props.onOpen).toHaveBeenCalled();
    });

    it('a revoked link joins nothing: a member can still open, a stranger can only close', async () => {
        const member = renderDialog({ ...base, status: 'revoked', role: 'viewer' });
        expect(screen.queryByRole('button', { name: 'joinInviteAccept' })).toBeNull();
        await userEvent.click(screen.getByRole('button', { name: 'joinGlossaryOpen' }));
        expect(member.onOpen).toHaveBeenCalled();
    });

    it('a revoked link shows a stranger the name and nothing else', () => {
        renderDialog({ status: 'revoked', glossaryName: 'Geheim', role: '' });
        expect(screen.getByRole('dialog')).toHaveAccessibleName('Geheim');
        expect(screen.getByText('joinGlossaryRevokedNoDetails')).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'joinGlossaryOpen' })).toBeNull();
        expect(screen.queryByRole('button', { name: 'joinInviteAccept' })).toBeNull();
    });

    it('disables the choice while a request is in flight', () => {
        render(<JoinGlossaryDialog invite={base} busy onAccept={vi.fn()} onClose={vi.fn()} onOpen={vi.fn()} />);
        expect(screen.getByRole('button', { name: 'joinInviteAccept' })).toBeDisabled();
        expect(screen.getByRole('button', { name: 'joinInviteDecline' })).toBeDisabled();
    });
});

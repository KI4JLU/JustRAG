import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { JoinInviteDialog } from './JoinInviteDialog';
import type { InvitePreview } from '../../hooks/useJoinInvite';

vi.mock('../../contexts/ThemeContext', () => ({ useTheme: () => ({ t: (k: string) => k }) }));

const base: InvitePreview = {
    status: 'invite', kbId: 'kb-9', kbName: 'Kurs', description: 'Worum es geht',
    linkRole: 'edit', role: '', isFavorite: false, inOverview: true,
};

function renderDialog(invite: InvitePreview) {
    const props = {
        busy: false,
        onAccept: vi.fn(), onClose: vi.fn(), onAddFavorite: vi.fn(), onOpenKb: vi.fn(),
    };
    render(<JoinInviteDialog invite={invite} {...props} />);
    return props;
}

describe('JoinInviteDialog', () => {
    it('an invitation asks before joining', async () => {
        const props = renderDialog(base);
        expect(screen.getByText('Worum es geht')).toBeInTheDocument();

        await userEvent.click(screen.getByRole('button', { name: 'joinInviteDecline' }));
        expect(props.onClose).toHaveBeenCalled();
        expect(props.onAccept).not.toHaveBeenCalled();

        await userEvent.click(screen.getByRole('button', { name: 'joinInviteAccept' }));
        expect(props.onAccept).toHaveBeenCalled();
    });

    it('a member is offered a favorite and the topic, never a join', async () => {
        const props = renderDialog({ ...base, status: 'member', role: 'view' });
        expect(screen.queryByRole('button', { name: 'joinInviteAccept' })).toBeNull();
        expect(screen.getByText(/joinInviteMemberFavoriteHint/)).toBeInTheDocument();

        await userEvent.click(screen.getByRole('button', { name: 'joinInviteAddFavorite' }));
        expect(props.onAddFavorite).toHaveBeenCalled();
        await userEvent.click(screen.getByRole('button', { name: 'joinInviteOpen' }));
        expect(props.onOpenKb).toHaveBeenCalled();
    });

    it('a starred topic missing from the overview is offered again', () => {
        renderDialog({ ...base, status: 'member', role: 'view', isFavorite: true, inOverview: false, canSubscribe: true });
        expect(screen.getByRole('button', { name: 'joinInviteAddFavorite' })).toBeInTheDocument();
    });

    it('implicit access to a topic no subscription can show offers no favorite', () => {
        renderDialog({ ...base, status: 'member', role: 'owner', inOverview: false, canSubscribe: false });
        expect(screen.queryByRole('button', { name: 'joinInviteAddFavorite' })).toBeNull();
        expect(screen.queryByText(/joinInviteMemberFavoriteHint/)).toBeNull();
    });

    it('a member who already starred the topic gets no favorite button', () => {
        renderDialog({ ...base, status: 'member', role: 'view', isFavorite: true });
        expect(screen.queryByRole('button', { name: 'joinInviteAddFavorite' })).toBeNull();
        expect(screen.getByText(/joinInviteMemberIsFavorite/)).toBeInTheDocument();
    });

    it('a revoked link without access only closes', () => {
        renderDialog({ ...base, status: 'revoked', description: undefined });
        expect(screen.getByText('joinInviteRevokedTitle')).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'joinInviteOpen' })).toBeNull();
        expect(screen.queryByRole('button', { name: 'joinInviteAccept' })).toBeNull();
    });

    it('a revoked link to a topic the user can read still opens it', () => {
        renderDialog({ ...base, status: 'revoked', role: 'view' });
        expect(screen.getByRole('button', { name: 'joinInviteOpen' })).toBeInTheDocument();
    });
});

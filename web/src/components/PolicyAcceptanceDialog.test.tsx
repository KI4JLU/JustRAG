import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import axios from 'axios';
import { PolicyAcceptanceGate } from './PolicyAcceptanceDialog';

/*
 * Oracle: the contract in API.md § Usage-policy acceptance — the notice shows
 * while GET says `required`, POST sends the version GET named, a 409
 * `policy_version_changed` means "load the current version", and nothing
 * blocks the app when the state cannot be loaded.
 */

vi.mock('axios', () => ({
    default: { get: vi.fn(), post: vi.fn(), isAxiosError: (e: unknown) => !!(e as { isAxiosError?: boolean })?.isAxiosError },
}));
vi.mock('../contexts/ThemeContext', () => ({
    useTheme: () => ({ t: (k: string) => k, language: 'de' as const }),
}));
const logout = vi.fn();
vi.mock('../contexts/AuthContext', () => ({
    useAuth: () => ({ logout }),
}));
const toast = { info: vi.fn(), error: vi.fn(), success: vi.fn(), warning: vi.fn() };
vi.mock('../contexts/ToastContext', () => ({
    useToast: () => toast,
}));
let pathname = '/';
vi.mock('@tanstack/react-router', () => ({
    useLocation: () => ({ pathname }),
}));

const required = (version: string) => ({ data: { version, required: true } });

describe('PolicyAcceptanceGate', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        pathname = '/';
    });

    it('shows nothing when no acceptance is required', async () => {
        (axios.get as Mock).mockResolvedValue({ data: { version: '', required: false } });
        render(<PolicyAcceptanceGate />);
        await waitFor(() => expect(axios.get).toHaveBeenCalled());
        expect(screen.queryByText('policyNoticeTitle')).not.toBeInTheDocument();
    });

    it('shows nothing when the state cannot be loaded', async () => {
        vi.spyOn(console, 'error').mockImplementation(() => {});
        (axios.get as Mock).mockRejectedValue(new Error('down'));
        render(<PolicyAcceptanceGate />);
        await waitFor(() => expect(console.error).toHaveBeenCalled());
        expect(screen.queryByText('policyNoticeTitle')).not.toBeInTheDocument();
    });

    it('stays off on the legal pages it links to', async () => {
        pathname = '/terms';
        (axios.get as Mock).mockResolvedValue(required('v1'));
        render(<PolicyAcceptanceGate />);
        await waitFor(() => expect(axios.get).toHaveBeenCalled());
        expect(screen.queryByText('policyNoticeTitle')).not.toBeInTheDocument();
    });

    it('accepts only after the checkbox, sending the version it showed', async () => {
        (axios.get as Mock).mockResolvedValue(required('2026-07-13'));
        (axios.post as Mock).mockResolvedValue({ data: { version: '2026-07-13', required: false, acceptedAt: '2026-11-03T10:00:00Z' } });
        render(<PolicyAcceptanceGate />);

        const accept = await screen.findByRole('button', { name: 'policyNoticeAccept' });
        expect(accept).toBeDisabled();
        await userEvent.click(screen.getByRole('checkbox'));
        expect(accept).toBeEnabled();
        await userEvent.click(accept);

        expect(axios.post).toHaveBeenCalledWith(expect.stringContaining('/api/user/policy-acceptance'), { version: '2026-07-13' });
        await waitFor(() => expect(screen.queryByText('policyNoticeTitle')).not.toBeInTheDocument());
    });

    it('reloads the notice when the version changed meanwhile', async () => {
        (axios.get as Mock)
            .mockResolvedValueOnce(required('v1'))
            .mockResolvedValueOnce(required('v2'));
        (axios.post as Mock).mockRejectedValue({
            isAxiosError: true,
            response: { status: 409, data: { code: 'policy_version_changed', error: 'changed' } },
        });
        render(<PolicyAcceptanceGate />);

        await userEvent.click(await screen.findByRole('checkbox'));
        await userEvent.click(screen.getByRole('button', { name: 'policyNoticeAccept' }));

        await waitFor(() => expect(axios.get).toHaveBeenCalledTimes(2));
        expect(toast.info).toHaveBeenCalledWith('policyNoticeUpdated');
        // A new version is a new notice: the confirmation has to be given again.
        await waitFor(() => expect(screen.getByRole('checkbox')).not.toBeChecked());
        await userEvent.click(screen.getByRole('checkbox'));
        (axios.post as Mock).mockResolvedValue({ data: { version: 'v2', required: false } });
        await userEvent.click(screen.getByRole('button', { name: 'policyNoticeAccept' }));
        expect(axios.post).toHaveBeenLastCalledWith(expect.any(String), { version: 'v2' });
    });

    it('links the legal pages in a new tab, where the gate stays off', async () => {
        (axios.get as Mock).mockResolvedValue(required('v1'));
        render(<PolicyAcceptanceGate />);
        const terms = await screen.findByRole('link', { name: /^termsOfUseTitle ?\(opensInNewTab\)$/ });
        const privacy = screen.getByRole('link', { name: /^privacyPolicyTitle ?\(opensInNewTab\)$/ });
        expect(terms).toHaveAttribute('href', '/terms');
        expect(privacy).toHaveAttribute('href', '/privacy');
        expect(terms).toHaveAttribute('target', '_blank');
    });

    it('signs out instead of accepting', async () => {
        (axios.get as Mock).mockResolvedValue(required('v1'));
        render(<PolicyAcceptanceGate />);
        await userEvent.click(await screen.findByRole('button', { name: 'logout' }));
        expect(logout).toHaveBeenCalled();
        expect(axios.post).not.toHaveBeenCalled();
    });
});

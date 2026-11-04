import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import axios from 'axios';
import { PolicyAcceptanceGate } from './PolicyAcceptanceDialog';

/*
 * Oracle: the contract in API.md § Usage-policy acceptance — the notice shows
 * while GET says `required`, POST sends the version GET named, a 409
 * `policy_version_changed` means "load the current version", and nothing
 * blocks the app when the state cannot be loaded; the gate's doc comment —
 * the app is inert until the first answer, and a tab coming back into view
 * checks again (at most every 30 s).
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

const renderGate = () => render(<PolicyAcceptanceGate><p>App</p></PolicyAcceptanceGate>);
const app = () => screen.getByText('App').parentElement as HTMLElement;

describe('PolicyAcceptanceGate', () => {
    beforeEach(() => {
        vi.restoreAllMocks();
        vi.clearAllMocks();
        pathname = '/';
    });

    it('shows nothing when no acceptance is required', async () => {
        (axios.get as Mock).mockResolvedValue({ data: { version: '', required: false } });
        renderGate();
        await waitFor(() => expect(axios.get).toHaveBeenCalled());
        expect(screen.queryByText('policyNoticeTitle')).not.toBeInTheDocument();
    });

    it('shows nothing when the state cannot be loaded', async () => {
        vi.spyOn(console, 'error').mockImplementation(() => {});
        (axios.get as Mock).mockRejectedValue(new Error('down'));
        renderGate();
        await waitFor(() => expect(console.error).toHaveBeenCalled());
        expect(screen.queryByText('policyNoticeTitle')).not.toBeInTheDocument();
    });

    it('stays off on the legal pages it links to', async () => {
        pathname = '/terms';
        (axios.get as Mock).mockResolvedValue(required('v1'));
        renderGate();
        await waitFor(() => expect(axios.get).toHaveBeenCalled());
        expect(screen.queryByText('policyNoticeTitle')).not.toBeInTheDocument();
    });

    it('accepts only after the checkbox, sending the version it showed', async () => {
        (axios.get as Mock).mockResolvedValue(required('2026-07-13'));
        (axios.post as Mock).mockResolvedValue({ data: { version: '2026-07-13', required: false, acceptedAt: '2026-11-03T10:00:00Z' } });
        renderGate();

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
        renderGate();

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
        renderGate();
        const terms = await screen.findByRole('link', { name: /^termsOfUseTitle ?\(opensInNewTab\)$/ });
        const privacy = screen.getByRole('link', { name: /^privacyPolicyTitle ?\(opensInNewTab\)$/ });
        expect(terms).toHaveAttribute('href', '/terms');
        expect(privacy).toHaveAttribute('href', '/privacy');
        expect(terms).toHaveAttribute('target', '_blank');
    });

    it('signs out instead of accepting', async () => {
        (axios.get as Mock).mockResolvedValue(required('v1'));
        renderGate();
        await userEvent.click(await screen.findByRole('button', { name: 'logout' }));
        expect(logout).toHaveBeenCalled();
        expect(axios.post).not.toHaveBeenCalled();
    });

    it('keeps the app inert until the state has answered', async () => {
        let answer: (v: unknown) => void = () => {};
        (axios.get as Mock).mockReturnValue(new Promise(r => { answer = r; }));
        renderGate();
        expect(app()).toHaveAttribute('inert');
        answer({ data: { version: '', required: false } });
        await waitFor(() => expect(app()).not.toHaveAttribute('inert'));
    });

    it('leaves the app usable when the state cannot be loaded', async () => {
        vi.spyOn(console, 'error').mockImplementation(() => {});
        (axios.get as Mock).mockRejectedValue(new Error('down'));
        renderGate();
        await waitFor(() => expect(app()).not.toHaveAttribute('inert'));
    });

    it('bounds the state request, so a hanging one fails open too', async () => {
        (axios.get as Mock).mockResolvedValue({ data: { version: '', required: false } });
        renderGate();
        await waitFor(() => expect(axios.get).toHaveBeenCalled());
        const [, config] = (axios.get as Mock).mock.calls[0];
        expect(config?.timeout).toBeGreaterThan(0);
    });

    it('checks again when the tab comes back, at most every 30 seconds', async () => {
        let now = 1_000_000;
        vi.spyOn(Date, 'now').mockImplementation(() => now);
        (axios.get as Mock)
            .mockResolvedValueOnce({ data: { version: '', required: false } })
            .mockResolvedValueOnce(required('v2'));
        renderGate();
        await waitFor(() => expect(axios.get).toHaveBeenCalledTimes(1));

        now += 10_000;
        window.dispatchEvent(new Event('focus'));
        expect(axios.get).toHaveBeenCalledTimes(1);

        now += 30_000;
        document.dispatchEvent(new Event('visibilitychange'));
        await waitFor(() => expect(axios.get).toHaveBeenCalledTimes(2));
        expect(await screen.findByText('policyNoticeTitle')).toBeInTheDocument();
    });

    it('drops a re-check answer that was sent before the user accepted', async () => {
        let now = 1_000_000;
        vi.spyOn(Date, 'now').mockImplementation(() => now);
        let staleAnswer: (v: unknown) => void = () => {};
        (axios.get as Mock)
            .mockResolvedValueOnce(required('v1'))
            .mockReturnValueOnce(new Promise(r => { staleAnswer = r; }));
        (axios.post as Mock).mockResolvedValue({ data: { version: 'v1', required: false } });
        renderGate();
        await userEvent.click(await screen.findByRole('checkbox'));

        now += 30_000;
        window.dispatchEvent(new Event('focus'));
        expect(axios.get).toHaveBeenCalledTimes(2);
        await userEvent.click(screen.getByRole('button', { name: 'policyNoticeAccept' }));
        await waitFor(() => expect(screen.queryByText('policyNoticeTitle')).not.toBeInTheDocument());

        staleAnswer(required('v1'));
        await new Promise(r => setTimeout(r, 0));
        expect(screen.queryByText('policyNoticeTitle')).not.toBeInTheDocument();
    });

    it('loads again when a check ran while the acceptance was in flight', async () => {
        let now = 1_000_000;
        vi.spyOn(Date, 'now').mockImplementation(() => now);
        let confirm: (v: unknown) => void = () => {};
        (axios.get as Mock)
            .mockResolvedValueOnce(required('v1'))
            .mockResolvedValueOnce(required('v2'))
            .mockResolvedValueOnce(required('v2'));
        (axios.post as Mock).mockReturnValue(new Promise(r => { confirm = r; }));
        renderGate();
        await userEvent.click(await screen.findByRole('checkbox'));
        await userEvent.click(screen.getByRole('button', { name: 'policyNoticeAccept' }));

        // An admin sets v2 and the tab comes back before v1's acceptance is confirmed.
        now += 30_000;
        window.dispatchEvent(new Event('focus'));
        await waitFor(() => expect(axios.get).toHaveBeenCalledTimes(2));
        confirm({ data: { version: 'v1', required: false } });

        await waitFor(() => expect(axios.get).toHaveBeenCalledTimes(3));
        await new Promise(r => setTimeout(r, 0));
        expect(screen.getByText('policyNoticeTitle')).toBeInTheDocument();
        await userEvent.click(screen.getByRole('checkbox'));
        (axios.post as Mock).mockResolvedValue({ data: { version: 'v2', required: false } });
        await userEvent.click(screen.getByRole('button', { name: 'policyNoticeAccept' }));
        expect(axios.post).toHaveBeenLastCalledWith(expect.any(String), { version: 'v2' });
    });

    it('stays inert until the newest request answers, not a superseded one', async () => {
        let now = 1_000_000;
        vi.spyOn(Date, 'now').mockImplementation(() => now);
        let first: (v: unknown) => void = () => {};
        let second: (v: unknown) => void = () => {};
        (axios.get as Mock)
            .mockReturnValueOnce(new Promise(r => { first = r; }))
            .mockReturnValueOnce(new Promise(r => { second = r; }));
        renderGate();
        now += 30_000;
        window.dispatchEvent(new Event('focus'));
        first({ data: { version: '', required: false } });
        await new Promise(r => setTimeout(r, 0));
        expect(app()).toHaveAttribute('inert');
        second(required('v2'));
        await waitFor(() => expect(app()).not.toHaveAttribute('inert'));
        expect(await screen.findByText('policyNoticeTitle')).toBeInTheDocument();
    });
});

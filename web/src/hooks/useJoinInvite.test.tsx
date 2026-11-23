import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import axios from 'axios';
import { useJoinInvite, type InvitePreview } from './useJoinInvite';
import { JOIN_TOKEN_KEY, JOIN_ATTEMPTS_KEY, MAX_JOIN_ATTEMPTS } from './useJoinLink';

vi.mock('axios');
const mockedAxios = axios as unknown as {
    isAxiosError: (err: unknown) => boolean;
};

const toastMock = { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() };
vi.mock('../contexts/ToastContext', () => ({ useToast: () => toastMock }));
vi.mock('../contexts/ThemeContext', () => ({ useTheme: () => ({ t: (k: string) => k }) }));

let policyCleared = true;
vi.mock('../components/shell/policyCleared', () => ({ usePolicyCleared: () => policyCleared }));

function axiosErr(status: number, data?: unknown) {
    return Object.assign(new Error(`status ${status}`), {
        isAxiosError: true,
        response: { status, data },
    });
}

class MemoryStorage implements Storage {
    private data = new Map<string, string>();
    get length() { return this.data.size; }
    clear() { this.data.clear(); }
    getItem(k: string) { return this.data.get(k) ?? null; }
    key(i: number) { return Array.from(this.data.keys())[i] ?? null; }
    removeItem(k: string) { this.data.delete(k); }
    setItem(k: string, v: string) { this.data.set(k, v); }
}

const invitePreview: InvitePreview = {
    status: 'invite', kbId: 'kb-9', kbName: 'Kurs', description: 'Worum es geht',
    linkRole: 'edit', role: '', isFavorite: false, inOverview: true,
};

function setup() {
    const openKbById = vi.fn().mockResolvedValue(undefined);
    const refreshKbs = vi.fn().mockResolvedValue(undefined);
    const hook = renderHook(() => useJoinInvite({ openKbById, refreshKbs }));
    return { ...hook, openKbById, refreshKbs };
}

beforeEach(() => {
    vi.clearAllMocks();
    policyCleared = true;
    Object.defineProperty(window, 'sessionStorage', {
        value: new MemoryStorage(), configurable: true, writable: true,
    });
    // vi.mock('axios') automocks isAxiosError into a vi.fn() returning
    // undefined; reimplement it the way real axios does.
    mockedAxios.isAxiosError = (err: unknown) => !!(err as { isAxiosError?: boolean } | null)?.isAxiosError;
});

describe('useJoinInvite', () => {
    it('resolves a parked token and joins nothing until accepted', async () => {
        window.sessionStorage.setItem(JOIN_TOKEN_KEY, 'tok');
        vi.mocked(axios.get).mockResolvedValue({ data: invitePreview });

        const { result, openKbById } = setup();

        await waitFor(() => expect(result.current.invite).toEqual(invitePreview));
        expect(axios.get).toHaveBeenCalledWith(expect.stringContaining('/api/invites/tok'));
        expect(axios.post).not.toHaveBeenCalled();
        expect(openKbById).not.toHaveBeenCalled();
        expect(window.sessionStorage.getItem(JOIN_TOKEN_KEY)).toBeNull();
    });

    it('waits for the AI-use notice before resolving', async () => {
        window.sessionStorage.setItem(JOIN_TOKEN_KEY, 'tok');
        vi.mocked(axios.get).mockResolvedValue({ data: invitePreview });
        policyCleared = false;

        const { result, rerender } = setup();
        await new Promise(r => setTimeout(r, 0));
        expect(axios.get).not.toHaveBeenCalled();

        policyCleared = true;
        rerender();
        await waitFor(() => expect(result.current.invite).not.toBeNull());
    });

    it('accept redeems, refreshes the lists and opens the KB', async () => {
        window.sessionStorage.setItem(JOIN_TOKEN_KEY, 'tok');
        vi.mocked(axios.get).mockResolvedValue({ data: invitePreview });
        vi.mocked(axios.post).mockResolvedValue({
            data: { kbId: 'kb-9', kbName: 'Kurs', role: 'edit', alreadyMember: false },
        });
        const { result, openKbById, refreshKbs } = setup();
        await waitFor(() => expect(result.current.invite).not.toBeNull());

        await act(() => result.current.accept());

        expect(axios.post).toHaveBeenCalledWith(expect.stringContaining('/api/invites/tok/redeem'));
        expect(toastMock.success).toHaveBeenCalledWith('joinLinkJoined');
        expect(refreshKbs).toHaveBeenCalled();
        expect(openKbById).toHaveBeenCalledWith('kb-9');
        expect(result.current.invite).toBeNull();
    });

    it('close (decline) joins nothing', async () => {
        window.sessionStorage.setItem(JOIN_TOKEN_KEY, 'tok');
        vi.mocked(axios.get).mockResolvedValue({ data: invitePreview });
        const { result, openKbById } = setup();
        await waitFor(() => expect(result.current.invite).not.toBeNull());

        act(() => result.current.close());

        expect(result.current.invite).toBeNull();
        expect(axios.post).not.toHaveBeenCalled();
        expect(openKbById).not.toHaveBeenCalled();
    });

    it('a link revoked while the dialog was open turns the dialog into the revoked notice', async () => {
        window.sessionStorage.setItem(JOIN_TOKEN_KEY, 'tok');
        vi.mocked(axios.get).mockResolvedValue({ data: invitePreview });
        vi.mocked(axios.post).mockRejectedValue(axiosErr(410, { error: 'invite link was revoked', code: 'invite_revoked' }));
        const { result, openKbById } = setup();
        await waitFor(() => expect(result.current.invite).not.toBeNull());

        await act(() => result.current.accept());

        expect(result.current.invite?.status).toBe('revoked');
        expect(openKbById).not.toHaveBeenCalled();
        expect(toastMock.error).not.toHaveBeenCalled();
    });

    it('addFavorite stars the KB, and subscribes one missing from the overview first', async () => {
        window.sessionStorage.setItem(JOIN_TOKEN_KEY, 'tok');
        vi.mocked(axios.get).mockResolvedValue({
            data: { ...invitePreview, status: 'member', role: 'view', inOverview: false, canSubscribe: true },
        });
        vi.mocked(axios.put).mockResolvedValue({ data: null });
        const { result, refreshKbs } = setup();
        await waitFor(() => expect(result.current.invite).not.toBeNull());

        await act(() => result.current.addFavorite());

        const urls = vi.mocked(axios.put).mock.calls.map(c => c[0]);
        expect(urls).toEqual([
            expect.stringContaining('/api/kb/kb-9/subscription'),
            expect.stringContaining('/api/kb/kb-9/favorite'),
        ]);
        expect(result.current.invite?.isFavorite).toBe(true);
        expect(refreshKbs).toHaveBeenCalled();
    });

    it('re-adds a starred topic to the overview without starring it again', async () => {
        window.sessionStorage.setItem(JOIN_TOKEN_KEY, 'tok');
        vi.mocked(axios.get).mockResolvedValue({
            data: { ...invitePreview, status: 'member', role: 'view', isFavorite: true, inOverview: false, canSubscribe: true },
        });
        vi.mocked(axios.put).mockResolvedValue({ data: null });
        const { result } = setup();
        await waitFor(() => expect(result.current.invite).not.toBeNull());

        await act(() => result.current.addFavorite());

        expect(vi.mocked(axios.put).mock.calls.map(c => c[0])).toEqual([
            expect.stringContaining('/api/kb/kb-9/subscription'),
        ]);
    });

    it('hides the dialog while a new AI-use notice is open', async () => {
        window.sessionStorage.setItem(JOIN_TOKEN_KEY, 'tok');
        vi.mocked(axios.get).mockResolvedValue({ data: invitePreview });
        const { result, rerender } = setup();
        await waitFor(() => expect(result.current.invite).not.toBeNull());

        policyCleared = false;
        rerender();
        expect(result.current.invite).toBeNull();
        policyCleared = true;
        rerender();
        expect(result.current.invite).not.toBeNull();
    });

    it('openKb closes the dialog and opens the KB without redeeming', async () => {
        window.sessionStorage.setItem(JOIN_TOKEN_KEY, 'tok');
        vi.mocked(axios.get).mockResolvedValue({ data: { ...invitePreview, status: 'member', role: 'view' } });
        const { result, openKbById } = setup();
        await waitFor(() => expect(result.current.invite).not.toBeNull());

        await act(() => result.current.openKb());

        expect(openKbById).toHaveBeenCalledWith('kb-9');
        expect(axios.post).not.toHaveBeenCalled();
        expect(result.current.invite).toBeNull();
    });

    it('does nothing when no token is parked', async () => {
        setup();
        await new Promise(r => setTimeout(r, 0));
        expect(axios.get).not.toHaveBeenCalled();
    });

    it('on a 404, leaves the token cleared and shows the invalid-link message', async () => {
        window.sessionStorage.setItem(JOIN_TOKEN_KEY, 'bad');
        vi.mocked(axios.get).mockRejectedValue(axiosErr(404));
        const { result } = setup();

        await waitFor(() => expect(toastMock.error).toHaveBeenCalledWith('joinLinkInvalid'));
        expect(window.sessionStorage.getItem(JOIN_TOKEN_KEY)).toBeNull();
        expect(result.current.invite).toBeNull();
    });

    it('on a 500, re-parks the token and shows the retryable message', async () => {
        window.sessionStorage.setItem(JOIN_TOKEN_KEY, 'tok');
        vi.mocked(axios.get).mockRejectedValue(axiosErr(500));
        setup();

        await waitFor(() => expect(toastMock.error).toHaveBeenCalledWith('joinLinkRetry'));
        expect(window.sessionStorage.getItem(JOIN_TOKEN_KEY)).toBe('tok');
    });

    it('resolves at most once even if the component re-renders', async () => {
        window.sessionStorage.setItem(JOIN_TOKEN_KEY, 'tok');
        vi.mocked(axios.get).mockResolvedValue({ data: invitePreview });
        const { result, rerender } = setup();
        rerender();
        rerender();

        await waitFor(() => expect(result.current.invite).not.toBeNull());
        expect(axios.get).toHaveBeenCalledTimes(1);
    });

    // Without a budget a durable non-404 error would re-fire a request and a
    // toast on every page load for the rest of the session. Each mount is one
    // page load; after MAX_JOIN_ATTEMPTS the token must be dropped.
    it('stops re-parking once the attempt budget is spent', async () => {
        window.sessionStorage.setItem(JOIN_TOKEN_KEY, 'tok');
        vi.mocked(axios.get).mockRejectedValue(axiosErr(500));

        for (let attempt = 1; attempt < MAX_JOIN_ATTEMPTS; attempt++) {
            setup();
            await waitFor(() => expect(toastMock.error).toHaveBeenCalledWith('joinLinkRetry'));
            expect(window.sessionStorage.getItem(JOIN_TOKEN_KEY)).toBe('tok');
            vi.clearAllMocks();
        }

        setup();
        await waitFor(() => expect(toastMock.error).toHaveBeenCalledWith('joinLinkFailed'));
        expect(window.sessionStorage.getItem(JOIN_TOKEN_KEY)).toBeNull();
    });

    it('clears the attempt budget after a successful lookup', async () => {
        window.sessionStorage.setItem(JOIN_TOKEN_KEY, 'tok');
        window.sessionStorage.setItem(JOIN_ATTEMPTS_KEY, String(MAX_JOIN_ATTEMPTS - 1));
        vi.mocked(axios.get).mockResolvedValue({ data: invitePreview });
        const { result } = setup();

        await waitFor(() => expect(result.current.invite).not.toBeNull());
        expect(window.sessionStorage.getItem(JOIN_ATTEMPTS_KEY)).toBeNull();
    });

    // An AxiosError carries config.url, which contains the token.
    it('does not print the token when logging a failure', async () => {
        const consoleErr = vi.spyOn(console, 'error').mockImplementation(() => {});
        const token = 'AbCdEf0123456789AbCdEf0123456789AbCdEf012';
        window.sessionStorage.setItem(JOIN_TOKEN_KEY, token);
        vi.mocked(axios.get).mockRejectedValue(Object.assign(axiosErr(500), {
            config: { url: `/api/invites/${token}` },
        }));
        setup();

        await waitFor(() => expect(consoleErr).toHaveBeenCalled());
        for (const call of consoleErr.mock.calls) {
            expect(JSON.stringify(call)).not.toContain(token);
        }
        consoleErr.mockRestore();
    });
});

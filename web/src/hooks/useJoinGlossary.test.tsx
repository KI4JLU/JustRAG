import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import axios from 'axios';
import { useJoinGlossary } from './useJoinGlossary';
import type { GlossaryInvitePreview } from '../components/translator/types';
import {
    captureJoinToken, GLOSSARY_JOIN_TOKEN_KEY, JOIN_ATTEMPTS_KEY, JOIN_TOKEN_KEY, peekJoinToken,
} from './useJoinLink';

/*
 * The glossary invite link. ORACLE: docs/api-contracts/translator.md "Invite links" and API.md —
 * the link calls GET /api/glossary-invites/{token}, shows what joining means, and only an accepted
 * dialog calls POST …/redeem; a 410 invite_revoked means the link was revoked; a link never changes
 * an existing membership. The path /join-glossary/<token> is parked across the sign-in like the
 * knowledge base's /join/<token>.
 */

vi.mock('axios');
const mockedAxios = axios as unknown as { isAxiosError: (err: unknown) => boolean };

const toastMock = { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() };
vi.mock('../contexts/ToastContext', () => ({ useToast: () => toastMock }));
const themeMock = { t: (k: string) => k };
vi.mock('../contexts/ThemeContext', () => ({ useTheme: () => themeMock }));

let policyCleared = true;
vi.mock('../components/shell/policyCleared', () => ({ usePolicyCleared: () => policyCleared }));

function axiosErr(status: number, data?: unknown) {
    return Object.assign(new Error(`status ${status}`), { isAxiosError: true, response: { status, data } });
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

const TOKEN = 'AbCdEf0123456789AbCdEf0123456789AbCdEf012';
const invite: GlossaryInvitePreview = {
    status: 'invite', glossaryId: 'g-9', glossaryName: 'Hochschulbegriffe', description: 'Fachwörter',
    linkRole: 'editor', role: '',
};

function setup(routeToken: string | null = null) {
    const openTranslator = vi.fn();
    const hook = renderHook((props: { routeToken: string | null }) => useJoinGlossary({ openTranslator, routeToken: props.routeToken }), {
        initialProps: { routeToken },
    });
    return { ...hook, openTranslator };
}

beforeEach(() => {
    vi.clearAllMocks();
    policyCleared = true;
    Object.defineProperty(window, 'sessionStorage', { value: new MemoryStorage(), configurable: true, writable: true });
    window.history.replaceState(null, '', '/');
    // vi.mock('axios') automocks isAxiosError; reimplement it the way real axios does.
    mockedAxios.isAxiosError = (err: unknown) => !!(err as { isAxiosError?: boolean } | null)?.isAxiosError;
});

describe('glossary join link capture', () => {
    it('parks the token of /join-glossary/<token> apart from a topic’s and cleans the URL', () => {
        window.history.replaceState(null, '', `/join-glossary/${TOKEN}`);
        captureJoinToken();
        expect(peekJoinToken('glossary')).toBe(TOKEN);
        expect(peekJoinToken('kb')).toBeNull();
        expect(window.location.pathname).toBe('/');
    });

    it('keeps the two kinds of link apart', () => {
        window.history.replaceState(null, '', `/join/${TOKEN}`);
        captureJoinToken();
        expect(peekJoinToken('kb')).toBe(TOKEN);
        expect(peekJoinToken('glossary')).toBeNull();
        expect(window.sessionStorage.getItem(GLOSSARY_JOIN_TOKEN_KEY)).toBeNull();
    });

    it('ignores a glossary path whose token is not one', () => {
        window.history.replaceState(null, '', '/join-glossary/short');
        captureJoinToken();
        expect(peekJoinToken('glossary')).toBeNull();
        expect(window.location.pathname).toBe('/join-glossary/short');
    });
});

describe('useJoinGlossary', () => {
    it('resolves a parked token and joins nothing until accepted', async () => {
        window.sessionStorage.setItem(GLOSSARY_JOIN_TOKEN_KEY, 'tok');
        vi.mocked(axios.get).mockResolvedValue({ data: invite });
        const { result, openTranslator } = setup();

        await waitFor(() => expect(result.current.invite).toEqual(invite));
        expect(axios.get).toHaveBeenCalledWith(expect.stringContaining('/api/glossary-invites/tok'));
        expect(axios.post).not.toHaveBeenCalled();
        expect(openTranslator).not.toHaveBeenCalled();
        expect(window.sessionStorage.getItem(GLOSSARY_JOIN_TOKEN_KEY)).toBeNull();
        // A topic's parked token is not this hook's.
        expect(window.sessionStorage.getItem(JOIN_TOKEN_KEY)).toBeNull();
    });

    it('does nothing without a parked token, and does not touch a topic link’s', async () => {
        window.sessionStorage.setItem(JOIN_TOKEN_KEY, 'kb-token');
        setup();
        await new Promise(r => setTimeout(r, 0));
        expect(axios.get).not.toHaveBeenCalled();
        expect(window.sessionStorage.getItem(JOIN_TOKEN_KEY)).toBe('kb-token');
    });

    it('waits for the AI-use notice before resolving', async () => {
        window.sessionStorage.setItem(GLOSSARY_JOIN_TOKEN_KEY, 'tok');
        vi.mocked(axios.get).mockResolvedValue({ data: invite });
        policyCleared = false;
        const { result, rerender } = setup();
        await new Promise(r => setTimeout(r, 0));
        expect(axios.get).not.toHaveBeenCalled();

        policyCleared = true;
        rerender({ routeToken: null });
        await waitFor(() => expect(result.current.invite).not.toBeNull());
    });

    it('takes a token that came with the URL inside the running app', async () => {
        vi.mocked(axios.get).mockResolvedValue({ data: invite });
        const { result } = setup(TOKEN);
        await waitFor(() => expect(result.current.invite).toEqual(invite));
        expect(axios.get).toHaveBeenCalledWith(expect.stringContaining(`/api/glossary-invites/${TOKEN}`));
        expect(axios.get).toHaveBeenCalledTimes(1);
    });

    it('parks a token from the URL while the AI-use notice is open, and resolves it once that is answered', async () => {
        vi.mocked(axios.get).mockResolvedValue({ data: invite });
        policyCleared = false;
        const { result, rerender } = setup(TOKEN);
        await new Promise(r => setTimeout(r, 0));
        expect(axios.get).not.toHaveBeenCalled();
        expect(window.sessionStorage.getItem(GLOSSARY_JOIN_TOKEN_KEY)).toBe(TOKEN);

        // The router replaced the URL meanwhile: the token is only the parked one now.
        policyCleared = true;
        rerender({ routeToken: null });
        await waitFor(() => expect(result.current.invite).toEqual(invite));
        expect(axios.get).toHaveBeenCalledWith(expect.stringContaining(`/api/glossary-invites/${TOKEN}`));
    });

    it('accept redeems, says so and opens the translator', async () => {
        window.sessionStorage.setItem(GLOSSARY_JOIN_TOKEN_KEY, 'tok');
        vi.mocked(axios.get).mockResolvedValue({ data: invite });
        vi.mocked(axios.post).mockResolvedValue({
            data: { linkId: 'l1', glossaryId: 'g-9', glossaryName: 'Hochschulbegriffe', role: 'editor', alreadyMember: false },
        });
        const { result, openTranslator } = setup();
        await waitFor(() => expect(result.current.invite).not.toBeNull());

        await act(() => result.current.accept());

        expect(axios.post).toHaveBeenCalledWith(expect.stringContaining('/api/glossary-invites/tok/redeem'));
        expect(toastMock.success).toHaveBeenCalledWith('joinGlossaryJoined');
        expect(openTranslator).toHaveBeenCalled();
        expect(result.current.invite).toBeNull();
    });

    it('close declines: nothing is posted', async () => {
        window.sessionStorage.setItem(GLOSSARY_JOIN_TOKEN_KEY, 'tok');
        vi.mocked(axios.get).mockResolvedValue({ data: invite });
        const { result } = setup();
        await waitFor(() => expect(result.current.invite).not.toBeNull());
        act(() => result.current.close());
        expect(result.current.invite).toBeNull();
        expect(axios.post).not.toHaveBeenCalled();
    });

    it('looks the same link up again when it is opened a second time in the same page load', async () => {
        vi.mocked(axios.get).mockResolvedValue({ data: invite });
        const { result, rerender } = setup(TOKEN);
        await waitFor(() => expect(result.current.invite).toEqual(invite));

        // Declined; the user goes elsewhere and follows the link again.
        act(() => result.current.close());
        expect(result.current.invite).toBeNull();
        rerender({ routeToken: null });
        rerender({ routeToken: TOKEN });

        await waitFor(() => expect(result.current.invite).toEqual(invite));
        expect(axios.get).toHaveBeenCalledTimes(2);
    });

    it('looks the link up again after it was accepted, too', async () => {
        vi.mocked(axios.get).mockResolvedValue({ data: invite });
        vi.mocked(axios.post).mockResolvedValue({
            data: { linkId: 'l1', glossaryId: 'g-9', glossaryName: 'Hochschulbegriffe', role: 'editor', alreadyMember: false },
        });
        const { result, rerender } = setup(TOKEN);
        await waitFor(() => expect(result.current.invite).not.toBeNull());
        await act(() => result.current.accept());
        expect(result.current.invite).toBeNull();

        rerender({ routeToken: null });
        rerender({ routeToken: TOKEN });
        await waitFor(() => expect(result.current.invite).not.toBeNull());
        expect(axios.get).toHaveBeenCalledTimes(2);
    });

    it('does not open a declined link again just because the language changed while its URL stays', async () => {
        vi.mocked(axios.get).mockResolvedValue({ data: invite });
        const { result, rerender } = setup(TOKEN);
        await waitFor(() => expect(result.current.invite).not.toBeNull());
        act(() => result.current.close());

        themeMock.t = (k: string) => k;
        rerender({ routeToken: TOKEN });
        await new Promise(r => setTimeout(r, 0));

        expect(axios.get).toHaveBeenCalledTimes(1);
        expect(result.current.invite).toBeNull();
    });

    it('a link revoked while the dialog was open turns it into the revoked state', async () => {
        window.sessionStorage.setItem(GLOSSARY_JOIN_TOKEN_KEY, 'tok');
        vi.mocked(axios.get).mockResolvedValue({ data: invite });
        vi.mocked(axios.post).mockRejectedValue(axiosErr(410, { code: 'invite_revoked', error: 'revoked' }));
        const { result, openTranslator } = setup();
        await waitFor(() => expect(result.current.invite).not.toBeNull());

        await act(() => result.current.accept());

        expect(result.current.invite?.status).toBe('revoked');
        expect(toastMock.error).not.toHaveBeenCalled();
        expect(openTranslator).not.toHaveBeenCalled();
    });

    it('a member who accepts anyway joins nothing twice and gets no joined toast', async () => {
        window.sessionStorage.setItem(GLOSSARY_JOIN_TOKEN_KEY, 'tok');
        vi.mocked(axios.get).mockResolvedValue({ data: { ...invite, status: 'member', role: 'viewer' } });
        vi.mocked(axios.post).mockResolvedValue({
            data: { linkId: 'l1', glossaryId: 'g-9', glossaryName: 'Hochschulbegriffe', role: 'viewer', alreadyMember: true },
        });
        const { result } = setup();
        await waitFor(() => expect(result.current.invite?.status).toBe('member'));
        await act(() => result.current.accept());
        expect(toastMock.success).not.toHaveBeenCalled();
    });

    it('404 means an invalid link and stays cleared', async () => {
        window.sessionStorage.setItem(GLOSSARY_JOIN_TOKEN_KEY, 'bad');
        vi.mocked(axios.get).mockRejectedValue(axiosErr(404));
        setup();
        await waitFor(() => expect(toastMock.error).toHaveBeenCalledWith('joinGlossaryInvalid'));
        expect(window.sessionStorage.getItem(GLOSSARY_JOIN_TOKEN_KEY)).toBeNull();
    });

    it('403 (the translation is off for this user) is no verdict on the link and no retry', async () => {
        window.sessionStorage.setItem(GLOSSARY_JOIN_TOKEN_KEY, 'tok');
        vi.mocked(axios.get).mockRejectedValue(axiosErr(403));
        setup();
        await waitFor(() => expect(toastMock.error).toHaveBeenCalledWith('joinGlossaryUnavailable'));
        expect(window.sessionStorage.getItem(GLOSSARY_JOIN_TOKEN_KEY)).toBeNull();
    });

    it('a blip re-parks the token for a retry, and the second failure drops it', async () => {
        window.sessionStorage.setItem(GLOSSARY_JOIN_TOKEN_KEY, 'tok');
        vi.mocked(axios.get).mockRejectedValue(axiosErr(503));
        setup();
        await waitFor(() => expect(toastMock.error).toHaveBeenCalledWith('joinLinkRetry'));
        expect(window.sessionStorage.getItem(GLOSSARY_JOIN_TOKEN_KEY)).toBe('tok');

        // The next page load takes the parked token again; the budget of two attempts is spent.
        toastMock.error.mockClear();
        setup();
        await waitFor(() => expect(toastMock.error).toHaveBeenCalledWith('joinLinkFailed'));
        expect(window.sessionStorage.getItem(GLOSSARY_JOIN_TOKEN_KEY)).toBeNull();
        // The topic link's counter was never touched.
        expect(window.sessionStorage.getItem(JOIN_ATTEMPTS_KEY)).toBeNull();
    });
});

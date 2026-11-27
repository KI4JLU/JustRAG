import { useCallback, useEffect, useRef, useState } from 'react';
import axios from 'axios';
import { API_BASE_URL } from '../api';
import type { GlossaryInvitePreview, GlossaryRedeemResponse } from '../components/translator/types';
import { useToast } from '../contexts/ToastContext';
import { useTheme } from '../contexts/ThemeContext';
import { usePolicyCleared } from '../components/shell/policyCleared';
import { userErrorMessage, errorInfo } from '../utils/userErrors';
import { takeJoinToken, parkJoinToken, recordJoinAttempt, clearJoinAttempts } from './useJoinLink';

interface UseJoinGlossaryParams {
    /** Opens the translator page, where the glossary shows up under „Glossare". */
    openTranslator: () => void;
    /**
     * A token that came with the URL itself (a /join-glossary/<token> path reached inside the
     * running app) instead of a parked one.
     */
    routeToken?: string | null;
}

export interface JoinGlossary {
    /** What the open link means for the caller; null while there is nothing to show. */
    invite: GlossaryInvitePreview | null;
    /** A request from one of the actions is in flight. */
    busy: boolean;
    accept: () => Promise<void>;
    close: () => void;
    /** For a member or a link that was revoked: goes to the translator. */
    open: () => void;
}

/**
 * The glossary invite link the user arrived with (/join-glossary/<token>, parked across the
 * sign-in), resolved once they are signed in and have answered the AI-use notice. Nothing is
 * joined on arrival: `invite` holds what the link means for the caller, the join dialog shows
 * it, and only `accept` calls POST …/redeem. Same rules as the knowledge-base link
 * (hooks/useJoinInvite.ts): a link never changes an existing membership; 404 means the token does
 * not exist, anything else that is not a verdict on the link (429, 5xx, a dropped connection) is
 * retried on the next page load within MAX_JOIN_ATTEMPTS.
 */
export function useJoinGlossary({ openTranslator, routeToken = null }: UseJoinGlossaryParams): JoinGlossary {
    const toast = useToast();
    const { t } = useTheme();
    const cleared = usePolicyCleared();
    const [token, setToken] = useState<string | null>(null);
    const [invite, setInvite] = useState<GlossaryInvitePreview | null>(null);
    const [busy, setBusy] = useState(false);
    // React 19 StrictMode runs effects twice in development; the ref makes the lookup happen
    // once per token regardless. It is let go when the dialog is answered (`close`, `accept`), so
    // the same link opened again later in this page load is looked up again.
    const resolved = useRef<string | null>(null);
    // The token of the URL that was looked up: the link in the address bar is not looked up again
    // (a changed dependency re-runs the effect) until the address has been something else.
    const fromUrl = useRef<string | null>(null);
    // The lookup's messages use the current ones without the effect depending on them: a change of
    // language must not look a link up again after it was answered.
    const messages = useRef({ toast, t });
    useEffect(() => { messages.current = { toast, t }; });

    useEffect(() => {
        const { toast, t } = messages.current;
        if (routeToken === null) fromUrl.current = null;
        if (!cleared) {
            // The URL is replaced right after this render: a token that came with it is parked,
            // so it survives until the AI-use notice is answered.
            if (routeToken) parkJoinToken(routeToken, 'glossary');
            return;
        }
        // Taken BEFORE the request on purpose: a 404 must not leave the token parked to be
        // retried on every later mount.
        const parked =
            routeToken !== null
                ? (fromUrl.current === routeToken ? null : routeToken)
                : (resolved.current === null ? takeJoinToken('glossary') : null);
        if (!parked || resolved.current === parked) return;
        resolved.current = parked;
        if (routeToken !== null) fromUrl.current = routeToken;

        void (async () => {
            try {
                const res = await axios.get<GlossaryInvitePreview>(
                    `${API_BASE_URL}/api/glossary-invites/${encodeURIComponent(parked)}`);
                clearJoinAttempts('glossary');
                setToken(parked);
                setInvite(res.data);
            } catch (err: unknown) {
                // Logged without the error object: an AxiosError carries config.url, which
                // contains the token — printing it would put a live credential in the console.
                const status = axios.isAxiosError(err) ? err.response?.status ?? 0 : 0;
                console.error('Glossary invite-link lookup failed with status', status);

                if (status === 404) {
                    clearJoinAttempts('glossary');
                    toast.error(t('joinGlossaryInvalid'));
                } else if (status === 403) {
                    // The translation is off, or the role may not use it: no verdict on the link either.
                    clearJoinAttempts('glossary');
                    toast.error(t('joinGlossaryUnavailable'));
                } else if (recordJoinAttempt('glossary')) {
                    parkJoinToken(parked, 'glossary');
                    toast.error(t('joinLinkRetry'));
                } else {
                    toast.error(t('joinLinkFailed'));
                }
            }
        })();
    }, [cleared, routeToken]);

    const close = useCallback(() => {
        resolved.current = null;
        setInvite(null);
        setToken(null);
    }, []);

    const open = useCallback(() => {
        close();
        openTranslator();
    }, [close, openTranslator]);

    const accept = useCallback(async () => {
        if (!invite || !token) return;
        setBusy(true);
        let result: GlossaryRedeemResponse;
        try {
            const res = await axios.post<GlossaryRedeemResponse>(
                `${API_BASE_URL}/api/glossary-invites/${encodeURIComponent(token)}/redeem`);
            result = res.data;
        } catch (err: unknown) {
            const status = axios.isAxiosError(err) ? err.response?.status ?? 0 : 0;
            console.error('Glossary invite-link redemption failed with status', status);
            setBusy(false);
            if (errorInfo(err).code === 'invite_revoked') {
                // Revoked while the dialog was open: say so in place.
                setInvite(prev => (prev ? { ...prev, status: 'revoked' } : prev));
                return;
            }
            toast.error(userErrorMessage(err, t, { fallbackKey: 'joinLinkFailed' }));
            return;
        }
        setBusy(false);
        if (!result.alreadyMember) toast.success(t('joinGlossaryJoined').replace('{name}', result.glossaryName));
        close();
        openTranslator();
    }, [invite, token, toast, t, close, openTranslator]);

    // Shown only while the AI-use notice is clear: a re-check that finds a new version hides
    // the dialog until it is accepted.
    return { invite: cleared ? invite : null, busy, accept, close, open };
}

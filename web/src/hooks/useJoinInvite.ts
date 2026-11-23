import { useCallback, useEffect, useRef, useState } from 'react';
import axios from 'axios';
import { API_BASE_URL } from '../api';
import type { KbCategory } from '../types';
import { useToast } from '../contexts/ToastContext';
import { useTheme } from '../contexts/ThemeContext';
import { usePolicyCleared } from '../components/shell/policyCleared';
import { userErrorMessage, errorInfo } from '../utils/userErrors';
import { takeJoinToken, parkJoinToken, recordJoinAttempt, clearJoinAttempts } from './useJoinLink';

/** GET /api/invites/{token} (API.md § Members and invite links). */
export interface InvitePreview {
    /** `invite`: the caller can join. `member`: the link changes nothing for them. `revoked`: no join. */
    status: 'invite' | 'member' | 'revoked';
    kbName: string;
    /** The caller's current role on the KB, '' for none. */
    role: string;
    isFavorite: boolean;
    /** The KB shows in the caller's overview (Meine Themen). */
    inOverview: boolean;
    /** A subscription can put it there (a published public KB). */
    canSubscribe?: boolean;
    /*
     * Everything below is left out for a revoked link the caller has no
     * access to: they learn the KB's name and nothing else.
     */
    kbId?: string;
    /** The role the link grants. */
    linkRole?: string;
    description?: string | null;
    category?: KbCategory | null;
    fileCount?: number;
    lastIngestedAt?: string | null;
    /** The role the KB answers in while it offers only one. */
    roleName?: string;
}

interface RedeemResponse {
    kbId: string;
    kbName: string;
    role: string;
    alreadyMember: boolean;
}

interface UseJoinInviteParams {
    /** Opens a KB known only by id — useKnowledgeBases.handleOpenKbById. */
    openKbById: (id: string) => Promise<unknown>;
    /** Reloads the KB lists, so a joined or starred topic shows up. */
    refreshKbs: () => Promise<unknown> | void;
}

export interface JoinInvite {
    /** What the open link means for the caller; null while there is nothing to show. */
    invite: InvitePreview | null;
    /** A request from one of the actions is in flight. */
    busy: boolean;
    accept: () => Promise<void>;
    close: () => void;
    addFavorite: () => Promise<void>;
    openKb: () => Promise<void>;
}

/**
 * The invite link the user arrived with (/join/<token>, parked across the
 * sign-in), resolved once they are signed in and have answered the AI-use
 * notice. Nothing is joined on arrival: `invite` holds what the link means for
 * the caller, the join dialog shows it, and only `accept` joins.
 *
 * A link never changes an existing membership. A member gets `member` and is
 * offered to save the topic as a favorite instead; a revoked link still names
 * its topic, so links placed on websites keep working for members.
 *
 * Resolving failures are discriminated: 404 means the token does not exist,
 * so the already-cleared token stays gone. Anything else (429, 5xx, a dropped
 * connection) is not a verdict on the link: the token is re-parked for a
 * retry on the next page load, within MAX_JOIN_ATTEMPTS, so a durable error
 * does not repeat a request and a toast on every load for the whole session.
 */
export function useJoinInvite({ openKbById, refreshKbs }: UseJoinInviteParams): JoinInvite {
    const toast = useToast();
    const { t } = useTheme();
    const cleared = usePolicyCleared();
    const [token, setToken] = useState<string | null>(null);
    const [invite, setInvite] = useState<InvitePreview | null>(null);
    const [busy, setBusy] = useState(false);
    // React 19 StrictMode runs effects twice in development; the ref makes
    // the lookup happen once regardless.
    const ran = useRef(false);

    useEffect(() => {
        if (!cleared || ran.current) return;
        ran.current = true;

        // Taken BEFORE the request on purpose: a 404 must not leave the token
        // parked to be retried on every later mount.
        const parked = takeJoinToken();
        if (!parked) return;

        void (async () => {
            try {
                const res = await axios.get<InvitePreview>(
                    `${API_BASE_URL}/api/invites/${encodeURIComponent(parked)}`);
                clearJoinAttempts();
                setToken(parked);
                setInvite(res.data);
            } catch (err: unknown) {
                // Logged without the error object: an AxiosError carries
                // config.url, which contains the token — printing it would put
                // a live credential in the browser console.
                const status = axios.isAxiosError(err) ? err.response?.status ?? 0 : 0;
                console.error('Invite-link lookup failed with status', status);

                if (status === 404) {
                    clearJoinAttempts();
                    toast.error(t('joinLinkInvalid'));
                } else if (recordJoinAttempt()) {
                    parkJoinToken(parked);
                    toast.error(t('joinLinkRetry'));
                } else {
                    toast.error(t('joinLinkFailed'));
                }
            }
        })();
    }, [cleared, toast, t]);

    const close = useCallback(() => {
        setInvite(null);
        setToken(null);
    }, []);

    const openKb = useCallback(async () => {
        if (!invite?.kbId) return;
        const id = invite.kbId;
        close();
        await openKbById(id);
    }, [invite, close, openKbById]);

    const accept = useCallback(async () => {
        if (!invite || !token) return;
        setBusy(true);
        let result: RedeemResponse;
        try {
            const res = await axios.post<RedeemResponse>(
                `${API_BASE_URL}/api/invites/${encodeURIComponent(token)}/redeem`);
            result = res.data;
        } catch (err: unknown) {
            const status = axios.isAxiosError(err) ? err.response?.status ?? 0 : 0;
            console.error('Invite-link redemption failed with status', status);
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
        if (!result.alreadyMember) {
            toast.success(t('joinLinkJoined').replace('{kb}', result.kbName));
            await refreshKbs();
        }
        close();
        await openKbById(result.kbId);
    }, [invite, token, toast, t, refreshKbs, close, openKbById]);

    const addFavorite = useCallback(async () => {
        if (!invite?.kbId) return;
        setBusy(true);
        try {
            // A star alone does not put a topic in the overview: a public
            // topic the user removed, or never subscribed to, is subscribed
            // first (a private one is always there for its members).
            if (!invite.inOverview) {
                if (!invite.canSubscribe) throw new Error('not subscribable');
                await axios.put(`${API_BASE_URL}/api/kb/${invite.kbId}/subscription`);
            }
            if (!invite.isFavorite) await axios.put(`${API_BASE_URL}/api/kb/${invite.kbId}/favorite`);
        } catch {
            setBusy(false);
            toast.error(t('favoriteError'));
            return;
        }
        setBusy(false);
        setInvite(prev => (prev ? { ...prev, isFavorite: true, inOverview: true } : prev));
        toast.success(t('joinInviteFavoriteSaved').replace('{kb}', invite.kbName));
        await refreshKbs();
    }, [invite, toast, t, refreshKbs]);

    // Shown only while the AI-use notice is clear: a re-check that finds a
    // new version hides the dialog until it is accepted.
    return { invite: cleared ? invite : null, busy, accept, close, addFavorite, openKb };
}

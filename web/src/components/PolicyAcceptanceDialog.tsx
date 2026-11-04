import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import axios from 'axios';
import { useLocation } from '@tanstack/react-router';
import { NoticeDialog, NoticeDialogLink } from '@ki4jlu/design-system';
import { API_BASE_URL } from '../api';
import { useAuth } from '../contexts/AuthContext';
import { useTheme } from '../contexts/ThemeContext';
import { useToast } from '../contexts/ToastContext';
import { errorInfo, userErrorMessage } from '../utils/userErrors';

const POLICY_URL = `${API_BASE_URL}/api/user/policy-acceptance`;

/** The legal pages the notice links to; the gate stays off on them so they can be read first. */
const LEGAL_PATHS = new Set(['/terms', '/privacy', '/accessibility']);

/** GET/POST /api/user/policy-acceptance (API.md § Usage-policy acceptance). */
interface PolicyState {
    version: string;
    required: boolean;
    acceptedAt?: string;
}

/** Re-check at most this often when the tab comes back, so a long-open tab picks up a new version. */
const RECHECK_MIN_INTERVAL_MS = 30_000;

/** A state request that hangs counts as failed, so the inert app is released (fail open). */
const STATE_TIMEOUT_MS = 10_000;

/**
 * The AI-use notice every signed-in user has to accept once per
 * `policy_acceptance_version` before using the web app. It cannot be closed:
 * the only ways out are accepting or signing out.
 *
 * The gate wraps the app. Until the first state request has answered, the app
 * is rendered but `inert`, so nothing can be used before the gate knows
 * whether a notice is due. The state is checked again whenever the tab comes
 * back into view (at most every 30 seconds), so a version an admin sets while
 * the app is open reaches open tabs too.
 *
 * The gate is the web app's only. The backend stores acceptances but refuses
 * nothing to a user who has not accepted, so a failed state request leaves the
 * app usable (the next check shows the notice) rather than locking everyone
 * out while the endpoint is down.
 */
export function PolicyAcceptanceGate({ children }: { children: ReactNode }) {
    const { pathname } = useLocation();
    const [state, setState] = useState<PolicyState | null>(null);
    // Only the first request blocks; once it answered or failed, the app stays usable.
    const [settled, setSettled] = useState(false);
    const lastCheck = useRef(0);
    // Bumped by every request and by an acceptance: an answer that is no longer
    // the newest (a re-check sent before the user accepted) is dropped.
    const generation = useRef(0);

    const load = useCallback(() => {
        lastCheck.current = Date.now();
        const mine = ++generation.current;
        axios.get<PolicyState>(POLICY_URL, { timeout: STATE_TIMEOUT_MS })
            .then(res => { if (mine === generation.current) setState(res.data); })
            // A failed re-check keeps the last known state.
            .catch((err: unknown) => console.error('Failed to load policy acceptance:', err))
            // Only the newest request lifts the initial block; a superseded one would lift it early.
            .finally(() => { if (mine === generation.current) setSettled(true); });
    }, []);

    useEffect(load, [load]);

    useEffect(() => {
        const recheck = () => {
            if (document.visibilityState !== 'visible') return;
            if (Date.now() - lastCheck.current < RECHECK_MIN_INTERVAL_MS) return;
            load();
        };
        document.addEventListener('visibilitychange', recheck);
        window.addEventListener('focus', recheck);
        return () => {
            document.removeEventListener('visibilitychange', recheck);
            window.removeEventListener('focus', recheck);
        };
    }, [load]);

    // A check that started while the acceptance was in flight may have read
    // the state before it, or a newer version after it; its answer and this
    // one cannot be ordered, so the state is loaded once more instead.
    const accept = useCallback(async (version: string) => {
        const startedAt = generation.current;
        const res = await axios.post<PolicyState>(POLICY_URL, { version });
        if (startedAt !== generation.current) {
            load();
            return;
        }
        generation.current++;
        setState(res.data);
    }, [load]);

    const exempt = LEGAL_PATHS.has(pathname);
    return (
        <>
            <div className="contents" inert={!settled && !exempt} aria-busy={!settled && !exempt}>
                {children}
            </div>
            {state?.required && !exempt && (
                <PolicyAcceptanceDialog key={state.version} version={state.version} onAccept={accept} onStale={load} />
            )}
        </>
    );
}

interface PolicyAcceptanceDialogProps {
    version: string;
    /** Stores the acceptance of `version`; rejects with the request's error. */
    onAccept: (version: string) => Promise<void>;
    /** The version changed while the notice was open: load the current one. */
    onStale: () => void;
}

export function PolicyAcceptanceDialog({ version, onAccept, onStale }: PolicyAcceptanceDialogProps) {
    const { t } = useTheme();
    const { logout } = useAuth();
    const toast = useToast();
    const [saving, setSaving] = useState(false);
    // "… sind in den {terms} und der {privacy} beschrieben." — the links sit in the sentence.
    const [beforeTerms, rest = ''] = t('policyNoticeResponsibility').split('{terms}');
    const [between, afterPrivacy = ''] = rest.split('{privacy}');

    const accept = async () => {
        setSaving(true);
        try {
            await onAccept(version);
        } catch (err) {
            if (errorInfo(err).code === 'policy_version_changed') {
                toast.info(t('policyNoticeUpdated'));
                onStale();
            } else {
                toast.error(userErrorMessage(err, t));
            }
        } finally {
            setSaving(false);
        }
    };

    return (
        // `open` stays set until the notice is answered; the legal pages open
        // in a new tab, where the gate stays off.
        <NoticeDialog
            open
            title={t('policyNoticeTitle')}
            newTabLabel={t('opensInNewTab')}
            confirmLabel={t('policyNoticeConfirm')}
            acceptLabel={t('policyNoticeAccept')}
            declineLabel={t('logout')}
            onAccept={accept}
            onDecline={logout}
            pending={saving}
        >
            <p>{t('policyNoticeAiSystem')}</p>
            <p>{t('policyNoticeCheckOutput')}</p>
            <p>
                {beforeTerms}
                <NoticeDialogLink href="/terms">{t('termsOfUseTitle')}</NoticeDialogLink>
                {between}
                <NoticeDialogLink href="/privacy">{t('privacyPolicyTitle')}</NoticeDialogLink>
                {afterPrivacy}
            </p>
        </NoticeDialog>
    );
}

import { useCallback, useEffect, useState } from 'react';
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

/**
 * The AI-use notice every signed-in user has to accept once per
 * `policy_acceptance_version` before using the web app. It cannot be closed:
 * the only ways out are accepting or signing out.
 *
 * The gate is the web app's only. The backend stores acceptances but refuses
 * nothing to a user who has not accepted, so a failed state request leaves the
 * app usable (the notice comes back on the next page load) rather than locking
 * everyone out while the endpoint is down.
 */
export function PolicyAcceptanceGate() {
    const { pathname } = useLocation();
    const [state, setState] = useState<PolicyState | null>(null);

    const load = useCallback(() => {
        axios.get<PolicyState>(POLICY_URL)
            .then(res => setState(res.data))
            .catch((err: unknown) => console.error('Failed to load policy acceptance:', err));
    }, []);

    useEffect(load, [load]);

    if (!state?.required || LEGAL_PATHS.has(pathname)) return null;
    return <PolicyAcceptanceDialog key={state.version} version={state.version} onAccepted={setState} onStale={load} />;
}

interface PolicyAcceptanceDialogProps {
    version: string;
    onAccepted: (state: PolicyState) => void;
    /** The version changed while the notice was open: load the current one. */
    onStale: () => void;
}

export function PolicyAcceptanceDialog({ version, onAccepted, onStale }: PolicyAcceptanceDialogProps) {
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
            const res = await axios.post<PolicyState>(POLICY_URL, { version });
            onAccepted(res.data);
        } catch (err) {
            if (errorInfo(err).code === 'policy_version_changed') {
                toast.info(t('policyNoticeUpdated'));
                onStale();
            } else {
                toast.error(userErrorMessage(err, t));
            }
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

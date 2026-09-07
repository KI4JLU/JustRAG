import React, { useEffect, useState } from 'react';
import axios from 'axios';
import { BookOpen, Sparkles, KeyRound } from 'lucide-react';
import { motion } from 'framer-motion';
import { AuthLayout, Button, Spinner, Stack } from '@ki4jlu/design-system';
import { API_BASE_URL } from './api';

import { useTheme } from './contexts/ThemeContext';
import { useFormValidation } from './hooks/useFormValidation';
import { useReducedMotion, getMotionProps } from './hooks/useReducedMotion';
import { Footer } from './components/Footer';
import { LegalPage } from './components/LegalPage';
import { FieldRow } from './components/form/FieldRow';
import { peekJoinToken } from './hooks/useJoinLink';

interface LoginProps {
    onLogin: (token: string, user: { id: string; username: string; role: string }) => void;
    siteConfigs: Record<string, string>;
}

interface PublicAuthProvider {
    id: string;
    type: string;
    name: string;
}

interface PublicAuthConfig {
    providers: PublicAuthProvider[];
    localAuthEnabled: boolean;
}

const Login: React.FC<LoginProps> = ({ onLogin, siteConfigs }) => {
    const { language, setLanguage, t } = useTheme();
    const { errors: fieldErrors, validate, clearError } = useFormValidation({
        username: (v) => !v.trim() && t('fieldRequired'),
        password: (v) => !v.trim() && t('fieldRequired'),
    });
    const reducedMotion = useReducedMotion();
    const [username, setUsername] = useState('');
    const [password, setPassword] = useState('');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const [legalPage, setLegalPage] = useState<'terms' | 'privacy' | 'accessibility' | null>(null);
    const [providers, setProviders] = useState<PublicAuthProvider[]>([]);
    const [localAuthEnabled, setLocalAuthEnabled] = useState(false);
    const [authConfigLoaded, setAuthConfigLoaded] = useState(false);
    // Deliberately without the KB's name: naming it would need an
    // unauthenticated preview endpoint that hands KB names to anyone holding
    // a token.
    const hasPendingJoin = peekJoinToken() !== null;

    // The /admin path is the superadmin breakglass: it always shows the local
    // username/password form and never the SSO button.
    const isAdminRoute = window.location.pathname === '/admin';

    // Discover the public auth config so the page renders only the methods that
    // are actually enabled.
    useEffect(() => {
        let cancelled = false;
        axios.get<PublicAuthConfig>(`${API_BASE_URL}/api/auth/providers`)
            .then(res => {
                if (cancelled) return;
                setProviders(res.data.providers ?? []);
                setLocalAuthEnabled(!!res.data.localAuthEnabled);
                setAuthConfigLoaded(true);
            })
            .catch(() => {
                // On failure, fall back to showing the local form so a backend
                // hiccup never strands users at a button-less screen.
                if (cancelled) return;
                setLocalAuthEnabled(true);
                setAuthConfigLoaded(true);
            });
        return () => { cancelled = true; };
    }, []);

    const oidcProvider = providers.find(p => p.type === 'oidc') ?? null;
    const ldapActive = providers.some(p => p.type === 'ldap');
    const showPasswordForm = isAdminRoute || (authConfigLoaded && (localAuthEnabled || ldapActive));
    const showOidcButton = !isAdminRoute && authConfigLoaded && oidcProvider !== null;

    // OIDC callback drops the JWT + user JSON into the URL fragment so they
    // never reach server logs. Read it on mount, hand off to onLogin, and
    // strip the fragment from the URL.
    useEffect(() => {
        const hash = window.location.hash;
        if (!hash.startsWith('#oidc=')) {
            const params = new URLSearchParams(window.location.search);
            const oidcErr = params.get('oidc_error');
            if (oidcErr) {
                setError(`${t('oidcLoginFailed')} (${oidcErr})`);
                params.delete('oidc_error');
                const newSearch = params.toString();
                window.history.replaceState(null, '', window.location.pathname + (newSearch ? '?' + newSearch : ''));
            }
            return;
        }
        try {
            const encoded = hash.slice('#oidc='.length);
            const json = atob(encoded.replace(/-/g, '+').replace(/_/g, '/'));
            const payload = JSON.parse(json) as { token: string; user: { id: string; username: string; role: string } };
            window.history.replaceState(null, '', window.location.pathname);
            onLogin(payload.token, payload.user);
        } catch (decodeErr) {
            console.error('OIDC fragment decode failed:', decodeErr);
            setError(t('oidcLoginFailed'));
        }
    }, [onLogin, t]);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!validate({ username, password })) return;
        setLoading(true);
        setError('');

        try {
            const response = await axios.post(`${API_BASE_URL}/api/auth/login`, {
                username,
                password,
            });

            const { token, user } = response.data;
            if (isAdminRoute) {
                window.history.replaceState(null, '', '/');
            }
            onLogin(token, user);
        } catch (err: unknown) {
            console.error('Login failed:', err);
            const axiosErr = err as { response?: { data?: { error?: string } } };
            setError(axiosErr.response?.data?.error || t('invalidCredentials'));
        } finally {
            setLoading(false);
        }
    };

    if (legalPage) {
        return <LegalPage page={legalPage} onBack={() => setLegalPage(null)} />;
    }

    /* -----------------------------------------------------------------------
     * Shell: the design system's AuthLayout template (card KI-693, the first
     * TEMPLATE adoption in this repo — stages 3a/3b only swapped controls).
     *
     * The template's real slot API, read off the installed package
     * (@ki4jlu/design-system 0.23.1, dist/templates/auth-layout.d.ts; the
     * package ships no MDX for templates):
     *
     *   logo?       -> centered above the card, in a `flex justify-center` div
     *   title       -> REQUIRED, rendered inside <CardTitle>
     *   description?-> <CardDescription> under the title
     *   children    -> <CardContent>
     *   footer?     -> muted centered area BELOW the card
     *   className / ...HTMLAttributes -> the viewport-filling root <div>
     *
     * The root supplies `flex min-h-dvh flex-col items-center justify-center
     * bg-surface px-gutter py-margin-page` and the inner Stack `w-full
     * max-w-md`, which is where the page frame, the centring, the card, the
     * heading and the 400px column all come from — every inline style that
     * used to produce them is deleted rather than carried across.
     *
     * Three consequences of the template that are NOT free, recorded here
     * because they are visual and only the developer's both-theme QA can
     * accept them:
     *   1. `max-w-md` (448px) sits on the template's inner Stack, not on the
     *      root, so it is NOT reachable through `className`. The card width is
     *      the template's to decide.
     *   2. `min-h-dvh` replaces this file's `viewportHeight('100dvh','100vh')`
     *      feature test. A browser without `dvh` (pre-Safari 15.4) now gets no
     *      min-height at all and the card sits top-aligned instead of centred.
     *   3. The logo moves from inside the card to above it, because that is
     *      what the `logo` slot is.
     *
     * The page-entry animation keeps its opacity fade but LOSES the 20px
     * y-slide: the animated element is now the viewport-filling page root
     * rather than a 400px card, and a downward transform on it would produce
     * transient document overflow.
     * TODO: not visually confirmed — no browser in this pass.
     * --------------------------------------------------------------------- */
    return (
        <motion.main
            {...getMotionProps(reducedMotion)}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.5 }}
        >
            <AuthLayout
                logo={siteConfigs.logo_path ? (
                    <img
                        src={`${API_BASE_URL}${siteConfigs.logo_path}`}
                        alt="Site Logo"
                        fetchPriority="high"
                        loading="eager"
                        className="h-[180px] max-w-full object-contain"
                    />
                ) : (
                    <BookOpen size={100} className="text-primary" />
                )}
                /* CardTitle renders a <div>, so the page's only <h1> has to
                 * come from the call site or be lost outright. `m-0` and
                 * `text-headline-md`/`font-semibold` are not a re-skin: they
                 * neutralise index.css's `@layer base { h1 { font-size:
                 * revert; font-weight: revert; margin: revert } }`
                 * counterweight, which would otherwise render the heading at
                 * the UA's 2em/700 with UA margins. The values restate
                 * CardTitle's own, and 24px/600 is also what this page's
                 * `font: var(--type-h1)` resolved to before.
                 * TODO: raise as a design-system gap — AuthLayout's title
                 * should be a heading, or CardTitle should take `asChild`.
                 * Not yet filed. */
                title={<h1 className="m-0 text-headline-md font-semibold">{t('welcomeBack')}</h1>}
                description={t('loginSubtitle')}
                footer={
                    <>
                        {/* Moved out of the card's absolutely-positioned
                          * top-right corner: the template owns the card, and
                          * `footer` is its documented slot for muted
                          * page-level links. The round shape comes from the DS
                          * `size="icon"` (`p-2 rounded-full`), not from a
                          * hand-set 44px circle. */}
                        <Button
                            variant="outline"
                            size="icon"
                            type="button"
                            onClick={() => setLanguage(language === 'de' ? 'en' : 'de')}
                            title={language === 'de' ? "Switch to English" : "Zu Deutsch wechseln"}
                            aria-label={language === 'de' ? "Switch to English" : "Zu Deutsch wechseln"}
                        >
                            {language.toUpperCase()}
                        </Button>
                        <Footer onNavigate={setLegalPage} />
                    </>
                }
            >
                <Stack gap="md">
                    {error && (
                        /* Form-level failure. There is no Alert component in
                         * the design system, so this stays a plain <div> —
                         * but its colours now come from the semantic tokens
                         * the old inline style was bridging to
                         * (--error-bg -> bg-error-container, --error-text ->
                         * text-error/border-error), which also removes the
                         * hardcoded `#fee2e2` fallback.
                         *
                         * `id="login-error"` is gone with the two
                         * `aria-describedby` references that used to point at
                         * it: FieldRow's props type forbids `aria-describedby`
                         * and `aria-invalid` at a call site, because
                         * FormControl derives both from the row's own `error`.
                         * `role="alert"` already announces this message once;
                         * the old wiring additionally marked BOTH credential
                         * fields invalid for a failure that names neither. */
                        <div
                            role="alert"
                            className="rounded-lg border border-error bg-error-container px-4 py-3 text-center text-sm text-on-error-container"
                        >
                            {error}
                        </div>
                    )}

                    {hasPendingJoin && (
                        <p className="text-sm text-on-surface-variant">
                            {t('joinLinkLoginHint')}
                        </p>
                    )}

                    {showPasswordForm && (
                        <Stack asChild gap="md">
                            <form onSubmit={handleSubmit}>
                                {/* The leading User/Lock icons are dropped:
                                  * FieldRow omits `leadingIcon` from its props
                                  * type on purpose and the row composition is
                                  * closed (KI-691/KI-692), so an icon here
                                  * would mean extending it. */}
                                <FieldRow
                                    label={t('username')}
                                    type="text"
                                    value={username}
                                    onChange={(e) => { setUsername(e.target.value); clearError('username'); }}
                                    placeholder={t('enterUsername')}
                                    error={fieldErrors.username}
                                />
                                <FieldRow
                                    label={t('password')}
                                    type="password"
                                    value={password}
                                    onChange={(e) => { setPassword(e.target.value); clearError('password'); }}
                                    placeholder="••••••••"
                                    error={fieldErrors.password}
                                />
                                <Button type="submit" disabled={loading} className="w-full">
                                    <span className="icon-swap" key={loading ? 'loading' : 'login'}>
                                        {loading ? (
                                            <Spinner size="sm" label={t('loading')} />
                                        ) : (
                                            <>
                                                {t('login')} <Sparkles size={18} />
                                            </>
                                        )}
                                    </span>
                                </Button>
                            </form>
                        </Stack>
                    )}

                    {showOidcButton && (
                        /* `asChild` is the DS's documented way to style a link
                         * as a button — the href, and with it the OIDC flow,
                         * is untouched. */
                        <Button asChild variant="outline" className="w-full">
                            <a href={`${API_BASE_URL}/api/auth/oidc/login`}>
                                <KeyRound size={18} /> {oidcProvider.name || t('loginWithSso')}
                            </a>
                        </Button>
                    )}
                </Stack>
            </AuthLayout>
        </motion.main>
    );
};

export default Login;

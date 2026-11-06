import { useId, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Trash2, Pencil, Save } from 'lucide-react';
import { Badge, BreadcrumbBack, Button } from '@ki4jlu/design-system';
import { useTheme } from '../../contexts/ThemeContext';
import { FieldRow, SelectFieldRow } from '../form/SettingsFieldRow';
import { AdminListCard } from './AdminListCard';
import { useSearchMatches, useSearchRevealForm } from '../../hooks/useSearchReveal';

/** Labels of the form's own fields (translation keys), for the settings search. */
// The protocol names (not translated) count for their type: „OIDC" opens an OIDC form.
const COMMON_FORM_KEYS = ['providerName', 'providerType'];
const LDAP_FORM_KEYS = ['LDAP', 'ldapUrl', 'bindDn', 'bindCredentials', 'searchBaseDn'];
const OIDC_FORM_KEYS = ['OIDC', 'oidcIssuerUrl', 'oidcClientId', 'oidcClientSecret', 'oidcRedirectUri', 'oidcScopes', 'oidcSuccessRedirect', 'oidcPostLogoutRedirect'];

interface LdapConfig {
    url: string;
    bindDN: string;
    bindCredentials: string;
    searchBase: string;
    searchFilter: string;
}

interface OidcConfig {
    issuerURL: string;
    clientID: string;
    clientSecret: string;
    scopes?: string[];
    redirectURI: string;
    successRedirect?: string;
    postLogoutRedirectURI?: string;
}

type ProviderConfig = LdapConfig | OidcConfig | Record<string, unknown>;

interface AuthProvider {
    id: string;
    type: string;
    name: string;
    config: ProviderConfig;
    isActive: boolean;
}

interface AdminAuthTabProps {
    providers: AuthProvider[];
    showForm: boolean;
    editingId: string | null;
    authFormData: Partial<AuthProvider>;
    setAuthFormData: React.Dispatch<React.SetStateAction<Partial<AuthProvider>>>;
    handleAuthSubmit: (e: React.FormEvent) => void;
    startEditAuth: (provider: AuthProvider) => void;
    /** Opens the empty add form. */
    startAdd: () => void;
    /** True once the providers have come back (the search picks one of them). */
    fetched?: boolean;
    handleDelete: (id: string, type: 'config' | 'auth') => void;
    resetForm: () => void;
    authValidation: {
        errors: Record<string, string>;
        clearError: (field: string) => void;
    };
    loading: boolean;
    /** The dialog's footer, where the form's actions go while the form is open. */
    footerSlot?: HTMLElement | null;
}

type AuthValidation = AdminAuthTabProps['authValidation'];
type SetForm = AdminAuthTabProps['setAuthFormData'];
type FormData = Partial<AuthProvider>;
type T = (key: string) => string;

const PROVIDER_TYPES = [
    { value: 'ldap', label: 'LDAP' },
    { value: 'oidc', label: 'OIDC' },
];

function asLdap(c: ProviderConfig | undefined): LdapConfig {
    const o = (c as Partial<LdapConfig>) ?? {};
    return {
        url: o.url ?? '',
        bindDN: o.bindDN ?? '',
        bindCredentials: o.bindCredentials ?? '',
        searchBase: o.searchBase ?? '',
        searchFilter: o.searchFilter ?? '(uid={{username}})',
    };
}

function asOidc(c: ProviderConfig | undefined): OidcConfig {
    const o = (c as Partial<OidcConfig>) ?? {};
    return {
        issuerURL: o.issuerURL ?? '',
        clientID: o.clientID ?? '',
        clientSecret: o.clientSecret ?? '',
        scopes: o.scopes ?? [],
        redirectURI: o.redirectURI ?? '',
        successRedirect: o.successRedirect ?? '',
        postLogoutRedirectURI: o.postLogoutRedirectURI ?? '',
    };
}

function renderLdapFields(form: FormData, setForm: SetForm, v: AuthValidation, t: T) {
    const cfg = asLdap(form.config);
    return (
        <>
            <FieldRow
                label={t('ldapUrl')}
                value={cfg.url}
                placeholder="ldap://ldap.example.com"
                error={v.errors.url}
                onChange={e => { setForm({ ...form, config: { ...cfg, url: e.target.value } }); v.clearError('url'); }}
            />
            <FieldRow
                label={t('bindDn')}
                value={cfg.bindDN}
                placeholder="cn=admin,dc=example,dc=com"
                onChange={e => setForm({ ...form, config: { ...cfg, bindDN: e.target.value } })}
            />
            <FieldRow
                label={t('bindCredentials')}
                type="password"
                value={cfg.bindCredentials}
                onChange={e => setForm({ ...form, config: { ...cfg, bindCredentials: e.target.value } })}
            />
            <FieldRow
                label={t('searchBaseDn')}
                value={cfg.searchBase}
                placeholder="ou=users,dc=example,dc=com"
                error={v.errors.searchBase}
                onChange={e => { setForm({ ...form, config: { ...cfg, searchBase: e.target.value } }); v.clearError('searchBase'); }}
            />
        </>
    );
}

function renderOidcFields(form: FormData, setForm: SetForm, v: AuthValidation, t: T) {
    const cfg = asOidc(form.config);
    const scopesText = (cfg.scopes ?? []).join(', ');
    return (
        <>
            <FieldRow
                label={t('oidcIssuerUrl')}
                value={cfg.issuerURL}
                placeholder={t('oidcIssuerUrlPlaceholder')}
                error={v.errors.issuerURL}
                onChange={e => { setForm({ ...form, config: { ...cfg, issuerURL: e.target.value } }); v.clearError('issuerURL'); }}
            />
            <FieldRow
                label={t('oidcClientId')}
                value={cfg.clientID}
                error={v.errors.clientID}
                onChange={e => { setForm({ ...form, config: { ...cfg, clientID: e.target.value } }); v.clearError('clientID'); }}
            />
            <FieldRow
                label={t('oidcClientSecret')}
                type="password"
                value={cfg.clientSecret}
                placeholder="********"
                help={t('oidcClientSecretHelp')}
                onChange={e => setForm({ ...form, config: { ...cfg, clientSecret: e.target.value } })}
            />
            <FieldRow
                label={t('oidcScopes')}
                value={scopesText}
                placeholder={t('oidcScopesPlaceholder')}
                onChange={e => setForm({ ...form, config: { ...cfg, scopes: e.target.value.split(',').map(s => s.trim()).filter(Boolean) } })}
            />
            <FieldRow
                label={t('oidcRedirectUri')}
                value={cfg.redirectURI}
                placeholder={`${window.location.origin}/api/auth/oidc/callback`}
                help={t('oidcRedirectUriHelp')}
                error={v.errors.redirectURI}
                onChange={e => { setForm({ ...form, config: { ...cfg, redirectURI: e.target.value } }); v.clearError('redirectURI'); }}
            />
            <FieldRow
                label={t('oidcSuccessRedirect')}
                value={cfg.successRedirect ?? ''}
                placeholder="/"
                help={t('oidcSuccessRedirectHelp')}
                onChange={e => setForm({ ...form, config: { ...cfg, successRedirect: e.target.value } })}
            />
            <FieldRow
                label={t('oidcPostLogoutRedirect')}
                value={cfg.postLogoutRedirectURI ?? ''}
                placeholder={`${window.location.origin}/`}
                help={t('oidcPostLogoutRedirectHelp')}
                onChange={e => setForm({ ...form, config: { ...cfg, postLogoutRedirectURI: e.target.value } })}
            />
        </>
    );
}

function providerSummary(provider: AuthProvider): string {
    if (provider.type === 'oidc') {
        return (provider.config as Partial<OidcConfig>).issuerURL ?? '';
    }
    return (provider.config as Partial<LdapConfig>).url ?? '';
}

export default function AdminAuthTab({
    providers,
    showForm,
    editingId,
    authFormData,
    setAuthFormData,
    handleAuthSubmit,
    startEditAuth,
    startAdd,
    fetched = true,
    handleDelete,
    resetForm,
    authValidation,
    loading,
    footerSlot,
}: AdminAuthTabProps) {
    const { t } = useTheme();
    const formId = useId();
    // The settings search opens the form when it names one of its fields — once the providers
    // have loaded: a provider of the type that has the field (any provider for a field both
    // types share), else an empty form of that type. As the query narrows, the form follows.
    const ldap = useSearchMatches(LDAP_FORM_KEYS.map(t));
    const oidc = useSearchMatches(OIDC_FORM_KEYS.map(t));
    const common = useSearchMatches(COMMON_FORM_KEYS.map(t));
    const target = !fetched ? null : ldap && oidc ? 'any' : ldap ? 'ldap' : oidc ? 'oidc' : common ? 'any' : null;
    useSearchRevealForm(target, showForm, authFormData, (type) => {
        const provider = providers.find(p => type === 'any' || p.type === type);
        if (provider) startEditAuth(provider);
        else {
            startAdd();
            if (type !== 'any') setAuthFormData(f => ({ ...f, type }));
        }
    }, resetForm);
    const renderActions = (actions: ReactNode) => footerSlot
        ? createPortal(actions, footerSlot)
        : <div className="flex flex-col-reverse gap-2 border-t border-outline-variant pt-4 sm:flex-row sm:justify-end">{actions}</div>;

    // The add/edit form is a sub-screen of the section, as „Mitglieder hinzufügen" is of
    // the KB settings: it replaces the list, a breadcrumb leads back, and its actions
    // take the dialog's footer (`footerSlot`), falling back to the form's own bottom.
    if (showForm) {
        return (
            <form id={formId} onSubmit={handleAuthSubmit} className="flex flex-col gap-6">
                <div className="flex min-w-0 flex-col gap-1.5">
                    <BreadcrumbBack
                        trail={[t('adminTabAuth')]}
                        labels={{ nav: t('breadcrumbNav'), back: t('backTo') }}
                        onClick={resetForm}
                    />
                    <h3 className="m-0 text-lg font-semibold text-on-surface">{editingId ? t('editAuthProvider') : t('newAuthProvider')}</h3>
                </div>
                <div className="flex flex-col gap-5">
                    <FieldRow
                        label={t('providerName')}
                        value={authFormData.name ?? ''}
                        placeholder={t('providerNamePlaceholder')}
                        error={authValidation.errors.name}
                        onChange={e => { setAuthFormData({ ...authFormData, name: e.target.value }); authValidation.clearError('name'); }}
                    />
                    <SelectFieldRow
                        label={t('providerType')}
                        value={authFormData.type ?? 'ldap'}
                        onValueChange={type => setAuthFormData({ ...authFormData, type })}
                        options={PROVIDER_TYPES}
                    />
                    {authFormData.type === 'oidc' ? renderOidcFields(authFormData, setAuthFormData, authValidation, t) : renderLdapFields(authFormData, setAuthFormData, authValidation, t)}
                </div>
                {renderActions(
                    <>
                        <Button type="button" variant="outline" onClick={resetForm}>{t('cancel')}</Button>
                        <Button type="submit" form={formId}><Save size={18} /> {t('saveProvider')}</Button>
                    </>,
                )}
            </form>
        );
    }

    return (
        <>

            <div className="flex flex-col gap-3">
                {loading ? (
                    <div className="loading-spinner"></div>
                ) : providers.length === 0 ? (
                    <p className="py-12 text-center text-on-surface-variant opacity-50">{t('noProvidersFound')}</p>
                ) : (
                    providers.map(provider => (
                        <AdminListCard
                            key={provider.id}
                            title={provider.name}
                            badge={provider.isActive && <Badge tone="success" className="uppercase">{t('enabled')}</Badge>}
                            details={[
                                `${t('providerType')}: ${provider.type.toUpperCase()}`,
                                `URL: ${providerSummary(provider)}`,
                            ]}
                            actionsLabel={`${t('kbActions')}: ${provider.name}`}
                            actions={[
                                { label: t('editProvider'), icon: <Pencil size={16} aria-hidden="true" />, onSelect: () => startEditAuth(provider) },
                                {
                                    label: t('deleteProvider'),
                                    icon: <Trash2 size={16} aria-hidden="true" />,
                                    destructive: true,
                                    separatorBefore: true,
                                    onSelect: () => handleDelete(provider.id, 'auth'),
                                },
                            ]}
                        />
                    ))
                )}
            </div>
        </>
    );
}

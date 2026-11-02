import { useState, useEffect, useMemo, useCallback } from 'react';
import axios from 'axios';
import { Plus, ShieldCheck, ShieldUser, Cpu, UserPlus, Search, FileText, Activity, Globe, Settings, Database, Blocks } from 'lucide-react';
import { Button, SettingsDialog, type SettingsSection } from '@ki4jlu/design-system';
import { getApiErrorMessage } from './utils/apiError';
import { API_BASE_URL } from './api';
import { useToast } from './contexts/ToastContext';
import { useTheme } from './contexts/ThemeContext';
import { useModalContext } from './contexts/ModalContext';
import { useFormValidation } from './hooks/useFormValidation';
import type { AdminSection } from './hooks/adminDialog';
import { adminSectionKeywords } from './components/admin/adminSearchKeywords';
import SystemHealthDashboard from './SystemHealthDashboard';
import KBOverviewDashboard from './KBOverviewDashboard';
import AdminConfigsTab from './components/admin/AdminConfigsTab';
import AdminAuthTab from './components/admin/AdminAuthTab';
import AdminUsersTab from './components/admin/AdminUsersTab';
import AdminRolesTab from './components/admin/AdminRolesTab';
import AdminSiteTab from './components/admin/AdminSiteTab';
import AdminSearchTab from './components/admin/AdminSearchTab';
import AdminAgentTab from './components/admin/AdminAgentTab';
import AdminEvalTab from './components/admin/AdminEvalTab';
import AdminGlobalKbsTab from './components/admin/AdminGlobalKbsTab';
import AdminTemplatesTab from './components/admin/AdminTemplatesTab';
import ReembedSection from './components/admin/ReembedSection';

interface AIModel {
    id?: string;
    name: string;
    isReasoning: boolean;
    isEmbedding: boolean;
    isRerank: boolean;
    isTts: boolean;
    isStt: boolean;
    dimensions?: number;
    contextWindow?: number;
}

interface AIConfig {
    id: string;
    name: string;
    provider: string;
    api_key: string;
    base_url?: string;
    chat_models: AIModel[];
    embedding_models: AIModel[];
    rerank_models: AIModel[];
    tts_models: AIModel[];
    stt_models: AIModel[];
    is_active: boolean;
}

interface User {
    id: string;
    username: string;
    role: string;
    firstName?: string;
    lastName?: string;
    /** ISO timestamp the account was created (GET /api/admin/users). */
    createdAt?: string;
}

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

export interface ChatModelOption {
    value: string;   // the model name (what gets saved)
    label: string;   // display text: "model-name (provider)"
}

type AdminTab = AdminSection;

// The sections are defined with the dialog's open state (hooks/adminDialog.ts, which owns `?admin=`).
export type { AdminSection };

interface AdminUIProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    section: AdminSection;
    onSectionChange: (section: AdminSection) => void;
    user: User;
    onEditGlobalKb?: (kb: { id: string; name: string }) => void;
}

/**
 * The admin console (user menu → „Admin-Einstellungen"), on the DS `SettingsDialog`
 * like the user and KB settings. Sections sit under the old page's nav groups
 * as dialog group headings: configuration, knowledge bases (overview, then
 * public KBs), users, monitoring. A system admin sees what the routes
 * let them use; the rest (authentication, search, agents, settings, eval) is
 * superadmin-only.
 *
 * Mount it only while open: it fetches the open section's data on mount.
 */
export default function AdminUI({ open, onOpenChange, section, onSectionChange, user, onEditGlobalKb }: AdminUIProps) {
    // Opens filling the window (1rem inside it); the toggle restores the plain `xl` window.
    const [maximized, setMaximized] = useState(true);
    const toast = useToast();
    const { t } = useTheme();
    const { showConfirm } = useModalContext();

    // Authentication, search, agents, settings and eval are superadmin-only
    // (their routes sit on superadminChain); an admin would only collect 403s.
    const isSuperadmin = user.role === 'superadmin';
    const isAdmin = isSuperadmin || user.role === 'admin';
    const visibleTabs: AdminTab[] = [
        'configs',
        ...(isSuperadmin ? ['auth', 'search', 'agent', 'site'] as const : []),
        ...(isAdmin ? ['kb-overview'] as const : []),
        'global-kbs',
        ...(isAdmin ? ['templates', 'users', 'roles', 'health'] as const : []),
        ...(isSuperadmin ? ['eval'] as const : []),
    ];
    const activeTab: AdminTab = visibleTabs.includes(section) ? section : 'configs';
    // A section this user may not see (a `?admin=auth` link opened by a plain admin) shows the first one;
    // say so to the store, so the URL names what is on screen.
    useEffect(() => {
        if (section !== activeTab) onSectionChange(activeTab);
    }, [section, activeTab, onSectionChange]);
    const [configs, setConfigs] = useState<AIConfig[]>([]);
    const [providers, setProviders] = useState<AuthProvider[]>([]);
    // Whether each list has come back once: the settings search picks a record from it (see
    // useSearchRevealForm), and `loading` is shared with the other requests of the section.
    const [configsFetched, setConfigsFetched] = useState(false);
    const [providersFetched, setProvidersFetched] = useState(false);
    const [usersList, setUsersList] = useState<User[]>([]);
    // Set when the last users fetch failed, so the Rollen tab shows no counts
    // instead of reading the empty list as "0 users" per role.
    const [usersFetchFailed, setUsersFetchFailed] = useState(false);
    const [siteConfigs, setSiteConfigs] = useState<Record<string, string>>({});
    const [loading, setLoading] = useState(true);
    const [showForm, setShowForm] = useState(false);
    // The dialog's footer, where an open add/edit form puts its actions (see KbSettingsDialog).
    const [footerSlot, setFooterSlot] = useState<HTMLDivElement | null>(null);
    const [editingId, setEditingId] = useState<string | null>(null);
    const [connectionTest, setConnectionTest] = useState<{
        configId: string;
        status: 'testing' | 'healthy' | 'unhealthy';
        latencyMs?: number;
        error?: string;
    } | null>(null);

    const availableChatModels = useMemo<ChatModelOption[]>(() => {
        const seen = new Set<string>();
        const out: ChatModelOption[] = [];
        for (const cfg of configs) {
            if (!cfg.chat_models) continue;
            for (const m of cfg.chat_models) {
                // Include every (name, provider) pair. If the SAME name appears
                // under multiple providers, show both so admins can see it exists
                // in more than one config.
                const key = `${m.name}__${cfg.name}`;
                if (seen.has(key)) continue;
                seen.add(key);
                out.push({ value: m.name, label: `${m.name} (${cfg.name})` });
            }
        }
        // Deterministic order: by label.
        out.sort((a, b) => a.label.localeCompare(b.label));
        return out;
    }, [configs]);

    // Config Form Data
    const [configFormData, setConfigFormData] = useState<Partial<AIConfig>>({
        name: '',
        provider: 'openai',
        api_key: '',
        base_url: 'https://api.openai.com/v1/',
        chat_models: [{ name: 'gpt-4o-mini', isReasoning: false, isEmbedding: false, isRerank: false, isTts: false, isStt: false }],
        embedding_models: [{ name: 'text-embedding-3-small', isReasoning: false, isEmbedding: true, isRerank: false, isTts: false, isStt: false, dimensions: 0 }],
        rerank_models: [],
        tts_models: [],
        stt_models: []
    });

    // Auth Provider Form Data
    const [authFormData, setAuthFormData] = useState<Partial<AuthProvider>>({
        name: '',
        type: 'ldap',
        config: {
            url: '',
            bindDN: '',
            bindCredentials: '',
            searchBase: '',
            searchFilter: '(uid={{username}})'
        },
        isActive: true
    });

    const configValidation = useFormValidation({
        name: (v) => !v.trim() && t('configNameRequired'),
        api_key: (v) => !v.trim() && t('apiKeyRequired'),
    });

    const authValidation = useFormValidation(
        authFormData.type === 'oidc'
            ? {
                name: (v) => !v.trim() && t('providerNameRequired'),
                issuerURL: (v) => !v.trim() && t('oidcIssuerUrlRequired'),
                clientID: (v) => !v.trim() && t('oidcClientIdRequired'),
                redirectURI: (v) => !v.trim() && t('oidcRedirectUriRequired'),
            }
            : {
                name: (v) => !v.trim() && t('providerNameRequired'),
                url: (v) => !v.trim() && t('ldapUrlRequired'),
                searchBase: (v) => !v.trim() && t('searchBaseRequired'),
            }
    );

    const fetchSiteConfigs = useCallback(async () => {
        setLoading(true);
        try {
            const res = await axios.get(`${API_BASE_URL}/api/site-config`);
            setSiteConfigs(res.data);
        } catch (error: unknown) {
            console.error('Failed to fetch site configs:', error);
            toast.error(t('siteConfigFetchError'));
        } finally {
            setLoading(false);
        }
    }, [toast, t]);

    const handleSiteConfigSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        const prev = { ...siteConfigs };
        try {
            await axios.post(`${API_BASE_URL}/api/site-config`, { configs: siteConfigs });
            toast.success(t('settingsSaved'));
        } catch {
            setSiteConfigs(prev);
            toast.error(t('settingsSaveError'));
        }
    };

    const fetchConfigs = useCallback(async () => {
        setLoading(true);
        try {
            const res = await axios.get(`${API_BASE_URL}/api/admin/configs`);
            setConfigs(res.data);
        } catch (error: unknown) {
            console.error('Failed to fetch configs:', error);
            toast.error(t('configsFetchError'));
        } finally {
            setLoading(false);
            setConfigsFetched(true);
        }
    }, [toast, t]);

    const fetchAuthProviders = useCallback(async () => {
        setLoading(true);
        try {
            const res = await axios.get(`${API_BASE_URL}/api/admin/auth-providers`);
            setProviders(res.data);
        } catch (error: unknown) {
            console.error('Failed to fetch providers:', error);
            toast.error(t('providersFetchError'));
        } finally {
            setLoading(false);
            setProvidersFetched(true);
        }
    }, [toast, t]);

    const fetchUsers = useCallback(async () => {
        setLoading(true);
        setUsersFetchFailed(false);
        try {
            const res = await axios.get(`${API_BASE_URL}/api/admin/users`);
            setUsersList(res.data);
        } catch (error: unknown) {
            console.error('Failed to fetch users:', error);
            setUsersFetchFailed(true);
            toast.error(t('usersFetchError'));
        } finally {
            setLoading(false);
        }
    }, [toast, t]);

    useEffect(() => {
        if (activeTab === 'configs') {
            fetchConfigs();
            fetchSiteConfigs();
        } else if (activeTab === 'auth') fetchAuthProviders();
        else if (activeTab === 'users' || activeTab === 'roles') fetchUsers();
        else if (activeTab === 'site' || activeTab === 'search' || activeTab === 'agent') fetchSiteConfigs();
    }, [activeTab, fetchConfigs, fetchSiteConfigs, fetchAuthProviders, fetchUsers]);

    const handleRoleChange = async (id: string, newRole: string) => {
        if (!await showConfirm(t('confirmPromoteUser'))) return;
        try {
            await axios.patch(`${API_BASE_URL}/api/admin/users/${id}/role`, { role: newRole });
            fetchUsers();
        } catch (error: unknown) {
            console.error('Role change failed:', error);
            toast.error(t('roleChangeError'));
        }
    };

    const handleDeleteUser = async (id: string, username: string) => {
        if (!await showConfirm(t('confirmDeleteUser').replace('{username}', username))) return;
        try {
            await axios.delete(`${API_BASE_URL}/api/admin/users/${id}`);
            fetchUsers();
        } catch (error: unknown) {
            console.error('User deletion failed:', error);
            toast.error(t('userDeleteError'));
        }
    };

    const handleConfigSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!configValidation.validate({ name: configFormData.name ?? '', api_key: configFormData.api_key ?? '' })) return;
        try {
            // reasoning_models is derived server-side from chat_models[*].isReasoning.
            // startEditConfig spreads the full API response (which includes it) into
            // form state, so without this drop the PATCH would echo a stale list and
            // the backend's legacy reasoning_models write path would clobber chat_models.
            const { reasoning_models: _legacyReasoning, ...rest } = configFormData as Partial<AIConfig> & { reasoning_models?: unknown };
            void _legacyReasoning;
            const dataToSend = {
                ...rest,
                chat_models: (configFormData.chat_models || []).filter(m => m.name.trim()),
                embedding_models: (configFormData.embedding_models || []).filter(m => m.name.trim()),
                rerank_models: (configFormData.rerank_models || []).filter(m => m.name.trim()),
                tts_models: (configFormData.tts_models || []).filter(m => m.name.trim()),
                stt_models: (configFormData.stt_models || []).filter(m => m.name.trim()),
            };

            let savedId: string;
            if (editingId) {
                await axios.patch(`${API_BASE_URL}/api/admin/configs/${editingId}`, dataToSend);
                savedId = editingId;
            } else {
                const res = await axios.post(`${API_BASE_URL}/api/admin/configs`, dataToSend);
                savedId = res.data.id;
            }
            resetForm();
            fetchConfigs();

            // Test connectivity after save
            setConnectionTest({ configId: savedId, status: 'testing' });
            try {
                const testRes = await axios.post(`${API_BASE_URL}/api/admin/configs/${savedId}/test`);
                setConnectionTest({
                    configId: savedId,
                    status: testRes.data.status === 'healthy' ? 'healthy' : 'unhealthy',
                    latencyMs: testRes.data.latencyMs,
                    error: testRes.data.error,
                });
            } catch {
                setConnectionTest({
                    configId: savedId,
                    status: 'unhealthy',
                    error: t('connectionTestFailed'),
                });
            }
            // Auto-dismiss after 15s
            setTimeout(() => setConnectionTest(prev => prev?.configId === savedId ? null : prev), 15_000);
        } catch (error: unknown) {
            console.error('Save failed:', error);
            toast.error(getApiErrorMessage(error, t('saveFailed')));
        }
    };

    const handleAuthSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        const cfg = (authFormData.config ?? {}) as Partial<LdapConfig & OidcConfig>;
        const inputs: Record<string, string> = authFormData.type === 'oidc'
            ? {
                name: authFormData.name ?? '',
                issuerURL: cfg.issuerURL ?? '',
                clientID: cfg.clientID ?? '',
                redirectURI: cfg.redirectURI ?? '',
            }
            : {
                name: authFormData.name ?? '',
                url: cfg.url ?? '',
                searchBase: cfg.searchBase ?? '',
            };
        if (!authValidation.validate(inputs)) return;
        try {
            if (editingId) {
                await axios.patch(`${API_BASE_URL}/api/admin/auth-providers/${editingId}`, authFormData);
            } else {
                await axios.post(`${API_BASE_URL}/api/admin/auth-providers`, authFormData);
            }
            resetForm();
            fetchAuthProviders();
        } catch (error: unknown) {
            console.error('Save failed:', error);
            toast.error(getApiErrorMessage(error, t('saveFailed')));
        }
    };

    const { clearAll: clearConfigValidation } = configValidation;
    const { clearAll: clearAuthValidation } = authValidation;

    const resetForm = () => {
        setShowForm(false);
        setEditingId(null);
        setConfigFormData({
            name: '',
            provider: 'openai',
            api_key: '',
            base_url: 'https://api.openai.com/v1/',
            chat_models: [{ name: 'gpt-4o-mini', isReasoning: false, isEmbedding: false, isRerank: false, isTts: false, isStt: false }],
            embedding_models: [{ name: 'text-embedding-3-small', isReasoning: false, isEmbedding: true, isRerank: false, isTts: false, isStt: false, dimensions: 0 }],
            rerank_models: [],
            tts_models: [],
            stt_models: []
        });
        setAuthFormData({
            name: '',
            type: 'ldap',
            config: {
                url: '',
                bindDN: '',
                bindCredentials: '',
                searchBase: '',
                searchFilter: '(uid={{username}})'
            },
            isActive: true
        });
        clearConfigValidation();
        clearAuthValidation();
    };

    const handleDelete = async (id: string, type: 'config' | 'auth') => {
        if (!await showConfirm(type === 'config' ? t('confirmDeleteConfig') : t('confirmDeleteProvider'))) return;
        try {
            const endpoint = type === 'config' ? 'configs' : 'auth-providers';
            await axios.delete(`${API_BASE_URL}/api/admin/${endpoint}/${id}`);
            if (type === 'config') fetchConfigs();
            else fetchAuthProviders();
        } catch (error: unknown) {
            console.error('Delete failed:', error);
            toast.error(t('deleteError'));
        }
    };

    const handleActivate = async (id: string) => {
        try {
            await axios.post(`${API_BASE_URL}/api/admin/configs/${id}/activate`);
            fetchConfigs();
        } catch (error: unknown) {
            console.error('Activation failed:', error);
            toast.error(t('activationError'));
        }
    };

    // An empty form — also when the search moves an open edit form over to a new record.
    const startAdd = () => {
        resetForm();
        setShowForm(true);
    };

    const startEditConfig = (config: AIConfig) => {
        setConfigFormData(config);
        setEditingId(config.id);
        setShowForm(true);
    };

    const startEditAuth = (provider: AuthProvider) => {
        setAuthFormData(provider);
        setEditingId(provider.id);
        setShowForm(true);
    };

    const content = (tab: AdminTab): React.ReactNode => {
        switch (tab) {
            case 'configs':
                return (
                    <AdminConfigsTab
                        configs={configs}
                        showForm={showForm}
                        editingId={editingId}
                        configFormData={configFormData}
                        setConfigFormData={setConfigFormData}
                        connectionTest={connectionTest}
                        setConnectionTest={setConnectionTest}
                        handleConfigSubmit={handleConfigSubmit}
                        startEditConfig={startEditConfig}
                        startAdd={startAdd}
                        fetched={configsFetched}
                        handleDelete={handleDelete}
                        handleActivate={handleActivate}
                        resetForm={resetForm}
                        configValidation={configValidation}
                        loading={loading}
                        siteConfigs={siteConfigs}
                        setSiteConfigs={setSiteConfigs}
                        onSiteConfigSubmit={handleSiteConfigSubmit}
                        availableChatModels={availableChatModels}
                        footerSlot={footerSlot}
                    />
                );
            case 'auth':
                return (
                    <AdminAuthTab
                        providers={providers}
                        showForm={showForm}
                        editingId={editingId}
                        authFormData={authFormData}
                        setAuthFormData={setAuthFormData}
                        handleAuthSubmit={handleAuthSubmit}
                        startEditAuth={startEditAuth}
                        startAdd={startAdd}
                        fetched={providersFetched}
                        handleDelete={handleDelete}
                        resetForm={resetForm}
                        authValidation={authValidation}
                        loading={loading}
                        footerSlot={footerSlot}
                    />
                );
            case 'users':
                return (
                    <AdminUsersTab
                        usersList={usersList}
                        currentUser={user}
                        handleRoleChange={handleRoleChange}
                        handleDeleteUser={handleDeleteUser}
                        loading={loading}
                    />
                );
            case 'roles':
                return <AdminRolesTab users={loading || usersFetchFailed ? null : usersList} />;
            case 'site':
                return <AdminSiteTab siteConfigs={siteConfigs} setSiteConfigs={setSiteConfigs} onSubmit={handleSiteConfigSubmit} footerSlot={footerSlot} />;
            case 'search':
                return <AdminSearchTab siteConfigs={siteConfigs} setSiteConfigs={setSiteConfigs} onSubmit={handleSiteConfigSubmit} footerSlot={footerSlot} />;
            case 'agent':
                return <AdminAgentTab siteConfigs={siteConfigs} setSiteConfigs={setSiteConfigs} onSubmit={handleSiteConfigSubmit} footerSlot={footerSlot} />;
            case 'health':
                return (
                    <>
                        <SystemHealthDashboard />
                        {isSuperadmin && <ReembedSection />}
                    </>
                );
            case 'kb-overview':
                return <KBOverviewDashboard />;
            case 'global-kbs':
                // Editing a public KB is its own full-page view: close the
                // console first so it is not left open behind that page.
                return (
                    <AdminGlobalKbsTab
                        onEditGlobalKb={onEditGlobalKb && ((kb) => { onOpenChange(false); onEditGlobalKb(kb); })}
                    />
                );
            case 'templates':
                return <AdminTemplatesTab footerSlot={footerSlot} />;
            case 'eval':
                return <AdminEvalTab />;
        }
    };

    // The group is the heading over a run of sections: keep `visibleTabs` ordered by it.
    const sectionMeta: Record<AdminTab, { icon: typeof Cpu; label: string; group: string }> = {
        configs: { icon: Cpu, label: t('adminTabAiModels'), group: t('adminNavGroupConfig') },
        auth: { icon: ShieldCheck, label: t('adminTabAuth'), group: t('adminNavGroupConfig') },
        search: { icon: Search, label: t('adminTabSearch'), group: t('adminNavGroupConfig') },
        agent: { icon: FileText, label: t('adminTabAgents'), group: t('adminNavGroupConfig') },
        site: { icon: Settings, label: t('adminTabSettings'), group: t('adminNavGroupConfig') },
        'kb-overview': { icon: Database, label: t('adminTabKbOverview'), group: t('adminNavGroupKbs') },
        'global-kbs': { icon: Globe, label: t('adminTabGlobalKbs'), group: t('adminNavGroupKbs') },
        templates: { icon: Blocks, label: t('adminTabTemplates'), group: t('adminNavGroupKbs') },
        users: { icon: UserPlus, label: t('adminTabUsers'), group: t('adminNavGroupUsers') },
        roles: { icon: ShieldUser, label: t('adminTabRoles'), group: t('adminNavGroupUsers') },
        health: { icon: Activity, label: t('adminTabHealth'), group: t('adminNavGroupMonitoring') },
        eval: { icon: Activity, label: t('evalRunner'), group: t('adminNavGroupMonitoring') },
    };

    // The dialog's search finds a section by its name and by the labels of what is inside it.
    const keywords = adminSectionKeywords(t);

    const sections: SettingsSection[] = visibleTabs.map((tab) => {
        const { icon: Icon, label, group } = sectionMeta[tab];
        return {
            value: tab,
            label,
            group,
            keywords: keywords[tab],
            icon: <Icon aria-hidden="true" />,
            content: <div className="admin-section pt-6">{content(tab)}</div>,
        };
    });

    // Every action of a section is a dialog action and sits in the footer, never in the section.
    // The tabs portal their own into `footerSlot` (Speichern, or the open form's Abbrechen and
    // Speichern); AdminUI adds „hinzufügen" to the two sections that list things.
    const addLabel = activeTab === 'configs' ? t('addConfig') : activeTab === 'auth' ? t('addProvider') : null;
    const hasFooterActions = addLabel !== null || activeTab === 'templates' || activeTab === 'site' || activeTab === 'search' || activeTab === 'agent';
    const footerSlotElement = (
        <div ref={setFooterSlot} className="ml-auto flex flex-col-reverse gap-2 sm:flex-row sm:justify-end" />
    );
    const footer = !hasFooterActions ? undefined : addLabel && !showForm ? (
        <>
            {/* Alone it is the section's primary action; next to the per-job Speichern it is secondary. */}
            <Button
                variant={activeTab === 'configs' ? 'outline' : 'default'}
                onClick={startAdd}
            >
                <Plus size={16} aria-hidden="true" />
                {addLabel}
            </Button>
            {activeTab === 'configs' && footerSlotElement}
        </>
    ) : footerSlotElement;

    return (
        <>
            <SettingsDialog
                open={open}
                onOpenChange={onOpenChange}
                value={activeTab}
                onValueChange={(v) => {
                    resetForm();
                    onSectionChange(v as AdminSection);
                }}
                size="xl"
                title={t('adminDashboard')}
                closeLabel={t('close')}
                maximizable
                maximized={maximized}
                onMaximizedChange={setMaximized}
                maximizeLabel={t('dialogMaximize')}
                restoreLabel={t('dialogRestore')}
                searchPlaceholder={t('settingsSearch')}
                emptyLabel={t('settingsNoMatch')}
                sections={sections}
                footer={footer}
            />

            <style>{`
                .result-card {
                    background: var(--bg-secondary);
                    border: 1px solid var(--border-color);
                    border-radius: var(--shape-lg);
                    padding: 1.5rem;
                    margin-bottom: 1rem;
                }
                /* Scoped to the dialog's content (the dialog sits over the app, so
                   a bare h3/p rule would recolour the page behind it); :where keeps
                   the old rules' specificity, so DS utilities still win. */
                :where(.admin-section) h3 {
                    color: var(--text-primary);
                }
                :where(.admin-section) p {
                    color: var(--text-secondary);
                }
            `}</style>
        </>
    );
}

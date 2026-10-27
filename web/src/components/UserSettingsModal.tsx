import { MessageSquare, Plug, Settings, User } from 'lucide-react';
import type { ReactNode } from 'react';
import {
    ACCENT_COLORS, AccentSwatch,
    SettingsDialog, SettingsRow, Switch, useAccent, useContrast,
    type AccentColor, type ContrastChoice,
} from '@ki4jlu/design-system';
import type { Theme } from '@ki4jlu/design-system';
import { useTheme } from '../contexts/ThemeContext';
import { useAuth } from '../contexts/AuthContext';
import ApiKeyManager from './ApiKeys/ApiKeyManager';
import { Choice } from './form/Choice';
import ConfluenceTokenManager from './ConfluenceTokenManager';
import type { Language } from '../translations';
import { roleLabel } from '../utils/roleLabel';
import { useAutoScrollEnabled, useFollowUpsEnabled, usePromptSuggestionsEnabled } from '../hooks/useChatSuggestionPrefs';

export type SettingsTab = 'general' | 'chat' | 'profile' | 'connectors';

interface UserSettingsModalProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    tab: SettingsTab;
    onTabChange: (tab: SettingsTab) => void;
}

/**
 * The user's settings window (user menu → „Einstellungen"), on the DS
 * `SettingsDialog`. General: colour scheme, contrast, accent, language. Chat: starter
 * suggestions, follow-ups, autoscroll. Profile: the
 * account as the directory (LDAP) knows it — read-only. Connectors: the API-key
 * and Confluence-token managers, each disabled with its reason where it does not apply.
 */
export function UserSettingsModal({ open, onOpenChange, tab, onTabChange }: UserSettingsModalProps) {
    const { t, theme, setTheme, language, setLanguage } = useTheme();
    const [suggestionsEnabled, setSuggestionsEnabled] = usePromptSuggestionsEnabled();
    const [followUpsEnabled, setFollowUpsEnabled] = useFollowUpsEnabled();
    const [autoScrollEnabled, setAutoScrollEnabled] = useAutoScrollEnabled();
    const { contrast, setContrast } = useContrast();
    const { accent, setAccent } = useAccent();
    const { user, siteConfigs } = useAuth();

    const readOnly = (value?: string) => <span className="text-on-surface-variant">{value || '–'}</span>;
    const canUseApiKeys = !!user && ['api-user', 'admin', 'superadmin'].includes(user.role);
    const disabled = readOnly(t('connectorDisabled'));

    return (
        <SettingsDialog
            open={open}
            onOpenChange={onOpenChange}
            value={tab}
            onValueChange={(v) => onTabChange(v as SettingsTab)}
            title={t('settings')}
            closeLabel={t('close')}
            searchPlaceholder={t('settingsSearch')}
            emptyLabel={t('settingsNoMatch')}
            sections={[
                {
                    value: 'general',
                    label: t('settingsGeneral'),
                    icon: <Settings aria-hidden="true" />,
                    keywords: [t('appearance'), t('contrast'), t('accentColor'), t('languageLabel')],
                    content: (
                        <>
                            <SettingsRow
                                label={t('appearance')}
                                labelId="settings-appearance"
                                control={(
                                    <Choice<Theme>
                                        id="settings-appearance"
                                        value={theme}
                                        onChange={setTheme}
                                        options={[['system', t('themeSystemShort')], ['light', t('themeLightShort')], ['dark', t('themeDarkShort')]]}
                                    />
                                )}
                            />
                            <SettingsRow
                                label={t('contrast')}
                                labelId="settings-contrast"
                                control={(
                                    <Choice<ContrastChoice>
                                        id="settings-contrast"
                                        value={contrast}
                                        onChange={setContrast}
                                        options={[['system', t('themeSystemShort')], ['normal', t('contrastNormal')], ['medium', t('contrastMedium')], ['more', t('contrastMore')]]}
                                    />
                                )}
                            />
                            <SettingsRow
                                label={t('accentColor')}
                                labelId="settings-accent"
                                control={(
                                    <Choice<AccentColor>
                                        id="settings-accent"
                                        value={accent}
                                        onChange={setAccent}
                                        options={ACCENT_COLORS.map(a => [a, (
                                            <span key={a} className="flex items-center gap-2">
                                                <AccentSwatch accent={a} />
                                                {t(`accent_${a}`)}
                                            </span>
                                        )] as [AccentColor, ReactNode])}
                                    />
                                )}
                            />
                            <SettingsRow
                                label={t('languageLabel')}
                                labelId="settings-language"
                                control={(
                                    <Choice<Language>
                                        id="settings-language"
                                        value={language}
                                        onChange={setLanguage}
                                        options={[['de', 'Deutsch'], ['en', 'English']]}
                                    />
                                )}
                            />
                        </>
                    ),
                },
                {
                    value: 'chat',
                    label: t('settingsChat'),
                    icon: <MessageSquare aria-hidden="true" />,
                    keywords: [t('promptSuggestions'), t('followUpsLabel'), t('autoScrollLabel')],
                    content: (
                        <>
                            <SettingsRow
                                label={t('promptSuggestions')}
                                labelId="settings-prompt-suggestions"
                                description={t('promptSuggestionsHint')}
                                control={<Switch aria-labelledby="settings-prompt-suggestions" checked={suggestionsEnabled} onCheckedChange={setSuggestionsEnabled} />}
                            />
                            <SettingsRow
                                label={t('followUpsLabel')}
                                labelId="settings-follow-ups"
                                description={t('followUpsHint')}
                                control={<Switch aria-labelledby="settings-follow-ups" checked={followUpsEnabled} onCheckedChange={setFollowUpsEnabled} />}
                            />
                            <SettingsRow
                                label={t('autoScrollLabel')}
                                labelId="settings-auto-scroll"
                                description={t('autoScrollHint')}
                                control={<Switch aria-labelledby="settings-auto-scroll" checked={autoScrollEnabled} onCheckedChange={setAutoScrollEnabled} />}
                            />
                        </>
                    ),
                },
                {
                    value: 'profile',
                    label: t('settingsProfile'),
                    icon: <User aria-hidden="true" />,
                    keywords: [t('firstName'), t('lastName'), t('emailAddress')],
                    content: (
                        <>
                            <SettingsRow label={t('username')} control={readOnly(user ? `@${user.username}` : undefined)} />
                            <SettingsRow label={t('firstName')} control={readOnly(user?.firstName)} />
                            <SettingsRow label={t('lastName')} control={readOnly(user?.lastName)} />
                            <SettingsRow label={t('emailAddress')} control={readOnly(user?.email)} />
                            <SettingsRow label={t('role')} control={readOnly(roleLabel(user?.role, t))} description={t('ldapNotice')} />
                        </>
                    ),
                },
                {
                    value: 'connectors',
                    label: t('settingsConnectors'),
                    icon: <Plug aria-hidden="true" />,
                    keywords: [t('apiKeys'), 'API', 'Confluence'],
                    // Always shown: a connector this user cannot use stays listed, disabled, with the reason.
                    content: (
                        <>
                            {canUseApiKeys
                                ? <SettingsRow label={t('apiKeys')}><ApiKeyManager /></SettingsRow>
                                : <SettingsRow label={t('apiKeys')} description={t('connectorApiKeysUnavailable')} control={disabled} />}
                            {siteConfigs.confluence_enabled === 'true'
                                ? <SettingsRow label="Confluence"><ConfluenceTokenManager /></SettingsRow>
                                : <SettingsRow label="Confluence" description={t('connectorConfluenceUnavailable')} control={disabled} />}
                        </>
                    ),
                },
            ]}
        />
    );
}

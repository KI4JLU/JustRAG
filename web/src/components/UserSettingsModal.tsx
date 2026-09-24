import { Settings, User } from 'lucide-react';
import type { ReactNode } from 'react';
import {
    ACCENT_COLORS, AccentSwatch,
    Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
    SettingsDialog, SettingsRow, Switch, useAccent, useContrast, useUiShape,
    type AccentColor, type ContrastChoice, type UiShape,
} from '@ki4jlu/design-system';
import type { Theme } from '@ki4jlu/design-system';
import { useTheme } from '../contexts/ThemeContext';
import { useAuth } from '../contexts/AuthContext';
import ApiKeyManager from './ApiKeys/ApiKeyManager';
import ConfluenceTokenManager from './ConfluenceTokenManager';
import type { Language } from '../translations';
import { roleLabel } from '../utils/roleLabel';
import { useFollowUpsEnabled, usePromptSuggestionsEnabled } from '../hooks/useChatSuggestionPrefs';

export type SettingsTab = 'general' | 'profile';

interface UserSettingsModalProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    tab: SettingsTab;
    onTabChange: (tab: SettingsTab) => void;
}

/** A labelled choice for a SettingsRow; the row's label names the select. */
function Choice<T extends string>({ id, value, onChange, options }: {
    id: string;
    value: T;
    onChange: (v: T) => void;
    options: [T, ReactNode][];
}) {
    return (
        <Select value={value} onValueChange={(v) => onChange(v as T)}>
            <SelectTrigger aria-labelledby={id} className="w-48">
                <SelectValue />
            </SelectTrigger>
            <SelectContent align="end">
                {options.map(([v, label]) => <SelectItem key={v} value={v}>{label}</SelectItem>)}
            </SelectContent>
        </Select>
    );
}

/**
 * The user's settings window (user menu → „Einstellungen"), on the DS
 * `SettingsDialog`. General: colour scheme, Style, language. Profile: the
 * account as the directory (LDAP) knows it — read-only — plus the API-key and
 * Confluence-token managers where they apply, as on the profile page.
 */
export function UserSettingsModal({ open, onOpenChange, tab, onTabChange }: UserSettingsModalProps) {
    const { t, theme, setTheme, language, setLanguage } = useTheme();
    const { shape, setShape } = useUiShape();
    const [suggestionsEnabled, setSuggestionsEnabled] = usePromptSuggestionsEnabled();
    const [followUpsEnabled, setFollowUpsEnabled] = useFollowUpsEnabled();
    const { contrast, setContrast } = useContrast();
    const { accent, setAccent } = useAccent();
    const { user, siteConfigs } = useAuth();

    const readOnly = (value?: string) => <span className="text-on-surface-variant">{value || '–'}</span>;
    const canUseApiKeys = !!user && ['api-user', 'admin', 'superadmin'].includes(user.role);

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
                    keywords: [t('appearance'), t('contrast'), t('accentColor'), t('uiShape'), t('promptSuggestions'), t('followUpsLabel'), t('languageLabel')],
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
                                description={t('contrastHint')}
                                control={(
                                    <Choice<ContrastChoice>
                                        id="settings-contrast"
                                        value={contrast}
                                        onChange={setContrast}
                                        options={[['system', t('themeSystemShort')], ['normal', t('contrastNormal')], ['more', t('contrastMore')]]}
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
                                label={t('uiShape')}
                                labelId="settings-ui-shape"
                                description={t('uiShapeHint')}
                                control={(
                                    <Choice<UiShape>
                                        id="settings-ui-shape"
                                        value={shape}
                                        onChange={setShape}
                                        options={[['rounded', t('uiShapeRounded')], ['pill', t('uiShapePill')]]}
                                    />
                                )}
                            />
                            <SettingsRow
                                label={t('promptSuggestions')}
                                labelId="settings-prompt-suggestions"
                                description={t('promptSuggestionsHint')}
                                control={<Switch id="settings-prompt-suggestions" checked={suggestionsEnabled} onCheckedChange={setSuggestionsEnabled} />}
                            />
                            <SettingsRow
                                label={t('followUpsLabel')}
                                labelId="settings-follow-ups"
                                description={t('followUpsHint')}
                                control={<Switch id="settings-follow-ups" checked={followUpsEnabled} onCheckedChange={setFollowUpsEnabled} />}
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
                    value: 'profile',
                    label: t('settingsProfile'),
                    icon: <User aria-hidden="true" />,
                    keywords: [t('firstName'), t('lastName'), t('emailAddress'), 'API'],
                    content: (
                        <>
                            <SettingsRow label={t('username')} control={readOnly(user ? `@${user.username}` : undefined)} />
                            <SettingsRow label={t('firstName')} control={readOnly(user?.firstName)} />
                            <SettingsRow label={t('lastName')} control={readOnly(user?.lastName)} />
                            <SettingsRow label={t('emailAddress')} control={readOnly(user?.email)} />
                            <SettingsRow label={t('role')} control={readOnly(roleLabel(user?.role, t))} description={t('ldapNotice')} />
                            {canUseApiKeys && <SettingsRow label={t('apiKeys')}><ApiKeyManager /></SettingsRow>}
                            {siteConfigs.confluence_enabled === 'true' && (
                                <SettingsRow label="Confluence"><ConfluenceTokenManager /></SettingsRow>
                            )}
                        </>
                    ),
                },
            ]}
        />
    );
}

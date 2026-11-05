import { useId } from 'react';
import { Save } from 'lucide-react';
import { Button, PanelSection } from '@ki4jlu/design-system';
import { useTheme } from '../../contexts/ThemeContext';
import { CheckboxFieldRow, FieldRow } from '../form/SettingsFieldRow';
import { DEFAULT_NAMES, NAME_MAX } from '../../utils/systemNames';
import { appNameFrom } from '../../utils/appName';
import { FooterActions } from './FooterActions';

interface AdminSiteTabProps {
    siteConfigs: Record<string, string>;
    setSiteConfigs: React.Dispatch<React.SetStateAction<Record<string, string>>>;
    onSubmit: (e: React.FormEvent) => void;
    /** The dialog's footer, where Speichern goes. */
    footerSlot?: HTMLElement | null;
}

export default function AdminSiteTab({ siteConfigs, setSiteConfigs, onSubmit, footerSlot }: AdminSiteTabProps) {
    const { t } = useTheme();
    const formId = useId();
    const set = (key: string, value: string) => setSiteConfigs(prev => ({ ...prev, [key]: value }));
    // The placeholders: what a blank field falls back to, the server's environment.
    const envAppName = appNameFrom({ app_name_prefix: siteConfigs.app_name_prefix, app_name_product: siteConfigs.app_name_product });

    return (
        <form id={formId} onSubmit={onSubmit} className="flex flex-col gap-6">
            {/* The deployment's names; blank = the default, shown as the
                placeholder. Institution and system are the app name's two
                parts (logo „JLU [RAG]"); they default to APP_NAME_PREFIX /
                APP_NAME_PRODUCT in the server's environment. There is no logo
                upload: the logo is the design system's wordmark. */}
            <PanelSection title={t('namesSection')}>
                <div className="flex flex-col gap-5">
                    <FieldRow
                        width="wide"
                        label={t('institutionNameLabel')}
                        help={t('institutionNameHelp')}
                        type="text"
                        maxLength={NAME_MAX}
                        value={siteConfigs.institution_name || ''}
                        onChange={e => set('institution_name', e.target.value)}
                        placeholder={envAppName.prefix}
                    />
                    <FieldRow
                        width="wide"
                        label={t('systemNameLabel')}
                        help={t('systemNameHelp')}
                        type="text"
                        maxLength={NAME_MAX}
                        value={siteConfigs.system_name || ''}
                        onChange={e => set('system_name', e.target.value)}
                        placeholder={envAppName.product}
                    />
                    <FieldRow
                        width="wide"
                        label={t('assistantNameLabel')}
                        help={t('assistantNameHelp')}
                        type="text"
                        maxLength={NAME_MAX}
                        value={siteConfigs.assistant_name || ''}
                        onChange={e => set('assistant_name', e.target.value)}
                        placeholder={DEFAULT_NAMES.assistant}
                    />
                </div>
            </PanelSection>

            <PanelSection title={t('policyAcceptanceSection')}>
                <FieldRow
                    width="wide"
                    label={t('policyAcceptanceVersion')}
                    help={t('policyAcceptanceVersionHelp')}
                    type="text"
                    value={siteConfigs.policy_acceptance_version || ''}
                    onChange={e => set('policy_acceptance_version', e.target.value)}
                    placeholder="2026-07-13"
                    maxLength={64}
                />
            </PanelSection>

            <PanelSection title={t('confluenceSettings')}>
                <div className="flex flex-col gap-5">
                    <CheckboxFieldRow
                        width="wide"
                        label={t('confluenceEnabled')}
                        checked={siteConfigs.confluence_enabled === 'true'}
                        onCheckedChange={checked => set('confluence_enabled', checked ? 'true' : 'false')}
                    />
                    {siteConfigs.confluence_enabled === 'true' && (
                        <FieldRow
                            width="wide"
                            label={t('confluenceBaseUrl')}
                            type="text"
                            value={siteConfigs.confluence_base_url || ''}
                            onChange={e => set('confluence_base_url', e.target.value)}
                            placeholder={t('confluenceBaseUrlPlaceholder')}
                        />
                    )}
                </div>
            </PanelSection>

            <PanelSection title={t('gitRepoSettings')}>
                <CheckboxFieldRow
                    width="wide"
                    label={t('gitRepoEnabled')}
                    help={t('gitRepoEnabledHelp')}
                    checked={siteConfigs.git_repo_enabled === 'true'}
                    onCheckedChange={checked => set('git_repo_enabled', checked ? 'true' : 'false')}
                />
            </PanelSection>

            <FooterActions slot={footerSlot}>
                <Button type="submit" form={formId}><Save size={18} aria-hidden="true" /> {t('saveSettings')}</Button>
            </FooterActions>
        </form>
    );
}

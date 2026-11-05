import { useId } from 'react';
import { Save } from 'lucide-react';
import { Button, PanelSection } from '@ki4jlu/design-system';
import { useTheme } from '../../contexts/ThemeContext';
import { CheckboxFieldRow, FieldRow, TextareaFieldRow } from '../form/SettingsFieldRow';
import { DEFAULT_NAMES, NAME_MAX } from '../../utils/systemNames';
import { appNameFrom, appNameText } from '../../utils/appName';
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

    return (
        <form id={formId} onSubmit={onSubmit} className="flex flex-col gap-6">
            {/* The deployment's names; blank = the default, shown as the
                placeholder. The system name's default is the app name. */}
            <PanelSection title={t('namesSection')}>
                <div className="flex flex-col gap-5">
                    <FieldRow
                        width="wide"
                        label={t('systemNameLabel')}
                        help={t('systemNameHelp')}
                        type="text"
                        maxLength={NAME_MAX}
                        value={siteConfigs.system_name || ''}
                        onChange={e => set('system_name', e.target.value)}
                        placeholder={appNameText(appNameFrom(siteConfigs))}
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

            {/* No logo upload: the logo is the design system's wordmark,
                built from APP_NAME_PREFIX / APP_NAME_PRODUCT in the
                server's environment. */}
            <div className="flex flex-col gap-5">
                <TextareaFieldRow
                    width="wide"
                    label={t('chatFooterLabel')}
                    value={siteConfigs.chat_footer || ''}
                    onChange={e => set('chat_footer', e.target.value)}
                    placeholder={t('chatFooterPlaceholder')}
                    rows={3}
                />
                <TextareaFieldRow
                    width="wide"
                    label={t('kbHeaderLabel')}
                    value={siteConfigs.kb_header || ''}
                    onChange={e => set('kb_header', e.target.value)}
                    placeholder={t('kbHeaderPlaceholder')}
                    rows={3}
                />
                <TextareaFieldRow
                    width="wide"
                    label={t('imprintLabel')}
                    value={siteConfigs.imprint || ''}
                    onChange={e => set('imprint', e.target.value)}
                    placeholder={t('imprintPlaceholder')}
                    rows={5}
                />
                <TextareaFieldRow
                    width="wide"
                    label={t('examplePromptsLabel')}
                    help={t('examplePromptsHelp')}
                    value={siteConfigs.example_prompts || ''}
                    onChange={e => set('example_prompts', e.target.value)}
                    placeholder={t('examplePromptsPlaceholder')}
                    rows={5}
                />
                <FieldRow
                    width="wide"
                    label={t('webProxy')}
                    help={t('webProxyHelp')}
                    type="text"
                    value={siteConfigs.web_proxy || ''}
                    onChange={e => set('web_proxy', e.target.value)}
                    placeholder="http://user:pass@host:port"
                />
            </div>

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

import { useId } from 'react';
import { Save } from 'lucide-react';
import { Button, PanelSection } from '@ki4jlu/design-system';
import { useTheme } from '../../contexts/ThemeContext';
import { CheckboxFieldRow, FieldRow } from '../form/SettingsFieldRow';
import { FooterActions } from './FooterActions';

interface AdminSearchTabProps {
    siteConfigs: Record<string, string>;
    setSiteConfigs: React.Dispatch<React.SetStateAction<Record<string, string>>>;
    onSubmit: (e: React.FormEvent) => void;
    /** The dialog's footer, where Speichern goes. */
    footerSlot?: HTMLElement | null;
}

export default function AdminSearchTab({ siteConfigs, setSiteConfigs, onSubmit, footerSlot }: AdminSearchTabProps) {
    const { t } = useTheme();
    const formId = useId();
    const set = (key: string, value: string) => setSiteConfigs(prev => ({ ...prev, [key]: value }));

    return (
        <form id={formId} onSubmit={onSubmit} className="flex flex-col gap-6">
            <PanelSection title={t('webSearchSection')}>
                <div className="flex flex-col gap-5">
                    <CheckboxFieldRow
                        width="wide"
                        label={t('webSearchEnabled')}
                        checked={siteConfigs.web_search_enabled === 'true'}
                        onCheckedChange={checked => set('web_search_enabled', checked ? 'true' : 'false')}
                    />
                    {siteConfigs.web_search_enabled === 'true' && (
                        <>
                            <FieldRow
                                width="wide"
                                label={t('googleSearchApiKey')}
                                help={t('googleSearchApiKeyHelp')}
                                type="password"
                                value={siteConfigs.google_search_api_key || ''}
                                onChange={e => set('google_search_api_key', e.target.value)}
                                placeholder="AIza..."
                            />
                            <FieldRow
                                width="wide"
                                label={t('googleSearchCx')}
                                help={t('googleSearchCxHelp')}
                                type="text"
                                value={siteConfigs.google_search_cx || ''}
                                onChange={e => set('google_search_cx', e.target.value)}
                                placeholder="0123456789..."
                            />
                        </>
                    )}
                </div>
            </PanelSection>

            <PanelSection title={t('academicSearchSection')}>
                <div className="flex flex-col gap-5">
                    <CheckboxFieldRow
                        width="wide"
                        label={t('academicSearchEnabled')}
                        checked={siteConfigs.academic_search_enabled === 'true'}
                        onCheckedChange={checked => set('academic_search_enabled', checked ? 'true' : 'false')}
                    />
                    {siteConfigs.academic_search_enabled === 'true' && (
                        <>
                            <FieldRow
                                width="wide"
                                label={t('academicSearchBaseUrl')}
                                help={t('academicSearchBaseUrlHelp')}
                                type="text"
                                value={siteConfigs.academic_search_base_url || ''}
                                onChange={e => set('academic_search_base_url', e.target.value)}
                                placeholder={t('academicSearchBaseUrlPlaceholder')}
                            />
                            <FieldRow
                                width="wide"
                                label={t('academicSearchName')}
                                help={t('academicSearchNameHelp')}
                                type="text"
                                value={siteConfigs.academic_search_name || ''}
                                onChange={e => set('academic_search_name', e.target.value)}
                                placeholder={t('academicSearchNamePlaceholder')}
                            />
                        </>
                    )}
                </div>
            </PanelSection>

            <FooterActions slot={footerSlot}>
                <Button type="submit" form={formId}><Save size={18} aria-hidden="true" /> {t('saveSearchProviders')}</Button>
            </FooterActions>
        </form>
    );
}

import { useId } from 'react';
import { Save } from 'lucide-react';
import { Button, PanelSection, SettingsRow } from '@ki4jlu/design-system';
import { useTheme } from '../../contexts/ThemeContext';
import { CheckboxFieldRow, SelectFieldRow } from '../form/SettingsFieldRow';
import { defaultTarget, languageOptions } from '../translator/languages';
import { useTranslatorConfig } from '../translator/translatorConfig';
import { FooterActions } from './FooterActions';

interface AdminExtensionsTabProps {
    siteConfigs: Record<string, string>;
    setSiteConfigs: React.Dispatch<React.SetStateAction<Record<string, string>>>;
    onSubmit: (e: React.FormEvent) => void;
    /** The dialog's footer, where Speichern goes. */
    footerSlot?: HTMLElement | null;
}

/**
 * „Erweiterungen": the functions the app can be extended with, one `PanelSection` each, every
 * one switched on and off by its own global-only site_config key and saved through the same
 * path as the other site settings. A new extension adds its own section here (and its keys to
 * `ADMIN_SEARCH_KEYS.extensions`); there is nothing to register.
 *
 * Translation is the first one: on/off (`translator_enabled`), the target language users start
 * with (`translator_default_target_lang`) and, read-only, the model it runs on — the Fast Tier
 * model, which is set under „KI-Modelle" where `model_tier_fast` is, not here.
 */
export default function AdminExtensionsTab({ siteConfigs, setSiteConfigs, onSubmit, footerSlot }: AdminExtensionsTabProps) {
    const { t } = useTheme();
    const formId = useId();
    const { config } = useTranslatorConfig();
    const set = (key: string, value: string) => setSiteConfigs(prev => ({ ...prev, [key]: value }));
    const languages = languageOptions(t, config?.languages);

    return (
        <form id={formId} onSubmit={onSubmit} className="flex flex-col gap-6">
            <p className="m-0 text-sm text-on-surface-variant">{t('extensionsIntro')}</p>

            <PanelSection title={t('extensionTranslation')} hint={t('extensionTranslationHint')}>
                <div className="flex flex-col gap-5">
                    <CheckboxFieldRow
                        width="wide"
                        label={t('translatorEnabled')}
                        help={t('translatorEnabledHelp')}
                        checked={siteConfigs.translator_enabled === 'true'}
                        onCheckedChange={checked => set('translator_enabled', checked ? 'true' : 'false')}
                    />
                    <SelectFieldRow
                        label={t('translatorDefaultTargetLanguage')}
                        help={t('translatorDefaultTargetLanguageHelp')}
                        value={defaultTarget({ defaultTargetLanguage: siteConfigs.translator_default_target_lang })}
                        onValueChange={value => set('translator_default_target_lang', value)}
                        options={languages.map(language => ({ value: language.code, label: language.name }))}
                    />
                    <SettingsRow
                        label={t('translatorModel')}
                        description={t('translatorModelHelp')}
                        control={(
                            <span data-testid="translator-model" className="block max-w-[280px] text-right text-sm text-on-surface-variant">
                                {config
                                    ? config.model
                                        ? t(config.modelSource === 'default' ? 'translatorModelDefaultValue' : 'translatorModelValue')
                                            .replace('{model}', config.model)
                                        : t('translatorModelDefault')
                                    : '–'}
                            </span>
                        )}
                    />
                </div>
            </PanelSection>

            <FooterActions slot={footerSlot}>
                <Button type="submit" form={formId}><Save size={18} aria-hidden="true" /> {t('saveSettings')}</Button>
            </FooterActions>
        </form>
    );
}

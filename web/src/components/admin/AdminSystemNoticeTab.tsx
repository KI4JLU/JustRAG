import { useId, useMemo, useState } from 'react';
import { BookmarkPlus, Save, Trash2 } from 'lucide-react';
import { Button, PanelSection } from '@ki4jlu/design-system';
import { useTheme } from '../../contexts/ThemeContext';
import { useModalContext } from '../../contexts/ModalContext';
import { CheckboxFieldRow, FieldRow, SelectFieldRow, TextareaFieldRow } from '../form/SettingsFieldRow';
import { SystemNoticeAlert } from '../SystemNotice';
import { FooterActions } from './FooterActions';
import { SYSTEM_NOTICE_TONES, isSafeNoticeHref, readSystemNotice, type SystemNoticeTone } from '../../utils/systemNotice';
import {
    SYSTEM_NOTICE_TEMPLATES_MAX, SYSTEM_NOTICE_TEMPLATE_NAME_MAX, hasSystemNoticeTemplateNamed,
    readSystemNoticeTemplates, upsertSystemNoticeTemplate, type SystemNoticeTemplate,
} from '../../utils/systemNoticeTemplates';

/** The server's limits (siteconfig/system_notice.go); `maxLength` counts UTF-16 units, close enough for a form hint. */
const TEXT_MAX = 1000;
const LABEL_MAX = 80;

const TONE_LABEL_KEYS: Record<SystemNoticeTone, string> = {
    neutral: 'systemNoticeToneNeutral',
    info: 'systemNoticeToneInfo',
    warning: 'systemNoticeToneWarning',
    error: 'systemNoticeToneError',
};

interface AdminSystemNoticeTabProps {
    siteConfigs: Record<string, string>;
    setSiteConfigs: React.Dispatch<React.SetStateAction<Record<string, string>>>;
    onSubmit: (e: React.FormEvent) => void;
    /** The dialog's footer, where Speichern goes. */
    footerSlot?: HTMLElement | null;
    /**
     * Stores the template list at once (not with Speichern): saving or deleting
     * a template is its own action and must not wait for, or publish, the
     * message being edited. Resolves false when the save failed.
     */
    onSaveTemplates: (templates: SystemNoticeTemplate[]) => Promise<boolean>;
}

/**
 * „Systemmeldung": one message every user sees under the app bar (site_config
 * `system_notice_*`). Its own section rather than part of „Einstellungen",
 * because admins edit it too — it saves through `PUT /api/admin/system-notice`,
 * which writes these keys only. The preview is the shell's own component, so
 * what the admin sees here is what users get.
 */
export default function AdminSystemNoticeTab({ siteConfigs, setSiteConfigs, onSubmit, footerSlot, onSaveTemplates }: AdminSystemNoticeTabProps) {
    const { t } = useTheme();
    const { showConfirm } = useModalContext();
    const templates = useMemo(() => readSystemNoticeTemplates(siteConfigs.system_notice_templates), [siteConfigs.system_notice_templates]);
    const [templateName, setTemplateName] = useState('');
    const formId = useId();
    const set = (key: string, value: string) => setSiteConfigs(prev => ({ ...prev, [key]: value }));
    const linkUrl = siteConfigs.system_notice_link_url || '';
    const linkError = linkUrl.trim() !== '' && !isSafeNoticeHref(linkUrl.trim()) ? t('systemNoticeLinkUrlInvalid') : undefined;
    // Previewed whether or not it is switched on — the admin drafts it first.
    const preview = useMemo(
        () => readSystemNotice({ ...siteConfigs, system_notice_enabled: 'true' }),
        [siteConfigs],
    );

    // A template only fills the form: switching the notice on and saving stay
    // the admin's own steps, so nothing goes out by picking one.
    const applyTemplate = (tpl: SystemNoticeTemplate) => setSiteConfigs(prev => ({
        ...prev,
        system_notice_title: tpl.title,
        system_notice_text: tpl.text,
        system_notice_tone: tpl.tone,
        system_notice_dismissible: tpl.dismissible ? 'true' : 'false',
        system_notice_link_url: tpl.linkUrl,
        system_notice_link_label: tpl.linkLabel,
    }));

    const deleteTemplate = async (tpl: SystemNoticeTemplate) => {
        if (!await showConfirm(t('systemNoticeTemplateDeleteConfirm').replace('{{name}}', tpl.name))) return;
        await onSaveTemplates(templates.filter(other => other !== tpl));
    };

    const trimmedName = templateName.trim();
    const replacesTemplate = hasSystemNoticeTemplateNamed(templates, trimmedName);
    const atLimit = templates.length >= SYSTEM_NOTICE_TEMPLATES_MAX && !replacesTemplate;
    const canSaveTemplate = trimmedName !== '' && (siteConfigs.system_notice_text || '').trim() !== '' && !linkError && !atLimit;
    const saveTemplate = async () => {
        if (!canSaveTemplate) return;
        const tone = siteConfigs.system_notice_tone;
        const saved = await onSaveTemplates(upsertSystemNoticeTemplate(templates, {
            name: trimmedName,
            title: (siteConfigs.system_notice_title || '').trim(),
            text: (siteConfigs.system_notice_text || '').trim(),
            tone: (SYSTEM_NOTICE_TONES as readonly string[]).includes(tone ?? '') ? tone as SystemNoticeTone : 'info',
            dismissible: siteConfigs.system_notice_dismissible === 'true',
            linkUrl: linkUrl.trim(),
            linkLabel: (siteConfigs.system_notice_link_label || '').trim(),
        }));
        if (saved) setTemplateName('');
    };

    return (
        <form id={formId} onSubmit={onSubmit} className="flex flex-col gap-6">
            <PanelSection title={t('systemNoticeTemplates')}>
                <p className="m-0 mb-3 text-sm text-on-surface-variant">{t('systemNoticeTemplatesHelp')}</p>
                {templates.length === 0 ? (
                    <p className="m-0 text-sm text-on-surface-variant">{t('systemNoticeTemplatesEmpty')}</p>
                ) : (
                    <ul className="m-0 flex list-none flex-col gap-1 p-0">
                        {templates.map(tpl => (
                            <li key={tpl.name} className="flex items-center gap-3 rounded-[var(--ui-radius-row)] px-3 py-2 hover:bg-surface-container">
                                <div className="flex min-w-0 flex-1 flex-col">
                                    <span className="truncate text-sm font-medium text-on-surface">{tpl.name}</span>
                                    <span className="truncate text-xs text-on-surface-variant">
                                        {t(TONE_LABEL_KEYS[tpl.tone])} · {tpl.title ? `${tpl.title} · ` : ''}{tpl.text}
                                    </span>
                                </div>
                                <Button type="button" variant="outline" size="sm" onClick={() => applyTemplate(tpl)}>
                                    {t('systemNoticeTemplateApply')}
                                </Button>
                                <Button
                                    type="button"
                                    variant="ghost"
                                    size="icon"
                                    aria-label={t('systemNoticeTemplateDelete').replace('{{name}}', tpl.name)}
                                    title={t('systemNoticeTemplateDelete').replace('{{name}}', tpl.name)}
                                    onClick={() => void deleteTemplate(tpl)}
                                >
                                    <Trash2 size={16} aria-hidden="true" />
                                </Button>
                            </li>
                        ))}
                    </ul>
                )}
            </PanelSection>

            <div className="flex flex-col gap-5">
                <CheckboxFieldRow
                    width="wide"
                    label={t('systemNoticeEnabled')}
                    help={t('systemNoticeEnabledHelp')}
                    checked={siteConfigs.system_notice_enabled === 'true'}
                    onCheckedChange={checked => set('system_notice_enabled', checked ? 'true' : 'false')}
                />
                <FieldRow
                    width="wide"
                    label={t('systemNoticeTitle')}
                    help={t('systemNoticeTitleHelp')}
                    type="text"
                    value={siteConfigs.system_notice_title || ''}
                    onChange={e => set('system_notice_title', e.target.value)}
                    placeholder={t('systemNoticeTitlePlaceholder')}
                    maxLength={LABEL_MAX}
                />
                <TextareaFieldRow
                    width="wide"
                    label={t('systemNoticeText')}
                    value={siteConfigs.system_notice_text || ''}
                    onChange={e => set('system_notice_text', e.target.value)}
                    placeholder={t('systemNoticeTextPlaceholder')}
                    maxLength={TEXT_MAX}
                    rows={3}
                />
                <SelectFieldRow
                    label={t('systemNoticeTone')}
                    help={t('systemNoticeToneHelp')}
                    value={siteConfigs.system_notice_tone || 'info'}
                    onValueChange={value => set('system_notice_tone', value)}
                    options={SYSTEM_NOTICE_TONES.map(tone => ({ value: tone, label: t(TONE_LABEL_KEYS[tone]) }))}
                />
                <CheckboxFieldRow
                    width="wide"
                    label={t('systemNoticeDismissible')}
                    help={t('systemNoticeDismissibleHelp')}
                    checked={siteConfigs.system_notice_dismissible === 'true'}
                    onCheckedChange={checked => set('system_notice_dismissible', checked ? 'true' : 'false')}
                />
                <FieldRow
                    width="wide"
                    label={t('systemNoticeLinkUrl')}
                    help={t('systemNoticeLinkUrlHelp')}
                    type="text"
                    inputMode="url"
                    value={linkUrl}
                    onChange={e => set('system_notice_link_url', e.target.value)}
                    placeholder="https://"
                    error={linkError}
                />
                <FieldRow
                    width="wide"
                    label={t('systemNoticeLinkLabel')}
                    type="text"
                    value={siteConfigs.system_notice_link_label || ''}
                    onChange={e => set('system_notice_link_label', e.target.value)}
                    placeholder={t('systemNoticeLinkDefault')}
                    maxLength={LABEL_MAX}
                />
                <div className="flex flex-col gap-2">
                    <p className="m-0 text-sm font-medium text-on-surface">{t('systemNoticePreview')}</p>
                    {preview ? (
                        // The close button is shown when the message is closable, and does nothing here.
                        <SystemNoticeAlert notice={preview} live="off" onDismiss={preview.dismissible ? () => {} : undefined} />
                    ) : (
                        <p className="m-0 text-sm text-on-surface-variant">{t('systemNoticePreviewEmpty')}</p>
                    )}
                </div>
                <FieldRow
                    width="wide"
                    label={t('systemNoticeTemplateName')}
                    help={t('systemNoticeTemplateNameHelp')}
                    type="text"
                    value={templateName}
                    onChange={e => setTemplateName(e.target.value)}
                    // Enter here saves the template, not the whole form (which would publish the notice).
                    onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); void saveTemplate(); } }}
                    maxLength={SYSTEM_NOTICE_TEMPLATE_NAME_MAX}
                    error={atLimit ? t('systemNoticeTemplatesLimit') : undefined}
                    footer={(
                        <div className="mt-2 flex flex-wrap items-center gap-3">
                            <Button type="button" variant="outline" size="sm" disabled={!canSaveTemplate} onClick={() => void saveTemplate()}>
                                <BookmarkPlus size={16} aria-hidden="true" /> {t('systemNoticeTemplateSave')}
                            </Button>
                            {replacesTemplate && (
                                <span className="text-xs text-on-surface-variant">{t('systemNoticeTemplateReplaces')}</span>
                            )}
                        </div>
                    )}
                />
            </div>

            <FooterActions slot={footerSlot}>
                <Button type="submit" form={formId} disabled={Boolean(linkError)}>
                    <Save size={18} aria-hidden="true" /> {t('saveSettings')}
                </Button>
            </FooterActions>
        </form>
    );
}

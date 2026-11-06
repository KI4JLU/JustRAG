import { useId, useMemo } from 'react';
import { Save } from 'lucide-react';
import {
    Badge, Button, Card, Input, Label, SegmentedControl, SelectableCard, SelectableCardGroup, Separator,
    SettingsRow, Switch, Textarea, cn,
} from '@ki4jlu/design-system';
import { useTheme } from '../../contexts/ThemeContext';
import { COMPACT_INPUT, COMPACT_TEXTAREA } from '../form/SettingsFieldRow';
import { FooterActions } from './FooterActions';
import { NoticePreviewFrame, PlacementThumb, TemplatePicker, ToneDot, type SystemNoticeDraft } from './SystemNoticeEditorParts';
import { PLACEMENT_HELP_KEYS, PLACEMENT_LABEL_KEYS, POSITION_KEYS, TONE_LABEL_KEYS } from './systemNoticeLabels';
import {
    SYSTEM_NOTICE_PLACEMENTS, SYSTEM_NOTICE_TONES, isSafeNoticeHref, isSystemNoticePlacement, readSystemNotice, systemNoticePlacement,
    type SystemNoticeTone,
} from '../../utils/systemNotice';
import { readSystemNoticeTemplates, type SystemNoticeTemplate } from '../../utils/systemNoticeTemplates';

/** The server's limits (siteconfig/system_notice.go); `maxLength` counts UTF-16 units, close enough for a form hint. */
const TEXT_MAX = 1000;
const LABEL_MAX = 80;

/** The order the type picker shows. */
const TONE_ORDER: readonly SystemNoticeTone[] = ['info', 'warning', 'error', 'neutral'];

const FIELD_LABEL = 'm-0 text-sm font-medium text-on-surface';
const FIELD_HELP = 'm-0 text-sm text-on-surface-variant';

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
 * „Systemmeldung": one message every user sees on every page (site_config
 * `system_notice_*`). Its own section rather than part of „Einstellungen",
 * because admins edit it too — it saves through `PUT /api/admin/system-notice`,
 * which writes these keys only.
 *
 * Top to bottom: whether it is shown; the message — its type (colour and
 * icon), its placement, title, text, link and whether users can close it,
 * with the templates beside the title; then a preview of the app with the
 * notice where it will sit. The preview is the shell's own component, so what
 * the admin sees is what users get. Nothing reaches users before Speichern.
 */
export default function AdminSystemNoticeTab({ siteConfigs, setSiteConfigs, onSubmit, footerSlot, onSaveTemplates }: AdminSystemNoticeTabProps) {
    const { t } = useTheme();
    const formId = useId();
    const id = useId();
    const ids = {
        enabled: `${id}-enabled`, enabledHelp: `${id}-enabled-help`, tone: `${id}-tone`, toneHelp: `${id}-tone-help`,
        placement: `${id}-placement`, title: `${id}-title`, titleHelp: `${id}-title-help`, template: `${id}-template`,
        text: `${id}-text`, linkUrl: `${id}-link-url`, linkLabel: `${id}-link-label`, linkHelp: `${id}-link-help`,
    };
    const set = (key: string, value: string) => setSiteConfigs(prev => ({ ...prev, [key]: value }));

    const enabled = siteConfigs.system_notice_enabled === 'true';
    const rawTone = siteConfigs.system_notice_tone ?? '';
    const tone: SystemNoticeTone = (SYSTEM_NOTICE_TONES as readonly string[]).includes(rawTone) ? rawTone as SystemNoticeTone : 'info';
    // Until the admin picks one, the placement follows the type — as it does on users' screens.
    const placement = systemNoticePlacement(tone, siteConfigs.system_notice_placement);
    const linkUrl = siteConfigs.system_notice_link_url || '';
    const linkError = linkUrl.trim() !== '' && !isSafeNoticeHref(linkUrl.trim()) ? t('systemNoticeLinkUrlInvalid') : undefined;
    const text = (siteConfigs.system_notice_text || '').trim();

    // Previewed whether or not it is switched on — the admin drafts it first.
    const preview = useMemo(
        () => readSystemNotice({ ...siteConfigs, system_notice_enabled: 'true' }),
        [siteConfigs],
    );
    const shown = enabled && preview !== null;

    const templates = useMemo(() => readSystemNoticeTemplates(siteConfigs.system_notice_templates), [siteConfigs.system_notice_templates]);
    const draft: SystemNoticeDraft | null = text === '' || linkError ? null : {
        title: (siteConfigs.system_notice_title || '').trim(),
        text,
        tone,
        // The admin's choice, or none: a template saved without one keeps following its tone.
        placement: isSystemNoticePlacement(siteConfigs.system_notice_placement) ? siteConfigs.system_notice_placement : '',
        dismissible: siteConfigs.system_notice_dismissible === 'true',
        linkUrl: linkUrl.trim(),
        linkLabel: (siteConfigs.system_notice_link_label || '').trim(),
    };
    const applyTemplate = (tpl: SystemNoticeTemplate) => setSiteConfigs(prev => ({
        ...prev,
        system_notice_title: tpl.title,
        system_notice_text: tpl.text,
        system_notice_tone: tpl.tone,
        system_notice_placement: tpl.placement,
        system_notice_dismissible: tpl.dismissible ? 'true' : 'false',
        system_notice_link_url: tpl.linkUrl,
        system_notice_link_label: tpl.linkLabel,
    }));

    return (
        <form id={formId} onSubmit={onSubmit} className="flex flex-col gap-6 pb-2">
            <p className={cn(FIELD_HELP, '-mt-4')}>{t('systemNoticeIntro')}</p>

            <Card className="flex items-center gap-4 px-5 py-4">
                <span
                    aria-hidden="true"
                    className={cn('size-2.5 shrink-0 rounded-full ring-4', enabled ? 'bg-success ring-success/20' : 'bg-outline ring-outline/20')}
                />
                <div className="min-w-0 flex-1">
                    <p id={ids.enabled} className="m-0 text-[15px] font-semibold text-on-surface">{t('systemNoticeEnabled')}</p>
                    <p id={ids.enabledHelp} className={cn(FIELD_HELP, 'mt-0.5')}>
                        {enabled ? t('systemNoticeEnabledOn') : t('systemNoticeEnabledOff')}
                    </p>
                </div>
                <Switch
                    checked={enabled}
                    onCheckedChange={checked => set('system_notice_enabled', checked ? 'true' : 'false')}
                    aria-labelledby={ids.enabled}
                    aria-describedby={ids.enabledHelp}
                />
            </Card>

            <Card className="flex flex-col gap-6 p-6">
                <h3 className="m-0 text-base font-semibold text-on-surface">{t('systemNoticeEdit')}</h3>

                <div className="flex flex-col gap-2">
                    <p id={ids.tone} className={FIELD_LABEL}>{t('systemNoticeTone')}</p>
                    <SegmentedControl
                        aria-labelledby={ids.tone}
                        aria-describedby={ids.toneHelp}
                        value={tone}
                        onValueChange={value => set('system_notice_tone', value)}
                        options={TONE_ORDER.map(option => ({
                            value: option,
                            label: t(TONE_LABEL_KEYS[option]),
                            icon: <ToneDot tone={option} />,
                            showLabel: true,
                        }))}
                        className="flex w-full [&>button]:flex-1"
                    />
                    <p id={ids.toneHelp} className={FIELD_HELP}>{t('systemNoticeToneHelp')}</p>
                </div>

                <div className="flex flex-col gap-2">
                    <p id={ids.placement} className={FIELD_LABEL}>{t('systemNoticePlacement')}</p>
                    <SelectableCardGroup
                        aria-labelledby={ids.placement}
                        value={placement}
                        onValueChange={value => set('system_notice_placement', value)}
                        className="grid-cols-1 gap-3 sm:grid-cols-3"
                    >
                        {SYSTEM_NOTICE_PLACEMENTS.map(option => (
                            <SelectableCard
                                key={option}
                                value={option}
                                // A click on the card the type already implies stores it too (the
                                // group reports no change for it), so the choice stays put when the
                                // type changes later.
                                onClick={() => set('system_notice_placement', option)}
                                className="flex-row items-center gap-3 p-3"
                            >
                                <PlacementThumb placement={option} tone={tone} />
                                <span className="flex min-w-0 flex-col">
                                    <span className="text-sm font-medium text-on-surface">{t(PLACEMENT_LABEL_KEYS[option])}</span>
                                    <span className="text-xs text-on-surface-variant">{t(PLACEMENT_HELP_KEYS[option])}</span>
                                </span>
                            </SelectableCard>
                        ))}
                    </SelectableCardGroup>
                </div>

                <div className="flex flex-col gap-2">
                    <div className="grid gap-4 sm:grid-cols-[3fr_2fr]">
                        <div className="flex min-w-0 flex-col gap-2">
                            <Label htmlFor={ids.title}>{t('systemNoticeTitle')} <span className="font-normal text-on-surface-variant">{t('systemNoticeOptional')}</span></Label>
                            <Input
                                id={ids.title}
                                className={COMPACT_INPUT}
                                value={siteConfigs.system_notice_title || ''}
                                onChange={e => set('system_notice_title', e.target.value)}
                                placeholder={t('systemNoticeTitlePlaceholder')}
                                maxLength={LABEL_MAX}
                                aria-describedby={ids.titleHelp}
                            />
                        </div>
                        <div className="flex min-w-0 flex-col gap-2">
                            <Label htmlFor={ids.template}>{t('systemNoticeTemplate')}</Label>
                            <TemplatePicker
                                id={ids.template}
                                templates={templates}
                                draft={draft}
                                onApply={applyTemplate}
                                onSaveTemplates={onSaveTemplates}
                            />
                        </div>
                    </div>
                    <p id={ids.titleHelp} className={FIELD_HELP}>{t('systemNoticeTitleHelp')}</p>
                </div>

                <div className="flex flex-col gap-2">
                    <Label htmlFor={ids.text}>{t('systemNoticeText')}</Label>
                    <Textarea
                        id={ids.text}
                        className={COMPACT_TEXTAREA}
                        rows={3}
                        value={siteConfigs.system_notice_text || ''}
                        onChange={e => set('system_notice_text', e.target.value)}
                        placeholder={t('systemNoticeTextPlaceholder')}
                        maxLength={TEXT_MAX}
                    />
                </div>

                <fieldset className="m-0 flex min-w-0 flex-col gap-2 border-0 p-0">
                    <legend className={cn(FIELD_LABEL, 'mb-2 p-0')}>
                        {t('systemNoticeLink')} <span className="font-normal text-on-surface-variant">{t('systemNoticeOptional')}</span>
                    </legend>
                    <div className="grid gap-4 sm:grid-cols-[7fr_4fr]">
                        <div className="flex min-w-0 flex-col gap-1.5">
                            <Label htmlFor={ids.linkUrl} className="font-normal text-on-surface-variant">{t('systemNoticeLinkUrl')}</Label>
                            <Input
                                id={ids.linkUrl}
                                className={COMPACT_INPUT}
                                type="text"
                                inputMode="url"
                                value={linkUrl}
                                onChange={e => set('system_notice_link_url', e.target.value)}
                                placeholder="https://"
                                aria-invalid={linkError ? true : undefined}
                                aria-describedby={ids.linkHelp}
                            />
                        </div>
                        <div className="flex min-w-0 flex-col gap-1.5">
                            <Label htmlFor={ids.linkLabel} className="font-normal text-on-surface-variant">{t('systemNoticeLinkLabel')}</Label>
                            <Input
                                id={ids.linkLabel}
                                className={COMPACT_INPUT}
                                value={siteConfigs.system_notice_link_label || ''}
                                onChange={e => set('system_notice_link_label', e.target.value)}
                                placeholder={t('systemNoticeLinkDefault')}
                                maxLength={LABEL_MAX}
                            />
                        </div>
                    </div>
                    {linkError
                        ? <p id={ids.linkHelp} role="alert" className="m-0 text-sm text-error">{linkError}</p>
                        : <p id={ids.linkHelp} className={FIELD_HELP}>{t('systemNoticeLinkUrlHelp')}</p>}
                </fieldset>

                <Separator />
                <SettingsRow
                    className="py-0"
                    label={t('systemNoticeDismissible')}
                    description={t('systemNoticeDismissibleHelp')}
                    control={(
                        <Switch
                            checked={siteConfigs.system_notice_dismissible === 'true'}
                            onCheckedChange={checked => set('system_notice_dismissible', checked ? 'true' : 'false')}
                            aria-label={t('systemNoticeDismissible')}
                        />
                    )}
                />
            </Card>

            <Card className="flex flex-col gap-4 p-6">
                <div className="flex items-center justify-between gap-3">
                    <h3 className="m-0 text-base font-semibold text-on-surface">{t('systemNoticePreview')}</h3>
                    <Badge tone={shown ? 'success' : 'neutral'}>{shown ? t('systemNoticePreviewShown') : t('systemNoticePreviewOff')}</Badge>
                </div>
                {preview ? (
                    <>
                        <NoticePreviewFrame notice={preview} />
                        <p className={FIELD_HELP}>{t(POSITION_KEYS[preview.placement])}</p>
                    </>
                ) : (
                    <p className={FIELD_HELP}>{t('systemNoticePreviewEmpty')}</p>
                )}
            </Card>

            <FooterActions slot={footerSlot}>
                <span className="self-center text-sm text-on-surface-variant">{t('systemNoticeSaveHint')}</span>
                <Button type="submit" form={formId} disabled={Boolean(linkError)}>
                    <Save size={18} aria-hidden="true" /> {t('saveSettings')}
                </Button>
            </FooterActions>
        </form>
    );
}

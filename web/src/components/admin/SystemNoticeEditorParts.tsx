import { useId, useState } from 'react';
import { Bookmark, ChevronDown, Trash2 } from 'lucide-react';
import {
    Button, Input, Label, Popover, PopoverContent, PopoverTrigger, Separator, cn,
} from '@ki4jlu/design-system';
import { useTheme } from '../../contexts/ThemeContext';
import { useModalContext } from '../../contexts/ModalContext';
import { COMPACT_INPUT } from '../form/SettingsFieldRow';
import { SystemNoticeAlert } from '../SystemNotice';
import { systemNoticePlacement, type SystemNotice, type SystemNoticePlacement, type SystemNoticeTone } from '../../utils/systemNotice';
import { PLACEMENT_LABEL_KEYS, TONE_LABEL_KEYS } from './systemNoticeLabels';
import {
    SYSTEM_NOTICE_TEMPLATES_MAX, SYSTEM_NOTICE_TEMPLATE_NAME_MAX, hasSystemNoticeTemplateNamed,
    upsertSystemNoticeTemplate, type SystemNoticeTemplate,
} from '../../utils/systemNoticeTemplates';

/*
 * The pieces of the admin's „Systemmeldung" section (AdminSystemNoticeTab):
 * the tone dot, the placement thumbnails, the preview frame and the template
 * picker.
 */

/** Each tone's own colour, for the dots and the thumbnails (the banner's solid fill). */
const TONE_FILL: Record<SystemNoticeTone, string> = {
    info: 'bg-info',
    warning: 'bg-warning',
    error: 'bg-error',
    neutral: 'bg-outline',
};

/** The tone as a coloured dot beside its name. Decorative: the name says it. */
export function ToneDot({ tone, className }: { tone: SystemNoticeTone; className?: string }) {
    return <span aria-hidden="true" className={cn('inline-block size-2 shrink-0 rounded-full', TONE_FILL[tone], className)} />;
}

/**
 * A placement drawn small: a window with the notice where it will sit, in the
 * tone's colour — a bar across the top, a short bar at the top of the content,
 * or a block in the bottom-right corner.
 */
export function PlacementThumb({ placement, tone }: { placement: SystemNoticePlacement; tone: SystemNoticeTone }) {
    const fill = TONE_FILL[tone];
    return (
        <span
            aria-hidden="true"
            className="relative block h-10 w-14 shrink-0 overflow-hidden rounded-md border border-outline-variant bg-canvas"
        >
            {placement === 'banner' && <span className={cn('absolute inset-x-0 top-0 h-2', fill)} />}
            {placement === 'inline' && <span className={cn('absolute top-2 left-1/2 h-1.5 w-8 -translate-x-1/2 rounded-full', fill)} />}
            {placement === 'toast' && <span className={cn('absolute right-1.5 bottom-1.5 h-2.5 w-5 rounded-sm', fill)} />}
        </span>
    );
}

/** A placeholder line of the preview's pretend page. */
function Line({ className }: { className: string }) {
    return <span className={cn('block h-2 rounded-full bg-surface-container-high', className)} />;
}

/**
 * The notice inside a small drawing of the app — side column and page — at the
 * place it will take: the banner across the top of everything, the small
 * message at the top of the page, or the card in the page's bottom-right
 * corner. The notice itself is the shell's own component, so its look is the
 * real one. Its close button is shown when the notice is closable, and does
 * nothing here.
 */
export function NoticePreviewFrame({ notice }: { notice: SystemNotice }) {
    const alert = <SystemNoticeAlert notice={notice} live="off" onDismiss={notice.dismissible ? () => {} : undefined} />;
    return (
        <div
            data-placement={notice.placement}
            className="flex min-h-60 flex-col overflow-hidden rounded-lg border border-outline-variant bg-canvas"
        >
            {notice.placement === 'banner' && alert}
            <div className="flex min-h-0 flex-1">
                <div aria-hidden="true" className="flex w-24 shrink-0 flex-col gap-2 border-r border-outline-variant p-3">
                    <Line className="w-16" />
                    <Line className="w-10" />
                    <Line className="w-12" />
                </div>
                <div className="flex min-w-0 flex-1 flex-col gap-3 p-4">
                    {notice.placement === 'inline' && <div className="flex justify-center">{alert}</div>}
                    <div aria-hidden="true" className="flex flex-col gap-2.5">
                        <Line className="w-2/5" />
                        <Line className="w-4/5" />
                        <Line className="w-3/5" />
                    </div>
                    {notice.placement === 'toast' && <div className="mt-auto w-full max-w-sm self-end pt-3">{alert}</div>}
                </div>
            </div>
        </div>
    );
}

/** The form as a template, without a name yet. */
export type SystemNoticeDraft = Omit<SystemNoticeTemplate, 'name'>;

interface TemplatePickerProps {
    /** Id for the trigger, so the field's label names it. */
    id: string;
    templates: SystemNoticeTemplate[];
    /** The current form, or null while it cannot be saved as a template (no text, a bad link). */
    draft: SystemNoticeDraft | null;
    onApply: (template: SystemNoticeTemplate) => void;
    /** Stores the whole list at once; resolves false when that failed. */
    onSaveTemplates: (templates: SystemNoticeTemplate[]) => Promise<boolean>;
}

/**
 * „Vorlage wählen …": a list of the saved templates — picking one fills the
 * form, the bin deletes it — and under it a field to save the current form as
 * one. A popover rather than a select, because its rows carry a second button
 * and its foot a text field, which a listbox cannot hold.
 *
 * Picking only fills the form: switching the notice on and saving stay the
 * admin's own steps, so nothing goes out by picking one. Saving or deleting a
 * template stores the list at once, apart from the notice being edited.
 */
export function TemplatePicker({ id, templates, draft, onApply, onSaveTemplates }: TemplatePickerProps) {
    const { t } = useTheme();
    const { showConfirm } = useModalContext();
    const [open, setOpen] = useState(false);
    const [name, setName] = useState('');
    const nameId = useId();
    const limitId = useId();

    const trimmed = name.trim();
    const replaces = hasSystemNoticeTemplateNamed(templates, trimmed);
    const atLimit = templates.length >= SYSTEM_NOTICE_TEMPLATES_MAX && !replaces;
    const canSave = trimmed !== '' && draft !== null && !atLimit;

    const save = async () => {
        if (!canSave || !draft) return;
        if (await onSaveTemplates(upsertSystemNoticeTemplate(templates, { ...draft, name: trimmed }))) setName('');
    };

    const remove = async (tpl: SystemNoticeTemplate) => {
        if (!await showConfirm(t('systemNoticeTemplateDeleteConfirm').replace('{{name}}', tpl.name))) return;
        await onSaveTemplates(templates.filter(other => other !== tpl));
    };

    return (
        <Popover open={open} onOpenChange={setOpen}>
            <PopoverTrigger asChild>
                <Button
                    id={id}
                    type="button"
                    variant="outline"
                    size="sm"
                    // No press shrink (`active:scale-95`): on a full-width field it reads as a squish.
                    className="h-9 w-full justify-between font-normal text-on-surface-variant active:scale-100"
                >
                    <span className="truncate text-sm">{t('systemNoticeTemplatePick')}</span>
                    <ChevronDown size={16} aria-hidden="true" />
                </Button>
            </PopoverTrigger>
            {/* Never taller than the room the popover has: the list scrolls, the save field stays in view. */}
            <PopoverContent
                align="end"
                className="flex max-h-[var(--radix-popover-content-available-height)] w-[min(36rem,calc(100vw-2rem))] flex-col p-2"
            >
                {templates.length === 0 ? (
                    <p className="m-0 px-3 py-2 text-sm text-on-surface-variant">{t('systemNoticeTemplatesEmpty')}</p>
                ) : (
                    <ul className="m-0 flex min-h-0 list-none flex-col gap-0.5 overflow-y-auto p-0">
                        {templates.map(tpl => (
                            <li key={tpl.name} className="flex items-center gap-1">
                                <Button
                                    type="button"
                                    variant="ghost"
                                    size="sm"
                                    className="h-auto min-w-0 flex-1 justify-start gap-3 text-left font-normal active:scale-100"
                                    onClick={() => { onApply(tpl); setOpen(false); }}
                                >
                                    <ToneDot tone={tpl.tone} />
                                    <span className="flex min-w-0 flex-col">
                                        <span className="truncate text-sm font-medium text-on-surface">{tpl.name}</span>
                                        <span className="truncate text-xs text-on-surface-variant">
                                            {t(TONE_LABEL_KEYS[tpl.tone])} · {t(PLACEMENT_LABEL_KEYS[systemNoticePlacement(tpl.tone, tpl.placement)])} · {tpl.text}
                                        </span>
                                    </span>
                                </Button>
                                <Button
                                    type="button"
                                    variant="ghost"
                                    size="icon"
                                    aria-label={t('systemNoticeTemplateDelete').replace('{{name}}', tpl.name)}
                                    title={t('systemNoticeTemplateDelete').replace('{{name}}', tpl.name)}
                                    onClick={() => void remove(tpl)}
                                >
                                    <Trash2 size={16} aria-hidden="true" />
                                </Button>
                            </li>
                        ))}
                    </ul>
                )}
                <Separator className="my-2 shrink-0" />
                <div className="flex shrink-0 flex-col gap-2 px-2 pb-1">
                    <Label htmlFor={nameId}>{t('systemNoticeTemplateName')}</Label>
                    <div className="flex gap-2">
                        <Input
                            id={nameId}
                            className={COMPACT_INPUT}
                            value={name}
                            onChange={e => setName(e.target.value)}
                            // Enter saves the template, not the form around it (which would publish the notice).
                            onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); void save(); } }}
                            placeholder={t('systemNoticeTemplateNamePlaceholder')}
                            maxLength={SYSTEM_NOTICE_TEMPLATE_NAME_MAX}
                            aria-invalid={atLimit ? true : undefined}
                            aria-describedby={atLimit || replaces ? limitId : undefined}
                        />
                        <Button
                            type="button"
                            variant="outline"
                            className="h-9 shrink-0"
                            disabled={!canSave}
                            aria-label={t('systemNoticeTemplateSave')}
                            onClick={() => void save()}
                        >
                            <Bookmark size={16} aria-hidden="true" /> {t('systemNoticeTemplateSaveShort')}
                        </Button>
                    </div>
                    {atLimit ? (
                        <p id={limitId} role="alert" className="m-0 text-sm text-error">{t('systemNoticeTemplatesLimit')}</p>
                    ) : replaces ? (
                        <p id={limitId} className="m-0 text-xs text-on-surface-variant">{t('systemNoticeTemplateReplaces')}</p>
                    ) : null}
                </div>
            </PopoverContent>
        </Popover>
    );
}

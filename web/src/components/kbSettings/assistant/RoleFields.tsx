import { useId, useImperativeHandle, useRef } from 'react';
import { FileText, GripVertical, Sparkles } from 'lucide-react';
import { Button, Shimmer, Textarea, Input } from '@ki4jlu/design-system';
import { useTheme } from '../../../contexts/ThemeContext';
import type { SystemNames } from '../../../utils/systemNames';

/**
 * The fields of a role's edit screen, shared by the topic's role editor
 * (Verhalten) and the admin's template editor (Vorlagen › Rollen), so both
 * edit a role the same way.
 */

/** Name and description: the role's card text. */
export function RoleNameFields({ name, description, onName, onDescription, nameMax, descriptionMax, disabled, describe }: {
    name: string;
    description: string;
    onName: (name: string) => void;
    onDescription: (description: string) => void;
    nameMax?: number;
    descriptionMax: number;
    disabled?: boolean;
    /** The AI help that writes the description from name and prompt (needs a topic). */
    describe?: { busy: boolean; failed: boolean; canRun: boolean; run: () => void };
}) {
    const { t } = useTheme();
    const nameId = useId();
    const descId = useId();
    return (
        <>
            <div className="flex flex-col gap-1.5">
                <label htmlFor={nameId} className="text-sm font-medium text-on-surface">{t('asstName')}</label>
                <Input
                    id={nameId}
                    value={name}
                    maxLength={nameMax}
                    disabled={disabled}
                    placeholder={t('asstNamePlaceholder')}
                    onChange={(e) => onName(e.target.value)}
                />
            </div>
            <div className="flex flex-col gap-1.5">
                <div className="flex min-h-8 items-center justify-between gap-3">
                    <label htmlFor={descId} className="text-sm font-medium text-on-surface">{t('asstDescription')}</label>
                    {describe && (
                        <Button
                            variant="ghost"
                            size="sm"
                            disabled={describe.busy || !describe.canRun}
                            title={describe.canRun ? undefined : t('asstDescribeNeedsPrompt')}
                            onClick={describe.run}
                        >
                            <Sparkles className="size-4" aria-hidden="true" />
                            {describe.busy ? <Shimmer className="m-0">{t('asstDescribeBusy')}</Shimmer> : t('asstDescribe')}
                        </Button>
                    )}
                </div>
                {/* Shown under the role's name — in the role list and on the start page's role cards.
                    One line of text that wraps: the field grows with it, Enter adds no line break. */}
                <Textarea
                    id={descId}
                    rows={1}
                    className="min-h-0 resize-none field-sizing-content"
                    value={description}
                    maxLength={descriptionMax}
                    placeholder={t('asstRoleDescriptionPlaceholder')}
                    onKeyDown={(e) => { if (e.key === 'Enter') e.preventDefault(); }}
                    disabled={disabled || describe?.busy}
                    onChange={(e) => onDescription(e.target.value.replace(/\s*\n\s*/g, ' '))}
                />
                {describe?.failed && <p role="alert" className="m-0 text-sm text-error">{t('asstDescribeFailed')}</p>}
            </div>
        </>
    );
}

/** The name placeholders a role prompt may use (kbbehavior.Names fills them in). */
const NAME_PLACEHOLDERS = ['{{assistant_name}}', '{{system_name}}'] as const;

/**
 * The role prompt: its label with the length count, the field, and its name
 * placeholders as chips — dragged into the prompt, or clicked to insert them
 * at the cursor — with what they answer as: the deployment's names when
 * `names` is given (a topic's role), else where they are set (the admin's
 * templates).
 */
export function RolePromptField({ value, onChange, max, disabled, onInsertSkeleton, textareaRef, names }: {
    value: string;
    onChange: (prompt: string) => void;
    max: number;
    disabled?: boolean;
    /** Offered while the prompt is empty: fills in the prompt skeleton. */
    onInsertSkeleton?: () => void;
    textareaRef?: React.Ref<HTMLTextAreaElement>;
    names?: SystemNames;
}) {
    const { t } = useTheme();
    const promptId = useId();
    const hintId = useId();
    const field = useRef<HTMLTextAreaElement | null>(null);
    // Where the cursor was when the field lost focus — a click on a chip
    // takes the focus first. Never focused: the placeholder goes at the end.
    const caret = useRef<[number, number] | null>(null);
    useImperativeHandle(textareaRef, () => field.current as HTMLTextAreaElement, []);

    const insert = (token: string) => {
        const [start, end] = caret.current ?? [value.length, value.length];
        const from = Math.min(start, value.length);
        const next = value.slice(0, from) + token + value.slice(Math.min(Math.max(end, from), value.length));
        if (next.length > max) return;
        onChange(next);
        const at = from + token.length;
        caret.current = [at, at];
        requestAnimationFrame(() => {
            field.current?.focus();
            field.current?.setSelectionRange(at, at);
        });
    };

    return (
        <div className="flex flex-col gap-1.5">
            <div className="flex min-h-8 items-center justify-between gap-3">
                <label htmlFor={promptId} className="text-sm font-medium text-on-surface">{t('asstPrompt')}</label>
                <div className="flex items-center gap-3">
                    {onInsertSkeleton && !value.trim() && (
                        <Button variant="ghost" size="sm" onClick={onInsertSkeleton}>
                            <FileText className="size-4" aria-hidden="true" /> {t('asstInsertSkeleton')}
                        </Button>
                    )}
                    <span className="text-xs tabular-nums text-on-surface-variant">{value.length} / {max}</span>
                </div>
            </div>
            <Textarea
                ref={field}
                id={promptId}
                rows={14}
                maxLength={max}
                value={value}
                placeholder={t('asstPromptPlaceholder')}
                disabled={disabled}
                aria-describedby={hintId}
                onBlur={(e) => { caret.current = [e.currentTarget.selectionStart, e.currentTarget.selectionEnd]; }}
                onChange={(e) => onChange(e.target.value)}
            />
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5">
                {NAME_PLACEHOLDERS.map((token) => (
                    // A drop into the field is the browser's own: it inserts
                    // the text where the pointer is and fires an input event.
                    <Button
                        key={token}
                        variant="outline"
                        size="sm"
                        draggable={!disabled}
                        disabled={disabled}
                        aria-label={t('asstInsertPlaceholder').replace('{token}', token)}
                        className="cursor-grab active:cursor-grabbing"
                        data-testid="prompt-placeholder"
                        onDragStart={(e) => {
                            e.dataTransfer.setData('text/plain', token);
                            e.dataTransfer.effectAllowed = 'copy';
                        }}
                        onClick={() => insert(token)}
                    >
                        <GripVertical className="size-3.5" aria-hidden="true" /> <code>{token}</code>
                    </Button>
                ))}
                <p id={hintId} className="m-0 text-xs text-on-surface-variant">
                    {names
                        ? t('asstPromptNamesHint').replace('{assistant}', names.assistant).replace('{system}', names.system)
                        : t('asstPromptNamesHintAdmin')}
                </p>
            </div>
        </div>
    );
}

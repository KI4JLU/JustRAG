import { useId, useLayoutEffect, useRef, useState } from 'react';
import { Check, Copy, FileText, Info, Sparkles } from 'lucide-react';
import { BreadcrumbBack, Button, Input, Notice, Shimmer, Textarea } from '@ki4jlu/design-system';
import { useTheme } from '../../../contexts/ThemeContext';
import { defaultStart, describeRole, generateRolePrompt, NotAvailableError, reviseRolePrompt } from './api';
import { RoleStartEditor } from './ChatStartEditor';
import { RolePanelFrame } from './RolePreviewPanel';
import { IconTile } from './roles';
import { ROLE_DESC_MAX, editTarget, idleAi, type RoleEditor } from './roleEditor';
import type { RoleView } from './roleModel';
import { SystemPromptPanel } from './SystemPromptPanel';
import { useAssistantSettings } from './useAssistantSettings';

const SUGGESTION_KEYS = ['asstGenExample1', 'asstGenExample2', 'asstGenExample3', 'asstGenExample4', 'asstGenExample5'];

/**
 * The role prompt in the edit screen: the AI help above it — generate a
 * prompt from a description while there is none, revise the one there is by
 * an instruction — then the prompt itself.
 */
function PromptEditor({ kbId, topic, editor, setEditor, maxPrompt }: {
    kbId: string;
    /** The KB's name: context for the generated role. */
    topic: string;
    editor: RoleEditor;
    setEditor: (e: RoleEditor) => void;
    maxPrompt: number;
}) {
    const { t, language: uiLanguage } = useTheme();
    // The role prompt is written in the language the KB's prompt is compiled in.
    const language = useAssistantSettings().catalog?.language ?? uiLanguage;
    const promptId = useId();
    const promptRef = useRef<HTMLTextAreaElement>(null);
    const empty = !editor.prompt.trim();
    const { ai } = editor;

    const run = async (query: string) => {
        const q = query.trim();
        if (!q) return;
        // The fields so far stay: a failed run keeps them.
        const base = { ...editor, ai: { query, phase: 'busy' as const } };
        setEditor(base);
        try {
            if (empty) {
                const res = await generateRolePrompt(kbId, q, topic, language);
                // A new role takes the suggested name; an edited one keeps its own.
                setEditor({ ...base, name: base.name.trim() ? base.name : res.name, prompt: res.prompt, ai: idleAi });
            } else {
                const res = await reviseRolePrompt(kbId, base.prompt, q, language);
                setEditor({ ...base, prompt: res.prompt, ai: { ...idleAi, undo: base.prompt } });
            }
        } catch (err) {
            setEditor({ ...base, ai: { query, phase: err instanceof NotAvailableError ? 'unavailable' : 'error' } });
        }
    };

    return (
        <div className="mt-2 flex flex-col gap-3">
            <form
                className="flex flex-col gap-2 sm:flex-row"
                onSubmit={(e) => {
                    e.preventDefault();
                    void run(ai.query);
                }}
            >
                <Input
                    aria-label={empty ? t('asstGenLabel') : t('asstReviseLabel')}
                    value={ai.query}
                    disabled={ai.phase === 'busy'}
                    onChange={(e) => setEditor({ ...editor, ai: { ...ai, query: e.target.value } })}
                    placeholder={empty ? t('asstGenPlaceholder') : t('asstRevisePlaceholder')}
                    className="flex-1"
                />
                <Button type="submit" variant="outline" disabled={!ai.query.trim() || ai.phase === 'busy'}>
                    <Sparkles className="size-4" aria-hidden="true" /> {empty ? t('asstGenerate') : t('asstRevise')}
                </Button>
            </form>
            {empty && ai.phase !== 'busy' && (
                <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm text-on-surface-variant">{t('asstExamples')}</span>
                    {SUGGESTION_KEYS.map((k) => (
                        <Button key={k} variant="outline" size="sm" className="rounded-full" onClick={() => void run(t(k))}>
                            {t(k)}
                        </Button>
                    ))}
                </div>
            )}
            {ai.phase === 'busy' && (
                <div className="flex items-center gap-3 rounded-xl bg-surface-container px-4 py-3">
                    <IconTile icon="sparkles" size="sm" />
                    <Shimmer className="m-0 text-sm">{(empty ? t('asstGenBusy') : t('asstReviseBusy')).replace('{q}', ai.query.trim())}</Shimmer>
                </div>
            )}
            {ai.undo !== undefined && (
                <Notice tone="info" icon={<Check />}>
                    {t('asstRevised')}{' '}
                    <Button variant="link" size="sm" className="h-auto p-0 align-baseline" onClick={() => setEditor({ ...editor, prompt: ai.undo ?? editor.prompt, ai: idleAi })}>
                        {t('asstUndo')}
                    </Button>
                </Notice>
            )}
            {(ai.phase === 'unavailable' || ai.phase === 'error') && (
                <Notice tone="warning" icon={<Info />}>
                    {ai.phase === 'unavailable' ? t('asstGenUnavailable') : empty ? t('asstGenFailed') : t('asstReviseFailed')}
                </Notice>
            )}
            <div className="flex flex-col gap-1.5">
                <div className="flex min-h-8 items-center justify-between gap-3">
                    <label htmlFor={promptId} className="text-sm font-medium text-on-surface">{t('asstPrompt')}</label>
                    <div className="flex items-center gap-3">
                        {empty && (
                            <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => {
                                    setEditor({ ...editor, prompt: t('asstPromptSkeleton') });
                                    requestAnimationFrame(() => promptRef.current?.focus());
                                }}
                            >
                                <FileText className="size-4" aria-hidden="true" /> {t('asstInsertSkeleton')}
                            </Button>
                        )}
                        <span className="text-xs tabular-nums text-on-surface-variant">{editor.prompt.length} / {maxPrompt}</span>
                    </div>
                </div>
                <Textarea
                    ref={promptRef}
                    id={promptId}
                    rows={14}
                    maxLength={maxPrompt}
                    value={editor.prompt}
                    placeholder={t('asstPromptPlaceholder')}
                    disabled={ai.phase === 'busy'}
                    onChange={(e) => setEditor({ ...editor, prompt: e.target.value, ai: { ...ai, undo: undefined } })}
                />
            </div>
        </div>
    );
}

/**
 * „Neue Rolle" / „Als eigene Rolle kopieren" / „Bearbeiten": replaces the
 * Verhalten content (not a modal) with the role preview's layout, made
 * editable — name and description, how a chat in the role starts, the role
 * prompt with AI help and the role's own rules. A template's prompt and rules
 * are the system preset: shown, not editable (its start is). The dialog
 * footer switches to this view's own actions while it is open
 * (BehaviorSection renders them).
 */
export function RoleEditorView({
    kbId, editor, setEditor, onBack, onCopyTemplate, maxPrompt, cover, onStartPage, ragPrompt, dynamicSample, sampleLoading, onNewExample,
}: {
    kbId: string;
    editor: RoleEditor;
    setEditor: (e: RoleEditor) => void;
    onBack: () => void;
    /** A template: start an own copy of it instead. */
    onCopyTemplate?: () => void;
    maxPrompt: number;
    /** The role's cover band (a template's own). */
    cover: Pick<RoleView, 'cover'>;
    /** The role has a card on the start page. */
    onStartPage: boolean;
    ragPrompt: string | null;
    dynamicSample: string[];
    sampleLoading: boolean;
    onNewExample: () => void;
}) {
    const { t, language: uiLanguage } = useTheme();
    const { draft, catalog } = useAssistantSettings();
    const nameId = useId();
    const descId = useId();
    const [describing, setDescribing] = useState<'idle' | 'busy' | 'error'>('idle');
    // The description from the role's name and prompt, in the KB prompt's language.
    const describe = async () => {
        setDescribing('busy');
        try {
            const res = await describeRole(kbId, editor.name.trim(), editor.prompt, catalog?.language ?? uiLanguage);
            setEditor({ ...editor, description: res.description.slice(0, ROLE_DESC_MAX) });
            setDescribing('idle');
        } catch {
            setDescribing('error');
        }
    };
    const rootRef = useRef<HTMLDivElement>(null);
    // The view replaces the role list in place: it opens at its top, not at the list's scroll position.
    useLayoutEffect(() => {
        rootRef.current?.scrollIntoView?.({ block: 'start' });
    }, []);
    const editing = editTarget(editor);
    const template = editor.kind === 'template';
    const start = editor.start ?? defaultStart();
    const copyOf = editor.kind === 'new' ? editor.copyOf : undefined;

    const title = template ? t('asstEditorTemplateTitle').replace('{name}', editor.name)
        : editing ? t('asstEditorEditTitle')
            : copyOf ? t('asstEditorCopyTitle') : t('asstNewRole');
    const hint = template ? t('asstEditorTemplateHint')
        : editing ? t('asstEditorEditHint')
            : copyOf ? t('asstEditorCopyHint').replace('{name}', copyOf) : t('asstEditorNewHint');

    return (
        <div ref={rootRef} className="flex scroll-mt-6 flex-col gap-6 pt-2">
            <div className="flex flex-col gap-1">
                <BreadcrumbBack trail={[t('kbSettingsTabBehavior'), t('asstTabRole')]} onClick={onBack} />
                <h3 className="m-0 text-2xl font-semibold text-on-surface">{title}</h3>
                <p className="m-0 mt-1 text-sm text-on-surface-variant">{hint}</p>
            </div>

            {template && onCopyTemplate && (
                <Notice icon={<Info />}>
                    <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
                        {t('asstTemplateFixedNotice')}
                        <Button variant="link" size="sm" className="h-auto p-0" onClick={onCopyTemplate}>
                            <Copy className="size-4" aria-hidden="true" /> {t('asstCopyTemplate')}
                        </Button>
                    </span>
                </Notice>
            )}

            <RolePanelFrame
                label={title}
                role={cover}
                start={start}
                left={(
                    <div className="flex flex-col gap-4 px-6">
                        {template ? (
                            <div>
                                <h4 className="m-0 text-xl font-semibold leading-snug text-on-surface">{editor.name}</h4>
                                {editor.description && <p className="m-0 mt-1 text-sm leading-6 text-on-surface-variant">{editor.description}</p>}
                            </div>
                        ) : (
                            <>
                                <div className="flex flex-col gap-1.5">
                                    <label htmlFor={nameId} className="text-sm font-medium text-on-surface">{t('asstName')}</label>
                                    <Input
                                        id={nameId}
                                        value={editor.name}
                                        placeholder={t('asstNamePlaceholder')}
                                        onChange={(e) => setEditor({ ...editor, name: e.target.value })}
                                    />
                                </div>
                                <div className="flex flex-col gap-1.5">
                                    <div className="flex min-h-8 items-center justify-between gap-3">
                                        <label htmlFor={descId} className="text-sm font-medium text-on-surface">{t('asstDescription')}</label>
                                        <Button
                                            variant="ghost"
                                            size="sm"
                                            disabled={describing === 'busy' || !editor.prompt.trim()}
                                            title={editor.prompt.trim() ? undefined : t('asstDescribeNeedsPrompt')}
                                            onClick={() => void describe()}
                                        >
                                            <Sparkles className="size-4" aria-hidden="true" />
                                            {describing === 'busy' ? <Shimmer className="m-0">{t('asstDescribeBusy')}</Shimmer> : t('asstDescribe')}
                                        </Button>
                                    </div>
                                    {/* Shown under the role's name — in the role list and on the start page's role cards.
                                        One line of text that wraps: the field grows with it, Enter adds no line break. */}
                                    <Textarea
                                        id={descId}
                                        rows={1}
                                        className="min-h-0 resize-none field-sizing-content"
                                        value={editor.description}
                                        maxLength={ROLE_DESC_MAX}
                                        placeholder={t('asstRoleDescriptionPlaceholder')}
                                        onKeyDown={(e) => { if (e.key === 'Enter') e.preventDefault(); }}
                                        disabled={describing === 'busy'}
                                        onChange={(e) => setEditor({ ...editor, description: e.target.value.replace(/\s*\n\s*/g, ' ') })}
                                    />
                                    {describing === 'error' && <p role="alert" className="m-0 text-sm text-error">{t('asstDescribeFailed')}</p>}
                                </div>
                            </>
                        )}
                    </div>
                )}
                stage={(
                    // The start is edited right here; the chat image is the preview's (Verhalten), not the edit screen's.
                    <div className="flex flex-col gap-4 px-6 py-5">
                        <div className="flex flex-col">
                            <span className="text-base font-semibold text-on-surface">{t('asstRoleStartTitle')}</span>
                            <span className="text-sm text-on-surface-variant">{t('asstRoleStartSub')}</span>
                        </div>
                        <RoleStartEditor
                            start={start}
                            onChange={(fn) => setEditor({ ...editor, start: fn(editor.start ?? defaultStart()) })}
                            roleName={editor.name.trim() || t('asstAssistant')}
                            dynamicSample={dynamicSample}
                            sampleLoading={sampleLoading}
                            onNewExample={onNewExample}
                        />
                        {onStartPage && <p className="m-0 text-xs text-on-surface-variant">{t('asstRoleStartOnPage')}</p>}
                    </div>
                )}
                right={(
                    <SystemPromptPanel
                        prompt={editor.prompt}
                        template={template}
                        rules={editor.rules}
                        onRulesChange={template ? undefined : (fn) => setEditor({ ...editor, rules: fn(editor.rules) })}
                        promptEditor={template ? undefined : <PromptEditor kbId={kbId} topic={draft?.title ?? ''} editor={editor} setEditor={setEditor} maxPrompt={maxPrompt} />}
                        ragPrompt={ragPrompt}
                    />
                )}
            />
        </div>
    );
}

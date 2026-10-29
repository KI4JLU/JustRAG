import { useEffect, useId, useRef, useState } from 'react';
import {
    ArrowDown, ArrowUp, GripVertical, Info, Lightbulb, MessageSquareText, Pencil, Plus, RefreshCw,
    SendHorizontal, Sparkles, TextCursorInput, Trash2, Upload, X,
} from 'lucide-react';
import {
    ActionMenu, Badge, Button, Checkbox, DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuTrigger,
    Notice, SegmentedControl, Select, SelectContent, SelectItem, SelectTrigger, SelectValue, Shimmer, Switch, Textarea, cn,
} from '@ki4jlu/design-system';
import { useTheme } from '../../../contexts/ThemeContext';
import { Skeleton } from '../../Skeleton';
import {
    FIXED_QUESTION_MAX, INSTRUCTION_MAX_LEN, QUESTION_MAX_LEN, ROLE_ENTRY_MAX, UPLOAD_LABEL_MAX_LEN,
    suggestStarterQuestions, type EntryKind, type EntryStart, type RoleEntry, type StartMode, type StartPage, type Suggestions,
} from './api';
import { editableField } from './editInPlace';
import { newId, type RoleView } from './roleModel';
import { DEFAULT_ENTRY_ID, START_MODE_LABEL, colorsStyle, roleCardCover, startEntries, startOf } from './startPageModel';
import { ComposerPreview } from './ComposerPreview';
import { KindIcon } from './entryKinds';
import { AddCardTile } from './RoleTiles';
import { RoleCardFrame, UploadStart } from './StartPageParts';
import { useAssistantSettings } from './useAssistantSettings';

const chip = 'rounded-[var(--ui-radius-control)] border px-3 py-1.5 text-sm';
/** Widths of the skeleton chips shown while a sample is generated (up to 6). */
const SKELETON_WIDTHS = [260, 200, 320, 220, 280, 180];

function OffNote({ children }: { children: React.ReactNode }) {
    return <p className="m-0 rounded-xl border border-dashed border-outline-variant px-5 py-4 text-sm text-on-surface-variant">{children}</p>;
}

/**
 * The suggestions under an input field — off, dynamic or fixed chips: the
 * page's own („Eingabefeld") and each role card's („Rollenauswahl").
 */
function SuggestionsEditor({ value, onChange, dynamicSample, sampleLoading, onNewExample, fileCount, label }: {
    value: Suggestions;
    onChange: (fn: (s: Suggestions) => Suggestions) => void;
    dynamicSample: string[];
    /** A new sample is being generated: skeleton chips instead of the questions. */
    sampleLoading: boolean;
    onNewExample: () => void;
    fileCount: number;
    /** Names the controls of a role card's suggestions („… Tutor"). */
    label?: string;
}) {
    const { t, language } = useTheme();
    const store = useAssistantSettings();
    const ids = { count: useId(), sort: useId(), q: useId() };
    const [aiPhase, setAiPhase] = useState<'idle' | 'busy' | 'done' | 'error'>('idle');
    const [aiList, setAiList] = useState<string[]>([]);
    const [dragIndex, setDragIndex] = useState<number | null>(null);
    const focusIndex = useRef<number | null>(null);
    const qs = value.fixedQuestions;
    const full = qs.length >= FIXED_QUESTION_MAX;
    const dynamic = value.questionMode === 'dynamic';
    const named = (key: string) => (label ? `${t(key)} · ${label}` : t(key));

    useEffect(() => {
        const i = focusIndex.current;
        if (i === null) return;
        focusIndex.current = null;
        document.getElementById(`${ids.q}-${i}`)?.focus();
    });

    const setFixed = (fn: (q: string[]) => string[]) => onChange(v => ({ ...v, fixedQuestions: fn(v.fixedQuestions) }));
    const move = (from: number, to: number) => setFixed(list => {
        if (to < 0 || to >= list.length || from === to) return list;
        const next = [...list];
        const [item] = next.splice(from, 1);
        next.splice(to, 0, item);
        return next;
    });
    const add = (text = '') => {
        if (full) return;
        if (!text) focusIndex.current = qs.length;
        setFixed(list => [...list, text]);
    };
    const suggest = async () => {
        setAiPhase('busy');
        try {
            const found = await suggestStarterQuestions(store.kb.id, language);
            setAiList(found.filter(q => !qs.includes(q)));
            setAiPhase('done');
        } catch {
            setAiPhase('error');
        }
    };

    return (
        <div className="flex flex-col gap-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="flex flex-wrap items-center gap-2 text-sm font-medium text-on-surface">
                    <Lightbulb className="size-4 text-primary" aria-hidden="true" /> {t('asstSuggestions')}
                    {value.questionsOn && dynamic && <Badge tone="neutral">{t('asstExampleChanges')}</Badge>}
                </span>
                <span className="flex items-center gap-3">
                    {value.questionsOn && (
                        <SegmentedControl
                            variant="nav"
                            aria-label={named('asstQuestionsKind')}
                            value={value.questionMode}
                            onValueChange={(v) => {
                                if (v === 'fixed') {
                                    // No fixed questions yet: the shown example becomes the starting list.
                                    onChange(s => ({ ...s, questionMode: 'fixed', fixedQuestions: s.fixedQuestions.length ? s.fixedQuestions : dynamicSample.slice(0, Math.min(s.dynamicCount, FIXED_QUESTION_MAX)) }));
                                } else {
                                    onChange(s => ({ ...s, questionMode: 'dynamic' }));
                                    setAiPhase('idle');
                                }
                            }}
                            options={[
                                { value: 'dynamic', label: t('asstDynamic'), icon: <RefreshCw className="size-4" aria-hidden="true" />, showLabel: true },
                                { value: 'fixed', label: t('asstFixedMode'), icon: <Pencil className="size-4" aria-hidden="true" />, showLabel: true },
                            ]}
                        />
                    )}
                    <span className="flex items-center gap-2">
                        <span className="text-xs text-on-surface-variant">{value.questionsOn ? t('asstOn') : t('asstOff')}</span>
                        <Switch aria-label={named('asstQuestionsShow')} checked={value.questionsOn} onCheckedChange={(v) => onChange(s => ({ ...s, questionsOn: v }))} />
                    </span>
                </span>
            </div>

            {!value.questionsOn ? (
                <OffNote>
                    {t('asstQuestionsOff')}
                    {qs.length > 0 && ` ${t('asstFixedKeptN').replace('{n}', String(qs.length))}`}
                </OffNote>
            ) : dynamic ? (
                <>
                    {sampleLoading ? (
                        <ul className="m-0 flex list-none flex-wrap gap-2 p-0" aria-busy="true" aria-label={t('asstSampleLoading')}>
                            {SKELETON_WIDTHS.slice(0, value.dynamicCount).map((w, i) => (
                                <li key={i} aria-hidden="true"><Skeleton width={w} height={34} borderRadius="var(--ui-radius-control)" /></li>
                            ))}
                        </ul>
                    ) : dynamicSample.length > 0 ? (
                        <ul className="m-0 flex list-none flex-wrap gap-2 p-0">
                            {dynamicSample.slice(0, value.dynamicCount).map(q => (
                                <li key={q} className={cn(chip, 'border-outline-variant bg-surface-container-lowest text-on-surface')}>{q}</li>
                            ))}
                        </ul>
                    ) : (
                        <p className="m-0 text-sm text-on-surface-variant">{t('asstNoExample')}</p>
                    )}
                    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-on-surface-variant">
                        <span>{t('asstDynamicGenerates').replace('{n}', String(fileCount))}</span>
                        <span className="ml-auto flex items-center gap-2">
                            <span id={ids.count}>{t('asstCount')}</span>
                            <SegmentedControl
                                variant="nav"
                                aria-labelledby={ids.count}
                                value={String(value.dynamicCount)}
                                onValueChange={(v) => onChange(s => ({ ...s, dynamicCount: Number(v) as 3 | 4 | 6 }))}
                                options={[{ value: '3', label: '3' }, { value: '4', label: '4' }, { value: '6', label: '6' }]}
                            />
                            <Button variant="ghost" size="sm" onClick={onNewExample} disabled={sampleLoading || dynamicSample.length === 0}>
                                <RefreshCw className="size-4" aria-hidden="true" /> {t('asstNewExample')}
                            </Button>
                        </span>
                    </div>
                </>
            ) : (
                <>
                    <p id={ids.sort} className="sr-only">{t('asstSortKeysHint')}</p>
                    <ol className="m-0 flex list-none flex-wrap gap-2 p-0" aria-label={t('asstFixedQuestions')}>
                        {qs.map((q, i) => (
                            <li
                                // Index keys: the list is plain strings; focus follows a moved question by id.
                                key={i}
                                onDragOver={(e) => { if (dragIndex !== null) e.preventDefault(); }}
                                onDrop={() => { if (dragIndex !== null) move(dragIndex, i); setDragIndex(null); }}
                                className={cn(
                                    'group flex max-w-full items-center rounded-[var(--ui-radius-control)] border border-outline-variant bg-surface-container-lowest pl-0.5 pr-1 text-sm transition-opacity focus-within:border-primary focus-within:ring-1 focus-within:ring-primary',
                                    dragIndex === i && 'opacity-40',
                                )}
                            >
                                <span
                                    draggable
                                    onDragStart={(e) => { setDragIndex(i); e.dataTransfer.effectAllowed = 'move'; }}
                                    onDragEnd={() => setDragIndex(null)}
                                    aria-hidden="true"
                                    title={t('asstDragToSort')}
                                    className="flex h-7 w-5 shrink-0 cursor-grab items-center justify-center text-on-surface-variant opacity-40 group-hover:opacity-100 active:cursor-grabbing"
                                >
                                    <GripVertical className="size-3.5" />
                                </span>
                                {/* eslint-disable-next-line design-system/no-raw-ui-elements -- a borderless chip input that grows with its text (field-sizing); the DS Input is a full field */}
                                <input
                                    id={`${ids.q}-${i}`}
                                    aria-label={t('asstQuestionLabel').replace('{n}', String(i + 1))}
                                    aria-describedby={ids.sort}
                                    value={q}
                                    maxLength={QUESTION_MAX_LEN}
                                    placeholder={t('asstQuestionInputPlaceholder')}
                                    onChange={(e) => setFixed(list => list.map((x, j) => (j === i ? e.target.value : x)))}
                                    onKeyDown={(e) => {
                                        if (!e.altKey || (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight')) return;
                                        e.preventDefault();
                                        const to = i + (e.key === 'ArrowLeft' ? -1 : 1);
                                        if (to < 0 || to >= qs.length) return;
                                        focusIndex.current = to;
                                        move(i, to);
                                    }}
                                    className="min-w-32 max-w-full border-0 bg-transparent px-1 py-1.5 text-on-surface outline-none [field-sizing:content] placeholder:text-on-surface-variant"
                                />
                                {/* eslint-disable-next-line design-system/no-raw-ui-elements -- the chip's own small remove control */}
                                <button
                                    type="button"
                                    aria-label={t('asstRemoveQuestion').replace('{n}', String(i + 1))}
                                    onClick={() => setFixed(list => list.filter((_, j) => j !== i))}
                                    className="flex size-6 shrink-0 items-center justify-center rounded-full text-on-surface-variant hover:bg-surface-container-high hover:text-on-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
                                >
                                    <X className="size-3.5" aria-hidden="true" />
                                </button>
                            </li>
                        ))}
                        {!full && (
                            <li>
                                {/* eslint-disable-next-line design-system/no-raw-ui-elements -- a dashed add chip at the end of the chip list */}
                                <button
                                    type="button"
                                    onClick={() => add()}
                                    className={cn(chip, 'flex items-center gap-1.5 border-dashed border-outline text-on-surface-variant hover:border-primary hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring')}
                                >
                                    <Plus className="size-4" aria-hidden="true" /> {t('asstAddQuestionChip')}
                                </button>
                            </li>
                        )}
                    </ol>

                    {aiPhase === 'busy' && <Shimmer className="m-0 text-sm">{t('asstReadingDocs').replace('{n}', String(fileCount))}</Shimmer>}
                    {aiPhase === 'error' && <p className="m-0 text-sm text-error">{t('asstSuggestFailed')}</p>}
                    {aiPhase === 'done' && aiList.length > 0 && (
                        <div className="flex flex-col gap-2">
                            <span className="text-xs text-on-surface-variant">{t('asstSuggestionsPick')}</span>
                            <ul className="m-0 flex list-none flex-wrap gap-2 p-0">
                                {aiList.map(s => (
                                    <li key={s}>
                                        {/* eslint-disable-next-line design-system/no-raw-ui-elements -- a dashed suggestion chip that takes the question over */}
                                        <button
                                            type="button"
                                            disabled={full}
                                            onClick={() => { add(s); setAiList(l => l.filter(x => x !== s)); }}
                                            className={cn(chip, 'flex items-center gap-1.5 border-dashed border-primary bg-primary/5 text-on-surface hover:bg-primary/10 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring')}
                                        >
                                            <Plus className="size-4 text-primary" aria-hidden="true" /> {s}
                                        </button>
                                    </li>
                                ))}
                            </ul>
                        </div>
                    )}

                    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-on-surface-variant">
                        <span>{qs.length ? t('asstFixedFooter') : t('asstFixedEmpty')}</span>
                        <span className="ml-auto flex items-center gap-3">
                            <span className="text-xs tabular-nums">{qs.length} / {FIXED_QUESTION_MAX}</span>
                            <Button variant="ghost" size="sm" disabled={aiPhase === 'busy' || full} onClick={() => void suggest()}>
                                <Sparkles className="size-4" aria-hidden="true" /> {aiPhase === 'done' ? t('asstNewSuggestions') : t('asstSuggestWithAi')}
                            </Button>
                        </span>
                    </div>
                </>
            )}
        </div>
    );
}

/** „Nur Datei-Upload": the members' dropzone with its label editable in it, plus the instruction. */
function UploadEditor({ page }: { page: StartPage }) {
    const { t } = useTheme();
    const store = useAssistantSettings();
    const instrId = useId();
    const set = (patch: Partial<StartPage>) => store.updateStartPage(p => ({ ...p, ...patch }));
    return (
        <div className="flex flex-col gap-2">
            {/* The members' dropzone (UploadStart), its label edited in place. */}
            <UploadStart
                onFiles={() => undefined}
                title={(
                    // eslint-disable-next-line design-system/no-raw-ui-elements -- edit in place: the dropzone's label keeps its look (proposed DS pattern)
                    <input
                        aria-label={t('asstUploadLabel')}
                        value={page.uploadLabel}
                        maxLength={UPLOAD_LABEL_MAX_LEN}
                        placeholder={t('asstUploadLabelDefault')}
                        onChange={(e) => set({ uploadLabel: e.target.value })}
                        className={cn(editableField, 'w-auto min-w-48 max-w-full text-center font-medium text-on-surface')}
                    />
                )}
            />
            <div className="flex flex-col gap-1.5 rounded-[var(--ui-radius-box)] border border-outline-variant bg-surface-container-lowest px-4 py-3">
                <label htmlFor={instrId} className="text-sm font-medium text-on-surface">{t('asstUploadInstruction')}</label>
                <textarea
                    id={instrId}
                    rows={2}
                    maxLength={INSTRUCTION_MAX_LEN}
                    value={page.uploadInstruction}
                    placeholder={t('asstUploadInstructionPlaceholder')}
                    onChange={(e) => set({ uploadInstruction: e.target.value })}
                    className={cn(editableField, 'text-sm leading-6 text-on-surface')}
                />
                <span className="text-xs text-on-surface-variant">{t('asstUploadInstructionHint')}</span>
            </div>
            <p className="m-0 text-xs text-on-surface-variant">{t('asstUploadModeFooter')}</p>
        </div>
    );
}

const KINDS = ['input', 'task', 'file'] as const satisfies readonly EntryKind[];

/**
 * How a role starts its chat on the start page — set up per role in
 * „Verhalten": „Startet mit" as three tiles (input field, instruction or
 * file) with a line on what members get, then the kind's own settings: a
 * live input field and its suggestions, the instruction (sent at once or
 * prefilled), or the members' dropzone with its label edited in it and the
 * instruction sent with the file.
 */
export function RoleStartEditor({ start, onChange, roleName, dynamicSample, sampleLoading, onNewExample }: {
    start: EntryStart;
    onChange: (fn: (e: EntryStart) => EntryStart) => void;
    /** Names the controls („… Tutor"). */
    roleName: string;
    dynamicSample: string[];
    sampleLoading: boolean;
    onNewExample: () => void;
}) {
    const { t } = useTheme();
    const store = useAssistantSettings();
    const kindId = useId();
    const instrId = useId();
    const patch = (p: Partial<EntryStart>) => onChange(e => ({ ...e, ...p }));
    const textInvalid = start.kind === 'task' && !start.text.trim();
    const named = (key: string) => t(key).replace('{n}', roleName);
    return (
        <div className="flex flex-col gap-3">
            <div className="flex flex-col gap-2">
                <span id={kindId} className="text-sm font-medium text-on-surface">{t('asstStartsWith')}</span>
                <SegmentedControl
                    variant="tile"
                    aria-labelledby={kindId}
                    value={start.kind}
                    onValueChange={(v) => patch({ kind: v as EntryKind })}
                    options={KINDS.map(kind => ({ value: kind, label: t(`asstKind_${kind}`), icon: <KindIcon kind={kind} aria-hidden="true" />, showLabel: true }))}
                />
                <p className="m-0 text-sm text-on-surface-variant">{t(`asstKindHint_${start.kind}`)}</p>
            </div>
            {start.kind === 'input' && (
                // The input field as members get it: a still image.
                <div inert>
                    <ComposerPreview kbName={store.draft?.title.trim() ?? ''} fileCount={store.kb.fileCount} />
                </div>
            )}
            {start.kind === 'task' && (
                // The start prompt: one line that wraps.
                <Textarea
                    rows={1}
                    className="min-h-0 resize-none field-sizing-content"
                    aria-label={named('asstInstructionLabel')}
                    aria-invalid={textInvalid}
                    value={start.text}
                    maxLength={QUESTION_MAX_LEN}
                    placeholder={t('asstInstructionPlaceholder')}
                    onChange={(ev) => patch({ text: ev.target.value.replace(/\n/g, '') })}
                />
            )}
            {textInvalid && <p className="m-0 text-xs text-error">{t('asstInstructionRequired')}</p>}
            {start.kind === 'task' && (
                <label className="flex cursor-pointer items-center gap-2 text-sm text-on-surface-variant">
                    <Checkbox checked={start.send} onCheckedChange={(v) => patch({ send: v === true })} />
                    {start.send ? t('asstSentImmediately') : t('asstOnlyPrefilled')}
                </label>
            )}
            {start.kind === 'file' && (
                <>
                    {/* The members' dropzone, its label (`text`) edited in place, as for „Nur Datei-Upload". */}
                    <UploadStart
                        onFiles={() => undefined}
                        title={(
                            // eslint-disable-next-line design-system/no-raw-ui-elements -- edit in place: the dropzone's label keeps its look (proposed DS pattern)
                            <input
                                aria-label={named('asstCardLabelLabel')}
                                value={start.text}
                                maxLength={UPLOAD_LABEL_MAX_LEN}
                                placeholder={t('asstFileDropTitle').replace('{role}', roleName)}
                                onChange={(ev) => patch({ text: ev.target.value })}
                                className={cn(editableField, 'w-auto min-w-48 max-w-full text-center font-medium text-on-surface')}
                            />
                        )}
                    />
                    <div className="flex flex-col gap-1.5">
                        <label htmlFor={instrId} className="text-sm font-medium text-on-surface">{t('asstUploadInstruction')}</label>
                        <Textarea
                            id={instrId}
                            rows={2}
                            className="min-h-0 resize-none field-sizing-content"
                            value={start.instruction}
                            maxLength={INSTRUCTION_MAX_LEN}
                            placeholder={t('asstUploadInstructionPlaceholder')}
                            onChange={(ev) => patch({ instruction: ev.target.value })}
                        />
                        <span className="text-xs text-on-surface-variant">{t('asstUploadInstructionHint')}</span>
                    </div>
                </>
            )}
            {start.kind === 'input' && (
                <div className="mt-1 border-t border-outline-variant pt-4">
                    <SuggestionsEditor
                        value={start.suggestions}
                        onChange={(fn) => onChange(e => ({ ...e, suggestions: fn(e.suggestions) }))}
                        label={roleName}
                        dynamicSample={dynamicSample}
                        sampleLoading={sampleLoading}
                        onNewExample={onNewExample}
                        fileCount={store.kb.fileCount ?? 0}
                    />
                </div>
            )}
        </div>
    );
}

/** A role card's ⋮ menu on the Startseite: try it, edit its start in Verhalten, move, remove. */
function cardActions(t: (k: string) => string, o: {
    onTry: () => void; onEdit: () => void; onMove?: (dir: -1 | 1) => void; canBack?: boolean; canForward?: boolean; onRemove?: () => void;
}) {
    return [
        { label: t('asstTryOut'), icon: <SendHorizontal className="size-4" />, onSelect: o.onTry },
        { label: t('asstEditStartInBehavior'), icon: <Pencil className="size-4" />, onSelect: o.onEdit },
        ...(o.onMove ? [
            { label: t('asstMoveForward'), icon: <ArrowUp className="size-4" />, disabled: !o.canForward, separatorBefore: true, onSelect: () => o.onMove?.(-1) },
            { label: t('asstMoveBack'), icon: <ArrowDown className="size-4" />, disabled: !o.canBack, onSelect: () => o.onMove?.(1) },
        ] : []),
        ...(o.onRemove ? [{ label: t('asstRemove'), icon: <Trash2 className="size-4" />, destructive: true, separatorBefore: true, onSelect: o.onRemove }] : []),
    ];
}

/**
 * „Rollenauswahl": the cards as members see them — the active role's first
 * (fixed), then up to 3 further ones, then „Rolle hinzufügen", a picker of
 * the KB's other roles. How a role starts is set in „Verhalten" (the input
 * field until then), not here.
 */
function RolesEditor({ page, roles, activeRoleId, focusEntryId, onAdded, onFocused, onTry, onViewRole }: {
    page: StartPage;
    roles: RoleView[];
    activeRoleId: string;
    /** A card to focus (just added), once it is on screen. */
    focusEntryId: string | null;
    onAdded: (entryId: string) => void;
    onFocused: () => void;
    onTry: (entry: RoleEntry) => void;
    onViewRole: (roleId: string) => void;
}) {
    const { t } = useTheme();
    const store = useAssistantSettings();
    const listId = useId();
    const entries = startEntries(page, activeRoleId);
    const full = page.roleEntries.length >= ROLE_ENTRY_MAX;

    useEffect(() => {
        if (!focusEntryId) return;
        const timer = window.setTimeout(() => {
            document.getElementById(listId)?.scrollIntoView?.({ block: 'start', behavior: 'smooth' });
            document.getElementById(`${listId}-${focusEntryId}`)?.focus({ preventScroll: true });
            onFocused();
        }, 50);
        return () => window.clearTimeout(timer);
    }, [focusEntryId, listId, onFocused]);

    const move = (id: string, dir: -1 | 1) => store.updateStartPage(sp => {
        const i = sp.roleEntries.findIndex(e => e.id === id);
        const j = i + dir;
        if (i < 0 || j < 0 || j >= sp.roleEntries.length) return sp;
        const next = [...sp.roleEntries];
        [next[i], next[j]] = [next[j], next[i]];
        return { ...sp, roleEntries: next };
    });
    const remove = (id: string) => store.updateStartPage(sp => ({ ...sp, roleEntries: sp.roleEntries.filter(x => x.id !== id) }));
    // The picker: the KB's roles, not the active one, not picked yet — each
    // starting as set in „Verhalten" (the input field until then).
    const deck = roles.filter(r => r.id !== activeRoleId && !r.disabled && !page.roleEntries.some(e => e.roleId === r.id));
    const pick = (roleId: string) => {
        if (full) return;
        const id = newId('re');
        store.updateStartPage(sp => ({ ...sp, roleEntries: [...sp.roleEntries, { id, roleId }] }));
        onAdded(id);
    };

    const card = (e: RoleEntry, i: number) => {
        const role = roles.find(r => r.id === e.roleId);
        const isDefault = e.id === DEFAULT_ENTRY_ID;
        return (
            <li key={e.id} className="group/card-tile relative">
                <RoleCardFrame
                    cover={roleCardCover(role, e.kind)}
                    kind={e.kind}
                    highlighted={isDefault}
                    title={<span id={`${listId}-${e.id}`} tabIndex={-1} className="outline-none">{role?.name}</span>}
                    description={role?.description}
                />
                <span className="absolute right-2 top-2 rounded-[var(--ui-radius-control)] transition-colors group-hover/card-tile:bg-surface-container-high group-focus-within/card-tile:bg-surface-container-high">
                    <ActionMenu
                        label={t('asstEntryActions').replace('{n}', role?.name ?? String(i + 1))}
                        actions={cardActions(t, {
                            onTry: () => onTry(e),
                            onEdit: () => onViewRole(e.roleId),
                            ...(isDefault ? {} : {
                                onMove: (dir: -1 | 1) => move(e.id, dir),
                                canForward: i > 1,
                                canBack: i < entries.length - 1,
                                onRemove: () => remove(e.id),
                            }),
                        })}
                    />
                </span>
            </li>
        );
    };

    return (
        <div id={listId} className="flex scroll-mt-4 flex-col gap-4">
            <span className="flex items-center gap-2 text-sm font-medium text-on-surface">
                {t('asstChooseRolesHeading')}
                <span className="ml-auto text-xs font-normal tabular-nums text-on-surface-variant">
                    {t('asstRolesCount').replace('{n}', String(page.roleEntries.length)).replace('{max}', String(ROLE_ENTRY_MAX))}
                </span>
            </span>
            {/* Shown once Speichern or „Fertig" was refused, not while the cards are being picked. */}
            {store.showErrors && page.roleEntries.length === 0 && <p role="alert" className="m-0 text-sm text-error">{t('asstRolesNeedSecond')}</p>}
            {/* One row: centred while it fits, scrolling sideways once it does not. */}
            <div className="-mx-1 overflow-x-auto px-1 pb-2 pt-1">
                <ol className="m-0 mx-auto flex w-max list-none gap-4 p-0">
                    {entries.map(card)}
                    {!full && (
                        <li>
                            {/* „Rolle hinzufügen" opens a picker of the KB's other roles. */}
                            <DropdownMenu>
                                <DropdownMenuTrigger asChild>
                                    <AddCardTile label={t('asstAddRoleEntry')} hint={t('asstAddRoleEntryHint')} />
                                </DropdownMenuTrigger>
                                <DropdownMenuContent align="center" className="max-h-96 w-80 max-w-[calc(100vw-2rem)] overflow-y-auto">
                                    <DropdownMenuLabel>{t('asstPickRole')}</DropdownMenuLabel>
                                    {deck.length === 0 ? (
                                        <DropdownMenuItem onSelect={() => onViewRole(activeRoleId)}>
                                            <span className="text-sm text-on-surface-variant">{t('asstDeckEmpty')}</span>
                                        </DropdownMenuItem>
                                    ) : deck.map(r => {
                                        const start = startOf(page, r.id);
                                        return (
                                            <DropdownMenuItem key={r.id} onSelect={() => pick(r.id)} className="items-start gap-3">
                                                {/* The card's band and avatar in small: its colours and how it starts. */}
                                                <span aria-hidden="true" className="flex size-9 shrink-0 items-center justify-center rounded-[var(--ui-radius-tile)] text-white [&_svg]:size-4" style={colorsStyle(roleCardCover(r, start.kind))}>
                                                    <KindIcon kind={start.kind} />
                                                </span>
                                                <span className="flex min-w-0 flex-col">
                                                    <span className="text-sm font-medium text-on-surface">
                                                        {r.name}{r.custom && <span className="font-normal text-on-surface-variant"> · {t('asstOwn')}</span>}
                                                    </span>
                                                    {r.description && <span className="line-clamp-2 text-xs text-on-surface-variant">{r.description}</span>}
                                                </span>
                                            </DropdownMenuItem>
                                        );
                                    })}
                                </DropdownMenuContent>
                            </DropdownMenu>
                        </li>
                    )}
                </ol>
            </div>
            <p className="m-0 text-xs text-on-surface-variant">{t('asstRolesFooter')}</p>
        </div>
    );
}

const MODES: { value: StartMode; text: string; icon: React.ReactNode }[] = [
    { value: 'input', text: 'asstStartInputText', icon: <TextCursorInput className="size-4" aria-hidden="true" /> },
    { value: 'upload', text: 'asstStartUploadText', icon: <Upload className="size-4" aria-hidden="true" /> },
    { value: 'roles', text: 'asstStartRolesText', icon: <MessageSquareText className="size-4" aria-hidden="true" /> },
];

/**
 * The Chat-Start block in edit mode: the mode (Eingabefeld | Nur Datei-Upload
 * | Rollenauswahl) and its editor. The settings of every mode are kept when
 * the mode changes.
 */
export function ChatStartEditor({
    roles, activeRoleId, dynamicSample, sampleLoading, onNewExample, modeNote, focusEntryId, onAdded, onFocused, onTry, onViewRole,
}: {
    roles: RoleView[];
    activeRoleId: string;
    dynamicSample: string[];
    sampleLoading: boolean;
    onNewExample: () => void;
    /** The mode was switched by „Als Einstiegsfrage anbieten" in Verhalten. */
    modeNote: boolean;
    focusEntryId: string | null;
    onAdded: (entryId: string) => void;
    onFocused: () => void;
    onTry: (entry: RoleEntry) => void;
    onViewRole: (roleId: string) => void;
}) {
    const { t } = useTheme();
    const store = useAssistantSettings();
    const labelId = useId();
    const page = store.draft?.startPage;
    if (!page) return null;
    const setMode = (v: string) => store.updateStartPage(p => ({ ...p, startMode: v as StartMode }));
    const mode = MODES.find(m => m.value === page.startMode) ?? MODES[0];

    return (
        <div className="flex w-full flex-col gap-4">
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                <span id={labelId} className="text-sm font-medium text-on-surface">{t('asstChatStart')}</span>
                <div className="hidden @xl:block">
                    <SegmentedControl
                        variant="nav"
                        aria-labelledby={labelId}
                        value={page.startMode}
                        onValueChange={setMode}
                        options={MODES.map(m => ({ value: m.value, label: t(START_MODE_LABEL[m.value]), icon: m.icon, showLabel: true }))}
                    />
                </div>
                <div className="w-full @xl:hidden">
                    <Select value={page.startMode} onValueChange={setMode}>
                        <SelectTrigger aria-labelledby={labelId}><SelectValue /></SelectTrigger>
                        <SelectContent>
                            {MODES.map(m => (
                                <SelectItem key={m.value} value={m.value}>
                                    <span className="flex items-center gap-2">{m.icon} {t(START_MODE_LABEL[m.value])}</span>
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                </div>
                <span className="w-full text-sm text-on-surface-variant">{t(mode.text)}</span>
            </div>
            {modeNote && page.startMode === 'roles' && <Notice tone="info" icon={<Info />}>{t('asstModeSwitchedNotice')}</Notice>}
            {page.startMode === 'roles' ? (
                <RolesEditor
                    page={page}
                    roles={roles}
                    activeRoleId={activeRoleId}
                    focusEntryId={focusEntryId}
                    onAdded={onAdded}
                    onFocused={onFocused}
                    onTry={onTry}
                    onViewRole={onViewRole}
                />
            ) : page.startMode === 'upload' ? (
                <UploadEditor page={page} />
            ) : (
                <>
                    <ComposerPreview kbName={store.draft?.title.trim() ?? ''} fileCount={store.kb.fileCount} />
                    <SuggestionsEditor
                        value={page}
                        onChange={(fn) => store.updateStartPage(p => ({ ...p, ...fn(p) }))}
                        dynamicSample={dynamicSample}
                        sampleLoading={sampleLoading}
                        onNewExample={onNewExample}
                        fileCount={store.kb.fileCount ?? 0}
                    />
                </>
            )}
        </div>
    );
}

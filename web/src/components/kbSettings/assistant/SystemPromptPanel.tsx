import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Lock, Pencil, Plus, Search, Trash2 } from 'lucide-react';
import {
    Accordion, AccordionContent, AccordionItem, AccordionTrigger, Badge, Button, Input, SettingsRow, Switch, cn,
} from '@ki4jlu/design-system';
import { useTheme } from '../../../contexts/ThemeContext';
import type { CustomRule, RuleSet } from './api';
import { useOpenGroups } from './openGroups';
import { activeRuleTexts, newId, promptParts } from './roleModel';
import { useAssistantSettings } from './useAssistantSettings';

/** One rule — the catalog's or an own one: label, description, switch; `action` before the switch. */
function RuleRow({ label, description, on, onToggle, action }: { label: string; description?: string; on: boolean; onToggle: (v: boolean) => void; action?: React.ReactNode }) {
    const id = useId();
    return (
        <SettingsRow
            labelId={id}
            className="py-1.5"
            label={label}
            description={description}
            control={(
                <div className="flex items-center gap-1">
                    {action}
                    <Switch aria-labelledby={id} checked={on} onCheckedChange={onToggle} />
                </div>
            )}
        />
    );
}

const REMARK = [remarkGfm];

/**
 * The role's prompt, rendered as markdown like a chat answer (raw HTML stays
 * text): its first ten lines, faded out, the rest behind „Ganzen Prompt anzeigen".
 */
function ClampedPrompt({ text }: { text: string }) {
    const { t } = useTheme();
    const ref = useRef<HTMLDivElement>(null);
    const [expanded, setExpanded] = useState(false);
    const [clamped, setClamped] = useState(false);
    // Measured while clamped: only a prompt longer than ten lines gets the toggle.
    useLayoutEffect(() => {
        const el = ref.current;
        if (el && !expanded) setClamped(el.scrollHeight > el.clientHeight + 1);
    }, [text, expanded]);
    return (
        <>
            <div
                ref={ref}
                className={cn(
                    'markdown-content mt-2 min-w-0 break-words text-sm leading-6 text-on-surface',
                    !expanded && 'max-h-[10lh] overflow-hidden',
                    clamped && !expanded && '[mask-image:linear-gradient(to_bottom,black_75%,transparent)]',
                )}
            >
                <ReactMarkdown remarkPlugins={REMARK}>{text}</ReactMarkdown>
            </div>
            {(clamped || expanded) && (
                <Button variant="link" size="sm" className="mt-1 h-auto p-0" aria-expanded={expanded} onClick={() => setExpanded(!expanded)}>
                    {expanded ? t('asstPromptShowLess') : t('asstPromptShowAll')}
                </Button>
            )}
        </>
    );
}

/** An Accordion trigger's row, kept compact: the title, and a count before the chevron. */
function GroupHead({ title, meta }: { title: React.ReactNode; meta?: React.ReactNode }) {
    return (
        <>
            <span className="min-w-0 flex-1 font-semibold text-on-surface">{title}</span>
            {meta && <span className="shrink-0 text-xs font-normal tabular-nums text-on-surface-variant">{meta}</span>}
        </>
    );
}

/** A layer's head: its number, its name and, on the right, where it comes from. */
function LayerHead({ n, tone, title, aside }: { n: number; tone: 'primary' | 'outline' | 'muted'; title: string; aside: React.ReactNode }) {
    return (
        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
            <span className={cn('flex items-center gap-2 text-xs font-semibold uppercase tracking-wide', tone === 'primary' ? 'text-primary' : 'text-on-surface-variant')}>
                <span
                    aria-hidden="true"
                    className={cn(
                        'flex size-[18px] items-center justify-center rounded-full text-[11px] tabular-nums',
                        tone === 'primary' && 'bg-primary text-on-primary',
                        tone === 'outline' && 'border-[1.5px] border-outline',
                        tone === 'muted' && 'bg-outline text-surface-container-lowest',
                    )}
                >
                    {n}
                </span>
                {title}
            </span>
            <span className="flex items-center gap-1.5 text-xs text-on-surface-variant">{aside}</span>
        </div>
    );
}

/**
 * A role's system prompt — the right column of the role preview and of the
 * role edit screen: what the model gets, in the server's order — the role's
 * prompt, the role's own rules and the fixed tool instructions — with a bar
 * of each part's share. In the preview everything is read only and the rules
 * show as they are sent; with `onRulesChange` (the edit screen) the rules are
 * switched and written here, and `promptEditor` takes the prompt's place.
 * `aside` sits in the top right corner (the preview's close button).
 */
export function SystemPromptPanel({
    prompt, template, rules, onRulesChange, promptEditor, ragPrompt, aside,
}: {
    prompt: string;
    /** A catalog template: its prompt is fixed. */
    template: boolean;
    rules: RuleSet;
    onRulesChange?: (fn: (set: RuleSet) => RuleSet) => void;
    promptEditor?: React.ReactNode;
    ragPrompt: string | null;
    aside?: React.ReactNode;
}) {
    const { t } = useTheme();
    const { catalog } = useAssistantSettings();
    const [ruleDraft, setRuleDraft] = useState<{ id?: string; text: string } | null>(null);
    const ruleInputRef = useRef<HTMLInputElement>(null);
    // The inline rule input takes the focus when it opens (new rule or edit).
    const ruleDraftKey = ruleDraft ? (ruleDraft.id ?? 'new') : null;
    useEffect(() => {
        if (ruleDraftKey) ruleInputRef.current?.focus();
    }, [ruleDraftKey]);

    const groupIds = [...(catalog?.ruleGroups.map(g => g.id) ?? []), 'own'];
    // The first group opens until folded; the tools' instruction stays folded.
    const [openGroups, setOpenGroups] = useOpenGroups(groupIds, groupIds.slice(0, 1));
    const [openTools, setOpenTools] = useOpenGroups(['rag'], []);

    if (!catalog) return null;
    const limits = catalog.limits;
    const editable = !!onRulesChange;

    const toggleRule = (id: string, on: boolean) => onRulesChange?.(set => ({ ...set, rules: { ...set.rules, [id]: on } }));
    const setCustomRules = (fn: (rules: CustomRule[]) => CustomRule[]) => onRulesChange?.(set => ({ ...set, customRules: fn(set.customRules) }));
    const commitRuleDraft = () => {
        const text = ruleDraft?.text.trim();
        if (!ruleDraft || !text) return;
        setCustomRules(list => (ruleDraft.id
            ? list.map(r => (r.id === ruleDraft.id ? { ...r, text } : r))
            : [...list, { id: newId('r'), text, on: true }]));
        setRuleDraft(null);
    };

    const ruleTexts = activeRuleTexts(catalog, rules);
    const totalRules = catalog.ruleGroups.reduce((n, g) => n + g.rules.length, 0) + rules.customRules.length;
    const parts = promptParts(prompt, ruleTexts, catalog.rulesHeading, ragPrompt ?? '');
    const total = parts.role.length + parts.rules.length + parts.tools.length;
    const share = (n: number) => (total ? `${(n / total) * 100}%` : '0%');
    const legend = [
        { key: 'asstPartRole', n: parts.role.length, swatch: 'bg-primary' },
        { key: 'asstPartRules', n: parts.rules.length, swatch: 'bg-primary/55' },
        { key: 'asstPartTools', n: parts.tools.length, swatch: 'bg-outline' },
    ];

    const ruleForm = (
        <form
            className="flex flex-col gap-2 py-2 sm:flex-row"
            onSubmit={(e) => { e.preventDefault(); commitRuleDraft(); }}
        >
            <Input
                ref={ruleInputRef}
                aria-label={t('asstNewRuleLabel')}
                value={ruleDraft?.text ?? ''}
                maxLength={limits.ruleMax}
                onChange={(e) => setRuleDraft(d => d && { ...d, text: e.target.value })}
                placeholder={t('asstNewRulePlaceholder')}
                className="flex-1"
            />
            <div className="flex gap-2">
                {ruleDraft?.id && (
                    <Button
                        type="button"
                        variant="outline"
                        size="icon"
                        aria-label={t('delete')}
                        onClick={() => {
                            setCustomRules(list => list.filter(x => x.id !== ruleDraft.id));
                            setRuleDraft(null);
                        }}
                    >
                        <Trash2 className="size-4" aria-hidden="true" />
                    </Button>
                )}
                <Button type="button" variant="outline" onClick={() => setRuleDraft(null)}>{t('cancel')}</Button>
                <Button type="submit" disabled={!ruleDraft?.text.trim()}>
                    {ruleDraft?.id ? t('asstApply') : t('asstAdd')}
                </Button>
            </div>
        </form>
    );

    return (
        <div className="flex min-w-0 flex-[999_1_32.5rem] flex-col gap-3.5 bg-surface-container-low p-6">
            <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                    <h4 className="m-0 text-[15px] font-semibold text-on-surface">{t('asstSystemPrompt')}</h4>
                    <p className="m-0 mt-0.5 text-sm text-on-surface-variant">{t('asstSystemPromptHint')}</p>
                </div>
                {aside}
            </div>

            {/* Each part's share of the whole prompt; follows the prompt and the rules. */}
            <div className="flex flex-col gap-1.5">
                <div aria-hidden="true" className="flex h-2 overflow-hidden rounded-full bg-surface-container-high">
                    {legend.map(l => <div key={l.key} className={cn('transition-[width]', l.swatch)} style={{ width: share(l.n) }} />)}
                </div>
                <ul className="m-0 flex list-none flex-wrap gap-x-4 gap-y-1 p-0 text-xs text-on-surface-variant">
                    {legend.map(l => (
                        <li key={l.key} className="flex items-center gap-1.5">
                            <span aria-hidden="true" className={cn('size-2 rounded-[2px]', l.swatch)} />
                            {t(l.key).replace('{n}', String(l.n))}
                        </li>
                    ))}
                </ul>
            </div>

            <div className="flex flex-col overflow-hidden rounded-xl border border-outline-variant bg-surface-container-lowest">
                {/* 1 — the role's own prompt. */}
                <section className="border-b border-outline-variant px-5 py-4">
                    <LayerHead n={1} tone="primary" title={t('asstRolePromptLayer')} aside={template ? t('asstFromTemplate') : t('asstFromRoleEditable')} />
                    {promptEditor ?? (prompt
                        ? <ClampedPrompt text={prompt} />
                        : <p className="m-0 mt-2 text-sm text-on-surface-variant">{t('asstEmptyPrompt')}</p>)}
                </section>

                {/* 2 — the role's own rules: as sent in the preview, switched in the edit screen. */}
                <section className="border-b border-outline-variant px-5 py-4">
                    <LayerHead
                        n={2}
                        tone="outline"
                        title={t('asstRulesLayer').replace('{n}', String(ruleTexts.length)).replace('{m}', String(totalRules))}
                        aside={t('asstRulesForThisRole')}
                    />
                    {!editable ? (
                        ruleTexts.length
                            ? <ul className="m-0 mt-2 flex list-disc flex-col gap-1 pl-5 text-sm leading-6 text-on-surface">{ruleTexts.map(r => <li key={r}>{r}</li>)}</ul>
                            : <p className="m-0 mt-2 text-sm text-on-surface-variant">{t('asstNoRulesActive')}</p>
                    ) : (
                        <div className="-mx-4 mt-1.5 flex flex-col">
                            <Accordion type="multiple" value={openGroups} onValueChange={setOpenGroups}>
                                {catalog.ruleGroups.map(g => {
                                    const on = g.rules.filter(r => rules.rules[r.id]);
                                    return (
                                        <AccordionItem key={g.id} value={g.id} className="border-b-0">
                                            <AccordionTrigger className="items-center px-4 py-1.5">
                                                <GroupHead title={g.title} meta={`${on.length}/${g.rules.length}`} />
                                            </AccordionTrigger>
                                            <AccordionContent className="pb-1 pl-8 pr-4">
                                                {g.rules.map(r => (
                                                    <RuleRow key={r.id} label={r.text} on={!!rules.rules[r.id]} onToggle={(v) => toggleRule(r.id, v)} />
                                                ))}
                                            </AccordionContent>
                                        </AccordionItem>
                                    );
                                })}
                                {/* The own rules: one more group, rendered like the catalog's. */}
                                <AccordionItem value="own" className="border-b-0">
                                    <AccordionTrigger className="items-center px-4 py-1.5">
                                        <GroupHead
                                            title={t('asstOwnRules')}
                                            meta={`${rules.customRules.filter(r => r.on).length}/${rules.customRules.length}`}
                                        />
                                    </AccordionTrigger>
                                    <AccordionContent className="pb-1 pl-8 pr-4">
                                        {rules.customRules.map(r => (ruleDraft?.id === r.id ? <div key={r.id}>{ruleForm}</div> : (
                                            <RuleRow
                                                key={r.id}
                                                label={r.text}
                                                on={r.on}
                                                onToggle={(on) => setCustomRules(list => list.map(x => (x.id === r.id ? { ...x, on } : x)))}
                                                action={(
                                                    <Button variant="ghost" size="icon" aria-label={`${t('asstEditRule')}: ${r.text}`} onClick={() => setRuleDraft({ id: r.id, text: r.text })}>
                                                        <Pencil className="size-3.5" aria-hidden="true" />
                                                    </Button>
                                                )}
                                            />
                                        )))}
                                        {rules.customRules.length === 0 && !ruleDraft && (
                                            <p className="m-0 py-1.5 text-sm text-on-surface-variant">{t('asstNoOwnRules')}</p>
                                        )}
                                        {ruleDraft && !ruleDraft.id ? ruleForm : rules.customRules.length < limits.customRulesMax && (
                                            <Button variant="ghost" size="sm" className="-ml-2 mt-1" onClick={() => setRuleDraft({ text: '' })}>
                                                <Plus className="size-4" aria-hidden="true" /> {t('asstAddRule')}
                                            </Button>
                                        )}
                                    </AccordionContent>
                                </AccordionItem>
                            </Accordion>
                        </div>
                    )}
                </section>

                {/* 3 — the tools' instructions: system-side, the same for every role. */}
                <section className="px-5 py-4">
                    <LayerHead
                        n={3}
                        tone="muted"
                        title={t('asstToolsLayer')}
                        aside={<><Lock className="size-3.5" aria-hidden="true" /> {t('asstToolsSystemSide')}</>}
                    />
                    <div className="-mx-4 mt-1.5">
                        {/* The tool's instruction is long and the same for every role: folded by default. */}
                        <Accordion type="multiple" value={openTools} onValueChange={setOpenTools}>
                            <AccordionItem value="rag" className="border-b-0">
                                <AccordionTrigger className="items-center px-4 py-1.5">
                                    <GroupHead
                                        title={(
                                            <span className="flex items-center gap-2">
                                                <Search className="size-4 shrink-0 text-primary" aria-hidden="true" />
                                                {t('asstRagSearch')}
                                                <Badge tone="primary">{t('asstRequired')}</Badge>
                                            </span>
                                        )}
                                    />
                                </AccordionTrigger>
                                <AccordionContent className="px-4 pb-2">
                                    <p className="m-0 whitespace-pre-line leading-6 text-on-surface-variant">
                                        {ragPrompt === null ? '…' : ragPrompt || t('ragSystemPromptUnavailable')}
                                    </p>
                                </AccordionContent>
                            </AccordionItem>
                        </Accordion>
                    </div>
                </section>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 text-xs text-on-surface-variant">
                <span className="tabular-nums">
                    {t('asstRolePromptCount').replace('{n}', String(prompt.length)).replace('{max}', String(limits.promptMax))}
                </span>
                {template && <span>{t('asstTemplateCopyOnly')}</span>}
            </div>
        </div>
    );
}

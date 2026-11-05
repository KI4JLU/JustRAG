import type { DiffChunk, TrajectoryEvent } from '../../types';
import { fillTemplate } from '../../utils/sourceDisplay';

/**
 * The agent step timeline's rows, built from an answer's trajectory (the
 * `agentTrajectory` events, live or stored) and its reasoning. Pure, so the
 * mapping from backend codes to readable rows is testable on its own.
 *
 * Rules:
 * - One row per step, in the order the backend emitted them. The model's
 *   thinking is one of them, at the `reasoning` marker the backend stores
 *   (and useChatStream inserts live) where the reasoning began.
 * - Every stage, decision and outcome code maps to a translated title; no
 *   internal id reaches the reader. A code this file does not know renders
 *   as a generic "intermediate step".
 * - Housekeeping that says nothing to the reader is not a row: a CRAG
 *   "proceed", the routing-policy and tool-route bookkeeping, a graph lookup
 *   that matched nothing, the planner's "starting" placeholder once the plan
 *   is there.
 * - A round or hop announced at its start and reported at its end (same
 *   stage and step) is one row; so is the standard path's search with the
 *   passages compression dropped afterwards, and an answer-time tool call
 *   with its result.
 */

export type StepKind =
    | 'thinking' | 'plan' | 'search' | 'decision' | 'answer' | 'refine' | 'team'
    | 'tool' | 'graph' | 'check' | 'read' | 'listing' | 'attachment' | 'other';

export interface Step {
    key: string;
    /** The backend stage, kept for a data attribute only. */
    stage: string;
    kind: StepKind;
    /** A warning icon: the step limited or degraded the answer. */
    warning: boolean;
    title: string;
    /** One line after the title, truncated by the row. */
    summary?: string;
    queries?: string[];
    /** File names of the step's retrieved chunks (deduplicated). */
    files?: string[];
    /** Natural-language reasoning (planner rationale, team router). */
    rationale?: string;
    /** Further detail lines. */
    lines?: string[];
    diff?: DiffChunk[];
    /** The thinking row: its detail is the reasoning text. */
    thinking?: boolean;
}

type T = (key: string) => string;

const REASONING_STAGE = 'reasoning';
const POST_ANSWER_STAGES = new Set(['refine_start', 'refine_complete', 'answer_degenerate_guard']);
const MERGED_STAGES = new Set(['iterate', 'hop', 'search', 'retrieval']);
const TOOL_RESULT = new Set(['agent_tool_call_result', 'agent_tool_call_failed']);

/** "{n} Schritte" with the count filled in. */
function tf(t: T, key: string, values: Record<string, string | number>): string {
    return fillTemplate(t(key), values);
}

/** A count label: the key's `…One` form for exactly one. */
function tn(t: T, key: string, n: number): string {
    return n === 1 ? t(`${key}One`) : tf(t, key, { n });
}

function queriesOf(e: TrajectoryEvent): string[] {
    if (e.queries && e.queries.length > 0) return e.queries;
    return e.query ? [e.query] : [];
}

function filesOf(e: TrajectoryEvent): string[] {
    return [...new Set((e.chunks ?? []).map(c => c.file_name).filter(Boolean))];
}

function quoted(qs: string[]): string {
    return qs.map(q => `„${q}“`).join(' · ');
}

function findingsText(t: T, e: TrajectoryEvent): string | undefined {
    if (typeof e.findings !== 'number') return undefined;
    return e.findings > 0 ? tn(t, 'stepNewFindings', e.findings) : t('stepNoNewFindings');
}

function join(...parts: (string | undefined)[]): string | undefined {
    const kept = parts.filter((p): p is string => !!p);
    return kept.length > 0 ? kept.join(' · ') : undefined;
}

/** The first line of the reasoning, without markdown markers. */
export function firstLine(text: string): string {
    const line = text.split('\n').map(l => l.trim()).find(l => l.length > 0) ?? '';
    return line.replace(/^(#{1,6}\s+|[-*+]\s+|>\s+|\d+[.)]\s+)/, '').replace(/[*_`]/g, '');
}

const TOOL_TITLE: Record<string, string> = {
    kb_search: 'stepToolKbSearch',
    graph_search: 'stepToolGraphSearch',
    web_search: 'stepToolWebSearch',
    recent_documents: 'stepToolRecentDocuments',
    table_query: 'stepToolTable',
    keyword_search: 'stepToolKeywordSearch',
    chunk_read: 'stepToolChunkRead',
    document_outline: 'stepToolOutline',
    count_mentions: 'stepToolCountMentions',
    calculator: 'stepToolCalculator',
    memory_read: 'stepToolMemoryRead',
    memory_write: 'stepToolMemoryWrite',
    code_exec: 'stepToolCodeExec',
    sql_query: 'stepToolTable',
};

const WARNING_OUTCOMES = new Set([
    'abstained', 'plan_error', 'iter_error', 'budget_exhausted', 'budget_exceeded', 'judge_error', 'search_error',
]);

function answerSummary(t: T, e: TrajectoryEvent): string | undefined {
    const rounds = e.step && e.step > 1 ? e.step : undefined;
    switch (e.decision) {
        case 'answered_after_iter':
            return rounds ? tf(t, 'stepAnswerRounds', { n: rounds }) : undefined;
        case 'early_stop_sufficient':
        case 'early_stop_no_query':
            return join(t('stepAnswerSufficient'), rounds ? tf(t, 'stepAnswerHops', { n: rounds }) : undefined);
        case 'early_stop_plateau':
            return t('stepAnswerPlateau');
        case 'no_progress':
        case 'early_stop_no_progress':
            return t('stepAnswerNoProgress');
        case 'max_iter_reached':
        case 'max_hops_reached':
            return t('stepAnswerLimit');
        case 'budget_exhausted':
        case 'budget_exceeded':
            return t('stepBudget');
        case 'plan_error':
        case 'iter_error':
        case 'judge_error':
        case 'search_error':
            return t('stepAnswerError');
        default:
            return undefined;
    }
}

/**
 * The row for one event, or null when the event is housekeeping. teamTurn
 * says the turn was a team's (its hops are specialists, not searches).
 */
function stepFor(t: T, e: TrajectoryEvent, key: string, teamTurn: boolean, hasLaterPlan: boolean, fmtDate: (iso: string) => string): Step | null {
    const base = { key, stage: e.stage, warning: false };
    const queries = queriesOf(e);
    const files = filesOf(e);
    switch (e.stage) {
        case 'plan':
            if (e.decision === 'team_route') {
                return { ...base, kind: 'team', title: t('stepTeamRoute'), summary: queries.join(', ') || undefined, rationale: e.reason || undefined };
            }
            if (e.reason === 'supervisor.dispatch') return { ...base, kind: 'plan', title: t('stepPlanDispatch') };
            if (queries.length === 0) {
                return hasLaterPlan ? null : { ...base, kind: 'plan', title: t('stepPlanStarting') };
            }
            return {
                ...base, kind: 'plan', title: t('stepPlan'),
                summary: tn(t, 'stepPlanQueries', queries.length),
                queries, rationale: e.reason && e.reason !== 'starting' ? e.reason : undefined,
            };
        case 'iterate':
            return {
                ...base, kind: 'search', title: tf(t, 'stepRound', { n: e.step ?? 1 }),
                summary: join(findingsText(t, e), queries.length > 0 ? quoted(queries) : undefined),
                queries, files, rationale: e.reason || undefined,
            };
        case 'hop':
            if (teamTurn) {
                return { ...base, kind: 'team', title: e.query || t('stepSpecialist'), summary: typeof e.findings === 'number' ? tn(t, 'stepResults', e.findings) : undefined, files };
            }
            return {
                ...base, kind: 'search', title: tf(t, 'stepSearchN', { n: e.step ?? 1 }),
                summary: join(findingsText(t, e), queries.length > 0 ? quoted(queries) : undefined),
                queries, files,
            };
        case 'search':
            return {
                ...base, kind: 'search', title: tf(t, 'stepSearchN', { n: e.step ?? 1 }),
                summary: join(findingsText(t, e), queries.length > 0 ? quoted(queries) : undefined),
                queries, files,
            };
        case 'retrieval':
            return {
                ...base, kind: 'search', title: t('stepSearch'),
                summary: join(typeof e.findings === 'number' ? tn(t, 'stepResults', e.findings) : t('stepNoResults'), e.query ? quoted([e.query]) : undefined),
                // The decomposed sub-questions; the question itself is in the line.
                queries: e.queries?.length ? e.queries : undefined,
                files,
                lines: e.dropped ? [tn(t, 'stepRetrievalDropped', e.dropped)] : undefined,
            };
        case 'recency_listing': {
            const date = e.reason ? fmtDate(e.reason) : '';
            return {
                ...base, kind: 'listing', title: t('stepRecencyListing'),
                summary: e.findings ? tf(t, 'stepRecencySince', { n: e.findings, date }) : tf(t, 'stepRecencyNone', { date }),
            };
        }
        case 'decision':
            return decisionStep(t, e, base, queries, files);
        case 'answer':
            if (e.decision === 'team_synthesis') return { ...base, kind: 'team', title: t('stepTeamSynthesis') };
            if (e.decision === 'abstained') return { ...base, kind: 'answer', warning: true, title: t('stepAnswerAbstained') };
            return { ...base, kind: 'answer', warning: WARNING_OUTCOMES.has(e.decision ?? ''), title: t('stepAnswer'), summary: answerSummary(t, e) };
        case 'refine_start':
            return { ...base, kind: 'refine', title: t('stepRefineStart'), summary: e.claims_before ? tn(t, 'stepRefineClaims', e.claims_before) : undefined };
        case 'refine_complete': {
            if (e.reason === 'unchanged' || !e.diff || e.diff.length === 0) {
                return { ...base, kind: 'refine', title: t('stepRefineUnchanged') };
            }
            const verifierError = e.claims_after === -1;
            return {
                ...base, kind: 'refine', warning: verifierError, title: t('stepRefineDone'),
                summary: verifierError ? t('stepRefineVerifierError') : undefined,
                diff: e.diff,
                lines: !verifierError && typeof e.claims_after === 'number'
                    ? [tf(t, 'stepRefineResidual', { before: e.claims_before ?? 0, after: e.claims_after })]
                    : undefined,
            };
        }
        case 'answer_degenerate_guard':
            return {
                ...base, kind: 'answer', warning: true, title: t('stepGuard'),
                lines: typeof e.run_length === 'number' || typeof e.limit === 'number'
                    ? [tf(t, 'stepGuardDetail', { run: e.run_length ?? '–', limit: e.limit ?? '–' })]
                    : undefined,
            };
        case 'longcontext_route':
            return { ...base, kind: 'read', title: t('stepLongContext') };
        case 'longcontext_map':
            return { ...base, kind: 'read', title: tf(t, 'stepLongContextMap', { n: e.step ?? 1 }), summary: findingsText(t, e), files };
        case 'longcontext_reduce':
            return {
                ...base, kind: 'read', title: tn(t, 'stepLongContextReduce', e.findings ?? 0),
                summary: e.dropped ? tf(t, 'stepLongContextDropped', { n: e.dropped }) : undefined,
            };
        case 'primer':
            return { ...base, kind: 'read', title: t('stepPrimer'), summary: typeof e.findings === 'number' ? tn(t, 'stepResults', e.findings) : undefined };
        case 'drift_followups':
            return { ...base, kind: 'plan', title: t('stepFollowups'), summary: queries.length > 0 ? quoted(queries) : undefined, queries };
        case 'compare_section':
            return { ...base, kind: 'read', title: tf(t, 'stepCompareSection', { n: e.step ?? 1 }), summary: typeof e.findings === 'number' ? tn(t, 'stepFindings', e.findings) : undefined };
        case 'attachments':
            return {
                ...base, kind: 'attachment', warning: e.decision === 'attachments_dropped',
                title: t(e.decision === 'attachments_dropped' ? 'stepAttachmentsDropped' : 'stepAttachmentsTrimmed'),
            };
        case 'conflict_surfacing':
            if (e.reason === 'found') {
                return { ...base, kind: 'check', warning: true, title: tn(t, 'stepConflictsFound', e.findings ?? 0) };
            }
            if (e.reason === 'timeout' || e.reason === 'error') {
                return { ...base, kind: 'check', warning: true, title: t('stepConflictsIncomplete') };
            }
            return { ...base, kind: 'check', title: t('stepConflicts') };
        case 'web_search':
            return { ...base, kind: 'tool', warning: true, title: t('stepWebSearchSkipped') };
        case 'orchestrator_policy':
            return e.decision === 'fallthrough' ? { ...base, kind: 'decision', warning: true, title: t('stepPolicyFallthrough') } : null;
        case 'answer_tools_route':
            return null;
        default:
            return { ...base, kind: 'other', title: t('stepOther') };
    }
}

function decisionStep(t: T, e: TrajectoryEvent, base: Pick<Step, 'key' | 'stage' | 'warning'>, queries: string[], files: string[]): Step | null {
    switch (e.decision) {
        case 'crag_proceed':
        case 'crag_proceed_after_rewrite':
            return null;
        case 'crag_rewrite':
            return { ...base, kind: 'search', title: t('stepRewrite') };
        case 'crag_rewrite_complete':
            return { ...base, kind: 'search', title: t('stepRewriteDone'), summary: queries.length > 0 ? quoted(queries) : undefined, queries, files };
        case 'crag_abstain':
            return {
                ...base, kind: 'decision', warning: true,
                title: t(e.reason === 'rewrite_did_not_recover' ? 'stepAbstainAfterRewrite' : 'stepAbstainNoChunks'),
            };
        case 'transform_followup':
            return { ...base, kind: 'decision', title: t('stepTransformFollowup') };
        case 'graph_traversal':
            if (!e.findings) return null;
            return { ...base, kind: 'graph', title: t('stepGraph'), summary: tn(t, 'stepGraphEntities', e.findings), queries };
        case 'budget_exceeded':
            return { ...base, kind: 'decision', warning: true, title: t('stepBudget') };
        case 'agent_tool_call': {
            const titleKey = TOOL_TITLE[e.reason ?? ''];
            return {
                ...base, kind: 'tool', title: titleKey ? t(titleKey) : t('stepToolCall'),
                summary: join(typeof e.findings === 'number' ? tn(t, 'stepResults', e.findings) : undefined, e.query ? quoted([e.query]) : undefined),
                // A tool without search text (calculator, chunk_read) shows its arguments.
                lines: !e.query && e.args ? [e.args] : undefined,
            };
        }
        case 'agent_tool_call_result':
        case 'agent_tool_call_failed':
            // Folded into the call's row (buildSteps); one without a call is dropped.
            return null;
        case 'insufficient_context':
            return { ...base, kind: 'decision', warning: true, title: t('stepInsufficientContext') };
        case 'agent_dispatch':
            return { ...base, kind: 'team', title: e.reason === 'retriever' ? t('stepSpecialistRetriever') : t('stepSpecialist') };
        case 'team_route':
            return { ...base, kind: 'team', warning: true, title: t('stepTeamNoSpecialist') };
        case 'team_unavailable':
            return { ...base, kind: 'team', warning: true, title: t('stepTeamUnavailable') };
        default:
            return { ...base, kind: 'other', title: t('stepOther') };
    }
}

/** Where the thinking row goes when the trajectory has no reasoning marker
 *  (an answer stored before the marker existed): before the steps that run
 *  after the answer (fact check, guard), else last. */
function legacyThinkingIndex(trajectory: TrajectoryEvent[]): number {
    const i = trajectory.findIndex(e => POST_ANSWER_STAGES.has(e.stage));
    return i === -1 ? trajectory.length : i;
}

export interface BuildStepsOptions {
    /** The reasoning is still streaming: the thinking row says so. */
    thinkingLive?: boolean;
    /** Formats an ISO date (the recency listing's window start); default as is. */
    formatDate?: (iso: string) => string;
}

export function buildSteps(
    trajectory: TrajectoryEvent[] | undefined,
    reasoning: string | undefined,
    t: T,
    opts: BuildStepsOptions = {},
): Step[] {
    const events = trajectory ?? [];
    const teamTurn = events.some(e => e.stage === 'plan' && e.decision === 'team_route');
    const hasReasoning = !!reasoning && reasoning.trim().length > 0;
    const marker = events.findIndex(e => e.stage === REASONING_STAGE);
    const thinkingAt = hasReasoning ? (marker === -1 ? legacyThinkingIndex(events) : marker) : -1;

    const fmtDate = opts.formatDate ?? ((iso: string) => iso);
    const steps: Step[] = [];
    // Last row index per "stage:step", for the start/end merge, and the
    // (merged) event behind each row.
    const open = new Map<string, number>();
    // The row of the last tool call per tool still waiting for its result.
    const openTool = new Map<string, number>();
    const rowEvent = new Map<number, TrajectoryEvent>();
    const lastPlan = events.reduce((acc, e, i) => (e.stage === 'plan' && queriesOf(e).length > 0 ? i : acc), -1);

    const pushThinking = () => {
        steps.push({
            key: 'thinking', stage: REASONING_STAGE, kind: 'thinking', warning: false, thinking: true,
            title: t(opts.thinkingLive ? 'stepThinkingLive' : 'stepThinking'),
            summary: firstLine(reasoning ?? '') || undefined,
        });
    };

    events.forEach((e, i) => {
        if (i === thinkingAt) pushThinking();
        if (e.stage === REASONING_STAGE) return;
        if (e.stage === 'decision' && TOOL_RESULT.has(e.decision ?? '')) {
            const prior = openTool.get(e.reason ?? '');
            if (prior === undefined) return;
            openTool.delete(e.reason ?? '');
            const merged = { ...rowEvent.get(prior)!, findings: e.findings };
            const next = stepFor(t, merged, steps[prior].key, teamTurn, false, fmtDate);
            if (next) {
                steps[prior] = e.decision === 'agent_tool_call_failed'
                    ? { ...next, warning: true, summary: join(t('stepToolFailed'), next.summary) }
                    : next;
                rowEvent.set(prior, merged);
            }
            return;
        }
        const mergeKey = MERGED_STAGES.has(e.stage) && e.step && !(teamTurn && e.stage === 'hop') ? `${e.stage}:${e.step}` : '';
        const prior = mergeKey ? open.get(mergeKey) : undefined;
        if (prior !== undefined) {
            const prev = steps[prior];
            // The end-of-round event carries findings and chunks; the start
            // event the queries and the rationale. Keep both.
            const merged = mergeEvents(rowEvent.get(prior)!, e);
            const next = stepFor(t, merged, prev.key, teamTurn, i < lastPlan, fmtDate);
            if (next) {
                steps[prior] = next;
                rowEvent.set(prior, merged);
            }
            return;
        }
        const step = stepFor(t, e, `${i}`, teamTurn, i < lastPlan, fmtDate);
        if (!step) return;
        steps.push(step);
        rowEvent.set(steps.length - 1, e);
        if (mergeKey) open.set(mergeKey, steps.length - 1);
        if (e.stage === 'decision' && e.decision === 'agent_tool_call') openTool.set(e.reason ?? '', steps.length - 1);
    });
    if (thinkingAt >= events.length) pushThinking();
    return steps;
}

function mergeEvents(a: TrajectoryEvent, b: TrajectoryEvent): TrajectoryEvent {
    return {
        ...a,
        ...Object.fromEntries(Object.entries(b).filter(([, v]) => v !== undefined && v !== '' && !(Array.isArray(v) && v.length === 0))),
        queries: b.queries?.length ? b.queries : a.queries,
        query: a.query || b.query,
        reason: a.reason || b.reason,
    };
}

// The header's phrase per kind, in the order the kinds first occur. A kind
// whose key has a `…One` form counts its steps; the others read the same for
// one step or several ("nachgedacht", "Faktencheck durchgeführt").
const SUMMARY_KEY: Record<StepKind, { key: string; counted: boolean }> = {
    plan: { key: 'stepsSumPlan', counted: false },
    search: { key: 'stepsSumSearch', counted: true },
    thinking: { key: 'stepsSumThinking', counted: false },
    decision: { key: 'stepsSumDecision', counted: true },
    answer: { key: 'stepsSumAnswer', counted: false },
    refine: { key: 'stepsSumRefine', counted: false },
    team: { key: 'stepsSumTeam', counted: false },
    tool: { key: 'stepsSumTool', counted: true },
    graph: { key: 'stepsSumGraph', counted: false },
    check: { key: 'stepsSumCheck', counted: false },
    read: { key: 'stepsSumRead', counted: true },
    listing: { key: 'stepsSumListing', counted: false },
    attachment: { key: 'stepsSumAttachment', counted: false },
    other: { key: 'stepsSumOther', counted: true },
};

/** At most this many phrases; past it, the last slot says how many steps are left. */
const SUMMARY_PHRASES = 3;

/**
 * The collapsed header's one line: what the steps did, grouped by kind in the
 * order they happened — "Plan erstellt, 2 Suchen durchgeführt und 4 weitere
 * Schritte". Up to three phrases are named; with more kinds, two are named and
 * the rest is counted as further steps.
 */
export function summarizeSteps(steps: Step[], t: T): string {
    const groups: { kind: StepKind; n: number }[] = [];
    for (const s of steps) {
        const g = groups.find(x => x.kind === s.kind);
        if (g) g.n++;
        else groups.push({ kind: s.kind, n: 1 });
    }
    const phrase = (g: { kind: StepKind; n: number }) => {
        const { key, counted } = SUMMARY_KEY[g.kind];
        return counted ? tn(t, key, g.n) : t(key);
    };
    let parts: string[];
    if (groups.length <= SUMMARY_PHRASES) {
        parts = groups.map(phrase);
    } else {
        const named = groups.slice(0, SUMMARY_PHRASES - 1);
        const rest = groups.slice(SUMMARY_PHRASES - 1).reduce((sum, g) => sum + g.n, 0);
        parts = [...named.map(phrase), tn(t, 'stepsSumMore', rest)];
    }
    const text = parts.length > 1
        ? `${parts.slice(0, -1).join(', ')} ${t('stepsSumAnd')} ${parts[parts.length - 1]}`
        : parts[0] ?? '';
    return text.charAt(0).toUpperCase() + text.slice(1);
}

/** Whether an answer has any step row to show. */
export function hasAgentSteps(trajectory: TrajectoryEvent[] | undefined, reasoning: string | undefined): boolean {
    return buildSteps(trajectory, reasoning, k => k).length > 0;
}

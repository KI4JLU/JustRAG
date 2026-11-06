import { describe, it, expect } from 'vitest';
import { buildSteps, firstLine, hasAgentSteps, summarizeSteps } from './buildSteps';
import { translations } from '../../translations';
import type { TrajectoryEvent } from '../../types';

const de = (k: string) => translations[k as keyof typeof translations]?.de ?? k;
const en = (k: string) => translations[k as keyof typeof translations]?.en ?? k;

// Every code the backend emits (go-backend/internal/chat: emitTrajectory call
// sites). Oracle for "no internal id reaches the reader": no rendered title
// or summary contains one of these strings.
const ALL_EVENTS: TrajectoryEvent[] = [
    { stage: 'orchestrator_policy', decision: 'fallthrough', reason: 'forced orchestrator plan_execute could not run' },
    { stage: 'plan', reason: 'starting' },
    { stage: 'plan', queries: ['Frist', 'Antrag'], reason: 'Zwei Aspekte' },
    { stage: 'iterate', step: 1, queries: ['Frist'], reason: 'erste Runde' },
    { stage: 'decision', decision: 'agent_tool_call', reason: 'kb_search', findings: 3 },
    { stage: 'iterate', step: 1, query: 'Frist', findings: 2, chunks: [{ idx: 1, file_name: 'po.pdf', score: 0.9 }] },
    { stage: 'decision', step: 2, decision: 'budget_exceeded', reason: 'tokens' },
    { stage: 'decision', decision: 'crag_rewrite', reason: 'low_relevance_retrying' },
    { stage: 'decision', decision: 'crag_rewrite_complete', query: 'Frist Antrag' },
    { stage: 'decision', decision: 'crag_abstain', reason: 'rewrite_did_not_recover' },
    { stage: 'decision', decision: 'crag_abstain', reason: 'no_relevant_chunks' },
    { stage: 'decision', decision: 'transform_followup', reason: 'reformat previous answer; retrieval skipped' },
    { stage: 'decision', decision: 'graph_traversal', reason: 'fired', queries: ['JLU'], findings: 1 },
    { stage: 'decision', decision: 'agent_dispatch', reason: 'retriever' },
    { stage: 'decision', decision: 'team_unavailable', reason: 'team not found' },
    { stage: 'decision', decision: 'team_route', reason: 'no specialist selected: x' },
    { stage: 'longcontext_route', mode: 'map_reduce', query: 'q' },
    { stage: 'longcontext_map', step: 1, findings: 4 },
    { stage: 'longcontext_reduce', findings: 9, dropped: 2 },
    { stage: 'primer', findings: 3 },
    { stage: 'drift_followups', queries: ['a', 'b'] },
    { stage: 'search', step: 1, query: 'a', findings: 0 },
    { stage: 'compare_section', step: 1, findings: 2 },
    { stage: 'attachments', decision: 'attachments_dropped', reason: 'context budget: …' },
    { stage: 'attachments', decision: 'attachments_kb_trimmed', reason: 'attached documents first: …' },
    { stage: 'conflict_surfacing', reason: 'found', findings: 2 },
    { stage: 'conflict_surfacing', reason: 'timeout' },
    { stage: 'web_search', decision: 'skipped', reason: 'Web search is not available' },
    { stage: 'answer', step: 2, decision: 'answered_after_iter' },
    { stage: 'answer', decision: 'answered_after_plan' },
    { stage: 'refine_start', mode: 'surgical', claims_before: 2 },
    { stage: 'refine_complete', mode: 'surgical', claims_before: 2, claims_after: 0, diff: [{ kind: 'added', text: 'neu ' }] },
    { stage: 'answer_degenerate_guard', decision: 'truncated', limit: 400, run_length: 1234 },
    { stage: 'recency_listing', findings: 3, reason: '2026-10-29' },
    { stage: 'retrieval', step: 1, query: 'Frist', queries: ['Frist', 'Antrag'], findings: 8, chunks: [{ idx: 1, file_name: 'po.pdf', score: 0.9 }] },
    { stage: 'retrieval', step: 1, decision: 'context_reduced', dropped: 3 },
    { stage: 'decision', decision: 'insufficient_context' },
    { stage: 'decision', decision: 'agent_tool_call', reason: 'keyword_search', query: 'Frist', args: '{"query":"Frist"}' },
    { stage: 'decision', decision: 'agent_tool_call_result', reason: 'keyword_search', findings: 2 },
    { stage: 'decision', decision: 'agent_tool_call', reason: 'calculator', args: '{"expression":"2*3"}' },
    { stage: 'decision', decision: 'agent_tool_call_failed', reason: 'calculator' },
];

const INTERNAL_IDS = [
    'orchestrator_policy', 'fallthrough', 'plan_execute', 'starting', 'agent_tool_call', 'kb_search', 'budget_exceeded',
    'crag_', 'rewrite_did_not_recover', 'no_relevant_chunks', 'transform_followup', 'graph_traversal', 'agent_dispatch',
    'retriever', 'team_unavailable', 'team_route', 'longcontext', 'map_reduce', 'drift', 'compare_section', 'attachments_',
    'conflict_surfacing', 'timeout', 'web_search', 'skipped', 'answered_after', 'refine_', 'surgical',
    'answer_degenerate_guard', 'truncated', 'relevant_chunks_sufficient', 'retrieval', 'context_reduced',
    'insufficient_context', 'recency_listing', 'agent_tool_call_result', 'agent_tool_call_failed', 'keyword_search', 'calculator',
];

describe('buildSteps', () => {
    it('labels every backend code; no internal id reaches the reader (de and en)', () => {
        for (const t of [de, en]) {
            const steps = buildSteps(ALL_EVENTS, undefined, t);
            const text = steps.map(s => `${s.title} ${s.summary ?? ''}`).join('\n');
            for (const id of INTERNAL_IDS) expect(text, id).not.toContain(id);
            expect(steps.some(s => s.title === t('stepOther'))).toBe(false);
        }
    });

    it('drops housekeeping: CRAG proceed, policy match, tool route, empty graph lookup', () => {
        const steps = buildSteps([
            { stage: 'decision', decision: 'crag_proceed', reason: 'relevant_chunks_sufficient' },
            { stage: 'decision', decision: 'crag_proceed_after_rewrite' },
            { stage: 'orchestrator_policy', decision: 'plan_execute', mode: 'force', policy_rule: 0 },
            { stage: 'answer_tools_route', decision: 'lookup', findings: 2 },
            { stage: 'decision', decision: 'graph_traversal', reason: 'skipped_no_entity' },
        ], undefined, de);
        expect(steps).toEqual([]);
        expect(hasAgentSteps([{ stage: 'decision', decision: 'crag_proceed' }], undefined)).toBe(false);
    });

    it('merges a round announced at its start and reported at its end into one row', () => {
        const steps = buildSteps([
            { stage: 'iterate', step: 1, queries: ['Frist', 'Antrag'], reason: 'erste Runde' },
            { stage: 'iterate', step: 1, query: 'Frist', findings: 3, chunks: [{ idx: 1, file_name: 'po.pdf', score: 1 }, { idx: 2, file_name: 'po.pdf', score: 1 }] },
            { stage: 'iterate', step: 2, queries: ['Gebühr'] },
        ], undefined, de);
        expect(steps).toHaveLength(2);
        expect(steps[0]).toMatchObject({
            title: 'Recherche-Runde 1', queries: ['Frist', 'Antrag'], files: ['po.pdf'], rationale: 'erste Runde',
            summary: '+3 neue Treffer · „Frist“ · „Antrag“',
        });
        expect(steps[1].title).toBe('Recherche-Runde 2');
    });

    it('keeps the planner placeholder only until the plan arrives', () => {
        expect(buildSteps([{ stage: 'plan', reason: 'starting' }], undefined, de).map(s => s.title)).toEqual(['Plan wird erstellt']);
        expect(buildSteps([
            { stage: 'plan', reason: 'starting' },
            { stage: 'plan', queries: ['a', 'b', 'c'] },
        ], undefined, de).map(s => `${s.title}: ${s.summary}`)).toEqual(['Plan: 3 Teilfragen']);
    });

    it('places the thinking at the reasoning marker', () => {
        const steps = buildSteps([
            { stage: 'plan', queries: ['a'] },
            { stage: 'reasoning' },
            { stage: 'answer' },
            { stage: 'refine_start', claims_before: 1 },
        ], '## Überlegung\nDie PO regelt das.', de);
        expect(steps.map(s => s.kind)).toEqual(['plan', 'thinking', 'answer', 'refine']);
        expect(steps[1]).toMatchObject({ title: 'Nachgedacht', summary: 'Überlegung', thinking: true });
    });

    it('without a marker (older answers) puts the thinking before the post-answer steps, else last', () => {
        expect(buildSteps([{ stage: 'answer' }, { stage: 'refine_start' }], 'x', de).map(s => s.kind)).toEqual(['answer', 'thinking', 'refine']);
        expect(buildSteps([{ stage: 'plan', queries: ['a'] }], 'x', de).map(s => s.kind)).toEqual(['plan', 'thinking']);
        expect(buildSteps(undefined, 'nur Denken', de).map(s => s.kind)).toEqual(['thinking']);
    });

    it('ignores the marker when there is no reasoning text', () => {
        expect(buildSteps([{ stage: 'reasoning' }], undefined, de)).toEqual([]);
        expect(buildSteps([{ stage: 'reasoning' }], '   ', de)).toEqual([]);
    });

    it('says the thinking is live while it streams', () => {
        expect(buildSteps(undefined, 'x', de, { thinkingLive: true })[0].title).toBe('Denkt nach …');
    });

    it('marks degrading outcomes as warnings, a routine decision not', () => {
        const steps = buildSteps([
            { stage: 'decision', decision: 'crag_rewrite' },
            { stage: 'decision', decision: 'crag_abstain', reason: 'no_relevant_chunks' },
            { stage: 'answer', decision: 'abstained' },
            { stage: 'answer_degenerate_guard', limit: 400, run_length: 1234 },
        ], undefined, de);
        expect(steps.map(s => s.warning)).toEqual([false, true, true, true]);
        expect(steps[3].lines).toEqual(['Wiederholung: 1234 Zeichen · Grenze: 400']);
    });

    it('shows a team turn as router, specialists and synthesis', () => {
        const steps = buildSteps([
            { stage: 'plan', decision: 'team_route', reason: 'beide relevant', queries: ['Netz', 'Recht'] },
            { stage: 'hop', step: 1, query: 'Netz', findings: 4, reason: 'specialist_complete' },
            { stage: 'hop', step: 2, query: 'Recht', findings: 2, reason: 'specialist_complete' },
            { stage: 'answer', decision: 'team_synthesis', step: 2 },
        ], undefined, en);
        expect(steps.map(s => `${s.title}|${s.summary ?? ''}`)).toEqual([
            'Team router|Netz, Recht', 'Netz|4 results', 'Recht|2 results', 'Combined the specialists\' answers|',
        ]);
        expect(steps[0].rationale).toBe('beide relevant');
    });

    it('counts in the singular for one', () => {
        const steps = buildSteps([
            { stage: 'plan', queries: ['a'] },
            { stage: 'iterate', step: 1, findings: 1 },
            { stage: 'refine_start', claims_before: 1 },
            { stage: 'conflict_surfacing', reason: 'found', findings: 1 },
        ], undefined, de);
        expect(steps.map(s => s.summary ?? s.title)).toEqual(['1 Teilfrage', '+1 neuer Treffer', '1 Aussage betroffen', '1 Widerspruch zwischen Quellen']);
    });

    it('renders an unknown stage as a generic step', () => {
        expect(buildSteps([{ stage: 'brand_new_stage' }], undefined, de)[0]).toMatchObject({ title: 'Zwischenschritt', kind: 'other' });
    });
});

describe('buildSteps: the standard path and answer-time tools', () => {
    it('shows the search with its hits, query and files; the dropped passages join its row', () => {
        const steps = buildSteps([
            { stage: 'retrieval', step: 1, query: 'Frist', findings: 8, chunks: [{ idx: 1, file_name: 'po.pdf', score: 1 }] },
            { stage: 'decision', decision: 'crag_proceed' },
            { stage: 'retrieval', step: 1, decision: 'context_reduced', dropped: 3 },
        ], undefined, de);
        expect(steps).toHaveLength(1);
        expect(steps[0]).toMatchObject({
            kind: 'search', title: 'Suche', summary: '8 Treffer · „Frist“', files: ['po.pdf'],
            lines: ['3 weniger belastbare Stellen aussortiert'], warning: false,
        });
        expect(steps[0].queries).toBeUndefined();
    });

    it('lists the decomposed sub-questions and says when nothing was found', () => {
        const [step] = buildSteps([{ stage: 'retrieval', step: 1, query: 'Frist und Gebühr', queries: ['Frist', 'Gebühr'] }], undefined, en);
        expect(step).toMatchObject({ summary: 'no results · „Frist und Gebühr“', queries: ['Frist', 'Gebühr'] });
    });

    it('marks the sufficient-context refusal as a warning', () => {
        expect(buildSteps([{ stage: 'decision', decision: 'insufficient_context' }], undefined, de)[0])
            .toMatchObject({ kind: 'decision', warning: true, title: 'Quellen reichen für eine belastbare Antwort nicht aus' });
    });

    it('formats the recency window with the given formatter', () => {
        const fmt = (iso: string) => iso.split('-').reverse().join('.');
        expect(buildSteps([{ stage: 'recency_listing', findings: 4, reason: '2026-10-29' }], undefined, de, { formatDate: fmt })[0])
            .toMatchObject({ kind: 'listing', title: 'Neueste Dokumente aufgelistet', summary: '4 seit 29.10.2026' });
        expect(buildSteps([{ stage: 'recency_listing', reason: '2026-10-29' }], undefined, de, { formatDate: fmt })[0].summary)
            .toBe('keine seit 29.10.2026');
    });

    it('folds a tool result into its call; a failure warns; arguments show when there is no query', () => {
        const steps = buildSteps([
            { stage: 'decision', decision: 'agent_tool_call', reason: 'kb_search', query: 'Frist' },
            { stage: 'decision', decision: 'agent_tool_call', reason: 'calculator', args: '{"expression":"2*3"}' },
            { stage: 'decision', decision: 'agent_tool_call_result', reason: 'kb_search', findings: 4 },
            { stage: 'decision', decision: 'agent_tool_call_failed', reason: 'calculator' },
            { stage: 'decision', decision: 'agent_tool_call_result', reason: 'web_search', findings: 1 },
        ], undefined, de);
        expect(steps.map(s => `${s.title}|${s.summary ?? ''}|${s.warning}`)).toEqual([
            'Suche in der Wissensdatenbank|4 Treffer · „Frist“|false',
            'Rechner|fehlgeschlagen|true',
        ]);
        expect(steps[1].lines).toEqual(['{"expression":"2*3"}']);
    });

    it('a live tool call shows before its result arrives', () => {
        expect(buildSteps([{ stage: 'decision', decision: 'agent_tool_call', reason: 'web_search', query: 'JLU Mensa' }], undefined, de)[0])
            .toMatchObject({ kind: 'tool', title: 'Websuche', summary: '„JLU Mensa“' });
    });
});

describe('summarizeSteps', () => {
    const sum = (events: TrajectoryEvent[], reasoning: string | undefined, t: (k: string) => string) =>
        summarizeSteps(buildSteps(events, reasoning, t), t);

    it('names up to three kinds in the order they happened, counting where it reads naturally', () => {
        expect(sum([{ stage: 'plan', queries: ['a'] }], undefined, de)).toBe('Plan erstellt');
        expect(sum([{ stage: 'iterate', step: 1 }, { stage: 'iterate', step: 2 }, { stage: 'answer' }], undefined, de))
            .toBe('2 Suchen durchgeführt und Recherche abgeschlossen');
        expect(sum([{ stage: 'plan', queries: ['a'] }, { stage: 'reasoning' }, { stage: 'answer' }], 'x', en))
            .toBe('Made a plan, thought it over and finished the research');
    });

    it('past three kinds names two and counts the remaining steps', () => {
        const events: TrajectoryEvent[] = [
            { stage: 'plan', queries: ['a', 'b'] },
            { stage: 'iterate', step: 1 }, { stage: 'iterate', step: 2 },
            { stage: 'reasoning' }, { stage: 'answer' },
            { stage: 'refine_start', claims_before: 1 }, { stage: 'refine_complete', diff: [{ kind: 'added', text: 'x' }] },
        ];
        expect(sum(events, 'x', de)).toBe('Plan erstellt, 2 Suchen durchgeführt und 4 weitere Schritte');
        expect(sum(events, 'x', en)).toBe('Made a plan, ran 2 searches and 4 more steps');
        expect(sum([{ stage: 'plan', queries: ['a'] }, { stage: 'iterate', step: 1 }, { stage: 'reasoning' }, { stage: 'answer' }], 'x', de))
            .toBe('Plan erstellt, 1 Suche durchgeführt und 2 weitere Schritte');
    });

    it('capitalises a lower-case first phrase and counts one in the singular', () => {
        expect(sum(undefined as unknown as TrajectoryEvent[], 'x', de)).toBe('Nachgedacht');
        expect(sum([{ stage: 'iterate', step: 1 }, { stage: 'plan', queries: ['a'] }, { stage: 'answer' }, { stage: 'refine_start' }], undefined, de))
            .toBe('1 Suche durchgeführt, Plan erstellt und 2 weitere Schritte');
    });

    it('every kind has a phrase in both languages', () => {
        for (const t of [de, en]) {
            const text = sum(ALL_EVENTS, 'x', t);
            expect(text).not.toMatch(/stepsSum/);
        }
        for (const k of ['Plan', 'Search', 'SearchOne', 'Thinking', 'Decision', 'DecisionOne', 'Answer', 'Refine', 'Team', 'Tool', 'ToolOne',
            'Graph', 'Check', 'Read', 'ReadOne', 'Listing', 'Attachment', 'Other', 'OtherOne', 'More', 'MoreOne', 'And']) {
            expect(de(`stepsSum${k}`), k).not.toBe(`stepsSum${k}`);
            expect(en(`stepsSum${k}`), k).not.toBe(`stepsSum${k}`);
        }
    });
});

describe('firstLine', () => {
    it('takes the first non-empty line without markdown markers', () => {
        expect(firstLine('\n\n**Ich** prüfe `die` PO.\nZweite Zeile')).toBe('Ich prüfe die PO.');
        expect(firstLine('- Punkt eins')).toBe('Punkt eins');
        expect(firstLine('1. Schritt')).toBe('Schritt');
    });
});

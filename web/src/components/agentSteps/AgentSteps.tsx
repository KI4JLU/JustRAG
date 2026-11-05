import { forwardRef, useId, useMemo, type ReactNode } from 'react';
import {
    BookOpen, Brain, CalendarClock, CircleCheck, Dot, FileSearch, ListTree, Network, Paperclip, PenLine, Scale, Search,
    Signpost, TriangleAlert, Users, Wrench, ChevronRight, type LucideIcon, type LucideProps,
} from 'lucide-react';
import {
    ChainOfThought, ChainOfThoughtContent, ChainOfThoughtSearchResult,
    ChainOfThoughtSearchResults, ChainOfThoughtStep, Collapsible, CollapsibleTrigger, Shimmer,
} from '@ki4jlu/design-system';
import { useTheme } from '../../contexts/ThemeContext';
import { formatDate } from '../../utils/dates';
import type { TrajectoryEvent } from '../../types';
import { buildSteps, summarizeSteps, type Step, type StepKind } from './buildSteps';

// The DS step takes an icon component; a warning step's icon is the amber
// triangle.
const WarningIcon = forwardRef<SVGSVGElement, LucideProps>(({ className, ...props }, ref) => (
    <TriangleAlert ref={ref} className={`${className ?? ''} text-warning`} {...props} />
)) as LucideIcon;
WarningIcon.displayName = 'WarningIcon';

const KIND_ICON: Record<StepKind, LucideIcon> = {
    thinking: Brain,
    plan: ListTree,
    search: Search,
    decision: Signpost,
    answer: CircleCheck,
    refine: PenLine,
    team: Users,
    tool: Wrench,
    graph: Network,
    check: Scale,
    read: BookOpen,
    listing: CalendarClock,
    attachment: Paperclip,
    other: Dot,
};

function iconFor(step: Step): LucideIcon {
    if (step.warning) return WarningIcon;
    return step.kind === 'search' && step.files?.length ? FileSearch : KIND_ICON[step.kind];
}

function hasDetail(step: Step): boolean {
    return !!(step.thinking || step.rationale || step.queries?.length || step.files?.length || step.lines?.length || step.diff?.length);
}

function StepDetail({ step, renderReasoning }: { step: Step; renderReasoning: () => ReactNode }) {
    const { t } = useTheme();
    if (step.thinking) return <>{renderReasoning()}</>;
    return (
        <>
            {step.queries && step.queries.length > 0 && (
                <ul className="m-0 list-disc space-y-1 pl-4">
                    {step.queries.map((q, i) => <li key={i}>{q}</li>)}
                </ul>
            )}
            {step.rationale && <p className="m-0">{step.rationale}</p>}
            {step.files && step.files.length > 0 && (
                <div className="space-y-1">
                    <p className="m-0">{t('stepFiles')}</p>
                    <ChainOfThoughtSearchResults>
                        {step.files.map(f => <ChainOfThoughtSearchResult key={f}>{f}</ChainOfThoughtSearchResult>)}
                    </ChainOfThoughtSearchResults>
                </div>
            )}
            {step.diff && step.diff.length > 0 && (
                <p data-testid="refine-diff" className="m-0 leading-relaxed break-words">
                    {step.diff.map((c, i) => {
                        if (c.kind === 'added') {
                            return <mark key={i} title={t('stepRefineAdded')} className="rounded-sm bg-warning-container px-0.5 text-on-surface">{c.text}</mark>;
                        }
                        if (c.kind === 'removed') return <del key={i}>{c.text}</del>;
                        return <span key={i}>{c.text}</span>;
                    })}
                </p>
            )}
            {step.lines?.map((l, i) => <p key={i} className="m-0">{l}</p>)}
        </>
    );
}

/**
 * One step: its line (title, then the truncated summary) and, below it, its
 * detail, always shown. Each row fades in as it mounts — a step arriving
 * while the answer is generated, or every row when the timeline opens
 * (index.css, .agent-step).
 */
function StepRow({ step, renderReasoning }: { step: Step; renderReasoning: () => ReactNode }) {
    const label = (
        <span className="flex min-w-0 items-center gap-2">
            <span className="shrink-0 text-on-surface">{step.title}</span>
            {step.summary && <span className="min-w-0 truncate">{step.summary}</span>}
        </span>
    );
    return (
        <ChainOfThoughtStep className="agent-step" data-stage={step.stage} icon={iconFor(step)} label={label} status="complete">
            {hasDetail(step) && (
                <div className="space-y-2 text-xs text-on-surface-variant">
                    <StepDetail step={step} renderReasoning={renderReasoning} />
                </div>
            )}
        </ChainOfThoughtStep>
    );
}

export interface AgentStepsProps {
    trajectory?: TrajectoryEvent[];
    reasoning?: string;
    /** The answer is being prepared (streaming, no answer text yet): the
     *  header names the current step instead of the summary. */
    working?: boolean;
    /** The reasoning is still streaming. */
    thinkingLive?: boolean;
    /** Caller-owned open state, see MessageContent. */
    open: boolean;
    onOpenChange: (open: boolean) => void;
    /** The reasoning text as rendered markdown, for the thinking row. */
    renderReasoning: () => ReactNode;
}

/**
 * The agent step timeline above an answer: the DS ChainOfThought, one step
 * per thing the assistant did — plan, research rounds, decisions, its
 * thinking, the fact check — in the order it happened, each a one-line row
 * with its detail below. Built from the live stream and, after a reload,
 * from the stored steps (messages.trajectory); nothing renders when there is
 * no step.
 *
 * The header is composed here rather than the DS ChainOfThoughtHeader, whose
 * brain icon and far-right chevron do not fit: it is the chevron, then one
 * line — the summary of what the steps did. It drives the DS content through
 * the same caller-owned open state.
 */
export function AgentSteps({ trajectory, reasoning, working, thinkingLive, open, onOpenChange, renderReasoning }: AgentStepsProps) {
    const { t, language } = useTheme();
    const contentId = useId();
    const steps = useMemo(
        () => buildSteps(trajectory, reasoning, t, { thinkingLive, formatDate: iso => formatDate(iso, language) }),
        [trajectory, reasoning, t, thinkingLive, language],
    );
    if (steps.length === 0) return null;

    const summary = summarizeSteps(steps, t);
    const current = steps[steps.length - 1].title;

    return (
        <ChainOfThought className="mb-4" data-testid="agent-steps" open={open}>
            <Collapsible open={open} onOpenChange={onOpenChange}>
                <CollapsibleTrigger
                    aria-controls={open ? contentId : undefined}
                    className="group flex w-full min-w-0 items-center gap-2 rounded-action text-left text-sm text-on-surface-variant transition-colors hover:text-on-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
                >
                    <ChevronRight aria-hidden="true" className="size-4 shrink-0 transition-transform group-data-[state=open]:rotate-90" />
                    <span className="min-w-0 truncate">
                        {working ? <Shimmer as="span" duration={1}>{current}</Shimmer> : summary}
                    </span>
                </CollapsibleTrigger>
            </Collapsible>
            <ChainOfThoughtContent id={contentId} className="agent-steps-content">
                {steps.map(step => <StepRow key={step.key} step={step} renderReasoning={renderReasoning} />)}
            </ChainOfThoughtContent>
        </ChainOfThought>
    );
}

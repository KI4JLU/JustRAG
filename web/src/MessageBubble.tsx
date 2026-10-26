import { memo, useState, useMemo, useEffect, useRef, useCallback } from 'react';
import { motion } from 'framer-motion';
import { FileText, ChevronDown, Check, Users, Bot, AlertTriangle, Info } from 'lucide-react';
import {
    Badge, Button, MessageBranch, MessageBranchNext, MessageBranchPage, MessageBranchPrevious, MessageBranchSelector,
    MessageToolbar, Sources, SourcesContent, SourcesTrigger,
} from '@ki4jlu/design-system';
import type { Message, BranchInfo, MessageAttachment, MessageVerification, MessageConflict } from './types';
import { flaggedClaimsFor } from './utils/verification';
import { useReducedMotion, getMotionProps } from './hooks/useReducedMotion';
import { BranchIndicator } from './components/BranchIndicator';
import { MessageActions } from './components/MessageActions';
import { MessageContextMenu } from './components/MessageContextMenu';
import { InlineMessageEditor } from './components/InlineMessageEditor';
import MessageContent from './components/MessageContent';
import { ComparisonFindings } from './components/ComparisonFindings';
import { messageSectionKey, type MessageSection } from './hooks/useMessageSections';
import { useIsMobileContext } from './contexts/MobileContext';
import { useTheme } from './contexts/ThemeContext';
import { HAPTIC_PATTERNS, triggerHaptic } from './utils/haptics';
import { withoutCitations } from './utils/citations';
import { buildCitationModel, citingTextByRaw, type CitedSource } from './utils/sourceDisplay';
import { citationMarkers } from './utils/citationRefs';
import { isTempMessageId } from './utils/messageTree';
import { normalizeMathDelimiters } from './utils/markdownMath';
import { SourceList } from './components/sources/SourceList';
import { useSourcePanel } from './contexts/SourcePanelContext';
import { formatMessageTime } from './utils/chatDates';
import { previewKindOf } from './utils/previewKind';
import { AttachmentChipItem } from './components/AttachmentChipItem';

interface MessageBubbleProps {
    message: Message;
    isStreaming?: boolean;
    /** The last message of the transcript: its action row stays visible at rest. */
    isLatest?: boolean;
    onPdfOpen?: (fileId: string, fileName: string, page: number) => void;
    onFollowUpClick?: (question: string) => void;
    showFollowUps?: boolean;
    branchInfo?: BranchInfo | null;
    onSwitchBranch?: (siblingId: string) => void;
    onEdit?: (messageId: string, newContent: string) => void;
    onFork?: (messageId: string) => void;
    onCompare?: (messageId: string) => void;
    onRegenerate?: (messageId: string) => void;
    onFeedback?: (messageId: string, feedback: 'positive' | 'negative' | null, comment?: string) => void;
    isEditing?: boolean;
    onEditCancel?: () => void;
    onPreviewSource?: (fileId: string, fileName: string) => void;
    /** Opens a chat attachment (the user's own file) in the preview window. */
    onPreviewAttachment?: (attachment: MessageAttachment) => void;
    onViewGraph?: (messageId: string) => void;
    animationDelay?: number;
    kbId?: string;
    questionText?: string;
    // Expand state for the height-changing answer sections. Owned by the chat
    // view rather than this component: the list is virtualized, so local state
    // here would reset on remount and change the item's measured height mid
    // scroll. See useMessageSections.
    reasoningOpen?: boolean;
    sourcesOpen?: boolean;
    confidenceOpen?: boolean;
    conflictsOpen?: boolean;
    onToggleSection?: (messageId: string, section: MessageSection) => void;
    // Resolves an AI message's teamId/agentId to a display name for the
    // attribution chip. Returns undefined on a lookup miss (e.g. the team or
    // agent was later deleted) — the chip then renders nothing rather than
    // an empty label.
    resolveAttribution?: (message: Message) => string | undefined;
    /**
     * Whether the caller may see an answer's citations
     * (capabilities.seeCitations; default true, as from a backend without
     * capabilities). false renders the answer without them — no inline
     * markers or source popover, no source list, no conflict report — see
     * withoutCitations.
     */
    showCitations?: boolean;
}

interface ConfidenceProps {
    verification: MessageVerification;
    t: (key: string) => string;
}

// confidenceTone maps a verification verdict to a status tone: success ≥80,
// warning ≥60, error below that and when unverified. Shared by the confidence
// chip and its expandable breakdown.
function confidenceTone(verification: MessageVerification): { tone: 'success' | 'warning' | 'error'; bar: string; labelKey: string } {
    const { verified, score } = verification;
    if (!verified) return { tone: 'error', bar: 'bg-error', labelKey: 'verificationUnverified' };
    if (score >= 80) return { tone: 'success', bar: 'bg-success', labelKey: 'verificationVerified' };
    if (score >= 60) return { tone: 'warning', bar: 'bg-warning', labelKey: 'verificationPartial' };
    return { tone: 'error', bar: 'bg-error', labelKey: 'verificationLowConfidence' };
}

// hasFactcheckOutput reports whether the LLM-based factchecker actually
// produced a verdict on this message. The MessageVerification blob is shared
// with the deterministic citation validator, which leaves score=0 / issues=[]
// untouched when the factchecker didn't run. Without this gate, an answer
// that only carries citation-validator output would render a spurious red
// "Unverified" badge driven by the falsy factchecker defaults.
function hasFactcheckOutput(v: MessageVerification): boolean {
    return v.score > 0 || (v.issues?.length ?? 0) > 0;
}

type SuspectReason = 'out_of_range' | 'no_overlap';

// suspectCitations maps the raw citation numbers the n-gram validator could
// not back up to the validator's reason: their chips are amber (colour only)
// and the preview says why. Undefined when validation didn't run or flagged
// nothing.
function suspectCitations(v: MessageVerification | null | undefined): Map<number, SuspectReason> | undefined {
    if (!v?.citations?.length) return undefined;
    const out = new Map<number, SuspectReason>();
    for (const c of v.citations) {
        if (!c.verified) out.set(c.n, c.reason);
    }
    return out.size > 0 ? out : undefined;
}

// citationSpanMap collects every citation N with a verified span (method =
// "span") into the Map MessageContent expects, keyed by N. Returns undefined
// when the span verifier didn't run or found nothing, so MessageContent
// skips the highlighted-excerpt path entirely and popovers render the old
// flat snippet.
function citationSpanMap(v: MessageVerification | null | undefined): Map<number, { start: number; end: number }> | undefined {
    if (!v?.citations?.length) return undefined;
    const out = new Map<number, { start: number; end: number }>();
    for (const c of v.citations) {
        if (c.verified && c.span) out.set(c.n, c.span);
    }
    return out.size > 0 ? out : undefined;
}

// fill replaces `{name}` placeholders in a translated string.
const fill = (text: string, values: Record<string, number>) =>
    text.replace(/\{(\w+)\}/g, (m, k: string) => (k in values ? String(values[k]) : m));

// The footer's toggles (confidence, conflicts) read like the „Quellen" trigger
// beside them: text with a chevron, no grey box on hover — the hover is a
// slight fade, the open state the rotated chevron.
const footerChipClass = 'group h-8 gap-1 px-1 py-0 hover:bg-transparent hover:opacity-80 active:scale-100';

const chevronClass = 'size-3.5 transition-transform motion-reduce:transition-none group-aria-expanded:rotate-180';

// ConfidenceChip is the answer-footer chip ("✓ Geprüft · 92%"). Clicking it
// toggles the ConfidenceDetails breakdown (owned by MessageBubble).
function ConfidenceChip({ verification, t, open, onToggle }: ConfidenceProps & { open: boolean; onToggle: () => void }) {
    const { verified, score } = verification;
    const c = confidenceTone(verification);
    return (
        <Button type="button" variant="ghost" size="sm" className={footerChipClass} onClick={onToggle} aria-expanded={open}>
            <Badge appearance="text" tone={c.tone}>
                <Check className="size-3.5" aria-hidden="true" />
                {t(c.labelKey)}{verified ? ` · ${score}%` : ''}
            </Badge>
            <ChevronDown className={chevronClass} aria-hidden="true" />
        </Button>
    );
}

// ConfidenceDetails is the expandable fact-check breakdown: a score bar plus
// per-method counts (wortgenau / semantisch / Hinweise) derived from the
// citation validator + factuality verifier output.
function ConfidenceDetails({ verification, t }: ConfidenceProps) {
    const { score, issues, citations } = verification;
    const c = confidenceTone(verification);
    const exact = citations?.filter(x => x.verified && x.method !== 'semantic').length ?? 0;
    const semantic = citations?.filter(x => x.verified && x.method === 'semantic').length ?? 0;
    const hints = (issues?.length ?? 0) + (citations?.filter(x => !x.verified).length ?? 0);
    return (
        <div className="mt-2 flex max-w-[420px] flex-col gap-2 rounded-lg border border-outline-variant bg-surface-container-low p-3">
            <div className="h-1.5 overflow-hidden rounded-full bg-outline-variant">
                {/* The width is the score itself, so it stays a style value. */}
                <div
                    className={`h-full rounded-full transition-[width] duration-300 motion-reduce:transition-none ${c.bar}`}
                    style={{ width: `${Math.max(0, Math.min(100, score))}%` }}
                />
            </div>
            <div className="flex flex-wrap gap-4 text-xs text-on-surface-variant">
                <span><strong className="text-on-surface">{exact}</strong> {t('confidenceExactMatch')}</span>
                <span><strong className="text-on-surface">{semantic}</strong> {t('confidenceSemantic')}</span>
                <span><strong className="text-on-surface">{hints}</strong> {t('confidenceHints')}</span>
            </div>
            {issues && issues.length > 0 && (
                <ul className="m-0 list-disc pl-4 text-xs text-on-surface-variant">
                    {issues.map((iss, i) => <li key={i}>{iss}</li>)}
                </ul>
            )}
        </div>
    );
}

// ConflictsChip is the "Widersprüchliche Quellen" / "Conflicting sources"
// answer-footer chip (Wave 5 conflict surfacing), shown next to the
// confidence chip whenever the turn's report found at least one conflict
// among the cited sources. Click toggles ConflictsDetails — same
// caller-owned-open-state pattern as ConfidenceChip (see useMessageSections;
// the state has to live above the virtualized message list).
function ConflictsChip({ count, t, open, onToggle }: { count: number; t: (key: string) => string; open: boolean; onToggle: () => void }) {
    return (
        <Button
            type="button"
            variant="ghost"
            size="sm"
            className={footerChipClass}
            onClick={onToggle}
            aria-expanded={open}
            aria-label={t('conflictsBadge')}
        >
            <Badge appearance="text" tone="error">
                <AlertTriangle className="size-3.5" aria-hidden="true" />
                {t('conflictsBadge')} · {count}
            </Badge>
            <ChevronDown className={chevronClass} aria-hidden="true" />
        </Button>
    );
}

// CONFLICT_KIND_KEY maps the backend's closed `kind` enum to its translation
// key: "contradiction" -> Widerspruch/Contradiction, "superseded" ->
// überholt/superseded.
const CONFLICT_KIND_KEY: Record<MessageConflict['kind'], string> = {
    contradiction: 'conflictKindContradiction',
    superseded: 'conflictKindSuperseded',
};

// ConflictsDetails lists every reported conflict: the claim, the two cited
// files, the kind, and — only when `newer` is 'a' or 'b' (never 'unknown') —
// which file is the more recent one. `newer` resolves against fileA/fileB by
// the backend's fixed convention: 'a' -> fileA, 'b' -> fileB.
function ConflictsDetails({ conflicts, t }: { conflicts: MessageConflict[]; t: (key: string) => string }) {
    return (
        <div className="conflict-details">
            {conflicts.map((c, i) => {
                const newerFile = c.newer === 'a' ? c.fileA : c.newer === 'b' ? c.fileB : undefined;
                return (
                    <div key={i} className="conflict-item">
                        <div className="conflict-claim">{c.claim}</div>
                        <div className="conflict-files">{c.fileA} vs. {c.fileB}</div>
                        <div className="conflict-kind">{t(CONFLICT_KIND_KEY[c.kind])}</div>
                        {newerFile && <div className="conflict-newer">{t('conflictNewerPrefix')}: {newerFile}</div>}
                    </div>
                );
            })}
        </div>
    );
}

function MessageBubble({ message: rawMessage, showCitations = true, isStreaming, isLatest = false, onPdfOpen, onFollowUpClick, showFollowUps, branchInfo, onSwitchBranch, onEdit, onFork, onCompare, onRegenerate, onFeedback, isEditing, onEditCancel, onPreviewSource, onPreviewAttachment, onViewGraph, animationDelay, kbId, questionText, resolveAttribution, reasoningOpen = false, sourcesOpen = false, confidenceOpen = false, conflictsOpen = false, onToggleSection }: MessageBubbleProps) {
    const { t, language } = useTheme();
    // An answer without its citations for a caller who may not see them.
    // Everything below — rendering, copy and export — reads this one object.
    const message = useMemo(
        () => (showCitations || rawMessage.role !== 'ai' ? rawMessage : withoutCitations(rawMessage)),
        [rawMessage, showCitations],
    );
    const isThinking = Boolean(isStreaming && message.reasoning && !message.content);
    const isMobile = useIsMobileContext();
    const reducedMotion = useReducedMotion();
    const [isHovered, setIsHovered] = useState(false);
    const [isFocused, setIsFocused] = useState(false);
    const [tapped, setTapped] = useState(false);
    // The tap that ends a long-press must not also toggle the footer.
    const menuClosedAtRef = useRef(0);
    const menuOpenRef = useRef(false);
    const handleMenuOpenChange = useCallback((open: boolean) => {
        menuOpenRef.current = open;
        if (!open) menuClosedAtRef.current = Date.now();
    }, []);
    // A popover opened from the answer actions keeps them shown while the
    // pointer is elsewhere.
    const [actionPopoverOpen, setActionPopoverOpen] = useState(false);
    // §8 answer-footer expandable sections — state lives in the chat view, keyed
    // by messageSectionKey, so it survives remounts (see the props).
    const confOpen = confidenceOpen;
    const sourcesExpanded = sourcesOpen;
    const conflictsExpanded = conflictsOpen;
    const sectionKey = messageSectionKey(message);
    const toggleSection = useCallback((section: MessageSection) => {
        if (sectionKey) onToggleSection?.(sectionKey, section);
    }, [sectionKey, onToggleSection]);
    const bubbleRef = useRef<HTMLDivElement>(null);
    const contentRef = useRef<HTMLDivElement>(null);

    // Close actions on outside click (mobile)
    useEffect(() => {
        if (!isMobile || !tapped) return;
        const handler = (e: MouseEvent) => {
            if (bubbleRef.current && !bubbleRef.current.contains(e.target as Node)) {
                setTapped(false);
            }
        };
        document.addEventListener('click', handler, true);
        return () => document.removeEventListener('click', handler, true);
    }, [isMobile, tapped]);

    const showActions = isMobile ? tapped : (isHovered || isFocused);
    // The footer shows on hover, focus inside the message or (touch) a tap, and
    // stays while a popover opened from it is open. On touch the actions are
    // not in it: they open from the long-press menu. The last message keeps it
    // at rest, and an expanded section (sources, confidence, conflicts) pins it
    // like a popover, so the toggle that closes it stays next to what it opened.
    const sectionExpanded = sourcesExpanded || confOpen || conflictsExpanded;
    const footerShown = (isLatest && !isMobile) || actionPopoverOpen || sectionExpanded || showActions;
    // The actions need the saved message: they appear once the answer is
    // saved (its aiMessageId arrives right after the last token), not at the
    // end of the turn — the checks after it (citations, fact check) can take
    // a while and join the footer when they finish.
    const actionsReady = !!message.id && !isTempMessageId(message.id);
    // A question carries its bubble inside the row, with its action row below it.
    const isQuestion = message.role === 'user' && !message.isEnhanced;
    const revealClass = 'transition-[opacity,visibility] duration-150 motion-reduce:transition-none data-[revealed=false]:invisible data-[revealed=false]:opacity-0';

    // Citation pills are owned by MessageContent: a click there opens the
    // source popover, and the document is opened from inside it via
    // handleOpenSource below. MessageBubble deliberately holds no citation
    // click/keydown delegation of its own — two handlers on the same click
    // meant a pill both previewed and navigated.

    // openSourceByFile dispatches a citation/source open to the PDF viewer or
    // the text-preview handler, depending on file type.
    const openSourceByFile = useCallback((fileName: string, fileId?: string, firstPage = 1) => {
        if (!fileId) return;
        // A PDF opens at its first cited page; every other kind is resolved
        // by the preview handler (utils/previewKind).
        if (previewKindOf({ name: fileName }) === 'pdf' && onPdfOpen) onPdfOpen(fileId, fileName, firstPage);
        else if (onPreviewSource) onPreviewSource(fileId, fileName);
    }, [onPdfOpen, onPreviewSource]);

    // Opening a source needs a handler, and ChatView passes one only with
    // downloadSources (the PDF viewer and the preview load the file).
    const canOpenSources = !!onPdfOpen || !!onPreviewSource;

    // Per-answer numbering of the cited sources (utils/sourceDisplay), shared
    // by the chips, the source list, the preview and the source panel.
    const citationModel = useMemo(() => buildCitationModel(message.content, message.sources), [message.content, message.sources]);
    const spans = useMemo(() => citationSpanMap(message.verification), [message.verification]);
    const suspect = useMemo(() => suspectCitations(message.verification), [message.verification]);

    // "In Quelle öffnen": the source panel next to the answer (chat view), or
    // the document itself where there is no panel (comparison view).
    const sourcePanel = useSourcePanel();
    // The same text MessageContent hands to addCitationRefs, so `occ` matches the chips.
    const markers = useMemo(() => citationMarkers(normalizeMathDelimiters(message.content), citationModel), [message.content, citationModel]);
    const openPanel = useCallback((source: CitedSource, passage: number, focus?: string, occ?: number) => {
        if (sourcePanel && sectionKey) {
            sourcePanel.open({
                messageKey: sectionKey, source, passage, spans, citing: citingTextByRaw(message.content), focus,
                model: citationModel, markers, occ,
            });
            return;
        }
        if (source.fileId) openSourceByFile(source.fileName, source.fileId, source.passages[passage]?.pages?.[0] || 1);
    }, [sourcePanel, sectionKey, spans, openSourceByFile, message.content, citationModel, markers]);
    const canOpenPanel = !!sourcePanel || canOpenSources;
    const handleOpenPanel = useCallback((n: number, raw: number, focus?: string, occ?: number) => {
        const source = citationModel.cited[n - 1];
        if (source) openPanel(source, Math.max(0, source.rawNumbers.indexOf(raw)), focus, occ);
    }, [citationModel, openPanel]);
    const panelTarget = sourcePanel?.target && sourcePanel.target.messageKey === sectionKey ? sourcePanel.target : null;
    const activeCitation = useMemo(() => (panelTarget
        ? { n: panelTarget.source.n, raw: panelTarget.source.rawNumbers[panelTarget.passage], occ: panelTarget.occ }
        : null), [panelTarget]);

    // "Alle N Quellen": opens the source list and brings it into view.
    const sourceListRef = useRef<HTMLDivElement>(null);
    const handleShowAllSources = useCallback(() => {
        if (!sourcesExpanded) toggleSection('sources');
        requestAnimationFrame(() => sourceListRef.current?.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' }));
    }, [sourcesExpanded, toggleSection]);

    // Attribution chip name — undefined on a lookup miss (team/agent deleted
    // after answering), in which case the chip renders nothing.
    const attributionName = message.role === 'ai' && (message.teamId || message.agentId)
        ? resolveAttribution?.(message)
        : undefined;

    // If editing this message inline, show editor instead
    if (isEditing && message.role === 'user' && onEdit && onEditCancel && message.id) {
        return (
            <div style={{ alignSelf: 'flex-end', width: '100%', maxWidth: '85%' }}>
                {branchInfo && onSwitchBranch && (
                    <BranchIndicator branchInfo={branchInfo} onSwitchBranch={onSwitchBranch} />
                )}
                <InlineMessageEditor
                    initialContent={message.content}
                    onSave={(newContent) => onEdit(message.id!, newContent)}
                    onCancel={onEditCancel}
                />
            </div>
        );
    }

    // Files attached to this question (chat attachments as context): the
    // composer's chips (DS AttachmentChip), read-only, above the bubble.
    const attachmentChips = message.attachments && message.attachments.length > 0 && (
        <ul
            aria-label={t('chatAttachmentsLabel')}
            className="m-0 mb-1.5 flex max-w-full list-none flex-wrap justify-end gap-2 p-0"
        >
            {message.attachments.map(a => (
                <li key={a.userFileId} className="min-w-0 max-w-full">
                    <AttachmentChipItem attachment={a} onOpen={onPreviewAttachment} />
                </li>
            ))}
        </ul>
    );

    const questionBody = (
        <>
            {message.content}
        </>
    );

    return (
        <MessageContextMenu
            message={message}
            enabled={actionsReady && !message.isEnhanced}
            onOpenChange={handleMenuOpenChange}
            onEdit={message.role === 'user' && onEdit ? () => onEdit(message.id!, message.content) : undefined}
            // Fork and regenerate start a new turn: not while this one still runs.
            onFork={message.role === 'ai' && onFork && !isLatest && !isStreaming ? () => onFork(message.id!) : undefined}
            onCompare={message.role === 'ai' && onCompare ? () => onCompare(message.id!) : undefined}
            onRegenerate={onRegenerate && !isStreaming ? () => onRegenerate(message.id!) : undefined}
            onFeedback={onFeedback ? (fb, comment) => onFeedback(message.id!, fb, comment) : undefined}
            onViewGraph={onViewGraph && citationModel.cited.length > 0 ? () => onViewGraph(message.id!) : undefined}
            contentRef={message.role === 'ai' ? contentRef : undefined}
            kbId={kbId}
            questionText={questionText}
        >
            <motion.div
                ref={bubbleRef}
                {...getMotionProps(reducedMotion)}
                initial={{ opacity: 0, y: 10, scale: 0.99 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                transition={{ duration: 0.3, ease: "easeOut", delay: animationDelay ?? 0 }}
                className={`${isQuestion
                    ? 'message-question flex min-w-0 max-w-full flex-col items-end self-end'
                    : `message-bubble ${message.role === 'user' ? 'message-user' : 'message-ai'}`}${isMobile ? ' select-none' : ''}`}
                style={message.isEnhanced ? {
                    background: 'var(--msg-enhanced-bg)',
                    color: 'var(--msg-enhanced-text)',
                    fontStyle: 'italic',
                    fontSize: '0.9rem',
                    border: `1px dashed var(--msg-enhanced-border)`,
                    alignSelf: 'flex-end',
                    borderRadius: 'var(--shape-xl) var(--shape-xl) var(--shape-sm) var(--shape-xl)',
                    padding: '0.5rem 1rem'
                } : isQuestion ? undefined : { position: 'relative' as const }}
                onMouseEnter={isMobile ? undefined : () => setIsHovered(true)}
                onMouseLeave={isMobile ? undefined : () => setIsHovered(false)}
                onClick={isMobile ? (e) => {
                    // A tap on a control (or inside a popover or menu portalled from
                    // one) is that control's, not a tap on the message.
                    const target = e.target as Element;
                    if (!e.currentTarget.contains(target) || target.closest('button, a, input, textarea, [role="button"], [role="menuitem"]')) return;
                    if (menuOpenRef.current || Date.now() - menuClosedAtRef.current < 500) return;
                    setTapped(prev => {
                        const next = !prev;
                        if (next) {
                            triggerHaptic(HAPTIC_PATTERNS.reveal);
                        }
                        return next;
                    });
                } : undefined}
                onFocus={isMobile ? undefined : () => setIsFocused(true)}
                onBlur={isMobile ? undefined : () => setIsFocused(false)}
                tabIndex={0}
            >
                {branchInfo && onSwitchBranch && message.isEnhanced && (
                    <BranchIndicator branchInfo={branchInfo} onSwitchBranch={onSwitchBranch} />
                )}

                {message.role === 'ai' ? (
                    // Inert wrapper. It used to be role="button" tabIndex={0} purely to
                    // carry the citation click/keydown delegation, which made screen
                    // readers announce the entire answer as a single button. Citation
                    // pills are individually focusable buttons now, so nothing here
                    // needs button semantics.
                    <div ref={contentRef} style={{ minWidth: 0 }}>
                        <MessageContent
                            content={message.content}
                            reasoning={message.reasoning}
                            isThinking={isThinking}
                            sources={message.sources}
                            citationModel={citationModel}
                            suspectCitations={suspect}
                            citationSpans={spans}
                            activeCitation={activeCitation}
                            onOpenPanel={canOpenPanel ? handleOpenPanel : undefined}
                            onShowAllSources={citationModel.cited.length > 0 ? handleShowAllSources : undefined}
                            trajectory={message.trajectory}
                            flaggedClaims={flaggedClaimsFor(message.verification)}
                            reasoningOpen={reasoningOpen}
                            onToggleReasoning={() => toggleSection('reasoning')}
                        />
                    </div>
                ) : isQuestion ? (
                    <>
                        {attachmentChips}
                        <div className="message-bubble message-user">
                            {questionBody}
                        </div>
                        {/* Under the bubble, shown with the other controls (hover,
                            focus, tap): the question's actions and, for an
                            edited question, its version selector. */}
                        {((branchInfo && onSwitchBranch && branchInfo.total > 1) || (actionsReady && !isMobile) || message.createdAt) && (
                            <div
                                data-testid="question-actions"
                                data-revealed={footerShown}
                                // The row is as tall as its buttons from the start: copy
                                // and edit appear only once the server confirms the
                                // question (a real id, seconds after sending), and a row
                                // growing then made the question jump.
                                className={`mt-1 flex items-center justify-end gap-1 ${isMobile ? '' : 'min-h-8'} ${revealClass}`}
                            >
                                {/* When the question was asked — the day stands on the separator above. */}
                                {message.createdAt && (
                                    <time dateTime={message.createdAt} className="mr-1 text-xs tabular-nums text-on-surface-variant">
                                        {formatMessageTime(message.createdAt, language)}
                                    </time>
                                )}
                                {actionsReady && !isMobile && (
                                    <MessageActions
                                        message={message}
                                        canCopy
                                        onEdit={onEdit ? () => onEdit(message.id!, message.content) : undefined}
                                    />
                                )}
                                {branchInfo && onSwitchBranch && branchInfo.total > 1 && (
                                    <BranchIndicator branchInfo={branchInfo} onSwitchBranch={onSwitchBranch} />
                                )}
                            </div>
                        )}
                    </>
                ) : <>{attachmentChips}{questionBody}</>}

                {message.role === 'ai' && message.comparisonFindings && message.comparisonFindings.length > 0 && (
                    <ComparisonFindings findings={message.comparisonFindings} t={t} />
                )}

                {/* §8 answer footer: shown on hover, focus inside the answer or a tap,
                    keeping its space while hidden. The source list and the actions wait for
                    the saved answer; checks and versions join as they arrive. */}
                {message.role === 'ai' && !message.isEnhanced && (!isStreaming || message.content || message.reasoning) && (
                    <Sources
                        className="mb-0"
                        open={sourcesExpanded}
                        onOpenChange={(open) => { if (open !== sourcesExpanded) toggleSection('sources'); }}
                    >
                        <MessageToolbar
                            data-testid="answer-footer"
                            data-revealed={footerShown}
                            className={`mt-2 min-h-8 flex-wrap justify-start gap-1 ${revealClass}`}
                        >
                            {attributionName && (
                                <Badge appearance="text" tone="neutral">
                                    {message.teamId ? <Users className="size-3.5" aria-hidden="true" /> : <Bot className="size-3.5" aria-hidden="true" />}
                                    {attributionName}
                                </Badge>
                            )}
                            {/* The source list joins the footer with the saved answer, not
                                while the text still streams. */}
                            {!actionsReady ? null : citationModel.cited.length > 0 ? (
                                <SourcesTrigger count={citationModel.cited.length}>
                                    <FileText className="size-4" aria-hidden="true" />
                                    <span className="font-medium">{t('answerSourcesToggle')} · {citationModel.cited.length}</span>
                                    <ChevronDown className="size-4 transition-transform motion-reduce:transition-none group-data-[state=open]:rotate-180" aria-hidden="true" />
                                </SourcesTrigger>
                            ) : (
                                // An answer without a cited source (a follow-up question, say).
                                <Badge appearance="text" tone="neutral" data-testid="no-sources">
                                    <Info className="size-3.5" aria-hidden="true" />
                                    {t('noMatchingSources')}
                                </Badge>
                            )}
                            {message.verification != null && hasFactcheckOutput(message.verification) && (
                                <ConfidenceChip
                                    verification={message.verification}
                                    t={t}
                                    open={confOpen}
                                    onToggle={() => toggleSection('confidence')}
                                />
                            )}
                            {message.conflicts != null && message.conflicts.length > 0 && (
                                <ConflictsChip
                                    count={message.conflicts.length}
                                    t={t}
                                    open={conflictsExpanded}
                                    onToggle={() => toggleSection('conflicts')}
                                />
                            )}
                            {branchInfo && onSwitchBranch && branchInfo.total > 1 && (
                                <MessageBranch
                                    className="w-auto"
                                    branch={branchInfo.currentIndex}
                                    totalBranches={branchInfo.total}
                                    onBranchChange={(i) => {
                                        const id = branchInfo.siblingIds[i];
                                        if (id) onSwitchBranch(id);
                                    }}
                                >
                                    <MessageBranchSelector aria-label={t('answerVersions')}>
                                        <MessageBranchPrevious formatLabel={(target, total) => fill(t('previousVersion'), { target, total })} />
                                        <MessageBranchPage format={(current, total) => fill(t('versionPage'), { current, total })} />
                                        <MessageBranchNext formatLabel={(target, total) => fill(t('nextVersion'), { target, total })} />
                                    </MessageBranchSelector>
                                </MessageBranch>
                            )}
                            {/* Shown once the answer is saved — not during generation;
                                sources, checks and versions join the footer as they
                                arrive. While the turn's checks still run, the actions
                                that start a new turn wait for it. */}
                            {actionsReady && !isMobile && (
                                <div data-testid="answer-actions" className="min-w-0">
                                    <MessageActions
                                        message={message}
                                        turnRunning={!!isStreaming}
                                        // Branching from the last answer would copy the whole chat:
                                        // the action is offered on earlier answers only.
                                        onFork={onFork && !isLatest ? () => onFork(message.id!) : undefined}
                                        onCompare={onCompare ? () => onCompare(message.id!) : undefined}
                                        onRegenerate={onRegenerate ? () => onRegenerate(message.id!) : undefined}
                                        onFeedback={onFeedback ? (fb, comment) => onFeedback(message.id!, fb, comment) : undefined}
                                        onViewGraph={onViewGraph && citationModel.cited.length > 0 ? () => onViewGraph(message.id!) : undefined}
                                        onPopoverOpenChange={setActionPopoverOpen}
                                        kbId={kbId}
                                        questionText={questionText}
                                        contentRef={contentRef}
                                    />
                                </div>
                            )}
                        </MessageToolbar>

                        {confOpen && message.verification != null && (
                            <ConfidenceDetails verification={message.verification} t={t} />
                        )}

                        {conflictsExpanded && message.conflicts != null && message.conflicts.length > 0 && (
                            <ConflictsDetails conflicts={message.conflicts} t={t} />
                        )}

                        {actionsReady && citationModel.cited.length > 0 && (
                            <SourcesContent className="w-full" ref={sourceListRef}>
                                <SourceList
                                    sources={citationModel.cited}
                                    activeN={activeCitation?.n ?? null}
                                    onOpen={canOpenPanel ? (source) => openPanel(source, 0) : undefined}
                                />
                            </SourcesContent>
                        )}
                    </Sources>
                )}

                {showFollowUps && message.followUpQuestions && message.followUpQuestions.length > 0 && onFollowUpClick && (
                    <div style={{ marginTop: '1rem' }}>
                        <div className="source-label" style={{ marginBottom: '0.5rem' }}>{t('followUpsLabel')}</div>
                        <div className="follow-up-suggestions" style={{ marginTop: 0, paddingTop: 0, borderTop: 'none' }}>
                            {message.followUpQuestions.map((q, idx) => (
                                <button
                                    key={idx}
                                    className="follow-up-chip"
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        onFollowUpClick(q);
                                    }}
                                >
                                    {q}
                                </button>
                            ))}
                        </div>
                    </div>
                )}
            </motion.div>
        </MessageContextMenu>
    );
}

export default memo(MessageBubble);

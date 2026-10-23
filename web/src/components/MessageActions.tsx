import { useEffect, useRef, useState } from 'react';
import { Copy, Pencil, GitBranch, Columns, RefreshCw, ThumbsUp, ThumbsDown, ExternalLink, Network } from 'lucide-react';
import { Button, MessageAction, MessageActions as DsMessageActions, Textarea } from '@ki4jlu/design-system';
import type { Message } from '../types';
import { HAPTIC_PATTERNS, triggerHaptic } from '../utils/haptics';
import { openExternal } from '../utils/openExternal';
import { useTheme } from '../contexts/ThemeContext';
import { useMessageActionRules, useMessageExport } from '../hooks/useMessageActions';
import { AnswerExportMenu } from './AnswerExportMenu';
import { AnchoredPopover } from './AnchoredPopover';

interface MessageActionsProps {
    message: Message;
    onEdit?: () => void;
    onFork?: () => void;
    onCompare?: () => void;
    onRegenerate?: () => void;
    onFeedback?: (feedback: 'positive' | 'negative' | null, comment?: string) => void;
    onViewGraph?: () => void;
    /** Offers copying the message text (the question row). */
    canCopy?: boolean;
    kbId?: string;
    questionText?: string;
    contentRef?: React.RefObject<HTMLDivElement | null>;
    /** Reports whether a popover opened from this row (feedback comment, export menu) is open. */
    onPopoverOpenChange?: (open: boolean) => void;
    /**
     * The turn is still running (the checks after the answer): the actions
     * that start a new turn — regenerate, branch — are disabled until it ends.
     */
    turnRunning?: boolean;
}

const MAX_COMMENT_LEN = 2000;

interface FeedbackThumbsProps {
    message: Message;
    onFeedback: (feedback: 'positive' | 'negative' | null, comment?: string) => void;
    onOpenChange: (open: boolean) => void;
    t: (key: string) => string;
}

function FeedbackThumbs({ message, onFeedback, onOpenChange, t }: FeedbackThumbsProps) {
    const [pendingRating, setPendingRating] = useState<'positive' | 'negative' | null>(null);
    const [comment, setComment] = useState('');
    const positiveRef = useRef<HTMLButtonElement>(null);
    const negativeRef = useRef<HTMLButtonElement>(null);
    // Anchor the comment popover to whichever thumb opened it (§6: open from the thumb).
    const activeTriggerRef = pendingRating === 'negative' ? negativeRef : positiveRef;
    const open = pendingRating !== null;

    useEffect(() => { onOpenChange(open); }, [open, onOpenChange]);

    // Focus goes back to the thumb: the box's own controls are about to unmount.
    const closePopover = () => {
        activeTriggerRef.current?.focus();
        setPendingRating(null);
        setComment('');
    };

    const submitWithComment = () => {
        if (pendingRating === null) return;
        const trimmed = comment.trim();
        onFeedback(pendingRating, trimmed.length > 0 ? trimmed : undefined);
        closePopover();
    };

    const handleThumbClick = (rating: 'positive' | 'negative') => {
        // Toggle off if same rating already active.
        if (message.feedback === rating) {
            onFeedback(null);
            setPendingRating(null);
            setComment('');
            return;
        }
        // First click: send the rating immediately AND open the comment box.
        triggerHaptic(HAPTIC_PATTERNS.action);
        onFeedback(rating);
        setPendingRating(rating);
        setComment('');
    };

    return (
        <>
            <MessageAction
                ref={positiveRef}
                tooltip={t('helpfulAnswer')}
                aria-pressed={message.feedback === 'positive'}
                onClick={() => handleThumbClick('positive')}
            >
                <ThumbsUp className="size-4" aria-hidden="true" />
            </MessageAction>
            <MessageAction
                ref={negativeRef}
                tooltip={t('unhelpfulAnswer')}
                aria-pressed={message.feedback === 'negative'}
                onClick={() => handleThumbClick('negative')}
            >
                <ThumbsDown className="size-4" aria-hidden="true" />
            </MessageAction>

            <AnchoredPopover
                open={open}
                triggerRef={activeTriggerRef}
                onClose={closePopover}
                align="start"
                width={280}
                role="dialog"
                ariaLabel={pendingRating === 'negative' ? t('feedbackTitleNegative') : t('feedbackTitlePositive')}
            >
                <div className="flex flex-col gap-2 p-3">
                    <p className="m-0 text-sm font-semibold text-on-surface">
                        {pendingRating === 'negative' ? t('feedbackTitleNegative') : t('feedbackTitlePositive')}
                    </p>
                    {/* eslint-disable-next-line jsx-a11y/no-autofocus */}
                    <Textarea autoFocus
                        value={comment}
                        onChange={(e) => setComment(e.target.value.slice(0, MAX_COMMENT_LEN))}
                        placeholder={t('feedbackCommentPlaceholder')}
                        rows={3}
                    />
                    <div className="flex items-center justify-between gap-2">
                        <span className="text-xs text-on-surface-variant">
                            {comment.length} / {MAX_COMMENT_LEN}
                        </span>
                        <div className="flex gap-2">
                            <Button type="button" variant="outline" size="sm" onClick={closePopover}>
                                {t('cancel')}
                            </Button>
                            <Button type="button" size="sm" onClick={submitWithComment}>
                                {t('feedbackCommentSubmit')}
                            </Button>
                        </div>
                    </div>
                </div>
            </AnchoredPopover>
        </>
    );
}

export function MessageActions({ message, onEdit, onFork, onCompare, onRegenerate, onFeedback, onViewGraph, canCopy, kbId, questionText, contentRef, onPopoverOpenChange, turnRunning = false }: MessageActionsProps) {
    const { t } = useTheme();
    const rules = useMessageActionRules(message, { onEdit, onFork, onCompare, onRegenerate, onFeedback, onViewGraph, contentRef });
    const exporter = useMessageExport(message);
    const [feedbackOpen, setFeedbackOpen] = useState(false);
    const [exportOpen, setExportOpen] = useState(false);
    const popoverOpen = feedbackOpen || exportOpen;

    useEffect(() => {
        onPopoverOpenChange?.(popoverOpen);
        return () => { if (popoverOpen) onPopoverOpenChange?.(false); };
    }, [popoverOpen, onPopoverOpenChange]);

    const act = (fn: () => void) => () => { triggerHaptic(HAPTIC_PATTERNS.action); fn(); };

    const traceUrl = rules.traceUrl;

    return (
        <DsMessageActions className={message.role === 'user' ? 'flex-wrap justify-end' : 'flex-wrap'}>
            {canCopy && (
                <MessageAction tooltip={t('copy')} onClick={act(exporter.copy)}>
                    <Copy className="size-4" aria-hidden="true" />
                </MessageAction>
            )}
            {rules.edit && onEdit && (
                <MessageAction tooltip={t('editMessage')} onClick={act(onEdit)}>
                    <Pencil className="size-4" aria-hidden="true" />
                </MessageAction>
            )}
            {rules.feedback && onFeedback && (
                <FeedbackThumbs message={message} onFeedback={onFeedback} onOpenChange={setFeedbackOpen} t={t} />
            )}
            {rules.regenerate && onRegenerate && (
                <MessageAction tooltip={t('regenerateResponse')} onClick={act(onRegenerate)} disabled={turnRunning}>
                    <RefreshCw className="size-4" aria-hidden="true" />
                </MessageAction>
            )}
            {rules.fork && onFork && (
                <MessageAction tooltip={t('forkFromHere')} onClick={act(onFork)} disabled={turnRunning}>
                    <GitBranch className="size-4" aria-hidden="true" />
                </MessageAction>
            )}
            {rules.compare && onCompare && (
                <MessageAction tooltip={t('compareBranches')} onClick={act(onCompare)}>
                    <Columns className="size-4" aria-hidden="true" />
                </MessageAction>
            )}
            {rules.export && contentRef && (
                <AnswerExportMenu
                    message={message}
                    kbId={kbId}
                    questionText={questionText}
                    contentRef={contentRef}
                    onOpenChange={setExportOpen}
                    t={t}
                />
            )}
            {rules.graph && onViewGraph && (
                <MessageAction tooltip={t('viewGraphForAnswer')} onClick={act(onViewGraph)}>
                    <Network className="size-4" aria-hidden="true" />
                </MessageAction>
            )}
            {traceUrl && (
                <MessageAction tooltip={t('viewTrace')} onClick={act(() => openExternal(traceUrl))}>
                    <ExternalLink className="size-4" aria-hidden="true" />
                </MessageAction>
            )}
        </DsMessageActions>
    );
}

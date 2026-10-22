import type { ReactNode } from 'react';
import { Columns, Copy, Download, ExternalLink, GitBranch, Network, Pencil, RefreshCw, ThumbsDown, ThumbsUp } from 'lucide-react';
import {
    ContextMenu, ContextMenuCheckboxItem, ContextMenuContent, ContextMenuItem, ContextMenuSeparator,
    ContextMenuSub, ContextMenuSubContent, ContextMenuSubTrigger, ContextMenuTrigger,
} from '@ki4jlu/design-system';
import type { Message } from '../types';
import { useTheme } from '../contexts/ThemeContext';
import { openExternal } from '../utils/openExternal';
import { HAPTIC_PATTERNS, triggerHaptic } from '../utils/haptics';
import { type MessageActionHandlers, useMessageActionRules, useMessageExport } from '../hooks/useMessageActions';

interface MessageContextMenuProps extends MessageActionHandlers {
    message: Message;
    kbId?: string;
    questionText?: string;
    /** false renders the message without a menu (streaming, unsaved). */
    enabled: boolean;
    onOpenChange?: (open: boolean) => void;
    /** The message element; it becomes the trigger (long-press, right-click). */
    children: ReactNode;
}

/**
 * The message's actions as a context menu: long-press on touch, right-click
 * with a mouse. Same actions and availability as the footer row
 * (useMessageActionRules); feedback here records the rating only, the
 * comment box stays with the footer's thumbs.
 */
export function MessageContextMenu({ message, kbId, questionText, enabled, onOpenChange, children, ...handlers }: MessageContextMenuProps) {
    const { t } = useTheme();
    const rules = useMessageActionRules(message, handlers);
    const exporter = useMessageExport(message, kbId, questionText, handlers.contentRef);
    const { onEdit, onFork, onCompare, onRegenerate, onFeedback, onViewGraph } = handlers;
    const { traceUrl } = rules;

    if (!enabled) return <>{children}</>;

    const rate = (rating: 'positive' | 'negative') => {
        triggerHaptic(HAPTIC_PATTERNS.action);
        onFeedback?.(message.feedback === rating ? null : rating);
    };

    return (
        <ContextMenu onOpenChange={(open) => { if (open) triggerHaptic(HAPTIC_PATTERNS.reveal); onOpenChange?.(open); }}>
            <ContextMenuTrigger asChild>{children}</ContextMenuTrigger>
            <ContextMenuContent aria-label={t('messageActions')}>
                <ContextMenuItem onSelect={() => void exporter.copy()}>
                    <Copy aria-hidden="true" />{t('copy')}
                </ContextMenuItem>
                {rules.edit && onEdit && (
                    <ContextMenuItem onSelect={onEdit}>
                        <Pencil aria-hidden="true" />{t('editMessage')}
                    </ContextMenuItem>
                )}
                {rules.feedback && (
                    <>
                        <ContextMenuSeparator />
                        <ContextMenuCheckboxItem checked={message.feedback === 'positive'} onSelect={() => rate('positive')}>
                            <ThumbsUp aria-hidden="true" />{t('helpfulAnswer')}
                        </ContextMenuCheckboxItem>
                        <ContextMenuCheckboxItem checked={message.feedback === 'negative'} onSelect={() => rate('negative')}>
                            <ThumbsDown aria-hidden="true" />{t('unhelpfulAnswer')}
                        </ContextMenuCheckboxItem>
                    </>
                )}
                {(rules.regenerate || rules.fork || rules.compare) && <ContextMenuSeparator />}
                {rules.regenerate && onRegenerate && (
                    <ContextMenuItem onSelect={onRegenerate}>
                        <RefreshCw aria-hidden="true" />{t('regenerateResponse')}
                    </ContextMenuItem>
                )}
                {rules.fork && onFork && (
                    <ContextMenuItem onSelect={onFork}>
                        <GitBranch aria-hidden="true" />{t('forkFromHere')}
                    </ContextMenuItem>
                )}
                {rules.compare && onCompare && (
                    <ContextMenuItem onSelect={onCompare}>
                        <Columns aria-hidden="true" />{t('compareBranches')}
                    </ContextMenuItem>
                )}
                {(rules.export || rules.graph || traceUrl) && <ContextMenuSeparator />}
                {rules.export && (
                    <ContextMenuSub>
                        <ContextMenuSubTrigger>
                            <Download aria-hidden="true" />{t('exportAnswer')}
                        </ContextMenuSubTrigger>
                        <ContextMenuSubContent>
                            <ContextMenuItem onSelect={exporter.markdown}>{t('exportMarkdown')}</ContextMenuItem>
                            {exporter.docx && <ContextMenuItem onSelect={() => void exporter.docx?.()}>{t('exportDocx')}</ContextMenuItem>}
                            <ContextMenuItem onSelect={exporter.pdf}>{t('exportPdf')}</ContextMenuItem>
                        </ContextMenuSubContent>
                    </ContextMenuSub>
                )}
                {rules.graph && onViewGraph && (
                    <ContextMenuItem onSelect={onViewGraph}>
                        <Network aria-hidden="true" />{t('viewGraphForAnswer')}
                    </ContextMenuItem>
                )}
                {traceUrl && (
                    <ContextMenuItem onSelect={() => openExternal(traceUrl)}>
                        <ExternalLink aria-hidden="true" />{t('viewTrace')}
                    </ContextMenuItem>
                )}
            </ContextMenuContent>
        </ContextMenu>
    );
}

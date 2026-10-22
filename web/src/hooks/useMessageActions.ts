import type { RefObject } from 'react';
import type { Message } from '../types';
import { useAuth } from '../contexts/AuthContext';
import { useTheme } from '../contexts/ThemeContext';
import { useToast } from '../contexts/ToastContext';
import { isTempMessageId } from '../utils/messageTree';
import {
    copyAnswerWithCitations,
    downloadAnswerMarkdown,
    exportAnswerDocx,
    printAnswerPdf,
} from '../utils/exportAnswer';

export interface MessageActionHandlers {
    onEdit?: () => void;
    onFork?: () => void;
    onCompare?: () => void;
    onRegenerate?: () => void;
    onFeedback?: (feedback: 'positive' | 'negative' | null, comment?: string) => void;
    onViewGraph?: () => void;
    contentRef?: RefObject<HTMLDivElement | null>;
}

/**
 * Which actions a message offers. The answer footer and the long-press menu
 * both read it, so the two never disagree.
 */
export function useMessageActionRules(message: Message, handlers: MessageActionHandlers) {
    const { user, siteConfigs } = useAuth();
    const isUser = message.role === 'user';
    const langfuseBaseUrl = siteConfigs.langfuse_base_url;
    // View trace — admin-only, requires both message.traceId AND siteConfigs.langfuse_base_url
    const traceUrl = !isUser && message.traceId && langfuseBaseUrl && (user?.role === 'admin' || user?.role === 'superadmin')
        ? `${langfuseBaseUrl.replace(/\/$/, '')}/${message.traceId}`
        : null;
    return {
        edit: isUser && !!handlers.onEdit,
        feedback: !isUser && !!handlers.onFeedback,
        // Not on an unsaved answer (a failed send leaves a `temp-error-*`
        // bubble): a regenerate names the answer it replaces, so there would
        // be nothing for the backend to hang the new one under.
        regenerate: !isUser && !!handlers.onRegenerate && !!message.id && !isTempMessageId(message.id),
        fork: !isUser && !!handlers.onFork,
        compare: !!handlers.onCompare,
        export: !isUser && !!handlers.contentRef,
        graph: !isUser && !!handlers.onViewGraph,
        traceUrl,
    };
}

/** Copy and export of a message, with their toasts. */
export function useMessageExport(message: Message, kbId?: string, questionText?: string, contentRef?: RefObject<HTMLDivElement | null>) {
    const { t } = useTheme();
    const toast = useToast();
    const heading = t('sourcesHeading');
    const isUser = message.role === 'user';

    return {
        copy: async () => {
            const ok = await copyAnswerWithCitations(message, heading);
            if (ok) toast.success(t(isUser ? 'messageCopied' : 'answerCopied'));
            else toast.error(t('exportFailed'));
        },
        markdown: () => downloadAnswerMarkdown(message, heading),
        docx: kbId
            ? async () => {
                try {
                    await exportAnswerDocx(kbId, message, questionText || '', heading);
                } catch {
                    toast.error(t('exportFailed'));
                }
            }
            : undefined,
        pdf: () => printAnswerPdf(contentRef?.current ?? null, questionText || t('exportAnswer')),
    };
}

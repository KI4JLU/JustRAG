import { useState } from 'react';
import { ArrowUp, FileText, WandSparkles } from 'lucide-react';
import {
    InputGroupAddon, PromptInput, PromptInputActionAddAttachments, PromptInputActionMenu, PromptInputActionMenuContent,
    PromptInputActionMenuTrigger, PromptInputAdaptiveTextarea, PromptInputSubmit,
} from '@ki4jlu/design-system';
import { useTheme } from '../../../contexts/ThemeContext';
import { useComposerNotch } from '../../../hooks/useComposerNotch';

/**
 * The chat composer as the topic's members see it, for the Startseite's
 * „Eingabefeld" start: the same DS PromptInput parts, notch and sizes as
 * ChatView's composer — + menu, adaptive textarea, improve-draft trigger,
 * source count and send. Nothing is sent: a submit only clears the draft.
 */
export function ComposerPreview({ kbName, fileCount, defaultValue = '' }: { kbName: string; fileCount?: number; /** A prefilled instruction. */ defaultValue?: string }) {
    const { t } = useTheme();
    const { notch, observeNotch } = useComposerNotch();
    const [text, setText] = useState(defaultValue);
    return (
        <PromptInput onSubmit={() => setText('')}>
            <InputGroupAddon align="inline-start" ref={observeNotch('left')} className="absolute bottom-1 left-3 p-0">
                <PromptInputActionMenu>
                    <PromptInputActionMenuTrigger className="size-10" title={t('attachFiles')} aria-label={t('attachFiles')} />
                    <PromptInputActionMenuContent align="start">
                        <PromptInputActionAddAttachments label={t('attachFiles')} />
                    </PromptInputActionMenuContent>
                </PromptInputActionMenu>
            </InputGroupAddon>
            <PromptInputAdaptiveTextarea
                aria-label={t('chatPlaceholder')}
                className="px-4 text-base leading-normal"
                placeholder={kbName ? t('chatPlaceholderContextual').replace('{{name}}', kbName) : t('chatPlaceholder')}
                value={text}
                onChange={(e) => setText(e.target.value)}
                rows={1}
                inlineLeft={notch.left}
                inlineRight={notch.right}
                laneHeight={48}
                maxHeight={240}
            />
            <InputGroupAddon align="inline-end" ref={observeNotch('right')} className="absolute right-3 bottom-1 gap-1 p-0">
                <PromptInputActionMenu>
                    <PromptInputActionMenuTrigger disabled title={t('enhanceNeedsDraft')} aria-label={t('enhanceTooltip')}>
                        <WandSparkles aria-hidden="true" />
                    </PromptInputActionMenuTrigger>
                </PromptInputActionMenu>
                {fileCount !== undefined && (
                    <span
                        className="inline-flex items-center gap-1 whitespace-nowrap px-2 text-sm text-on-surface-variant"
                        title={t('activeSources')}
                        aria-label={`${fileCount} ${t('sources')}`}
                    >
                        <FileText size={16} aria-hidden="true" />
                        <span aria-hidden="true">{fileCount}</span>
                    </span>
                )}
                <PromptInputSubmit className="size-10" disabled={!text.trim()} aria-label={t('sendMessage')}>
                    <ArrowUp aria-hidden="true" />
                </PromptInputSubmit>
            </InputGroupAddon>
        </PromptInput>
    );
}

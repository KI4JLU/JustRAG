import { useMemo } from 'react';
import { MessageCircleQuestion } from 'lucide-react';
import { useTheme } from '../../contexts/ThemeContext';
import type { SourcePanelTarget } from '../../contexts/SourcePanelContext';
import { messageSectionKey } from '../../hooks/useMessageSections';
import type { Message } from '../../types';
import { citationMarkers } from '../../utils/citationRefs';
import { normalizeMathDelimiters } from '../../utils/markdownMath';
import { buildCitationModel, citationSpanMap, citingTextByRaw, type CitedSource } from '../../utils/sourceDisplay';
import { SourceList } from './SourceList';

interface CitationsPanelProps {
    /** The chat's transcript, in reading order. */
    messages: readonly Message[];
    /** The cited source open beside the answers, if any: marks its row. */
    target: SourcePanelTarget | null;
    /** Opens one cited source, as a click on its row beneath the answer does. */
    onOpen: (target: SourcePanelTarget) => void;
}

/**
 * The side panel's citations view: every answer of the chat that cites
 * sources, each with the same list its „Quellen" toggle opens beneath it,
 * under the question it answers.
 */
export function CitationsPanel({ messages, target, onOpen }: CitationsPanelProps) {
    const { t } = useTheme();
    const groups = useMemo(() => {
        const out: { key: string; question: string; message: Message; sources: CitedSource[] }[] = [];
        let question = '';
        for (const message of messages) {
            if (message.role === 'user') {
                if (!message.isEnhanced) question = message.content;
                continue;
            }
            const key = messageSectionKey(message);
            if (!key || message.isEnhanced) continue;
            const sources = buildCitationModel(message.content, message.sources).cited;
            if (sources.length > 0) out.push({ key, question, message, sources });
        }
        return out;
    }, [messages]);

    const open = (message: Message, key: string, source: CitedSource) => {
        const model = buildCitationModel(message.content, message.sources);
        onOpen({
            messageKey: key,
            source,
            passage: 0,
            spans: citationSpanMap(message.verification),
            citing: citingTextByRaw(message.content),
            model,
            markers: citationMarkers(normalizeMathDelimiters(message.content), model),
        });
    };

    return (
        <section aria-label={t('sidePanelCitations')} className="flex min-h-0 flex-1 flex-col bg-surface">
            <div className="flex h-14 shrink-0 items-center border-b border-outline-variant px-4">
                <h2 className="m-0 truncate text-sm font-semibold text-on-surface">{t('sidePanelCitations')}</h2>
            </div>
            {groups.length === 0 ? (
                <div className="flex flex-1 flex-col items-center justify-center gap-1 px-6 text-center">
                    <p className="m-0 text-sm font-medium text-on-surface">{t('sidePanelCitationsEmpty')}</p>
                    <p className="m-0 text-sm text-on-surface-variant">{t('sidePanelCitationsEmptyHint')}</p>
                </div>
            ) : (
                <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
                    <ol className="m-0 flex list-none flex-col gap-6 p-0">
                        {groups.map(({ key, question, message, sources }) => (
                            <li key={key} className="min-w-0">
                                {question && (
                                    // The question these sources answer: one line, cut with an ellipsis.
                                    <h3 className="m-0 mb-2 flex min-w-0 items-center gap-2 text-sm font-semibold text-on-surface">
                                        <MessageCircleQuestion className="size-4 shrink-0 text-on-surface-variant" aria-hidden="true" />
                                        <span className="sr-only">{t('sidePanelCitationsQuestion')}: </span>
                                        <span className="truncate">{question}</span>
                                    </h3>
                                )}
                                <SourceList
                                    sources={sources}
                                    activeN={target?.messageKey === key ? target.source.n : null}
                                    onOpen={(source) => open(message, key, source)}
                                    columns={1}
                                />
                            </li>
                        ))}
                    </ol>
                </div>
            )}
        </section>
    );
}

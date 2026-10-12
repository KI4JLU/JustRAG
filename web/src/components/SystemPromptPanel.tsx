import { useEffect, useState } from 'react';
import axios from 'axios';
import { API_BASE_URL } from '../api';
import { Check, Trash2 } from 'lucide-react';
import { Button, ContentPanel, PanelSection, Textarea } from '@ki4jlu/design-system';
import { useTheme } from '../contexts/ThemeContext';

const MAX_LEN = 8000;

interface SystemPromptPanelProps {
    draft: string;
    onDraftChange: (value: string) => void;
    onSave: () => void;
    onDelete: () => void;
    onClose: () => void;
}

/**
 * KB behaviour editor (gear in the workspace header): the KB's own system
 * prompt, plus the fixed RAG instructions it is combined with (read-only).
 * It takes the whole chat content area while open — the conversation and
 * composer step aside — so the prompt gets a real editor instead of a
 * three-line box squeezed above the input.
 */
export function SystemPromptPanel({
    draft, onDraftChange, onSave, onDelete, onClose,
}: SystemPromptPanelProps) {
    const { t, language } = useTheme();

    // The fixed RAG answer instructions every turn appends after this KB's
    // prompt — shown read-only so the owner sees what theirs is combined with.
    const [ragPrompt, setRagPrompt] = useState<string | null>(null);
    useEffect(() => {
        let cancelled = false;
        axios.get<{ prompt: string }>(`${API_BASE_URL}/api/chat/rag-system-prompt`, { params: { lang: language } })
            .then(res => { if (!cancelled) setRagPrompt(res.data.prompt); })
            .catch(() => { if (!cancelled) setRagPrompt(''); });
        return () => { cancelled = true; };
    }, [language]);

    return (
        <ContentPanel
            id="kb-system-prompt-panel"
            title={t('kbBehaviorTitle')}
            titleId="kb-system-prompt-title"
            onClose={onClose}
            closeLabel={t('close')}
            footer={(
                <>
                    <Button variant="ghost" onClick={onDelete}>
                        <Trash2 size={16} aria-hidden="true" />
                        {t('delete')}
                    </Button>
                    <div className="flex gap-2">
                        <Button variant="outline" onClick={onClose}>{t('cancel')}</Button>
                        <Button onClick={onSave}>
                            <Check size={16} aria-hidden="true" />
                            {t('save')}
                        </Button>
                    </div>
                </>
            )}
        >
            <PanelSection
                title={<label htmlFor="chat-system-prompt">{t('systemPromptLabel')}</label>}
                titleId="kb-own-prompt-title"
                aside={<span aria-live="polite">{draft.length} / {MAX_LEN}</span>}
                hint={t('systemPromptDescription')}
                grow
            >
                <Textarea
                    id="chat-system-prompt"
                    value={draft}
                    onChange={(e) => onDraftChange(e.target.value)}
                    placeholder={t('systemPromptPlaceholder')}
                    maxLength={MAX_LEN}
                    className="min-h-48 flex-1"
                />
            </PanelSection>

            <PanelSection title={t('ragSystemPromptLabel')} titleId="kb-rag-prompt-title" hint={t('ragSystemPromptHint')}>
                {/* Read-only textarea: selectable, scrollable, announced as read-only. */}
                <Textarea
                    readOnly
                    aria-labelledby="kb-rag-prompt-title"
                    value={ragPrompt === null ? '…' : ragPrompt || t('ragSystemPromptUnavailable')}
                    className="min-h-72"
                />
            </PanelSection>
        </ContentPanel>
    );
}

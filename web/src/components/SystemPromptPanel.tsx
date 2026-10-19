import { useEffect, useState } from 'react';
import axios from 'axios';
import { API_BASE_URL } from '../api';
import { Check, Trash2 } from 'lucide-react';
import { Button, ContentPanel, PanelSection, Tabs, TabsContent, TabsList, TabsTrigger, Textarea } from '@ki4jlu/design-system';
import { useTheme } from '../contexts/ThemeContext';
import type { KbSourceFlags } from '../types';
import { KbRolesRightsTab } from './kbSettings/KbRolesRightsTab';

const MAX_LEN = 8000;

interface SystemPromptPanelProps {
    draft: string;
    onDraftChange: (value: string) => void;
    onSave: () => void;
    onDelete: () => void;
    onClose: () => void;
    /** Drafted per-KB source flags for the "Rollen & Rechte" tab. */
    flags: KbSourceFlags;
    onFlagsChange: (next: KbSourceFlags) => void;
    /** Opens the members dialog from the "Rollen & Rechte" tab. */
    onAssignPeople: (e: React.MouseEvent) => void;
    /** Something changed on either tab (prompt draft or flags): enables Speichern. */
    dirty: boolean;
}

type SettingsTab = 'behavior' | 'roles';

/**
 * „Thema-Einstellungen" (gear in the workspace header), two tabs:
 *   - Verhalten: the KB's own system prompt, plus the fixed RAG instructions
 *     it is combined with (read-only).
 *   - Rollen & Rechte: the KB's role × right matrix (KbRolesRightsTab).
 * One footer for both: Speichern saves what changed on either tab and stays
 * disabled until something did ("Keine Änderungen" on the left); Löschen (the
 * system prompt) only shows on Verhalten. The panel is as tall as its content
 * (up to the content area), so a short tab does not push the footer down.
 * It takes the whole chat content area while open — the conversation and
 * composer step aside — so the prompt gets a real editor instead of a
 * three-line box squeezed above the input.
 */
export function SystemPromptPanel({
    draft, onDraftChange, onSave, onDelete, onClose, flags, onFlagsChange, onAssignPeople, dirty,
}: SystemPromptPanelProps) {
    const { t, language } = useTheme();
    const [tab, setTab] = useState<SettingsTab>('behavior');

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
            title={t('kbSettingsTitle')}
            titleId="kb-system-prompt-title"
            onClose={onClose}
            closeLabel={t('close')}
            // Height follows the content: flex-initial instead of the panel's
            // flex-1 (still shrinks and scrolls when the content is taller).
            className="flex-initial"
            footer={(
                <>
                    <div className="flex items-center gap-3">
                        {tab === 'behavior' && (
                            <Button variant="ghost" onClick={onDelete}>
                                <Trash2 size={16} aria-hidden="true" />
                                {t('delete')}
                            </Button>
                        )}
                        {!dirty && <span className="text-sm text-on-surface-variant" aria-live="polite">{t('kbSettingsNoChanges')}</span>}
                    </div>
                    <div className="flex gap-2">
                        <Button variant="outline" onClick={onClose}>{t('cancel')}</Button>
                        <Button onClick={onSave} disabled={!dirty}>
                            <Check size={16} aria-hidden="true" />
                            {t('save')}
                        </Button>
                    </div>
                </>
            )}
        >
            <Tabs value={tab} onValueChange={(v) => setTab(v as SettingsTab)} className="flex min-h-0 flex-1 flex-col gap-6">
                <TabsList aria-label={t('kbSettingsTitle')}>
                    <TabsTrigger value="behavior">{t('kbSettingsTabBehavior')}</TabsTrigger>
                    <TabsTrigger value="roles">{t('kbSettingsTabRoles')}</TabsTrigger>
                </TabsList>
                <TabsContent value="behavior" className="flex min-h-0 flex-1 flex-col gap-6">
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
                </TabsContent>
                <TabsContent value="roles">
                    <KbRolesRightsTab flags={flags} onFlagsChange={onFlagsChange} onAssignPeople={onAssignPeople} />
                </TabsContent>
            </Tabs>
        </ContentPanel>
    );
}

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchMatches, useSearchReveal } from '../../../hooks/useSearchReveal';
import { Check, Info, Pencil } from 'lucide-react';
import { Button, Notice, PromptSuggestions } from '@ki4jlu/design-system';
import { useTheme } from '../../../contexts/ThemeContext';
import type { RoleEntry } from './api';
import { ChatStartEditor } from './ChatStartEditor';
import { ComposerPreview } from './ComposerPreview';
import { RoleChatPreview } from './RoleChatPreview';
import { allRoles } from './roleModel';
import { RoleStartCards, StartGlow, TitleCard, UploadStart } from './StartPageParts';
import { chatStartIncomplete, startEntries, visibleQuestions } from './startPageModel';
import { TitleCardEditor } from './TitleCardEditor';
import { useAssistantSettings } from './useAssistantSettings';
import { useStarterSample } from './useStarterSample';

type Block = 'card' | 'start';

/** Labels of the fields behind each block's „Bearbeiten" (translation keys), for the settings search. */
const CARD_EDITOR_KEYS = ['asstTitle', 'asstCategory', 'asstDescription', 'asstGenerateDescription'];
const START_EDITOR_KEYS = ['asstChatStart', 'asstQuestions', 'asstRoleEntries', 'asstDynamic', 'asstFixedMode', 'asstCount', 'asstUploadLabel', 'asstUploadInstruction'];

/**
 * „Startseite": the start page exactly as members see it — the title card,
 * then the chat start. „Bearbeiten" in the top right corner swaps both for
 * their editors right where they are; the chat start's „Fertig" swaps both
 * back. Nothing is kept without the
 * dialog's Speichern (the shared draft).
 */
export function StartPageSection() {
    const { t, language } = useTheme();
    const store = useAssistantSettings();
    const { draft, catalog, categories, kb } = store;
    const roles = useMemo(() => allRoles(catalog, draft?.behavior), [catalog, draft?.behavior]);
    // Opened from „Als Einstiegsfrage anbieten" in Verhalten: on the chat
    // start's editor, with the new card focused (the store added it).
    const [opened] = useState(() => (store.pending?.type === 'startRoles' ? store.pending : null));
    const [editing, setEditing] = useState<Record<Block, boolean>>({ card: false, start: !!opened });
    const [previewChat, setPreviewChat] = useState<RoleEntry | null>(null);
    const [modeNote, setModeNote] = useState(!!opened?.switched);
    const [focusEntryId, setFocusEntryId] = useState<string | null>(opened?.entryId ?? null);

    // An example of the dynamic questions, generated for the role of the card
    // being tried, else the active role's (the input field's).
    const { sample: dynamicSample, loading: sampleLoading, newExample } = useStarterSample(kb.id, language, previewChat?.roleId ?? undefined);

    const { pending, clearPending } = store;
    useEffect(() => {
        if (pending?.type === 'startRoles') clearPending();
    }, [pending, clearPending]);
    const activeRoleId = draft?.behavior.activeRoleId ?? '';

    const onFocused = useCallback(() => setFocusEntryId(null), []);

    // The editors' fields exist only behind „Bearbeiten": the settings search opens the editor whose
    // field it names, and closes it again when the search moves on (unless it was open already).
    const cardMatch = useSearchMatches(CARD_EDITOR_KEYS.map(t));
    const startMatch = useSearchMatches(START_EDITOR_KEYS.map(t));
    const reveal = (block: Block, match: boolean) => [
        match ? 'on' : null,
        editing[block],
        () => { setPreviewChat(null); setEditing(e => ({ ...e, [block]: true })); },
        () => setEditing(e => ({ ...e, [block]: false })),
    ] as const;
    useSearchReveal(...reveal('card', cardMatch));
    useSearchReveal(...reveal('start', startMatch));

    if (!draft) return null;
    const page = draft.startPage;
    const questions = visibleQuestions(page, dynamicSample);
    const category = categories.find(c => c.id === draft.categoryId) ?? null;
    const open = (...blocks: Block[]) => {
        setPreviewChat(null);
        setEditing(e => ({ ...e, ...Object.fromEntries(blocks.map(b => [b, true])) }));
    };
    // „Fertig" keeps the editors open while the chat start is incomplete
    // (e.g. „Rollenauswahl" with the default role alone) and shows why.
    const done = () => {
        if (editing.start && chatStartIncomplete(page, activeRoleId)) {
            store.revealErrors();
            return;
        }
        setEditing({ card: false, start: false });
        setModeNote(false);
    };
    const viewRole = (roleId: string) => store.send('behavior', { type: 'previewRole', roleId });

    // Exactly what members see: no frame, label or note of the editor's own.
    // The chat's own layout classes (`chat-column` on the stage,
    // `input-container--start` here): composer, role cards and dropzone as
    // wide as the title card — as in ChatView's empty chat.
    const startView = (
        <div className="input-container input-container--start">
            {page.startMode === 'roles' ? (
                <div>
                    <RoleStartCards entries={startEntries(page, activeRoleId)} roles={roles} onStart={setPreviewChat} />
                </div>
            ) : page.startMode === 'upload' ? (
                <div>
                    <UploadStart title={page.uploadLabel.trim() || t('asstUploadLabelDefault')} onFiles={() => undefined} onBrowse={() => undefined} />
                </div>
            ) : (
                <ComposerPreview kbName={draft.title.trim()} fileCount={kb.fileCount} />
            )}
            {questions.length > 0 && (
                <PromptSuggestions
                    title={t('asstSuggestions')}
                    suggestions={questions}
                    onSelect={() => undefined}
                    className="mt-4"
                />
            )}
        </div>
    );

    return (
        <div className="@container flex flex-col gap-4 pt-6">
            <Notice tone="info" icon={<Info />}>{t('asstStartNotice')}</Notice>
            {store.showErrors && chatStartIncomplete(page, activeRoleId) && !editing.start && (
                <Notice tone="warning" icon={<Info />}>
                    {t('asstStartIncomplete')}{' '}
                    <Button variant="link" size="sm" className="h-auto p-0 align-baseline" onClick={() => open('start')}>{t('asstEditChatStart')}</Button>
                </Notice>
            )}
            <div className="overflow-hidden rounded-xl border border-outline-variant bg-surface shadow-card">
                <div className="relative isolate flex min-h-[30rem] flex-col">
                    {/* The preview's top right corner: „Bearbeiten" opens the title
                        card's and the chat start's editors together, „Fertig" in
                        the same place closes them. */}
                    {!previewChat && (editing.card || editing.start ? (
                        <Button size="sm" className="absolute right-3 top-3 z-10" onClick={done}>
                            <Check className="size-3.5" aria-hidden="true" /> {t('asstDone')}
                        </Button>
                    ) : (
                        <Button variant="outline" size="sm" aria-label={t('asstEditStartPage')} className="absolute right-3 top-3 z-10" onClick={() => open('card', 'start')}>
                            <Pencil className="size-3.5" aria-hidden="true" /> <span className="hidden @sm:inline">{t('asstEdit')}</span>
                        </Button>
                    ))}
                    {!previewChat && <StartGlow category={category} />}
                    {previewChat ? (
                        <RoleChatPreview entry={previewChat} role={roles.find(r => r.id === previewChat.roleId)} kbName={draft.title.trim()} fileCount={kb.fileCount} dynamicSample={dynamicSample} onBack={() => setPreviewChat(null)} />
                    ) : (
                        // The chat's empty stage (ChatStage's slots and the chat's
                        // layout classes), anchored at the top instead of centred:
                        // the editors below the title grow downwards, so the
                        // title stays where it is when „Bearbeiten" opens them.
                        <div data-slot="chat-stage" className="chat-column flex min-h-0 min-w-0 flex-1 flex-col">
                            <div data-slot="chat-stage-content" className="flex min-w-0 flex-col pt-12">
                                <div className="mx-auto flex w-full max-w-2xl flex-col px-4 py-6">
                                    {editing.card ? (
                                        <TitleCardEditor
                                            categories={categories}
                                            fileCount={kb.fileCount}
                                            asOf={kb.lastIngestedAt}
                                        />
                                    ) : (
                                        <TitleCard
                                            title={draft.title}
                                            category={category}
                                            description={draft.description ?? t('kbHeaderDefault')}
                                            fileCount={kb.fileCount}
                                            asOf={kb.lastIngestedAt}
                                        />
                                    )}
                                </div>
                            </div>
                            <div data-slot="chat-stage-composer" className="w-full shrink-0">
                            {editing.start ? (
                                // The editor takes the chat start's own place and width.
                                <div className="input-container input-container--start">
                                <ChatStartEditor
                                    roles={roles}
                                    activeRoleId={activeRoleId}
                                    dynamicSample={dynamicSample}
                                    sampleLoading={sampleLoading}
                                    onNewExample={newExample}
                                    modeNote={modeNote}
                                    focusEntryId={focusEntryId}
                                    onAdded={setFocusEntryId}
                                    onFocused={onFocused}
                                    onTry={setPreviewChat}
                                    onViewRole={viewRole}
                                />
                                </div>
                            ) : startView}
                            </div>
                            <div aria-hidden="true" className="flex-1" />
                            <p data-slot="chat-stage-footer" className="m-0 shrink-0 px-6 pb-4 text-center text-xs text-on-surface-variant">{t('chatFooter')}</p>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}

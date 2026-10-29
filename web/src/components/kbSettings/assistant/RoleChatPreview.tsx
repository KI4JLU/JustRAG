import { useState } from 'react';
import { ArrowLeft, FileText } from 'lucide-react';
import { Badge, Button, ChatBubble, ChatStage, PromptSuggestions, Shimmer } from '@ki4jlu/design-system';
import { useTheme } from '../../../contexts/ThemeContext';
import type { RoleEntry } from './api';
import { ComposerPreview } from './ComposerPreview';
import type { RoleView } from './roleModel';
import { UploadStart } from './StartPageParts';
import { suggestionQuestions } from './startPageModel';

/**
 * How a chat started from a role card begins (a click on a card, or
 * „Ausprobieren"): the role badge, then the empty chat, the instruction sent
 * or prefilled, or the role's upload area; an `input` card's suggestions
 * under the field (`dynamicSample`: an example of the generated ones).
 */
export function RoleChatPreview({ entry, role, kbName, fileCount, dynamicSample, onBack }: {
    entry: RoleEntry;
    role?: RoleView;
    kbName: string;
    fileCount?: number;
    dynamicSample: string[];
    onBack: () => void;
}) {
    const { t } = useTheme();
    const [uploaded, setUploaded] = useState(false);
    const name = role?.name ?? t('asstAssistant');
    const isFile = entry.kind === 'file';
    const isTask = entry.kind === 'task' && !!entry.text.trim();
    // „Eingabefeld" (or an instruction without text) just opens an empty chat in the role.
    const started = isFile ? uploaded : isTask && entry.send;

    const questions = entry.kind === 'input' ? suggestionQuestions(entry.suggestions, dynamicSample) : [];

    // The chat as members see it after a click on the card (ChatView): the
    // back link and the role badge above the empty chat, the real composer —
    // or the card's dropzone — and the card's suggestions under it.
    return (
        <div className="flex flex-1 flex-col">
            <ChatStage
                className="chat-column"
                empty={!started}
                composer={(
                    <div className={started ? 'input-container' : 'input-container input-container--start'}>
                        {isFile && !uploaded ? (
                            <div>
                                <UploadStart
                                    title={entry.text.trim() || t('asstFileDropTitle').replace('{role}', name)}
                                    onFiles={() => setUploaded(true)}
                                    onBrowse={() => setUploaded(true)}
                                />
                            </div>
                        ) : (
                            <ComposerPreview kbName={kbName} fileCount={fileCount} defaultValue={isTask && !entry.send ? entry.text : ''} />
                        )}
                        {questions.length > 0 && (
                            <PromptSuggestions title={t('promptSuggestions')} suggestions={questions} onSelect={() => undefined} className="mt-4" />
                        )}
                    </div>
                )}
                footer={t('chatFooter')}
            >
                <div className="flex flex-wrap items-center justify-center gap-2 px-4 pt-3">
                    <Button variant="ghost" size="sm" onClick={onBack}>
                        <ArrowLeft className="size-4" aria-hidden="true" /> {t('asstBackToStart')}
                    </Button>
                    <Badge tone="primary">{t('asstRoleBadge').replace('{role}', name)}</Badge>
                </div>
                {started ? (
                    <div className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-3 px-6 py-6">
                        <ChatBubble from="user">
                            {isFile ? (
                                <span className="flex flex-col gap-2">
                                    <span className="flex items-center gap-2 rounded-md bg-on-primary/15 px-2 py-1.5">
                                        <FileText className="size-4 shrink-0" aria-hidden="true" /> {t('asstExampleFileName')}
                                    </span>
                                    <span>{entry.instruction.trim() || t('asstFileDefaultMessage')}</span>
                                </span>
                            ) : entry.text}
                        </ChatBubble>
                        <Shimmer className="m-0 text-sm">{(isFile ? t('asstRoleChecksFile') : t('asstRoleThinking')).replace('{role}', name)}</Shimmer>
                    </div>
                ) : (
                    <div className="mx-auto max-w-2xl px-6 pb-4 pt-8 text-center">
                        <p className="m-0 text-on-surface-variant">
                            {isFile
                                ? t('asstFileStartHint')
                                : isTask
                                    ? t('asstTaskPrefilledHint')
                                    : t('asstNewChatInRole').replace('{role}', name)}
                        </p>
                    </div>
                )}
            </ChatStage>
        </div>
    );
}

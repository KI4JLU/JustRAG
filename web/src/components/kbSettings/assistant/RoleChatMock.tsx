import { Badge, ChatBubble, PromptSuggestions } from '@ki4jlu/design-system';
import { useTheme } from '../../../contexts/ThemeContext';
import type { KbCategory } from '../../../types';
import type { EntryStart } from './api';
import { ComposerPreview } from './ComposerPreview';
import { TitleCard, UploadStart } from './StartPageParts';
import { suggestionQuestions } from './startPageModel';

/**
 * How a chat in a role begins, for the role preview in „Verhalten": the
 * topic's title block (title, category and meta line, the topic's
 * description), the role badge, the role's start — the input field, its
 * instruction or its upload area — and its suggestions, then the chat's
 * disclaimer. A still image: `inert`, nothing in it reacts.
 */
export function RoleChatMock({
    roleName, start, kbTitle, category, description, fileCount, asOf, dynamicSample,
}: {
    roleName: string;
    start: EntryStart;
    kbTitle: string;
    category: KbCategory | null;
    description: string;
    fileCount?: number;
    asOf?: string;
    dynamicSample: string[];
}) {
    const { t } = useTheme();
    const isTask = start.kind === 'task' && !!start.text.trim();
    const questions = start.kind === 'input' ? suggestionQuestions(start.suggestions, dynamicSample) : [];
    return (
        <div inert className="flex flex-1 flex-col">
            <div className="flex flex-1 flex-col items-center justify-center gap-5 px-5 pt-6">
                <div className="w-full max-w-md">
                    <TitleCard title={kbTitle} category={category} description={description} fileCount={fileCount} asOf={asOf} />
                </div>
                <div className="flex w-full max-w-md flex-col items-center gap-2.5">
                    <Badge tone="primary">{t('asstRoleBadge').replace('{role}', roleName)}</Badge>
                    {isTask && start.send && <ChatBubble from="user" className="self-end">{start.text}</ChatBubble>}
                    <div className="w-full">
                        {start.kind === 'file' ? (
                            <UploadStart title={start.text.trim() || t('asstFileDropTitle').replace('{role}', roleName)} onFiles={() => undefined} />
                        ) : (
                            <ComposerPreview kbName={kbTitle} fileCount={fileCount} defaultValue={isTask && !start.send ? start.text : ''} />
                        )}
                    </div>
                    {questions.length > 0 && (
                        <PromptSuggestions title={t('promptSuggestions')} suggestions={questions} onSelect={() => undefined} />
                    )}
                </div>
            </div>
            <p className="m-0 shrink-0 px-6 pb-4 pt-4 text-center text-xs text-on-surface-variant">{t('chatFooter')}</p>
        </div>
    );
}

import { PromptSuggestions } from '@ki4jlu/design-system';
import { useTheme } from '../../../contexts/ThemeContext';
import type { RoleEntry, StartPage } from './api';
import { ComposerPreview } from './ComposerPreview';
import type { RoleView } from './roleModel';
import { RoleStartCards, UploadStart } from './StartPageParts';
import { activeTaskStart, pageMode, startEntries, startOf, taskModeEntry } from './startPageModel';

/**
 * The chat start of a start page as members see it, for the settings'
 * previews — the Startseite's and the role preview in „Verhalten" draw the
 * same one, so they cannot disagree: „Rollenauswahl"'s cards, or the active
 * role's own start — its role-prompt card, its upload area or the input
 * field —, then the starter questions.
 * The chat's own layout class (`input-container--start`): as wide as the
 * title card, as in ChatView's empty chat.
 */
export function StartView({ page, activeRoleId, roles, kbTitle, fileCount, questions, onStart }: {
    page: StartPage;
    activeRoleId: string;
    roles: RoleView[];
    kbTitle: string;
    fileCount?: number;
    questions: string[];
    onStart: (entry: RoleEntry) => void;
}) {
    const { t } = useTheme();
    const mode = pageMode(page, activeRoleId, roles);
    const taskStart = activeTaskStart(page, activeRoleId, roles);
    const start = startOf(page, activeRoleId, roles);
    const roleName = roles.find(r => r.id === activeRoleId)?.name ?? t('asstAssistant');
    return (
        <div className="input-container input-container--start">
            {mode === 'roles' || taskStart ? (
                <div>
                    <RoleStartCards
                        entries={taskStart ? [taskModeEntry(taskStart, activeRoleId)] : startEntries(page, activeRoleId, roles)}
                        roles={roles}
                        onStart={onStart}
                    />
                </div>
            ) : mode === 'upload' ? (
                <div>
                    <UploadStart
                        title={start.text.trim() || t('asstFileDropTitle').replace('{role}', roleName)}
                        onFiles={() => undefined}
                        onBrowse={() => undefined}
                    />
                </div>
            ) : (
                <ComposerPreview kbName={kbTitle} fileCount={fileCount} />
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
}

import { ChatStage, ChatStageColumn } from '@ki4jlu/design-system';
import { useTheme } from '../../../contexts/ThemeContext';
import type { KbCategory } from '../../../types';
import type { StartPage } from './api';
import type { RoleView } from './roleModel';
import { StartGlow, TitleCard } from './StartPageParts';
import { soleRoleName } from './startPageModel';
import { StartView } from './StartView';

/**
 * The start page a role makes, for the role preview in „Verhalten" — drawn
 * exactly as the Startseite's preview draws it (developer, 05.11.2026: the
 * two must agree): the glow, the topic's title block, the chat start
 * (StartView) and the chat's disclaimer, in the chat's empty-stage layout.
 * A still image: `inert`, nothing in it reacts.
 */
export function RoleChatMock({
    page, activeRoleId, roles, kbTitle, category, description, fileCount, asOf, questions,
}: {
    /** The page as it shows with the role as the start role. */
    page: StartPage;
    activeRoleId: string;
    roles: RoleView[];
    kbTitle: string;
    category: KbCategory | null;
    description: string;
    fileCount?: number;
    asOf?: string;
    questions: string[];
}) {
    const { t } = useTheme();
    return (
        <div inert className="relative isolate flex flex-1 flex-col">
            <StartGlow category={category} />
            <ChatStage empty align="start" footer={t('chatFooter')} composer={(
                <StartView
                    page={page}
                    activeRoleId={activeRoleId}
                    roles={roles}
                    fileCount={fileCount}
                    questions={questions}
                    onStart={() => undefined}
                />
            )}>
                <ChatStageColumn className="flex flex-col px-4 pt-18 pb-6">
                    <TitleCard title={kbTitle} category={category} role={soleRoleName(page, activeRoleId, roles)} description={description} fileCount={fileCount} asOf={asOf} />
                </ChatStageColumn>
            </ChatStage>
        </div>
    );
}

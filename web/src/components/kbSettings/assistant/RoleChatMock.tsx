import { useTheme } from '../../../contexts/ThemeContext';
import type { KbCategory } from '../../../types';
import type { StartPage } from './api';
import type { RoleView } from './roleModel';
import { StartGlow, TitleCard } from './StartPageParts';
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
            <div data-slot="chat-stage" className="chat-column flex min-h-0 min-w-0 flex-1 flex-col">
                <div data-slot="chat-stage-content" className="flex min-w-0 flex-col pt-12">
                    <div className="mx-auto flex w-full max-w-2xl flex-col px-4 py-6">
                        <TitleCard title={kbTitle} category={category} description={description} fileCount={fileCount} asOf={asOf} />
                    </div>
                </div>
                <div data-slot="chat-stage-composer" className="w-full shrink-0">
                    <StartView
                        page={page}
                        activeRoleId={activeRoleId}
                        roles={roles}
                        kbTitle={kbTitle}
                        fileCount={fileCount}
                        questions={questions}
                        onStart={() => undefined}
                    />
                </div>
                <div aria-hidden="true" className="flex-1" />
                <p data-slot="chat-stage-footer" className="m-0 shrink-0 px-6 pb-4 text-center text-xs text-on-surface-variant">{t('chatFooter')}</p>
            </div>
        </div>
    );
}

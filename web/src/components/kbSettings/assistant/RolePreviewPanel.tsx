import { forwardRef } from 'react';
import { X } from 'lucide-react';
import { Badge, Button, Tooltip, TooltipContent, TooltipTrigger, cardAccentStyle } from '@ki4jlu/design-system';
import { useTheme } from '../../../contexts/ThemeContext';
import { defaultStart, type EntryStart, type RuleSet, type StartPage } from './api';
import { RoleChatMock } from './RoleChatMock';
import { allRoles, type RoleView } from './roleModel';
import { RoleCover } from './StartPageParts';
import { pageQuestions, roleAccent, roleCardCover } from './startPageModel';
import { SystemPromptPanel } from './SystemPromptPanel';
import { useAssistantSettings } from './useAssistantSettings';

/**
 * The start page the role makes, as a still image at least as tall as the
 * chat's empty stage: for the active role exactly the Startseite's preview
 * (its mode, cards and questions); for another role the page it would make
 * as the start role — its role-prompt card, its upload area or the input
 * field with its suggestions. Drawn by the same StartView as the Startseite.
 * It fills the frame's lower section (RolePanelFrame `stage`) edge to edge.
 */
function RoleChatImage({ roleId, start, active, dynamicSample }: {
    roleId: string;
    start: EntryStart;
    active: boolean;
    dynamicSample: string[];
}) {
    const { t } = useTheme();
    const { draft, kb, categories, catalog } = useAssistantSettings();
    if (!draft || !catalog) return null;
    const roles = allRoles(catalog, draft.behavior);
    const stored = draft.startPage;
    // Another role: the page as it would be with that role as the start role, alone.
    const page: StartPage = active ? stored : { ...stored, roleStarts: { ...stored.roleStarts, [roleId]: start }, roleEntries: [] };
    const questions = pageQuestions(page, roleId, roles, dynamicSample);
    return (
        <div className="flex min-h-[28.75rem] flex-1 flex-col">
            <RoleChatMock
                page={page}
                activeRoleId={roleId}
                roles={roles}
                kbTitle={draft.title.trim()}
                category={categories.find(c => c.id === draft.categoryId) ?? null}
                description={draft.description ?? t('kbHeaderDefault')}
                fileCount={kb.fileCount}
                asOf={kb.lastIngestedAt}
                questions={questions}
            />
        </div>
    );
}

/**
 * The two columns the role preview and the role edit screen share. The left
 * one is split: the role's head (its card's cover band and avatar) with
 * `left` under it, then — below a divider, on the chat's own surface —
 * `stage`, how a chat in the role begins. Then `right` (the system prompt).
 */
export const RolePanelFrame = forwardRef<HTMLElement, {
    label: string;
    role: Pick<RoleView, 'cover'>;
    start: EntryStart;
    left: React.ReactNode;
    stage: React.ReactNode;
    right: React.ReactNode;
}>(function RolePanelFrame({ label, role, start, left, stage, right }, ref) {
    return (
        <section ref={ref} aria-label={label} style={cardAccentStyle(roleAccent(roleCardCover(role, start.kind)))} className="flex scroll-mt-4 flex-wrap overflow-hidden rounded-xl border border-outline-variant bg-surface-container-lowest shadow-card">
            <div className="flex min-w-0 flex-[1_1_25rem] flex-col border-r border-outline-variant">
                <div className="flex flex-col gap-4 pb-6">
                    <div className="flex flex-col">
                        <RoleCover kind={start.kind} />
                    </div>
                    {left}
                </div>
                <div className="flex flex-1 flex-col border-t border-outline-variant bg-surface">{stage}</div>
            </div>
            {right}
        </section>
    );
});

/**
 * The viewed role under the role cards (not necessarily the active one), as
 * a preview only: its head as on its card, how a chat in it begins, and the
 * system prompt it compiles to with its rules as they are sent. Nothing is
 * changed here: the role's edit screen (its card's ⋮ menu) does that.
 */
export const RolePreviewPanel = forwardRef<HTMLElement, {
    role: RoleView;
    active: boolean;
    /** The role has a card on the start page. */
    onStartPage: boolean;
    /** How the role starts on the start page; undefined = the input field. */
    start: EntryStart | undefined;
    rules: RuleSet;
    ragPrompt: string | null;
    dynamicSample: string[];
    onClose: () => void;
}>(function RolePreviewPanel({
    role, active, onStartPage, start, rules, ragPrompt, dynamicSample, onClose,
}, ref) {
    const { t } = useTheme();
    const shown = start ?? defaultStart();
    return (
        <RolePanelFrame
            ref={ref}
            label={t('asstPreviewOf').replace('{name}', role.name)}
            role={role}
            start={shown}
            left={(
                <div className="px-6">
                    <div className="flex flex-wrap items-center gap-2">
                        <h4 className="m-0 text-xl font-semibold leading-snug text-on-surface">{role.name}</h4>
                        {active && <Badge tone="primary">{t('asstActive')}</Badge>}
                        {onStartPage && <Badge tone="secondary">{t('asstStartSetUpBadge')}</Badge>}
                        <Badge tone="neutral">{role.custom ? t('asstOwn') : t('asstTemplate')}</Badge>
                    </div>
                    {role.description && <p className="m-0 mt-1 text-sm leading-6 text-on-surface-variant">{role.description}</p>}
                </div>
            )}
            stage={<RoleChatImage roleId={role.id} start={shown} active={active} dynamicSample={dynamicSample} />}
            right={(
                <SystemPromptPanel
                    prompt={role.prompt}
                    template={!role.custom}
                    rules={rules}
                    ragPrompt={ragPrompt}
                    aside={(
                        <Tooltip>
                            <TooltipTrigger asChild>
                                <Button variant="ghost" size="icon" aria-label={t('asstClosePreview')} onClick={onClose}>
                                    <X className="size-[18px]" aria-hidden="true" />
                                </Button>
                            </TooltipTrigger>
                            <TooltipContent>{t('asstClosePreview')}</TooltipContent>
                        </Tooltip>
                    )}
                />
            )}
        />
    );
});

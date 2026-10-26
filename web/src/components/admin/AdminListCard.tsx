import type { ReactNode } from 'react';
import { ActionMenu, Card, CardContent, CardHeader, CardTitle, type ActionMenuItem } from '@ki4jlu/design-system';

interface AdminListCardProps {
    title: ReactNode;
    /** Next to the title (a status pill). */
    badge?: ReactNode;
    /** The card is the one in use (the active configuration): a primary accent on its edge. */
    accent?: boolean;
    /** Facts under the title, one line each. */
    details: ReactNode[];
    /** What the ⋮ menu offers; destructive ones last, after a separator. */
    actions: ActionMenuItem[];
    /** Accessible name of the ⋮ trigger. */
    actionsLabel: string;
    /** Settings of the thing, as `SettingsRow`s: they sit under the facts, set off by a rule. */
    children?: ReactNode;
}

/**
 * A thing the console lists (an AI configuration, a login provider): the DS card with its
 * title and facts, and the ⋮ action menu every card of the app uses, as the topic cards do.
 */
export function AdminListCard({ title, badge, accent, details, actions, actionsLabel, children }: AdminListCardProps) {
    return (
        <Card accent={accent}>
            <CardHeader className="flex-row items-center justify-between gap-3">
                <CardTitle className="flex min-w-0 items-center gap-2">
                    <span className="truncate">{title}</span>
                    {badge}
                </CardTitle>
                <ActionMenu actions={actions} label={actionsLabel} triggerClassName="size-6 rounded-[var(--ui-radius-control)]" align="end" />
            </CardHeader>
            <CardContent className="flex flex-col gap-0.5 text-sm text-on-surface-variant">
                {details.map((d, i) => <div key={i}>{d}</div>)}
            </CardContent>
            {children && (
                <CardContent className="mt-2 flex flex-col border-t border-outline-variant pt-0">
                    {children}
                </CardContent>
            )}
        </Card>
    );
}

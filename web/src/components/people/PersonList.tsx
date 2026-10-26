import type { LiHTMLAttributes, ReactNode } from 'react';
import { Avatar, cn } from '@ki4jlu/design-system';
import { displayName, initialsOf } from '../../utils/personName';

/**
 * A framed list of people: the KB settings' member list and the admin user list
 * share this, so a person looks the same wherever the app lists them. Rows are
 * `PersonRow`s.
 */
export function PersonList({ className, children, ...props }: { className?: string; children: ReactNode } & React.HTMLAttributes<HTMLUListElement>) {
    return (
        <ul
            className={cn('m-0 flex list-none flex-col divide-y divide-outline-variant rounded-xl border border-outline-variant p-0', className)}
            {...props}
        >
            {children}
        </ul>
    );
}

interface PersonRowProps extends Omit<LiHTMLAttributes<HTMLLIElement>, 'children'> {
    firstName?: string | null;
    lastName?: string | null;
    username: string;
    /** What the row offers on its right: a role badge or select, an actions menu. */
    children?: ReactNode;
}

/** Avatar, name and @username on the left, the row's controls on the right. */
export function PersonRow({ firstName, lastName, username, children, className, ...props }: PersonRowProps) {
    return (
        <li className={cn('flex items-center gap-3 px-4 py-3', className)} {...props}>
            <Avatar initials={initialsOf(firstName, lastName, username)} />
            <div className="min-w-0 flex-1">
                <div className="truncate font-medium text-on-surface">{displayName(firstName, lastName, username)}</div>
                <div className="truncate text-sm text-on-surface-variant">@{username}</div>
            </div>
            {children}
        </li>
    );
}

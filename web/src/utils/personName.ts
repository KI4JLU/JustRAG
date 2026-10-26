/** Two initials from the name, else from the username. */
export function initialsOf(firstName: string | null | undefined, lastName: string | null | undefined, username: string): string {
    const fromName = `${firstName?.trim()[0] ?? ''}${lastName?.trim()[0] ?? ''}`;
    return (fromName || username.slice(0, 2)).toUpperCase();
}

/** First and last name, else the username. */
export function displayName(firstName: string | null | undefined, lastName: string | null | undefined, username: string): string {
    return [firstName, lastName].filter(Boolean).join(' ').trim() || username;
}

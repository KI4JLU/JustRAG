import type { ConfluenceSource, FileEntry, GitRepoSource, RssFeed } from '../../types';

/* The source list's two modes, each a set of ticked rows:
 *  - filter: which sources the chat answers from (FileEntry.selected). Opens
 *    with the current filter ticked; only Confirm writes the set back, so
 *    Cancel leaves the filter exactly as it was.
 *  - remove: which sources to remove. Opens with the one card it was started
 *    from ticked; Remove asks once and deletes the set.
 *
 * A key names one row of the list: a single file card, or a synced source —
 * an RSS feed, a Confluence space, a git repository — which stands for all of
 * its files. Every row takes part in both modes: a synced source's files
 * carry its id (rssFeedId, confluenceSourceId, gitRepoSourceId), so ticking
 * the row selects or deselects exactly those files. */

export type SourceKey = `file:${string}` | `rss:${string}` | `confluence:${string}` | `git:${string}`;

export const fileKey = (id: string): SourceKey => `file:${id}`;
export const feedKey = (id: string): SourceKey => `rss:${id}`;
export const confluenceKey = (id: string): SourceKey => `confluence:${id}`;
export const gitKey = (id: string): SourceKey => `git:${id}`;

/** The Confluence spaces and git repositories of the list. */
export interface SyncedSources {
    confluence: ConfluenceSource[];
    git: GitRepoSource[];
}

/** One synced source: its row's key and the files that belong to it. */
interface SourceGroup {
    key: SourceKey;
    files: FileEntry[];
}

/** Every synced source as a row key with its files, in list order (RSS,
 *  Confluence, git — the order SourcesSection renders them in). */
function sourceGroups(files: FileEntry[], feeds: RssFeed[], synced?: SyncedSources): SourceGroup[] {
    return [
        ...feeds.map(f => ({ key: feedKey(f.id), files: files.filter(x => x.rssFeedId === f.id) })),
        ...(synced?.confluence ?? []).map(s => ({ key: confluenceKey(s.id), files: files.filter(x => x.confluenceSourceId === s.id) })),
        ...(synced?.git ?? []).map(s => ({ key: gitKey(s.id), files: files.filter(x => x.gitRepoSourceId === s.id) })),
    ];
}

/** A source counts as left out of the chat when it has files and none of
 *  them is selected — the same rule greys its row out. */
const groupExcluded = (g: SourceGroup) => g.files.length > 0 && g.files.every(f => f.selected === false);

/** Files that have a card of their own (everything not folded into a
 *  feed/source row). SourcesSection renders exactly these. */
export function cardFiles(files: FileEntry[]): FileEntry[] {
    return files.filter(f => f.origin !== 'rss' && f.origin !== 'confluence' && f.origin !== 'git');
}

/** An RSS feed is left out of the chat (see groupExcluded). */
export function feedExcluded(feedId: string, files: FileEntry[]): boolean {
    return groupExcluded({ key: feedKey(feedId), files: files.filter(f => f.rssFeedId === feedId) });
}

/** A Confluence space or git repository is left out of the chat (see groupExcluded). */
export function syncedExcluded(kind: 'confluence' | 'git', sourceId: string, files: FileEntry[]): boolean {
    const own = kind === 'confluence'
        ? files.filter(f => f.confluenceSourceId === sourceId)
        : files.filter(f => f.gitRepoSourceId === sourceId);
    return groupExcluded({ key: kind === 'confluence' ? confluenceKey(sourceId) : gitKey(sourceId), files: own });
}

/** The rows the chat filter currently includes: what the filter mode opens
 *  with. Exactly the rows that are not greyed out. */
export function filterKeys(files: FileEntry[], feeds: RssFeed[], synced?: SyncedSources): SourceKey[] {
    return [
        ...cardFiles(files).filter(f => f.selected !== false).map(f => fileKey(f.id)),
        ...sourceGroups(files, feeds, synced).filter(g => !groupExcluded(g)).map(g => g.key),
    ];
}

/** Every key the list currently shows, in list order. */
export function selectableKeys(files: FileEntry[], feeds: RssFeed[], synced?: SyncedSources): SourceKey[] {
    return [...cardFiles(files).map(f => fileKey(f.id)), ...sourceGroups(files, feeds, synced).map(g => g.key)];
}

/** The selection narrowed to rows that still exist (a file may have been
 *  deleted or a source removed while the mode was open). */
export function liveSelection(selection: ReadonlySet<SourceKey>, files: FileEntry[], feeds: RssFeed[], synced?: SyncedSources): SourceKey[] {
    return selectableKeys(files, feeds, synced).filter(k => selection.has(k));
}

/** What Confirm writes into the chat filter: every row's files are selected
 *  if the row is ticked and deselected otherwise. Files of a source the list
 *  does not know (no synced list passed) are left alone. */
export function filterUpdate(selection: ReadonlySet<SourceKey>, files: FileEntry[], feeds: RssFeed[], synced?: SyncedSources): { select: string[]; deselect: string[] } {
    const select: string[] = [];
    const deselect: string[] = [];
    for (const f of cardFiles(files)) (selection.has(fileKey(f.id)) ? select : deselect).push(f.id);
    for (const g of sourceGroups(files, feeds, synced)) {
        for (const f of g.files) (selection.has(g.key) ? select : deselect).push(f.id);
    }
    return { select, deselect };
}

/** Whether the filter Confirm would write leaves the chat at least one file
 *  — counting the files Confirm leaves alone. A ticked row can stand for no
 *  file at all (a feed without items). */
export function filterKeepsFiles(selection: ReadonlySet<SourceKey>, files: FileEntry[], feeds: RssFeed[], synced?: SyncedSources): boolean {
    const { select, deselect } = filterUpdate(selection, files, feeds, synced);
    if (select.length > 0) return true;
    const dropped = new Set(deselect);
    return files.some(f => f.selected !== false && !dropped.has(f.id));
}

/** The ticked rows split by what deletes them. */
export function deleteTargets(
    selection: ReadonlySet<SourceKey>, files: FileEntry[], feeds: RssFeed[], synced?: SyncedSources,
): { fileIds: string[]; feedIds: string[]; confluenceIds: string[]; gitIds: string[] } {
    return {
        fileIds: cardFiles(files).filter(f => selection.has(fileKey(f.id))).map(f => f.id),
        feedIds: feeds.filter(f => selection.has(feedKey(f.id))).map(f => f.id),
        confluenceIds: (synced?.confluence ?? []).filter(s => selection.has(confluenceKey(s.id))).map(s => s.id),
        gitIds: (synced?.git ?? []).filter(s => selection.has(gitKey(s.id))).map(s => s.id),
    };
}

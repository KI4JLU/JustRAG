import type { FileEntry, RssFeed } from '../../types';

/* The source list's two modes, each a set of ticked rows:
 *  - filter: which sources the chat answers from (FileEntry.selected). Opens
 *    with the current filter ticked; only Confirm writes the set back, so
 *    Cancel leaves the filter exactly as it was.
 *  - remove: which sources to remove. Opens with the one card it was started
 *    from ticked; Remove asks once and deletes the set.
 *
 * A key names one row of the list: a single file card, or an RSS feed row
 * (which stands for all of that feed's files). Confluence and git rows are not
 * selectable — git files carry no source id on the wire, so a row cannot be
 * mapped to its files — and Confirm leaves their files' filter state alone. */

export type SourceKey = `file:${string}` | `rss:${string}`;

export const fileKey = (id: string): SourceKey => `file:${id}`;
export const feedKey = (id: string): SourceKey => `rss:${id}`;

/** Files that have a card of their own (everything not folded into a
 *  feed/source row). SourcesSection renders exactly these. */
export function cardFiles(files: FileEntry[]): FileEntry[] {
    return files.filter(f => f.origin !== 'rss' && f.origin !== 'confluence' && f.origin !== 'git');
}

/** An RSS feed counts as left out of the chat when it has files and none of
 *  them is selected — the same rule greys its row out. */
export function feedExcluded(feedId: string, files: FileEntry[]): boolean {
    const feedFiles = files.filter(f => f.rssFeedId === feedId);
    return feedFiles.length > 0 && feedFiles.every(f => f.selected === false);
}

/** The rows the chat filter currently includes: what the filter mode opens
 *  with. Exactly the rows that are not greyed out. */
export function filterKeys(files: FileEntry[], feeds: RssFeed[]): SourceKey[] {
    return [
        ...cardFiles(files).filter(f => f.selected !== false).map(f => fileKey(f.id)),
        ...feeds.filter(feed => !feedExcluded(feed.id, files)).map(feed => feedKey(feed.id)),
    ];
}

/** Every key the list currently shows, in list order. */
export function selectableKeys(files: FileEntry[], feeds: RssFeed[]): SourceKey[] {
    return [...cardFiles(files).map(f => fileKey(f.id)), ...feeds.map(f => feedKey(f.id))];
}

/** The selection narrowed to rows that still exist (a file may have been
 *  deleted or a feed removed while the mode was open). */
export function liveSelection(selection: ReadonlySet<SourceKey>, files: FileEntry[], feeds: RssFeed[]): SourceKey[] {
    return selectableKeys(files, feeds).filter(k => selection.has(k));
}

/** What Confirm writes into the chat filter: every selectable row's files are
 *  selected if the row is ticked and deselected otherwise. */
export function filterUpdate(selection: ReadonlySet<SourceKey>, files: FileEntry[], feeds: RssFeed[]): { select: string[]; deselect: string[] } {
    const select: string[] = [];
    const deselect: string[] = [];
    for (const f of cardFiles(files)) (selection.has(fileKey(f.id)) ? select : deselect).push(f.id);
    const ticked = new Set(feeds.filter(feed => selection.has(feedKey(feed.id))).map(feed => feed.id));
    const known = new Set(feeds.map(feed => feed.id));
    for (const f of files) {
        if (f.origin !== 'rss' || !f.rssFeedId || !known.has(f.rssFeedId)) continue;
        (ticked.has(f.rssFeedId) ? select : deselect).push(f.id);
    }
    return { select, deselect };
}

/** Whether the filter Confirm would write leaves the chat at least one file
 *  — counting the files Confirm leaves alone (Confluence, git). A ticked row
 *  can stand for no file at all (an RSS feed without items). */
export function filterKeepsFiles(selection: ReadonlySet<SourceKey>, files: FileEntry[], feeds: RssFeed[]): boolean {
    const { select, deselect } = filterUpdate(selection, files, feeds);
    if (select.length > 0) return true;
    const dropped = new Set(deselect);
    return files.some(f => f.selected !== false && !dropped.has(f.id));
}

/** The ticked rows split by what deletes them. */
export function deleteTargets(selection: ReadonlySet<SourceKey>, files: FileEntry[], feeds: RssFeed[]): { fileIds: string[]; feedIds: string[] } {
    return {
        fileIds: cardFiles(files).filter(f => selection.has(fileKey(f.id))).map(f => f.id),
        feedIds: feeds.filter(f => selection.has(feedKey(f.id))).map(f => f.id),
    };
}

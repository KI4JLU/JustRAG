import type { ConfluenceSource, GitRepoSource, RssFeed } from '../../types';

/** The synced source whose details are open — one of the three kinds. */
export type SourceDetailsTarget =
    | { kind: 'rss'; source: RssFeed }
    | { kind: 'confluence'; source: ConfluenceSource }
    | { kind: 'git'; source: GitRepoSource };

/** The grey type chip of each kind — the same one the source list shows. */
export const SOURCE_TYPE_CHIP: Record<SourceDetailsTarget['kind'], string> = {
    rss: 'RSS',
    confluence: 'COL',
    git: 'GIT',
};

/**
 * The message of a synced source in status `error`. Its `errorMessage` is
 * the remote system's or the backend's own text and is never shown.
 */
export const SOURCE_SYNC_ERROR_KEY: Record<SourceDetailsTarget['kind'], string> = {
    rss: 'rssFeedSyncError',
    confluence: 'confluenceSourceSyncError',
    git: 'gitRepoSyncError',
};

export function sourceDetailsTitle(target: SourceDetailsTarget): string {
    switch (target.kind) {
        case 'rss': return target.source.title || target.source.url;
        case 'confluence': return `${target.source.spaceKey}${target.source.rootPageTitle ? ` / ${target.source.rootPageTitle}` : ''}`;
        case 'git': {
            const repo = target.source.repoUrl.replace(/\.git$/, '').split('/').slice(-2).join('/');
            return `${repo}${target.source.branch ? ` @ ${target.source.branch}` : ''}`;
        }
    }
}

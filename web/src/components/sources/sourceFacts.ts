import type { SyncSchedule } from '../../types';
import { useTheme } from '../../contexts/ThemeContext';
import type { SourceDetailsTarget } from './sourceDetails';
import type { SourceTone } from './SourceStatusDot';

const KIND_LABEL = { rss: 'sourceKindRss', confluence: 'sourceKindConfluence', git: 'sourceKindGit' } as const;

/**
 * What a synced source (RSS feed, Confluence space, git repository) says
 * about itself — its kind, size, state, schedule and last / next sync — as
 * the details dialog's header shows it and the list row's hover card repeats
 * it. One derivation, so the two cannot disagree.
 */
export function useSourceFacts(target: SourceDetailsTarget) {
    const { t, language } = useTheme();
    const s = target.source;
    const locale = language === 'en' ? 'en-GB' : 'de-DE';
    const dateTime = (iso: string | null | undefined) => (iso
        ? new Date(iso).toLocaleString(locale, { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
        : '–');
    const scheduleLabel: Record<SyncSchedule, string> = {
        manual: t('syncScheduleManual'),
        daily: t('syncScheduleDaily'),
        weekly: t('syncScheduleWeekly'),
    };
    const statusLabel = s.status === 'active' ? t('active')
        : s.status === 'paused' ? t('paused')
        : s.status === 'syncing' ? t('syncing')
        : t('feedError');
    const statusTone: SourceTone = s.status === 'error' ? 'error' : s.status === 'active' ? 'ok' : 'busy';

    const [count, countLabel, lastLabel, lastAt] = target.kind === 'rss'
        ? [target.source.itemCount, t('items'), t('lastPolled'), target.source.lastPolledAt]
        : target.kind === 'confluence'
            ? [target.source.pageCount, t('pages'), t('lastSynced'), target.source.lastSyncedAt]
            : [target.source.fileCount, t('gitFiles'), t('lastSynced'), target.source.lastSyncedAt];
    const progress = (target.kind === 'confluence' || target.kind === 'git') && target.source.status === 'syncing' && target.source.syncTotal > 0
        ? `${target.source.syncProgress}/${target.source.syncTotal} ${t('filesProcessed')}`
        : null;
    // Only a scheduled source has a next run; a manual one may still carry a stale value.
    const nextAt = s.syncSchedule !== 'manual' ? s.nextSyncAt : null;

    return {
        kindLabel: t(KIND_LABEL[target.kind]),
        count, countLabel,
        statusLabel, statusTone, progress,
        schedule: scheduleLabel[s.syncSchedule],
        lastLabel, lastAt, nextAt,
        dateTime,
    };
}

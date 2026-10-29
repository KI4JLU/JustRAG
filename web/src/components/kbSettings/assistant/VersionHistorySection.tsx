import { useEffect, useState } from 'react';
import axios from 'axios';
import { Check, ChevronRight, History, Info, Loader2, RotateCcw } from 'lucide-react';
import {
    Avatar, Badge, Button, Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, FilterChips, Notice, cn,
} from '@ki4jlu/design-system';
import { useTheme } from '../../../contexts/ThemeContext';
import { fetchSettingsVersions, restoreSettingsVersion, type SettingsVersion, type VersionChange } from './api';
import { useAssistantSettings } from './useAssistantSettings';
import { changeFieldLabel, changeValue, initials, versionNote } from './versionModel';

const VISIBLE = 5;
type Filter = 'all' | VersionChange['area'];

function useDateFormat() {
    const { language } = useTheme();
    const locale = language === 'de' ? 'de-DE' : 'en-GB';
    return {
        date: (iso: string) => new Date(iso).toLocaleDateString(locale, { day: '2-digit', month: '2-digit', year: 'numeric' }),
        time: (iso: string) => new Date(iso).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' }),
    };
}

function ChangeLine({ c }: { c: VersionChange }) {
    const { t } = useTheme();
    return (
        <li className="grid grid-cols-1 gap-1 py-2 @lg:grid-cols-[11rem_minmax(0,1fr)] @lg:gap-4">
            <span className="text-sm text-on-surface-variant">{changeFieldLabel(c, t)}</span>
            <span className="min-w-0 text-sm text-on-surface">
                {c.added !== undefined && (
                    <span className="flex items-start gap-2"><Badge tone="success">{t('asstAdded')}</Badge><span className="min-w-0 break-words">{c.added}</span></span>
                )}
                {c.removed !== undefined && (
                    <span className="flex items-start gap-2">
                        <Badge tone="error">{t('asstRemoved')}</Badge>
                        <span className="min-w-0 break-words line-through decoration-on-surface-variant">{c.removed}</span>
                    </span>
                )}
                {c.from !== undefined && (
                    <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                        <span className="break-words text-on-surface-variant line-through decoration-on-surface-variant">{changeValue(c, c.from, t)}</span>
                        <ChevronRight className="size-3.5 text-on-surface-variant" aria-label={t('asstChangedTo')} />
                        <span className="break-words font-medium">{changeValue(c, c.to, t)}</span>
                    </span>
                )}
                {c.from === undefined && c.added === undefined && c.removed === undefined && <span>{t('asstChanged')}</span>}
            </span>
        </li>
    );
}

function VersionItem({ v, current, last, open, onToggle, onRestore }: {
    v: SettingsVersion;
    current: boolean;
    last: boolean;
    open: boolean;
    onToggle: () => void;
    onRestore: () => void;
}) {
    const { t } = useTheme();
    const fmt = useDateFormat();
    const areas = (['start', 'behavior'] as const).filter(a => v.changes.some(c => c.area === a));
    const areaLabel = (a: VersionChange['area']) => (a === 'start' ? t('asstStartPage') : t('kbSettingsTabBehavior'));
    const regionId = `version-changes-${v.number}`;
    const note = versionNote(v, t);
    const n = v.changes.length;
    return (
        <li className="relative flex gap-4 pb-6 last:pb-0">
            {!last && <span aria-hidden="true" className="absolute left-[7px] top-5 h-[calc(100%-0.75rem)] w-px bg-outline-variant" />}
            <span aria-hidden="true" className={cn('relative z-10 mt-1.5 size-[15px] shrink-0 rounded-full border-[3px]', current ? 'border-primary-container bg-primary' : 'border-surface bg-outline')} />
            <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <span className="font-semibold text-on-surface">v{v.number}</span>
                    <span className="text-sm text-on-surface-variant">· <time dateTime={v.createdAt}>{fmt.date(v.createdAt)}</time>, {fmt.time(v.createdAt)}</span>
                    {current && <Badge tone="primary">{t('asstCurrent')}</Badge>}
                    {v.restoredFrom ? <Badge tone="neutral"><RotateCcw className="size-3" aria-hidden="true" /> {t('asstRestoredFrom').replace('{n}', String(v.restoredFrom))}</Badge> : null}
                </div>
                <p className="m-0 mt-1 text-sm text-on-surface">
                    {note.text}
                    {note.auto && <span className="ml-1.5 text-xs text-on-surface-variant">{t('asstAutoNote')}</span>}
                </p>
                <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-2">
                    {v.authorName && (
                        <span className="flex items-center gap-1.5 text-xs text-on-surface-variant"><Avatar initials={initials(v.authorName)} size="xs" /> {v.authorName}</span>
                    )}
                    {areas.map(a => <Badge key={a} tone="neutral">{areaLabel(a)}</Badge>)}
                </div>
                {(n > 0 || !current) && (
                    <div className="mt-2 flex flex-wrap items-center gap-1">
                        {n > 0 && (
                            <Button variant="ghost" size="sm" aria-expanded={open} aria-controls={regionId} onClick={onToggle}>
                                <ChevronRight className={cn('size-4 transition-transform', open && 'rotate-90')} aria-hidden="true" />
                                {open ? t('asstHideChanges') : n === 1 ? t('asstShowOneChange') : t('asstShowNChanges').replace('{n}', String(n))}
                            </Button>
                        )}
                        {!current && (
                            <Button variant="ghost" size="sm" onClick={onRestore}>
                                <RotateCcw className="size-4" aria-hidden="true" /> {t('asstRestore')}
                            </Button>
                        )}
                    </div>
                )}
                {open && n > 0 && (
                    <div id={regionId} className="mt-2 rounded-xl border border-outline-variant bg-surface-container-lowest px-4 py-1">
                        {areas.map(a => (
                            <div key={a} className="border-b border-outline-variant py-2 last:border-b-0">
                                <div className="pt-1 text-xs font-semibold uppercase tracking-wide text-on-surface-variant">{areaLabel(a)}</div>
                                <ul className="m-0 list-none divide-y divide-outline-variant p-0">
                                    {v.changes.filter(c => c.area === a).map((c, i) => <ChangeLine key={i} c={c} />)}
                                </ul>
                            </div>
                        ))}
                    </div>
                )}
            </div>
        </li>
    );
}

/**
 * „Versionsverlauf": every save of Startseite or Verhalten is a version with
 * its changes. Restoring writes the chosen state as a NEW version — nothing
 * is overwritten. No footer: nothing here is a draft.
 */
export function VersionHistorySection() {
    const { t } = useTheme();
    const fmt = useDateFormat();
    const store = useAssistantSettings();
    const { kb, version, applySaved, dirty } = store;
    const [versions, setVersions] = useState<SettingsVersion[] | null>(null);
    const [loadFailed, setLoadFailed] = useState(false);
    const [filter, setFilter] = useState<Filter>('all');
    const [openNumber, setOpenNumber] = useState<number | null>(null);
    const [showAll, setShowAll] = useState(false);
    const [ask, setAsk] = useState<SettingsVersion | null>(null);
    const [restoring, setRestoring] = useState(false);
    const [restoreError, setRestoreError] = useState<string | null>(null);
    const [flash, setFlash] = useState<string | null>(null);

    const [attempt, setAttempt] = useState(0);
    // Read again after every save (the store's version moves).
    useEffect(() => {
        let cancelled = false;
        fetchSettingsVersions(kb.id)
            .then(list => {
                if (cancelled) return;
                setVersions(list);
                setLoadFailed(false);
                setOpenNumber(o => o ?? list[0]?.number ?? null);
            })
            .catch(() => { if (!cancelled) setLoadFailed(true); });
        return () => { cancelled = true; };
    }, [kb.id, version, attempt]);
    useEffect(() => {
        if (!flash) return;
        const timer = window.setTimeout(() => setFlash(null), 3500);
        return () => window.clearTimeout(timer);
    }, [flash]);

    if (loadFailed && !versions) {
        return (
            <div className="pt-6">
                <Notice tone="warning" icon={<Info />}>
                    <span className="flex flex-wrap items-center gap-x-3">
                        {t('asstVersionsLoadFailed')}
                        <Button variant="link" size="sm" className="px-0" onClick={() => setAttempt(a => a + 1)}>{t('asstRetry')}</Button>
                    </span>
                </Notice>
            </div>
        );
    }
    if (!versions) return <Loader2 className="mt-6 size-5 animate-spin text-on-surface-variant" aria-label={t('loading')} />;
    if (!versions.length) return <div className="pt-6"><Notice tone="info" icon={<History />}>{t('asstVersionsEmpty')}</Notice></div>;

    const current = versions[0];
    const next = current.number + 1;
    // The baseline has no changes but stays in every filter: it is the start of the line.
    const filtered = versions.filter(v => filter === 'all' || v.kind === 'baseline' || v.changes.some(c => c.area === filter));
    const visible = showAll ? filtered : filtered.slice(0, VISIBLE);
    const hidden = filtered.length - visible.length;

    const restore = async (v: SettingsVersion) => {
        setRestoring(true);
        setRestoreError(null);
        try {
            const res = await restoreSettingsVersion(kb.id, v.number, version);
            applySaved(res);
            setAsk(null);
            setOpenNumber(null);
            setFlash(t('asstRestoredFlash').replace('{n}', String(v.number)).replace('{m}', String(res.version)));
        } catch (err) {
            const code = axios.isAxiosError(err) ? (err.response?.data as { code?: string } | undefined)?.code : undefined;
            setRestoreError(code === 'version_not_restorable' ? t('asstNotRestorable') : code === 'settings_conflict' ? t('asstConflict') : t('asstRestoreFailed'));
        } finally {
            setRestoring(false);
        }
    };

    return (
        <div className="@container flex flex-col gap-5 pt-6">
            <div className="flex flex-wrap items-center gap-4 rounded-xl border border-outline-variant bg-surface-container-lowest p-4 shadow-card">
                <span aria-hidden="true" className="flex size-10 shrink-0 items-center justify-center rounded-[var(--ui-radius-tile)] bg-primary-container text-on-primary-container [&_svg]:size-5"><History /></span>
                <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                        <span className="text-lg font-semibold text-on-surface">v{current.number}</span>
                        <Badge tone="primary">{t('asstCurrent')}</Badge>
                    </div>
                    <p className="m-0 text-sm text-on-surface-variant">
                        {t('asstSavedAtBy')
                            .replace('{date}', fmt.date(current.createdAt))
                            .replace('{time}', fmt.time(current.createdAt))
                            .replace('{name}', current.authorName || t('asstEmptyValue'))
                            .replace('{n}', String(versions.length))}
                    </p>
                </div>
            </div>

            {flash && <Notice tone="info" icon={<Check />} aria-live="polite">{flash}</Notice>}

            <div className="flex flex-wrap items-center justify-between gap-3">
                <FilterChips
                    aria-label={t('asstFilterVersions')}
                    value={filter}
                    onValueChange={(v) => { setFilter(v as Filter); setShowAll(false); }}
                    options={[
                        { value: 'all', label: t('asstAllChanges') },
                        { value: 'start', label: t('asstStartPage') },
                        { value: 'behavior', label: t('kbSettingsTabBehavior') },
                    ]}
                />
                <span className="text-xs text-on-surface-variant">{t('asstEverySaveVersion')}</span>
            </div>

            <section aria-label={t('asstVersionList')}>
                <ol className="m-0 list-none p-0">
                    {visible.map((v, i) => (
                        <VersionItem
                            key={v.number}
                            v={v}
                            current={v.number === current.number}
                            last={i === visible.length - 1 && hidden === 0}
                            open={openNumber === v.number}
                            onToggle={() => setOpenNumber(openNumber === v.number ? null : v.number)}
                            onRestore={() => { setRestoreError(null); setAsk(v); }}
                        />
                    ))}
                </ol>
                {hidden > 0 && (
                    <div className="relative flex gap-4">
                        <span aria-hidden="true" className="mt-1 flex size-[15px] shrink-0 items-center justify-center"><span className="h-full w-px border-l border-dashed border-outline" /></span>
                        <Button variant="ghost" size="sm" onClick={() => setShowAll(true)}>
                            {hidden === 1 ? t('asstShowOneOlder') : t('asstShowNOlder').replace('{n}', String(hidden))}
                        </Button>
                    </div>
                )}
            </section>

            <Notice icon={<Info />}>{t('asstRestoreNote')}</Notice>

            <Dialog open={!!ask} onOpenChange={(o) => { if (!o && !restoring) setAsk(null); }}>
                <DialogContent className="max-w-md">
                    <DialogHeader>
                        <DialogTitle>{t('asstRestoreTitle').replace('{n}', String(ask?.number ?? ''))}</DialogTitle>
                        <DialogDescription>
                            {t('asstRestoreText')
                                .replace('{date}', ask ? fmt.date(ask.createdAt) : '')
                                .replace('{m}', String(next))
                                .replace('{k}', String(current.number))}
                            {dirty && ` ${t('asstRestoreUnsaved')}`}
                        </DialogDescription>
                    </DialogHeader>
                    {restoreError && <Notice tone="warning" icon={<Info />}>{restoreError}</Notice>}
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setAsk(null)} disabled={restoring}>{t('cancel')}</Button>
                        <Button onClick={() => ask && void restore(ask)} disabled={restoring}>
                            {restoring ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : <RotateCcw className="size-4" aria-hidden="true" />}
                            {t('asstRestoreAs').replace('{m}', String(next))}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    );
}

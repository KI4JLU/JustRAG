import { useState, useEffect, useCallback } from 'react';
import { FileText, Loader2, Star } from 'lucide-react';
import { Badge, Card, cardNeutralAccent, CardBand, CardContent, CardDescription, CardFooter, CardHairline, CardMeta, CardTitle } from '@ki4jlu/design-system';
import axios from 'axios';
import { API_BASE_URL } from '../api';
import { useTheme } from '../contexts/ThemeContext';
import { useToast } from '../contexts/ToastContext';
import { useKbSearch } from '../contexts/KbSearchContext';
import { FILTER_ALL, FILTER_FAVORITES } from '../hooks/useTopicFilters';
import type { KbCatalogEntry, KbCategory } from '../types';
import { CategoryPill } from './CategoryPill';
import { TitleCardMeta } from './kbSettings/assistant/StartPageParts';
import { categoryDotColor } from './kbSettings/assistant/startPageModel';

interface KbCatalogPanelProps {
    /** Called after every successful subscribe/unsubscribe toggle, so the
     * caller can refetch the Favoriten list — a subscription change changes
     * what that list shows. */
    onSubscriptionChange: () => void;
    /** Opens a KB known only by its id — the catalog rows carry nothing else. */
    onOpenKb: (id: string) => void;
    /**
     * The active chip from the page's `TopicFilterBar` — `FILTER_ALL`,
     * `FILTER_FAVORITES`, a system category's id or one of the caller's own.
     *
     * It arrives as a prop rather than being read from a context here because
     * this panel owns its own list: the catalog is a REQUEST, not the `kbs`
     * array the other views filter, so applying the chip is its job and not the
     * page's. Every catalog row already carries `isFavorite` and
     * `userCategoryIds` (migration 0077), so it stays a client-side filter over
     * the response and adds no request.
     */
    topicFilter?: string;
    /** Cards or one row per topic — the page's Karten/Liste switch. */
    viewMode?: 'card' | 'list';
}

/** The list view's columns: name (elastic), size, „Stand", star. Below `md` size and date drop out. */
const CATALOG_ROW_COLUMNS =
    'grid grid-cols-[minmax(0,1fr)_auto] gap-x-4 md:grid-cols-[minmax(0,1fr)_7.5rem_8.5rem_auto] [&>*:nth-child(2)]:max-md:hidden [&>*:nth-child(3)]:max-md:hidden';

const SEARCH_DEBOUNCE_MS = 250;

/** How many cards the grid shows before the "show more" button takes over. */
const INITIAL_VISIBLE = 8;

/**
 * The discovery surface: the search RESULTS over every public KB the caller
 * may discover, filtered by the page's chip row (favorites, system and own
 * categories). It lives inline in the Home
 * overview's "KBs entdecken" accordion, which unmounts it while collapsed —
 * so both fetches below re-run each time the section is expanded, and a KB
 * published after the page loaded appears without a reload.
 *
 * It is also the counterpart of the star on a Favoriten card: that star only
 * ever writes an opt-out (no membership change, no chat deletion), so every
 * KB removed there lands back here — including a staged one the caller
 * curates, which GET /api/kb/catalog lists to its members for that reason.
 *
 * IT NO LONGER OWNS THE SEARCH FIELD (card KI-787). The developer moved that
 * one field into the shell's top bar — a move, not a copy: there is no input
 * here any more, and no second `query` state. What stayed is everything the
 * REQUEST needs: the 250 ms debounce below, the category filter, and the
 * `q=`/`category=` assembly.
 *
 * SINCE KI-837 THE HEADER FIELD IS THE GLOBAL SEARCH, and it no longer
 * drives this panel keystroke by keystroke. The query arrives as
 * `KbSearchContext.catalogQuery`, which the dropdown's „show all matching
 * topics in Discover" row sets — see `KbSearchContext` for why the two are
 * separate, and for the TODO that marks it as a reversible assumption.
 */
export default function KbCatalogPanel({ onSubscriptionChange, onOpenKb, topicFilter, viewMode = 'card' }: KbCatalogPanelProps) {
    const { t } = useTheme();
    const toast = useToast();
    const { catalogQuery: query } = useKbSearch();
    const [entries, setEntries] = useState<KbCatalogEntry[]>([]);
    const [categories, setCategories] = useState<KbCategory[]>([]);
    const [pending, setPending] = useState<Set<string>>(new Set());
    const [loading, setLoading] = useState(true);
    /* The fold is stored as WHICH FILTER it was opened for, not as a boolean
       (card KI-787). It used to be a boolean that `changeQuery` and
       `changeCategory` each reset, which stopped working the moment the query
       started arriving from outside this component: there is no setter here to
       hang the reset on any more. Storing the filter the user expanded FOR
       makes „a new result set is folded again" a derived fact rather than a
       side effect somebody has to remember to fire — and it needs no effect,
       so it cannot cascade a render. Same observable behaviour: changing the
       query or the category re-closes the fold. */
    const [expandedFor, setExpandedFor] = useState<string | null>(null);

    // GET /api/kb-categories is authentication-only (its /api/admin/ twin
    // serves the same list to the curation UI). It used to be fetched from the
    // admin route, which answered 403 for everybody else — so the filter tabs
    // were invisible to exactly the users the catalog exists for.
    useEffect(() => {
        axios.get(`${API_BASE_URL}/api/kb-categories`)
            .then(res => setCategories(Array.isArray(res.data) ? res.data : []))
            .catch(() => setCategories([]));
    }, []);

    /* A system category's chip filters on the server (`category=`), as the
       catalog's own tab strip did before the page's chip row took the system
       categories in (developer, 30.10.2026); every other chip filters the
       response below. */
    const activeCategory = topicFilter && categories.some(c => c.id === topicFilter) ? topicFilter : null;

    useEffect(() => {
        const handle = setTimeout(() => {
            const params = new URLSearchParams();
            if (query.trim()) params.set('q', query.trim());
            if (activeCategory) params.append('category', activeCategory);
            axios.get(`${API_BASE_URL}/api/kb/catalog?${params}`)
                .then(res => setEntries(res.data))
                .catch(() => setEntries([]))
                .finally(() => setLoading(false));
        }, SEARCH_DEBOUNCE_MS);
        return () => clearTimeout(handle);
    }, [query, activeCategory]);

    // The identity of the current result set, and therefore of the fold. Two
    // fields joined by a character neither can contain on its own — a category
    // is a uuid and the query is free text, so the newline keeps „a\nb" from
    // colliding with „a" + „\nb".
    const filterKey = `${query}\n${activeCategory ?? ''}`;
    const expanded = expandedFor === filterKey;

    const toggle = useCallback(async (entry: KbCatalogEntry) => {
        const next = !entry.subscribed;
        setPending(prev => new Set(prev).add(entry.id));
        // Optimistic flip so the switch doesn't wait on the round-trip; rolled
        // back below on failure.
        setEntries(prev => prev.map(e => (e.id === entry.id ? { ...e, subscribed: next } : e)));
        try {
            const url = `${API_BASE_URL}/api/kb/${entry.id}/subscription`;
            if (next) {
                await axios.put(url);
            } else {
                await axios.delete(url);
            }
            onSubscriptionChange();
        } catch {
            setEntries(prev => prev.map(e => (e.id === entry.id ? { ...e, subscribed: !next } : e)));
            toast.error(t('subscriptionError'));
        } finally {
            setPending(prev => {
                const copy = new Set(prev);
                copy.delete(entry.id);
                return copy;
            });
        }
    }, [onSubscriptionChange, toast, t]);

    /* The page's chip, applied to the response.
     *
     * BEFORE the fold, deliberately: folding first and filtering after would
     * make „show N more" a count of rows the filter had already removed, and a
     * favorite sitting at position 9 would be unreachable behind a button that
     * claimed to reveal it. */
    const filtered = topicFilter === undefined || topicFilter === FILTER_ALL || activeCategory !== null
        ? entries
        : topicFilter === FILTER_FAVORITES
            ? entries.filter(e => e.isFavorite)
            // A category not in the catalog's list (stale, or hidden meanwhile) matches nothing.
            : [];

    // The catalog can hold every public KB in the deployment; showing all of
    // them at once buries the four sections below it. The fold is client-side
    // on purpose — the request is already capped at 200 rows, and paginating
    // the fetch would make the count in the button a guess.
    const visible = expanded ? filtered : filtered.slice(0, INITIAL_VISIBLE);
    const hidden = expanded ? 0 : filtered.length - visible.length;

    return (
        <div className="home-view__catalog">
            {loading ? (
                <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem', textAlign: 'start' }}>{t('loading')}</p>
            ) : filtered.length === 0 ? (
                /* A heading and a line, not one sentence: the first states
                   what is (nothing here), the second what will change it
                   (somebody publishing one). The old flat string reported a
                   failed lookup, which is the wrong reading of an empty shelf
                   whose content other people supply. */
                <div className="flex flex-col gap-stack-sm">
                    <p className="m-0 font-headline-sm text-headline-sm-mobile text-on-surface">
                        {t('catalogEmptyTitle')}
                    </p>
                    <p className="m-0 text-on-surface-variant">{t('catalogEmptyBody')}</p>
                </div>
            ) : (
                <>
                {viewMode === 'list' && (
                    <div aria-hidden="true" className={`${CATALOG_ROW_COLUMNS} mb-2 border-l-4 border-transparent pl-4 pr-3 text-xs font-medium text-on-surface-variant`}>
                        <span>{t('kbListColTopic')}</span>
                        <span className="text-right">{t('kbListColSources')}</span>
                        <span className="text-right">{t('kbListColAsOf')}</span>
                        <span className="w-7" />
                    </div>
                )}
                {/* Cards: two columns at most, the title and description want
                    the width (developer mockup). List: one row per topic. */}
                <ul className={viewMode === 'list' ? 'm-0 flex list-none flex-col gap-2 p-0' : 'm-0 grid list-none gap-6 p-0 lg:grid-cols-2'}>
                    {visible.map(entry => {
                        const category = categories.find(c => entry.categoryIds.includes(c.id));
                        const accentColor = category ? categoryDotColor(category) : undefined;
                        const open = {
                            role: 'button',
                            tabIndex: 0,
                            'aria-label': `${t('openKb')}: ${entry.name}`,
                            onClick: () => onOpenKb(entry.id),
                            onKeyDown: (e: React.KeyboardEvent) => {
                                if (e.key === 'Enter' || e.key === ' ') {
                                    e.preventDefault();
                                    onOpenKb(entry.id);
                                }
                            },
                        } as const;
                        const nameButton = (
                            <button
                                type="button"
                                className="text-button home-view__kb-name-btn"
                                onClick={(e) => { e.stopPropagation(); onOpenKb(entry.id); }}
                            >
                                {entry.name}
                            </button>
                        );
                        /* Mirror image of the filled star on a Favoriten card:
                           outline means "not in my favorites yet, click to add",
                           filled means "already there, click to drop it". The
                           card itself opens the KB, so this must not bubble. */
                        const star = (
                            <button
                                onClick={(e) => { e.stopPropagation(); void toggle(entry); }}
                                disabled={pending.has(entry.id)}
                                className="home-view__mini-icon shrink-0"
                                aria-pressed={entry.subscribed}
                                title={entry.subscribed ? t('unsubscribe') : t('subscribe')}
                                aria-label={entry.subscribed ? t('unsubscribe') : t('subscribe')}
                            >
                                {pending.has(entry.id)
                                    ? <Loader2 className="animate-spin" size={16} aria-hidden="true" />
                                    : <Star size={16} aria-hidden="true" fill={entry.subscribed ? 'currentColor' : 'none'} />}
                            </button>
                        );
                        const documents = entry.fileCount !== undefined && (
                            <Badge>
                                <FileText size={12} aria-hidden="true" />
                                {entry.fileCount === 1 ? t('asstOneDocument') : t('asstNDocuments').replace('{n}', String(entry.fileCount))}
                            </Badge>
                        );
                        if (viewMode === 'list') {
                            /* The row, as on „Mein Wissen": the category's colour
                               as the left edge with a faint tint from it (grey,
                               no tint, without one), the name with its category
                               under it, then size, „Stand" and the star. */
                            return (
                                <li key={entry.id} className="min-w-0">
                                    <Card
                                        interactive
                                        accent
                                        tint={!!category}
                                        accentColor={accentColor ?? cardNeutralAccent}
                                        data-testid="catalog-entry"
                                        className={`${CATALOG_ROW_COLUMNS} cursor-pointer items-center py-3 pl-4 pr-3`}
                                        {...open}
                                    >
                                        <div className="flex min-w-0 flex-col items-start gap-1">
                                            <span className="max-w-full truncate font-semibold text-on-surface">{nameButton}</span>
                                            {category && <CategoryPill category={category} small />}
                                        </div>
                                        <div className="flex justify-end">{documents}</div>
                                        <span className="truncate text-right text-sm text-on-surface-variant">
                                            <TitleCardMeta asOf={entry.lastIngestedAt ?? undefined} leading={false} />
                                        </span>
                                        {star}
                                    </Card>
                                </li>
                            );
                        }
                        return (
                            <li key={entry.id} className="flex min-w-0">
                                {/* The hairline card (developer mockup „Hairline", 30.10.2026):
                                    name and star on a faint tint of the category's colour,
                                    the category on the rule, the description, then size and
                                    „Stand". Neutral without a category. */}
                                <Card
                                    interactive
                                    accentColor={accentColor}
                                    data-testid="catalog-entry"
                                    className="w-full cursor-pointer"
                                    {...open}
                                >
                                    <CardBand data-testid="catalog-band">
                                        <CardTitle>{nameButton}</CardTitle>
                                        {star}
                                    </CardBand>
                                    <CardHairline>{category && <CategoryPill category={category} onHairline />}</CardHairline>
                                    <CardContent>
                                        {/* What the topic's start page shows: the own
                                            description (or header text), else the default line. */}
                                        <CardDescription className="line-clamp-3 leading-6 text-on-surface">{entry.description?.trim() || t('kbHeaderDefault')}</CardDescription>
                                    </CardContent>
                                    <CardFooter>
                                        <CardMeta className="text-xs">
                                            {documents}
                                            <TitleCardMeta asOf={entry.lastIngestedAt ?? undefined} leading={false} />
                                        </CardMeta>
                                    </CardFooter>
                                </Card>
                            </li>
                        );
                    })}
                </ul>
                {hidden > 0 && (
                    <div className="kb-catalog__more">
                        <button type="button" className="secondary-button" onClick={() => setExpandedFor(filterKey)}>
                            {t('catalogShowMore').replace('{n}', String(hidden))}
                        </button>
                    </div>
                )}
                {expanded && filtered.length > INITIAL_VISIBLE && (
                    <div className="kb-catalog__more">
                        <button type="button" className="secondary-button" onClick={() => setExpandedFor(null)}>
                            {t('catalogShowLess')}
                        </button>
                    </div>
                )}
                </>
            )}
        </div>
    );
}

import { useState, useEffect, useCallback } from 'react';
import { Loader2, Globe, Star } from 'lucide-react';
import axios from 'axios';
import { API_BASE_URL } from '../api';
import { useTheme } from '../contexts/ThemeContext';
import { useToast } from '../contexts/ToastContext';
import { useKbSearch } from '../contexts/KbSearchContext';
import { FILTER_ALL, FILTER_FAVOURITES } from '../hooks/useTopicFilters';
import type { KbCatalogEntry, KbCategory } from '../types';

interface KbCatalogPanelProps {
    /** Called after every successful subscribe/unsubscribe toggle, so the
     * caller can refetch the Favoriten list — a subscription change changes
     * what that list shows. */
    onSubscriptionChange: () => void;
    /** Opens a KB known only by its id — the catalog rows carry nothing else. */
    onOpenKb: (id: string) => void;
    /**
     * The active chip from the page's `TopicFilterBar` — `FILTER_ALL`,
     * `FILTER_FAVOURITES`, or one of the caller's category ids.
     *
     * It arrives as a prop rather than being read from a context here because
     * this panel owns its own list: the catalog is a REQUEST, not the `kbs`
     * array the other views filter, so applying the chip is its job and not the
     * page's. Every catalog row already carries `isFavourite` and
     * `userCategoryIds` (migration 0068), so it stays a client-side filter over
     * the response and adds no request.
     */
    topicFilter?: string;
}

const SEARCH_DEBOUNCE_MS = 250;

/** How many cards the grid shows before the "show more" button takes over. */
const INITIAL_VISIBLE = 8;

/**
 * The discovery surface: the search RESULTS, category tabs and a favorites
 * toggle over every public KB the caller may discover. It lives inline in the Home
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
 * `q=`/`category=` assembly. The query itself arrives through
 * `KbSearchContext`, which also explains why a keystroke can reach this
 * component at all while „KBs entdecken" starts collapsed — writing the query
 * expands the section, and expanding it is what mounts this panel.
 */
export default function KbCatalogPanel({ onSubscriptionChange, onOpenKb, topicFilter }: KbCatalogPanelProps) {
    const { t } = useTheme();
    const toast = useToast();
    const { query } = useKbSearch();
    const [entries, setEntries] = useState<KbCatalogEntry[]>([]);
    const [categories, setCategories] = useState<KbCategory[]>([]);
    const [activeCategory, setActiveCategory] = useState<string | null>(null);
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
     * favourite sitting at position 9 would be unreachable behind a button that
     * claimed to reveal it. */
    const filtered = topicFilter === undefined || topicFilter === FILTER_ALL
        ? entries
        : topicFilter === FILTER_FAVOURITES
            ? entries.filter(e => e.isFavourite)
            : entries.filter(e => e.userCategoryIds.includes(topicFilter));

    // The catalog can hold every public KB in the deployment; showing all of
    // them at once buries the four sections below it. The fold is client-side
    // on purpose — the request is already capped at 200 rows, and paginating
    // the fetch would make the count in the button a guess.
    const visible = expanded ? filtered : filtered.slice(0, INITIAL_VISIBLE);
    const hidden = expanded ? 0 : filtered.length - visible.length;

    return (
        <div className="home-view__catalog">
            {/* Tabs, not chips: the filter is single-select and always has
                exactly one active value, which is what a tab strip states and
                a row of toggle chips does not. "Alle" is the leftmost tab
                rather than a way to clear the others. */}
            {categories.length > 0 && (
                <div className="kb-catalog__tabs" role="tablist" aria-label={t('catalogCategoryTabs')}>
                    <button
                        type="button"
                        role="tab"
                        onClick={() => setActiveCategory(null)}
                        aria-selected={activeCategory === null}
                        className={`kb-catalog__tab${activeCategory === null ? ' kb-catalog__tab--active' : ''}`}
                    >
                        {t('catalogAllCategories')}
                    </button>
                    {categories.map(c => (
                        <button
                            key={c.id}
                            type="button"
                            role="tab"
                            onClick={() => setActiveCategory(c.id)}
                            aria-selected={activeCategory === c.id}
                            className={`kb-catalog__tab${activeCategory === c.id ? ' kb-catalog__tab--active' : ''}`}
                        >
                            {c.name}
                        </button>
                    ))}
                </div>
            )}

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
                <ul className="home-view__grid">
                    {visible.map(entry => (
                        <li
                            key={entry.id}
                            data-testid="catalog-entry"
                            className="source-card home-view__kb-card"
                            role="button" // eslint-disable-line jsx-a11y/no-noninteractive-element-to-interactive-role
                            tabIndex={0}
                            aria-label={`${t('openKb')}: ${entry.name}`}
                            onClick={() => onOpenKb(entry.id)}
                            onKeyDown={(e) => {
                                if (e.key === 'Enter' || e.key === ' ') {
                                    e.preventDefault();
                                    onOpenKb(entry.id);
                                }
                            }}
                        >
                            <div className="home-view__card-top">
                                <Globe size={20} color="var(--accent-primary)" aria-hidden="true" />
                                <div className="home-view__badge-row">
                                    {/* Mirror image of the filled star on a Favoriten card:
                                        outline means "not in my favorites yet, click to add",
                                        filled means "already there, click to drop it". The
                                        card itself opens the KB, so this must not bubble. */}
                                    <button
                                        onClick={(e) => { e.stopPropagation(); void toggle(entry); }}
                                        disabled={pending.has(entry.id)}
                                        className="home-view__mini-icon"
                                        aria-pressed={entry.subscribed}
                                        title={entry.subscribed ? t('unsubscribe') : t('subscribe')}
                                        aria-label={entry.subscribed ? t('unsubscribe') : t('subscribe')}
                                    >
                                        {pending.has(entry.id)
                                            ? <Loader2 className="animate-spin" size={16} aria-hidden="true" />
                                            : <Star size={16} aria-hidden="true" fill={entry.subscribed ? 'currentColor' : 'none'} />}
                                    </button>
                                </div>
                            </div>

                            <div className="source-title home-view__kb-name">
                                <button
                                    type="button"
                                    className="text-button home-view__kb-name-btn"
                                    onClick={(e) => { e.stopPropagation(); onOpenKb(entry.id); }}
                                >
                                    {entry.name}
                                </button>
                            </div>

                            {entry.description && (
                                <div className="home-view__kb-header-text">{entry.description}</div>
                            )}
                        </li>
                    ))}
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

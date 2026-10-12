// Shared date formatting for the Wave-3 "freshness" surface (source dates on
// citations/source cards, admin KB-overview staleness/last-sync columns, the
// Home KB-card freshness chip). Centralizing this means those surfaces cannot
// drift on edge-case handling (missing/invalid input) the way four
// independent copies could.
//
// Both functions degrade to the em-dash placeholder the app already used for
// "no value" (KBOverviewDashboard's original formatRelative) rather than
// throwing or rendering "Invalid Date" — every backend field behind these is
// optional (old messages have no createdAt/publishedAt, non-RSS files have no
// publishedAt, a KB with no synced source has no lastSyncAt).

const DATE_PLACEHOLDER = '—';

// formatDate renders an absolute, locale-aware calendar date (no time-of-day
// — a source date only needs day-level precision).
export function formatDate(iso: string | undefined, lang: 'de' | 'en'): string {
    if (!iso) return DATE_PLACEHOLDER;
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return DATE_PLACEHOLDER;
    return new Intl.DateTimeFormat(lang, { year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
}

// formatRelative renders locale-aware relative time ("vor 2 Std." / "2 hr.
// ago"). Moved from KBOverviewDashboard.tsx, which built one
// Intl.RelativeTimeFormat per render and threaded it through; this version
// takes the plain language code instead so every caller (citation popover,
// source cards, the dashboard, the Home chip) can call it the same way.
// Building the formatter per call is negligible at UI-render volume.
export function formatRelative(iso: string | undefined, lang: 'de' | 'en'): string {
    if (!iso) return DATE_PLACEHOLDER;
    const then = new Date(iso).getTime();
    if (Number.isNaN(then)) return DATE_PLACEHOLDER;
    const rtf = new Intl.RelativeTimeFormat(lang, { numeric: 'auto' });
    const diffMs = then - Date.now(); // negative => in the past
    const sec = Math.round(diffMs / 1000);
    const min = Math.round(diffMs / 60000);
    const hr = Math.round(diffMs / 3600000);
    const day = Math.round(diffMs / 86400000);
    if (Math.abs(sec) < 60) return rtf.format(sec, 'second');
    if (Math.abs(min) < 60) return rtf.format(min, 'minute');
    if (Math.abs(hr) < 24) return rtf.format(hr, 'hour');
    return rtf.format(day, 'day');
}

// formatRelativeCoarse is the KB card's „Genutzt" / „Aktualisiert" value
// (card KI-848): `Intl.RelativeTimeFormat(lang, { numeric: 'auto' })`, which
// is what yields „gestern" / „yesterday" instead of „vor 1 Tag". Unlike
// `formatRelative` (unchanged, used by the admin dashboard and the citation
// surfaces) it climbs to months and years, because a card line reading
// „vor 412 Tagen" is noise. THE RULE, by the absolute age:
//   < 1 minute   → „jetzt" / „now"          (second 0)
//   < 1 hour     → minutes                  („vor 5 Minuten")
//   < 24 hours   → hours                    („vor 3 Stunden")
//   < 30 days    → days                     („gestern", „vor 7 Tagen")
//   < 365 days   → months, rounded, ≥ 1     („vor 2 Monaten")
//   otherwise    → years, rounded, ≥ 1      („vor 3 Jahren")
// A timestamp in the future (clock skew between server and browser) reads as
// „jetzt" rather than „in 2 Minuten": these are past events by definition.
export function formatRelativeCoarse(iso: string | undefined, lang: 'de' | 'en'): string {
    if (!iso) return DATE_PLACEHOLDER;
    const then = new Date(iso).getTime();
    if (Number.isNaN(then)) return DATE_PLACEHOLDER;
    const rtf = new Intl.RelativeTimeFormat(lang, { numeric: 'auto' });
    const ageMs = Math.max(0, Date.now() - then);
    // Floored below a day, so 59.9 minutes is „vor 59 Minuten", never „vor 60
    // Minuten"; rounded from a day up, so 36 hours is „vorgestern" (2 days).
    const min = Math.floor(ageMs / 60000);
    const hr = Math.floor(ageMs / 3600000);
    const day = Math.round(ageMs / 86400000);
    if (ageMs < 60000) return rtf.format(0, 'second');
    if (ageMs < 3600000) return rtf.format(-min, 'minute');
    if (ageMs < 86400000) return rtf.format(-hr, 'hour');
    if (day < 30) return rtf.format(-day, 'day');
    if (day < 365) return rtf.format(-Math.max(1, Math.round(day / 30.4375)), 'month');
    return rtf.format(-Math.max(1, Math.round(day / 365.25)), 'year');
}

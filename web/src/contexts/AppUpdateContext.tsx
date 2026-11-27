import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useRegisterSW } from 'virtual:pwa-register/react';
import { shouldApplyAutomatically } from '../utils/updatePolicy';

// Re-check for a newly deployed service worker on this cadence. Matches the
// useVersionCheck poll interval, so a deploy surfaces the update card
// within about a minute even on a long-lived tab.
const UPDATE_CHECK_INTERVAL = 60_000;

// How often to re-evaluate the deferral deadline. Not time-critical to the
// second, so this stays cheap.
const POLICY_TICK_INTERVAL = 30_000;

export interface AppUpdate {
    /** A newer build's service worker is installed and waiting. */
    available: boolean;
    /** When this tab first saw it waiting; null while there is none. */
    since: Date | null;
    /** Switches to it: the waiting worker takes over and the page reloads. */
    apply: () => void;
}

// Without a provider (tests, Storybook) there is never an update.
const AppUpdateContext = createContext<AppUpdate>({ available: false, since: null, apply: () => {} });

/**
 * Registers the service worker — once, for the whole app — and tells the
 * shell when a newer build is waiting. The shell shows that as a card
 * (hooks/useSystemNoticeBanner.tsx); accepting it posts SKIP_WAITING and
 * reloads, the only way to move an open tab off its precached app shell.
 *
 * Also applies a long-ignored update on a hidden tab. Why the worker waits at
 * all, and when the version may change: utils/updatePolicy.ts.
 */
export function AppUpdateProvider({ children }: { children: ReactNode }) {
    // When the waiting worker was reported: the update card's creation time.
    const [since, setSince] = useState<Date | null>(null);
    const {
        needRefresh: [needRefresh],
        updateServiceWorker,
    } = useRegisterSW({
        // Stamped as it is reported, so the card never renders without it.
        onNeedRefresh() {
            setSince((at) => at ?? new Date());
        },
        onRegisteredSW(_swUrl, registration) {
            if (!registration) return;
            setInterval(() => {
                // Offline / transient failures just retry on the next tick.
                registration.update().catch(() => { /* no-op */ });
            }, UPDATE_CHECK_INTERVAL);
        },
    });

    const [now, setNow] = useState(() => Date.now());

    // When the waiting worker was first seen — the clock the deferral deadline
    // runs against. A ref because changing it must not itself re-render.
    const pendingSince = useRef<number | null>(null);

    // updateServiceWorker is not guaranteed to be referentially stable, and it
    // must not be a dependency of the effects and the callback below.
    const updateRef = useRef(updateServiceWorker);
    useEffect(() => {
        updateRef.current = updateServiceWorker;
    }, [updateServiceWorker]);

    useEffect(() => {
        if (needRefresh && pendingSince.current === null) {
            pendingSince.current = since?.getTime() ?? Date.now();
        }
    }, [needRefresh, since]);

    // Re-evaluate on a timer and whenever the tab is shown or hidden — the
    // latter is what makes the deadline actionable, since auto-apply only
    // fires while hidden.
    useEffect(() => {
        if (!needRefresh) return;
        const tick = () => setNow(Date.now());
        const timer = setInterval(tick, POLICY_TICK_INTERVAL);
        document.addEventListener('visibilitychange', tick);
        return () => {
            clearInterval(timer);
            document.removeEventListener('visibilitychange', tick);
        };
    }, [needRefresh]);

    const applied = useRef(false);
    useEffect(() => {
        if (!needRefresh || applied.current) return;
        if (shouldApplyAutomatically(pendingSince.current, now, document.hidden)) {
            applied.current = true;
            void updateRef.current(true);
        }
    }, [needRefresh, now]);

    const apply = useCallback(() => { void updateRef.current(true); }, []);
    const value = useMemo(() => ({ available: needRefresh, since, apply }), [needRefresh, since, apply]);
    return <AppUpdateContext.Provider value={value}>{children}</AppUpdateContext.Provider>;
}

export function useAppUpdate(): AppUpdate {
    return useContext(AppUpdateContext);
}

import { useCallback, useEffect, useState } from 'react';
import axios from 'axios';
import { API_BASE_URL } from '../../api';
import { splitUsernames } from '../../utils/splitUsernames';
import { displayName } from '../../utils/personName';
import type { BulkAddSummary, LookedUpUser } from './sharing';

/**
 * One name in the "Benutzernamen" field. Resolved by an exact username lookup (no directory
 * search):
 * - `found`: an account — a chip with avatar and name, added directly;
 * - `pending`: no account yet — a warning chip, parked as a pending invite and granted at the
 *   person's first login;
 * - `member` / `invalid` / `failed`: an error chip, skipped when adding.
 */
export interface Candidate {
    key: string;
    typed: string;
    status: 'resolving' | 'found' | 'pending' | 'member' | 'invalid' | 'failed';
    user?: LookedUpUser;
}

/** Names that are sent to the bulk endpoint: accounts and pending invites. */
export const isAddable = (c: Candidate) => c.status === 'found' || c.status === 'pending';

/**
 * The names being collected for a bulk add, and what each one resolves to. Shared by every
 * sharing panel: the lookup is the same whatever is being shared; `isMember` says whether an
 * account already holds a role there.
 */
export function useBulkAdd(isMember: (userId: string) => boolean) {
    const [candidates, setCandidates] = useState<Candidate[]>([]);
    const [query, setQuery] = useState('');
    // The lookup result for one typed string; shown only while it still matches.
    const [lookedUp, setLookedUp] = useState<{ typed: string; user: LookedUpUser | null } | null>(null);

    // GET /api/users/{term} is NOT an exact lookup: with no exact username (or id) it falls back
    // to a substring search over username, first and last name and returns the first hit
    // (users.SearchUserByTerm). Fine for the suggestion row — the person adding picks someone
    // explicitly — but a committed name must never silently become whoever the search hit first.
    const fetchUser = useCallback(async (term: string): Promise<LookedUpUser | null> => {
        try {
            const res = await axios.get(`${API_BASE_URL}/api/users/${encodeURIComponent(term)}`);
            return res.data as LookedUpUser;
        } catch (err: unknown) {
            if (axios.isAxiosError(err) && err.response?.status === 404) return null;
            throw err;
        }
    }, []);

    // A committed name: an account only on an exact username (or id) match. Anything else is what
    // the bulk endpoint makes of it too — a pending invite for exactly the typed name.
    const lookup = useCallback(async (typed: string): Promise<Pick<Candidate, 'status' | 'user'>> => {
        if (!typed || /\s/.test(typed)) return { status: 'invalid' };
        try {
            const user = await fetchUser(typed);
            const exact = user && (user.username.toLowerCase() === typed.toLowerCase() || user.id === typed);
            if (!exact) return { status: 'pending' };
            return { status: isMember(user.id) ? 'member' : 'found', user };
        } catch {
            return { status: 'failed' };
        }
    }, [fetchUser, isMember]);

    // Commit names: each becomes a chip at once ("resolving"), then takes the state its lookup
    // returns. A name already in the field is not added twice.
    const addNames = useCallback((names: string[]) => {
        setCandidates(prev => {
            const seen = new Set(prev.map(c => c.key));
            const fresh: Candidate[] = [];
            for (const typed of names) {
                const key = typed.toLowerCase();
                if (seen.has(key)) continue;
                seen.add(key);
                fresh.push({ key, typed, status: 'resolving' });
            }
            for (const c of fresh) {
                void lookup(c.typed).then(result => setCandidates(cur => {
                    // Two names that resolve to the same account ("Tester", "tester", the user's
                    // id) are one person: keep the first chip.
                    if (result.user && cur.some(x => x.key !== c.key && x.user?.id === result.user!.id)) {
                        return cur.filter(x => x.key !== c.key);
                    }
                    return cur.map(x => x.key === c.key ? { ...x, ...result } : x);
                }));
            }
            return [...prev, ...fresh];
        });
    }, [lookup]);

    const addSuggestion = (user: LookedUpUser) => {
        const key = user.username.toLowerCase();
        setCandidates(prev => prev.some(c => c.key === key || c.user?.id === user.id)
            ? prev
            : [...prev, { key, typed: user.username, status: isMember(user.id) ? 'member' : 'found', user }]);
    };

    // The suggestion row: whoever the search finds for the text typed so far ("tes" → Tessa
    // Beispiel), unless that person is already in the field.
    const typedQuery = query.trim();
    const canSuggest = typedQuery.length >= 2 && !/\s/.test(typedQuery);
    useEffect(() => {
        if (!canSuggest) return;
        const timer = setTimeout(() => {
            void fetchUser(typedQuery)
                .then(user => setLookedUp({ typed: typedQuery, user }))
                .catch(() => setLookedUp({ typed: typedQuery, user: null }));
        }, 250);
        return () => clearTimeout(timer);
    }, [typedQuery, canSuggest, fetchUser]);
    const suggestion = canSuggest && lookedUp?.typed === typedQuery && lookedUp.user
        && !candidates.some(c => c.key === lookedUp.user!.username.toLowerCase() || c.user?.id === lookedUp.user!.id)
        ? lookedUp.user : null;

    // "CSV hochladen": the file's names become chips like typed ones. Any separator
    // splitUsernames knows (comma, whitespace, newline, and ";"); a header cell "username" is
    // dropped.
    const addCsvFile = async (file: File | undefined) => {
        if (!file) return;
        const names = splitUsernames((await file.text()).replace(/;/g, ','))
            .filter(n => !/^(username|benutzername|user)$/i.test(n));
        addNames(names);
    };

    const reset = useCallback(() => {
        setCandidates([]);
        setQuery('');
    }, []);

    return {
        candidates, setCandidates, query, setQuery, suggestion, addNames, addSuggestion, addCsvFile, reset,
        /** The names the bulk endpoint gets. */
        usernames: candidates.filter(isAddable).map(c => c.user?.username ?? c.typed),
        addableCount: candidates.filter(isAddable).length,
        resolving: candidates.some(c => c.status === 'resolving'),
        pendingNames: candidates.filter(c => c.status === 'pending').map(c => c.typed),
        skippedNames: candidates.filter(c => c.status === 'member' || c.status === 'invalid' || c.status === 'failed')
            .map(c => (c.user ? displayName(c.user.firstName, c.user.lastName, c.user.username) : c.typed)),
        isMember,
    };
}

export type BulkAdd = ReturnType<typeof useBulkAdd>;

/** The toast line of a bulk add's answer: how many were shared now, parked, or already held access. */
export function bulkSummaryText(template: string, summary: BulkAddSummary): string {
    return template
        .replace('{shared}', String(summary.shared.length))
        .replace('{pending}', String(summary.pending.length))
        .replace('{already}', String(summary.alreadyHadAccess.length));
}

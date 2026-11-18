import { useEffect, useMemo, useState } from 'react';
import axios from 'axios';
import { API_BASE_URL } from '../api';

const NONE: string[] = [];

/**
 * Starter questions for an empty chat, generated server-side from the KB's
 * documents for the role the chat starts in (GET /api/kb/{id}/starter-questions;
 * roleId undefined = the active role). New ones every time the empty chat
 * opens: the server keeps none. Empty while loading, when disabled, and on
 * any failure: the caller's configured prompts stand on their own. `loading`
 * is true while an answer is still on its way.
 */
export function useStarterQuestions(kbId: string | undefined, language: string, enabled: boolean, roleId?: string): { questions: string[]; loading: boolean } {
    const [state, setState] = useState<{ key: string; questions: string[] }>({ key: '', questions: [] });
    const key = enabled && kbId ? `${kbId}|${language}|${roleId ?? ''}` : '';
    // Every change of what is asked for drops the answer held: coming back to
    // an earlier request (switched off and on, another language and back)
    // asks afresh, and must report loading instead of the old answer as settled.
    const [asked, setAsked] = useState(key);
    if (asked !== key) {
        setAsked(key);
        setState({ key: '', questions: [] });
    }

    useEffect(() => {
        if (!key || !kbId) return;
        let cancelled = false;
        axios.get<{ questions: string[] }>(`${API_BASE_URL}/api/kb/${kbId}/starter-questions`, { params: { lang: language, roleId } })
            .then(res => { if (!cancelled) setState({ key, questions: res.data.questions ?? [] }); })
            .catch(() => { if (!cancelled) setState({ key, questions: [] }); });
        return () => { cancelled = true; };
    }, [key, kbId, language, roleId]);

    const settled = state.key === key;
    return useMemo(() => ({ questions: settled ? state.questions : NONE, loading: !!key && !settled }), [settled, state.questions, key]);
}

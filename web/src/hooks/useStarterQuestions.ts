import { useEffect, useState } from 'react';
import axios from 'axios';
import { API_BASE_URL } from '../api';

/**
 * Starter questions for an empty chat, generated server-side from the KB's
 * documents (GET /api/kb/{id}/starter-questions — the follow-up generator's
 * sibling, cached per KB content). Empty while loading, when disabled, and on
 * any failure: the caller's configured prompts stand on their own.
 */
export function useStarterQuestions(kbId: string | undefined, language: string, enabled: boolean): string[] {
    const [state, setState] = useState<{ key: string; questions: string[] }>({ key: '', questions: [] });
    const key = enabled && kbId ? `${kbId}|${language}` : '';

    useEffect(() => {
        if (!key || !kbId) return;
        let cancelled = false;
        axios.get<{ questions: string[] }>(`${API_BASE_URL}/api/kb/${kbId}/starter-questions`, { params: { lang: language } })
            .then(res => { if (!cancelled) setState({ key, questions: res.data.questions ?? [] }); })
            .catch(() => { if (!cancelled) setState({ key, questions: [] }); });
        return () => { cancelled = true; };
    }, [key, kbId, language]);

    return state.key === key ? state.questions : [];
}

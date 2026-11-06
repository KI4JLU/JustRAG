import { useCallback, useEffect, useState } from 'react';
import { fetchStarterQuestions } from './api';

/**
 * An example of a role's generated starter questions for the settings
 * (roleId undefined = the active role). The server generates new ones on
 * every call, as members get on every empty chat; „Neues Beispiel"
 * (`newExample`) asks again. `loading` is true while a sample is generated.
 */
export function useStarterSample(kbId: string, language: string, roleId: string | undefined): { sample: string[]; loading: boolean; newExample: () => void } {
    const [sample, setSample] = useState<string[]>([]);
    const [loading, setLoading] = useState(true);
    const [round, setRound] = useState(0);
    useEffect(() => {
        let cancelled = false;
        setLoading(true);
        fetchStarterQuestions(kbId, language, roleId)
            .then(q => { if (!cancelled) setSample(q); })
            .catch(() => undefined)
            .finally(() => { if (!cancelled) setLoading(false); });
        return () => { cancelled = true; };
    }, [kbId, language, roleId, round]);
    const newExample = useCallback(() => setRound(r => r + 1), []);
    return { sample, loading, newExample };
}

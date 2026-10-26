import { useState } from 'react';
import axios from 'axios';
import { RefreshCw } from 'lucide-react';
import { Button, SettingsRow } from '@ki4jlu/design-system';
import { API_BASE_URL } from '../../api';
import { useTheme } from '../../contexts/ThemeContext';
import { useToast } from '../../contexts/ToastContext';
import { useModalContext } from '../../contexts/ModalContext';

export default function ReembedSection() {
    const { t } = useTheme();
    const toast = useToast();
    const { showConfirm } = useModalContext();
    const [loading, setLoading] = useState(false);
    const [result, setResult] = useState<{ queued: number } | null>(null);

    const handleReembedAll = async () => {
        if (!await showConfirm(t('confirmReembedAll'))) return;

        setLoading(true);
        setResult(null);
        try {
            const res = await axios.post(`${API_BASE_URL}/api/admin/reembed-all`);
            setResult({ queued: res.data.queued });
        } catch (err: unknown) {
            toast.error(t('reembedError'));
            console.error(err);
        } finally {
            setLoading(false);
        }
    };

    return (
        // A single action with its explanation, as a settings row: the title and description on
        // the left, the button on the right, the outcome underneath. The confirm step above is
        // what guards it (re-embedding every KB is slow and costs model calls).
        <SettingsRow
            className="mt-8"
            label={t('reembedAllTitle')}
            description={t('reembedAllDesc')}
            control={(
                <Button type="button" variant="outline" onClick={handleReembedAll} disabled={loading}>
                    <RefreshCw size={16} className={loading ? 'animate-spin' : undefined} aria-hidden="true" />
                    {loading ? t('reembedQueuing') : t('reembedAllButton')}
                </Button>
            )}
        >
            {result && (
                <p role="status" className="m-0 text-sm text-on-surface-variant">
                    {t('reembedQueued').replace('{count}', String(result.queued))}
                </p>
            )}
        </SettingsRow>
    );
}

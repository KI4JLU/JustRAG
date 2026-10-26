import { useEffect, useState } from 'react';
import axios from 'axios';
import { Loader2 } from 'lucide-react';
import { API_BASE_URL } from '../../api';
import { getApiErrorMessage } from '../../utils/apiError';
import {
    Alert, AlertDescription, Button, Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, Label,
    Select, SelectContent, SelectItem, SelectTrigger, SelectValue, Spinner,
} from '@ki4jlu/design-system';
import { useTheme } from '../../contexts/ThemeContext';

export interface UnpublishCandidate {
    userId: string;
    username: string;
    firstName?: string | null;
    lastName?: string | null;
}

export interface UnpublishImpact {
    subscribers: number;
    candidates: UnpublishCandidate[];
}

export interface AdminUnpublishDialogProps {
    kbId: string;
    kbName: string;
    /** Acting admin's own user id — the fallback owner when there are no
     * KB-admin candidates to pick from. */
    currentUserId: string;
    busy: boolean;
    error: string | null;
    onCancel: () => void;
    onConfirm: (newOwnerId: string) => void;
}

function displayName(c: UnpublishCandidate): string {
    const full = `${c.firstName ?? ''} ${c.lastName ?? ''}`.trim();
    return full ? `${full} (${c.username})` : c.username;
}

/**
 * Unpublish confirmation modal for the public-KB admin tab.
 *
 * Loads GET /api/admin/kb/{id}/unpublish-impact on mount so the admin sees
 * the subscriber count and the pool of KB-admin candidates before confirming
 * — POST /api/admin/kb/{id}/unpublish requires newOwnerId, since a private KB
 * without an owner would be unreachable for everyone but superadmins. When
 * there are no candidates the acting admin becomes the owner automatically
 * (no picker to block on); otherwise confirmation stays disabled until one is
 * chosen.
 */
export function AdminUnpublishDialog({
    kbId, kbName, currentUserId, busy, error, onCancel, onConfirm,
}: AdminUnpublishDialogProps) {
    const { t } = useTheme();
    const [impact, setImpact] = useState<UnpublishImpact | null>(null);
    const [loading, setLoading] = useState(true);
    const [loadError, setLoadError] = useState<string | null>(null);
    const [selectedOwnerId, setSelectedOwnerId] = useState('');

    useEffect(() => {
        let cancelled = false;
        (async () => {
            try {
                const res = await axios.get(`${API_BASE_URL}/api/admin/kb/${kbId}/unpublish-impact`);
                const data = res.data as UnpublishImpact;
                if (cancelled) return;
                setImpact(data);
                setLoadError(null);
                if (data.candidates.length === 0) setSelectedOwnerId(currentUserId);
            } catch (err: unknown) {
                if (!cancelled) setLoadError(getApiErrorMessage(err, t('unpublishImpactLoadError')));
            } finally {
                if (!cancelled) setLoading(false);
            }
        })();
        return () => { cancelled = true; };
    }, [kbId, currentUserId, t]);

    const hasCandidates = (impact?.candidates.length ?? 0) > 0;
    const ready = impact !== null && (!hasCandidates || selectedOwnerId !== '');

    return (
        <Dialog open onOpenChange={(open) => { if (!open) onCancel(); }}>
            <DialogContent closeLabel={t('close')} className="max-w-md" aria-describedby={undefined}>
                <DialogHeader className="pr-8">
                    <DialogTitle>{t('unpublishTitle')}</DialogTitle>
                </DialogHeader>

                <div className="flex flex-col gap-3">
                    <p className="m-0 font-semibold text-on-surface">{kbName}</p>

                    {loading && (
                        <div className="flex items-center gap-2 py-3 text-on-surface-variant">
                            <Spinner size="sm" label={t('loading')} />
                            <span aria-hidden="true">{t('loading')}</span>
                        </div>
                    )}

                    {impact && (
                        <>
                            <p className="m-0 text-sm text-on-surface-variant">
                                {t('unpublishSubscriberWarning').replace('{count}', String(impact.subscribers))}
                            </p>

                            {hasCandidates ? (
                                <div className="flex flex-col gap-1.5">
                                    <Label htmlFor="admin-unpublish-owner">{t('unpublishOwnerLabel')}</Label>
                                    <Select value={selectedOwnerId} onValueChange={setSelectedOwnerId}>
                                        <SelectTrigger id="admin-unpublish-owner" aria-label={t('unpublishOwnerLabel')}>
                                            <SelectValue placeholder={t('unpublishOwnerLabel')} />
                                        </SelectTrigger>
                                        <SelectContent>
                                            {impact.candidates.map((c) => (
                                                <SelectItem key={c.userId} value={c.userId}>{displayName(c)}</SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                </div>
                            ) : (
                                <p className="m-0 text-sm text-on-surface-variant">{t('unpublishNoCandidates')}</p>
                            )}
                        </>
                    )}

                    {(error || loadError) && (
                        <Alert tone="error" live="assertive">
                            <AlertDescription>{error || loadError}</AlertDescription>
                        </Alert>
                    )}
                </div>

                <DialogFooter>
                    <Button type="button" variant="outline" onClick={onCancel} disabled={busy}>
                        {t('cancel')}
                    </Button>
                    <Button
                        type="button"
                        variant="destructive"
                        onClick={() => { if (ready && !busy) onConfirm(selectedOwnerId); }}
                        disabled={!ready || busy}
                    >
                        {busy && <Loader2 size={15} className="animate-spin" aria-hidden="true" />}
                        {t('unpublishKb')}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}

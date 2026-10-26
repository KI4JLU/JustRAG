import { useState, useEffect, useMemo } from 'react';
import axios from 'axios';
import { Loader2 } from 'lucide-react';
import { API_BASE_URL } from '../../api';
import { getApiErrorMessage } from '../../utils/apiError';
import {
    Alert, AlertDescription, Button, Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader,
    DialogTitle, Input, Spinner,
} from '@ki4jlu/design-system';
import { useTheme } from '../../contexts/ThemeContext';

export interface AdminUserOption {
    id: string;
    username: string;
    firstName?: string;
    lastName?: string;
}

export interface KbTransferOwnerDialogProps {
    kbName: string;
    currentOwnerId?: string | null;
    currentOwnerName?: string | null;
    busy: boolean;
    error: string | null;
    onCancel: () => void;
    onConfirm: (userId: string) => void;
}

function displayName(u: AdminUserOption): string {
    const full = `${u.firstName ?? ''} ${u.lastName ?? ''}`.trim();
    return full ? `${full} (${u.username})` : u.username;
}

/**
 * Owner-transfer modal for the admin KB-Übersicht.
 *
 * Loads the admin user list once on open and filters client-side — the list is
 * small and unpaginated (GET /api/admin/users), so a round trip per keystroke
 * would buy nothing. The current owner is not offered: the backend rejects a
 * self-transfer with 400 and there is no sense in showing a dead option.
 */
export function KbTransferOwnerDialog({
    kbName, currentOwnerId, currentOwnerName, busy, error, onCancel, onConfirm,
}: KbTransferOwnerDialogProps) {
    const { t } = useTheme();
    const [users, setUsers] = useState<AdminUserOption[]>([]);
    const [loadError, setLoadError] = useState<string | null>(null);
    const [loading, setLoading] = useState(true);
    const [search, setSearch] = useState('');
    const [selectedId, setSelectedId] = useState('');

    useEffect(() => {
        let cancelled = false;
        (async () => {
            try {
                const res = await axios.get(`${API_BASE_URL}/api/admin/users`);
                if (!cancelled) {
                    setUsers(res.data as AdminUserOption[]);
                    setLoadError(null);
                }
            } catch (err: unknown) {
                if (!cancelled) setLoadError(getApiErrorMessage(err, t('kbTransferUsersLoadError')));
            } finally {
                if (!cancelled) setLoading(false);
            }
        })();
        return () => { cancelled = true; };
    }, [t]);

    const candidates = useMemo(() => {
        const needle = search.trim().toLowerCase();
        return users
            .filter((u) => u.id !== currentOwnerId)
            .filter((u) => !needle || displayName(u).toLowerCase().includes(needle));
    }, [users, search, currentOwnerId]);

    // A selection that has been filtered out of `candidates` (e.g. the admin
    // picked a user, then typed a search term that hides them) must not be
    // submittable — the admin can no longer see who they'd be confirming.
    const selectionVisible = selectedId !== '' && candidates.some((u) => u.id === selectedId);

    return (
        <Dialog open onOpenChange={(open) => { if (!open) onCancel(); }}>
            <DialogContent closeLabel={t('close')} className="max-w-md">
                <DialogHeader className="pr-8">
                    <DialogTitle>{t('kbTransferTitle')}</DialogTitle>
                    <DialogDescription>{t('kbTransferIntro')}</DialogDescription>
                </DialogHeader>

                <div className="flex flex-col gap-3">
                    <div>
                        <p className="m-0 font-semibold text-on-surface">{kbName}</p>
                        <p className="m-0 text-sm text-on-surface-variant">
                            {t('kbTransferCurrentOwner')}: {currentOwnerName || t('kbTransferNoOwner')}
                        </p>
                    </div>

                    <Input
                        type="text"
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        placeholder={t('kbTransferSearchPlaceholder')}
                        aria-label={t('kbTransferSearchPlaceholder')}
                    />

                    <div className="max-h-56 overflow-y-auto rounded-lg border border-outline-variant">
                        {loading && (
                            <div className="flex items-center gap-2 p-3 text-on-surface-variant">
                                <Spinner size="sm" label={t('loading')} />
                                <span aria-hidden="true">{t('loading')}</span>
                            </div>
                        )}
                        {!loading && candidates.length === 0 && (
                            <div className="p-3 text-sm text-on-surface-variant">{t('kbTransferNoUsers')}</div>
                        )}
                        {candidates.map((u) => (
                            <Button
                                key={u.id}
                                type="button"
                                variant="ghost"
                                className="w-full justify-start rounded-none"
                                onClick={() => setSelectedId(u.id)}
                                aria-pressed={selectedId === u.id}
                            >
                                {displayName(u)}
                            </Button>
                        ))}
                    </div>

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
                        onClick={() => { if (selectionVisible) onConfirm(selectedId); }}
                        disabled={!selectionVisible || busy}
                    >
                        {busy && <Loader2 size={15} className="animate-spin" aria-hidden="true" />}
                        {t('kbTransferSubmit')}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}

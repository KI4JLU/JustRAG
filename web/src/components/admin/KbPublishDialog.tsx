import { Globe, Loader2 } from 'lucide-react';
import {
    Alert, AlertDescription, Button, Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from '@ki4jlu/design-system';
import { useTheme } from '../../contexts/ThemeContext';

export interface KbPublishDialogProps {
    kbName: string;
    busy: boolean;
    error: string | null;
    onCancel: () => void;
    onConfirm: () => void;
}

/**
 * Confirmation modal for making a private KB public from the admin KB-Übersicht.
 *
 * Publishing hands read access to every authenticated user and strips the KB's
 * owner, so the dialog states both up front rather than leaving the operator to
 * infer them from a button label. It also names the staging step: the backend
 * forces is_published = false on publish, so the KB is public but invisible to
 * ordinary users until an admin flips the catalog toggle in the global-KB tab.
 *
 * No type-to-confirm here, unlike KbDeleteDialog — publishing is reversible
 * (the unpublish path in the global-KB tab), deleting is not. Presentational
 * only: the parent owns the request.
 */
export function KbPublishDialog({ kbName, busy, error, onCancel, onConfirm }: KbPublishDialogProps) {
    const { t } = useTheme();

    return (
        <Dialog open onOpenChange={(open) => { if (!open) onCancel(); }}>
            <DialogContent closeLabel={t('close')} className="max-w-md" aria-describedby={undefined}>
                <DialogHeader className="pr-8">
                    <DialogTitle className="flex items-center gap-2">
                        <Globe size={18} aria-hidden="true" className="shrink-0 text-primary" />
                        {t('kbPublishTitle')}
                    </DialogTitle>
                </DialogHeader>

                <div className="flex flex-col gap-3">
                    <p className="m-0 font-semibold text-on-surface">{kbName}</p>

                    <p className="m-0 text-sm text-error">{t('kbPublishWarning')}</p>
                    <p className="m-0 text-sm text-on-surface-variant">{t('kbPublishStagedNote')}</p>
                    <p className="m-0 text-sm text-on-surface-variant">{t('kbPublishOwnerNote')}</p>

                    {error && (
                        <Alert tone="error" live="assertive">
                            <AlertDescription>{error}</AlertDescription>
                        </Alert>
                    )}
                </div>

                <DialogFooter>
                    <Button type="button" variant="outline" onClick={onCancel} disabled={busy}>
                        {t('cancel')}
                    </Button>
                    <Button type="button" onClick={onConfirm} disabled={busy}>
                        {busy && <Loader2 size={15} className="animate-spin" aria-hidden="true" />}
                        {t('kbActionPublish')}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}

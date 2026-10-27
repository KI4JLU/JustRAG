import { useState } from 'react';
import { AlertTriangle, Loader2 } from 'lucide-react';
import {
    Alert, AlertDescription, Button, Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, Input, Label,
} from '@ki4jlu/design-system';
import { useTheme } from '../../contexts/ThemeContext';

export interface KbDeleteDialogProps {
    kbName: string;
    isGlobal: boolean;
    fileCount: number;
    /** Pre-formatted size (the dashboard owns formatBytes). */
    sizeLabel: string;
    chatCount: number;
    busy: boolean;
    error: string | null;
    onCancel: () => void;
    onConfirm: () => void;
}

/**
 * Type-to-confirm delete modal for the admin KB-Übersicht.
 *
 * Deletion cascades across the main DB, the vector DB, and object storage, so
 * the operator must retype the KB name exactly — a plain confirm is too easy to
 * fire from the wrong table row. Presentational only: the parent owns the request.
 */
export function KbDeleteDialog({
    kbName, isGlobal, fileCount, sizeLabel, chatCount, busy, error, onCancel, onConfirm,
}: KbDeleteDialogProps) {
    const { t } = useTheme();
    const [typed, setTyped] = useState('');
    const armed = typed === kbName && !busy;

    return (
        <Dialog open onOpenChange={(open) => { if (!open) onCancel(); }}>
            <DialogContent closeLabel={t('close')} className="max-w-md" aria-describedby={undefined}>
                <DialogHeader className="pr-8">
                    <DialogTitle className="flex items-center gap-2">
                        <AlertTriangle size={18} aria-hidden="true" className="shrink-0 text-error" />
                        {t('kbDeleteTitle')}
                    </DialogTitle>
                </DialogHeader>

                <div className="flex flex-col gap-3">
                    <p className="m-0 font-semibold text-on-surface">{kbName}</p>
                    <p className="m-0 text-sm text-on-surface-variant">
                        {t('kbDeleteStats')
                            .replace('{files}', String(fileCount))
                            .replace('{size}', sizeLabel)
                            .replace('{chats}', String(chatCount))}
                    </p>

                    <p className="m-0 text-sm text-error">{t('kbDeleteWarning')}</p>
                    {isGlobal && (
                        <p className="m-0 text-sm text-on-surface-variant">{t('kbDeleteGlobalNote')}</p>
                    )}

                    <div className="flex flex-col gap-1.5">
                        <Label htmlFor="kb-delete-confirm">{t('kbDeleteConfirmLabel')}</Label>
                        <Input
                            id="kb-delete-confirm"
                            type="text"
                            value={typed}
                            onChange={(e) => setTyped(e.target.value)}
                            autoComplete="off"
                        />
                    </div>

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
                    <Button type="button" variant="destructive" onClick={() => { if (armed) onConfirm(); }} disabled={!armed}>
                        {busy && <Loader2 size={15} className="animate-spin" aria-hidden="true" />}
                        {t('delete')}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}

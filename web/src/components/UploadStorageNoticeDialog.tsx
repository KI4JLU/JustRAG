import { useEffect, useState } from 'react';
import {
  Button, Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@ki4jlu/design-system';
import { useAuth } from '../contexts/AuthContext';
import { useTheme } from '../contexts/ThemeContext';
import { useUploadStorageNoticeDialog } from '../hooks/useUploadStorageNotice';

/**
 * How long uploaded files are kept, asked before an upload until the user
 * accepts it once — one notice for chat attachments, one for sources, as the
 * two are kept differently. "Verstanden" lets the upload go and settles that
 * notice for good; closing it any other way (X, Escape, a click outside)
 * drops the files, and the next upload of that kind asks again.
 */
export function UploadStorageNoticeDialog() {
  const { t } = useTheme();
  const { user } = useAuth();
  const { kind, decline, accept, dropAll } = useUploadStorageNoticeDialog(user.id);
  // Logging out unmounts the shell: waiting uploads are dropped, and the
  // next login is not greeted by the notice on its own, only the next upload.
  useEffect(() => dropAll, [dropAll]);
  // The text stays while the dialog animates out.
  const [shownKind, setShownKind] = useState(kind);
  if (kind && kind !== shownKind) setShownKind(kind);

  return (
    <Dialog open={kind !== null} onOpenChange={(next) => { if (!next) decline(); }}>
      <DialogContent id="upload-storage-notice" className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t('uploadStorageNoticeTitle')}</DialogTitle>
          <DialogDescription>{t(shownKind === 'source' ? 'uploadStorageNoticeSource' : 'uploadStorageNoticeChat')}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button onClick={accept}>{t('uploadStorageNoticeAccept')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

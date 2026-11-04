import { useEffect } from 'react';
import {
  Button, Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@ki4jlu/design-system';
import { useAuth } from '../contexts/AuthContext';
import { useTheme } from '../contexts/ThemeContext';
import { useUploadStorageNotice } from '../hooks/useUploadStorageNotice';

/**
 * How long uploaded documents are kept, asked before an upload until the user
 * accepts it once. "Verstanden" lets the upload go and settles it for good;
 * closing it any other way (X, Escape, a click outside) drops the files, and
 * the next upload asks again.
 */
export function UploadStorageNoticeDialog() {
  const { t } = useTheme();
  const { user } = useAuth();
  const { open, decline, accept } = useUploadStorageNotice(user.id);
  // Logging out unmounts the shell: the waiting upload is dropped, and the
  // next login is not greeted by the notice on its own, only the next upload.
  useEffect(() => decline, [decline]);

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) decline(); }}>
      <DialogContent id="upload-storage-notice" className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t('uploadStorageNoticeTitle')}</DialogTitle>
          <DialogDescription>{t('uploadStorageNotice')}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button onClick={accept}>{t('uploadStorageNoticeAccept')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

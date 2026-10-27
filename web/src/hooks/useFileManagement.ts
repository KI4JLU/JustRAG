import { useState, useRef, useCallback, useMemo, useEffect } from 'react';
import axios from 'axios';
import type { KnowledgeBase, FileEntry } from '../types';
import { API_BASE_URL } from '../api';
import { MAX_FILES_PER_KB, MAX_FILES_PER_GLOBAL_KB } from '../constants';
import { useModalContext } from '../contexts/ModalContext';
import { useTheme } from '../contexts/ThemeContext';
import { useToast } from '../contexts/ToastContext';
import { isForbidden } from '../utils/apiError';
import { uploadFailureMessage, userErrorMessage } from '../utils/userErrors';
import { markdownSourceTitle } from '../utils/textSourceTitle';
import { unlistableKbId } from '../utils/kbAccess';

interface UseFileManagementParams {
  currentKb: KnowledgeBase | null;
}

/** A file whose upload is still running: listed from the drop on, until its
 *  POST returns and the server's row takes its place. */
export interface PendingUpload {
  id: string;
  kbId: string;
  name: string;
  type: string;
  origin: 'upload';
}

export function useFileManagement({ currentKb }: UseFileManagementParams) {
  const { t, language } = useTheme();
  const { showConfirm } = useModalContext();
  const toast = useToast();
  const [files, setFiles] = useState<FileEntry[]>([]);
  // The KB whose file list `files` holds — until it matches the open KB, the
  // list is unknown, not empty (callers must not show the "no sources" state).
  const [filesKbId, setFilesKbId] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [showUploadModal, setShowUploadModal] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [textSourceTitle, setTextSourceTitle] = useState('');
  const [textSourceContent, setTextSourceContent] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [pendingUploads, setPendingUploads] = useState<PendingUpload[]>([]);
  const uploadSeq = useRef(0);
  // Bumped whenever a row is added locally: a list request started before
  // that would drop the row again, so its response is discarded.
  const listEpoch = useRef(0);
  // The open KB: a list or upload response for another KB is dropped.
  const openKbId = useRef(currentKb?.id);
  useEffect(() => { openKbId.current = currentKb?.id; }, [currentKb?.id]);
  // The KB whose list `files` holds (filesKbId, readable from callbacks).
  const listKbId = useRef<string | null>(null);
  // Files deleted here: an upload response arriving later must not bring one back.
  const deletedIds = useRef(new Set<string>());

  const hasFiles = useMemo(() => files.some(f => f.status === 'completed'), [files]);
  const filesLoaded = !!currentKb && filesKbId === currentKb.id;
  const selectedFileCount = useMemo(() => files.filter(f => f.selected !== false).length, [files]);

  // No seeSources on the open KB: its file list is never requested.
  const unlistable = unlistableKbId(currentKb);
  const fetchFiles = useCallback(async (kbId: string, signal?: AbortSignal) => {
    if (kbId === unlistable) {
      // Known-empty rather than unknown, and not the previous KB's list.
      setFiles([]);
      setFilesKbId(kbId);
      listKbId.current = kbId;
      return;
    }
    const epoch = listEpoch.current;
    try {
      // Request a high limit — the chat UI needs the full file list to show
      // accurate counts and let users select files. The backend defaults to
      // limit=50 which truncates KBs with large Confluence imports.
      const res = await axios.get(`${API_BASE_URL}/api/kb/${kbId}/files?limit=10000`, { signal });
      if (epoch !== listEpoch.current || kbId !== openKbId.current) return;
      const filesWithSelection = res.data.map((file: FileEntry) => ({
        ...file,
        selected: file.selected !== undefined ? file.selected : true
      }));
      setFiles(filesWithSelection);
      setFilesKbId(kbId);
      listKbId.current = kbId;
    } catch (err: unknown) {
      if (axios.isCancel(err) || kbId !== openKbId.current) return;
      // A failed refresh keeps this KB's list; another KB's list goes.
      const otherKbList = listKbId.current !== kbId;
      setFilesKbId(kbId);
      listKbId.current = kbId;
      // No seeSources on this KB: no list, and nothing to report. Clearing
      // also drops the previous KB's list.
      if (isForbidden(err)) {
        setFiles([]);
        return;
      }
      if (otherKbList) setFiles([]);
      console.error('Failed to fetch files:', err);
      toast.error(t('filesFetchError'));
    }
  }, [t, toast, unlistable]);

  // Polling for processing files
  const hasProcessingFiles = files.some(
    f => f.status === 'processing' || f.status === 'pending' || f.currentStage != null,
  );
  const currentKbId = currentKb?.id;
  useEffect(() => {
    if (hasProcessingFiles && currentKbId) {
      const interval = setInterval(() => {
        fetchFiles(currentKbId);
      }, 2000);
      return () => clearInterval(interval);
    }
  }, [hasProcessingFiles, currentKbId, fetchFiles]);

  const uploadFilesBatch = useCallback(async (filesToUpload: File[]) => {
    if (!currentKb || filesToUpload.length === 0) return;

    const kbId = currentKb.id;
    const fileLimit = currentKb.isGlobal ? MAX_FILES_PER_GLOBAL_KB : MAX_FILES_PER_KB;
    const inFlight = pendingUploads.filter(u => u.kbId === kbId).length;
    const remaining = Math.max(0, fileLimit - files.length - inFlight);
    const eligible = filesToUpload.slice(0, remaining);

    if (eligible.length < filesToUpload.length) {
      toast.warning(`${t('fileLimitReached')} (${fileLimit})`);
    }
    if (eligible.length === 0) return;

    // Every file is listed right away; on a slow uplink the uploads alone
    // can take tens of seconds.
    const batch = eligible.map(file => ({
      file,
      row: { id: `upload-${++uploadSeq.current}`, kbId, name: file.name, type: file.type, origin: 'upload' as const },
    }));
    setPendingUploads(prev => [...batch.map(b => b.row), ...prev]);

    setUploading(true);
    try {
      const UPLOAD_CONCURRENCY = 3;
      let nextIndex = 0;
      const failures: { name: string; err: unknown }[] = [];
      const worker = async () => {
        while (nextIndex < batch.length) {
          const { file, row } = batch[nextIndex++];
          const formData = new FormData();
          formData.append('file', file);
          try {
            const res = await axios.post<FileEntry>(`${API_BASE_URL}/api/kb/${kbId}/files`, formData);
            const created = res.data;
            if (openKbId.current === kbId && listKbId.current === kbId && !deletedIds.current.has(created.id)) {
              listEpoch.current++;
              // Newest first, as the list endpoint orders them.
              setFiles(prev => prev.some(f => f.id === created.id) ? prev : [{ ...created, selected: true }, ...prev]);
            }
          } catch (err: unknown) {
            console.error('Upload failed:', err);
            failures.push({ name: file.name, err });
          } finally {
            setPendingUploads(prev => prev.filter(u => u.id !== row.id));
          }
        }
      };
      const workerCount = Math.min(UPLOAD_CONCURRENCY, batch.length);
      await Promise.all(Array.from({ length: workerCount }, worker));
      if (failures.length > 0) {
        toast.error(uploadFailureMessage(failures, t, language));
      }
      if (openKbId.current === kbId) await fetchFiles(kbId);
    } finally {
      setUploading(false);
    }
  }, [currentKb, files.length, pendingUploads, fetchFiles, t, language, toast]);

  const uploads = useMemo(
    () => pendingUploads.filter(u => u.kbId === currentKb?.id),
    [pendingUploads, currentKb?.id],
  );

  const handleFileUpload = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFiles = Array.from(e.target.files || []);
    if (selectedFiles.length === 0 || !currentKb) return;
    setShowUploadModal(false);
    await uploadFilesBatch(selectedFiles);
    if (fileInputRef.current) fileInputRef.current.value = '';
  }, [currentKb, uploadFilesBatch]);

  // Deletes without asking: the caller has confirmed (one file, or a batch
  // from the sources selection mode under one dialog). Optimistic; a file
  // whose DELETE fails comes back in its old place.
  const deleteFiles = useCallback(async (fileIds: string[]) => {
    if (fileIds.length === 0) return;
    const ids = new Set(fileIds);
    fileIds.forEach(id => deletedIds.current.add(id));
    let snapshot: FileEntry[] = [];
    setFiles(prev => { snapshot = prev; return prev.filter(f => !ids.has(f.id)); });
    const results = await Promise.allSettled(fileIds.map(id => axios.delete(`${API_BASE_URL}/api/files/${id}`)));
    const failed = new Set(fileIds.filter((_, i) => results[i].status === 'rejected'));
    failed.forEach(id => deletedIds.current.delete(id));
    if (failed.size === 0) return;
    // Snapshot order for what was there before, then anything that arrived
    // meanwhile (a poll, an upload).
    setFiles(prev => {
      const current = new Map(prev.map(f => [f.id, f]));
      const before = new Set(snapshot.map(f => f.id));
      return [
        ...snapshot.filter(f => current.has(f.id) || failed.has(f.id)).map(f => current.get(f.id) ?? f),
        ...prev.filter(f => !before.has(f.id)),
      ];
    });
    toast.error(t('deleteFileError'));
  }, [t, toast]);

  const handleDeleteFile = useCallback(async (fileId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!await showConfirm(t('confirmDeleteFile'))) return;
    await deleteFiles([fileId]);
  }, [deleteFiles, showConfirm, t]);

  const retryFile = useCallback(async (fileId: string) => {
    try {
      await axios.post(`${API_BASE_URL}/api/files/${fileId}/retry`);
      // Flip to pending locally — this re-arms the 2s polling effect above.
      setFiles(prev => prev.map(f =>
        f.id === fileId
          ? { ...f, status: 'pending' as const, progress: 0, errorStage: undefined, errorMessage: undefined }
          : f
      ));
    } catch (err: unknown) {
      console.error('Retry failed:', err);
      toast.error(userErrorMessage(err, t, { fallbackKey: 'retryRequestFailed' }));
    }
  }, [t, toast]);

  const retryAllFailed = useCallback(async () => {
    if (!currentKb) return;
    try {
      await axios.post(`${API_BASE_URL}/api/kb/${currentKb.id}/files/retry-failed`);
      await fetchFiles(currentKb.id);
    } catch (err: unknown) {
      console.error('Retry all failed:', err);
      toast.error(userErrorMessage(err, t, { fallbackKey: 'retryAllRequestFailed' }));
    }
  }, [currentKb, fetchFiles, t, toast]);

  const handleToggleFileSelection = useCallback((fileId: string, e: React.SyntheticEvent) => {
    e.stopPropagation();
    setFiles(prev => prev.map(f =>
      f.id === fileId ? { ...f, selected: !f.selected } : f
    ));
  }, []);

  const handleToggleFilesSelection = useCallback((fileIds: string[], selected: boolean) => {
    setFiles(prev => prev.map(f =>
      fileIds.includes(f.id) ? { ...f, selected } : f
    ));
  }, []);

  const handleDownloadFile = useCallback(async (fileId: string) => {
    try {
      const res = await axios.get(`${API_BASE_URL}/api/files/${fileId}/download`, {
        responseType: 'blob'
      });
      const url = window.URL.createObjectURL(new Blob([res.data]));
      const link = document.createElement('a');
      link.href = url;

      const contentDisposition = res.headers['content-disposition'];
      let fileName = files.find(f => f.id === fileId)?.name || 'download';
      if (contentDisposition) {
        const match = contentDisposition.match(/filename="(.+)"/);
        if (match && match[1]) fileName = match[1];
      }

      link.setAttribute('download', fileName);
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
    } catch (err: unknown) {
      console.error('Failed to download file:', err);
      toast.error(t('downloadFileError'));
    }
  }, [files, t, toast]);

  const openUploadModal = useCallback(() => {
    setTextSourceTitle('');
    setTextSourceContent('');
    setShowUploadModal(true);
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  }, []);

  const handleDragEnter = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  }, []);

  const handleDrop = useCallback(async (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);

    const droppedFiles = Array.from(e.dataTransfer.files);
    if (droppedFiles.length === 0 || !currentKb) return;
    setShowUploadModal(false);
    await uploadFilesBatch(droppedFiles);
  }, [currentKb, uploadFilesBatch]);

  // Files dropped on a dropzone that is not a React drag target of this hook
  // (the sources panel's DS FileDropzone).
  const uploadFiles = useCallback(async (dropped: File[]) => {
    if (dropped.length === 0 || !currentKb) return;
    setShowUploadModal(false);
    await uploadFilesBatch(dropped);
  }, [currentKb, uploadFilesBatch]);

  const handleTextSourceAdd = useCallback(async () => {
    if (!currentKb || !textSourceContent.trim()) return;

    setUploading(true);
    setShowUploadModal(false);

    try {
      await axios.post(`${API_BASE_URL}/api/kb/${currentKb.id}/text`, {
        // `.md` suffix: marks the source as markdown for the preview.
        title: markdownSourceTitle(textSourceTitle),
        content: textSourceContent
      });
      await fetchFiles(currentKb.id);
      setTextSourceTitle('');
      setTextSourceContent('');
    } catch (err: unknown) {
      console.error('Text source add failed:', err);
      toast.error(userErrorMessage(err, t, { fallbackKey: 'addTextFailed' }));
    } finally {
      setUploading(false);
    }
  }, [currentKb, textSourceTitle, textSourceContent, fetchFiles, t, toast]);

  return useMemo(() => ({
    files, uploads, uploading, hasFiles, filesLoaded, selectedFileCount, fileInputRef,
    fetchFiles, uploadFiles, handleFileUpload, deleteFiles, handleDeleteFile, handleToggleFileSelection, handleToggleFilesSelection,
    handleDownloadFile, openUploadModal, retryFile, retryAllFailed,
    showUploadModal, setShowUploadModal,
    isDragging, textSourceTitle, setTextSourceTitle,
    textSourceContent, setTextSourceContent,
    handleDragOver, handleDragEnter, handleDragLeave, handleDrop, handleTextSourceAdd,
  }), [
    files, uploads, uploading, hasFiles, filesLoaded, selectedFileCount,
    showUploadModal, isDragging, textSourceTitle, textSourceContent,
    fetchFiles, uploadFiles, handleFileUpload, deleteFiles, handleDeleteFile, handleToggleFileSelection, handleToggleFilesSelection,
    handleDownloadFile, openUploadModal, retryFile, retryAllFailed,
    handleDragOver, handleDragEnter, handleDragLeave, handleDrop, handleTextSourceAdd
  ]);
}

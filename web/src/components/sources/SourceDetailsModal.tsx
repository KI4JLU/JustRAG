import React from 'react';
import { Trash2 } from 'lucide-react';
import { Button, Dialog, DialogContent, DialogHeader, DialogTitle } from '@ki4jlu/design-system';
import type { FileEntry, SyncSchedule } from '../../types';
import { SOURCE_TYPE_CHIP, sourceDetailsTitle, type SourceDetailsTarget } from './sourceDetails';
import { useTheme } from '../../contexts/ThemeContext';
import { IngestStageIndicator } from '../sidebar/IngestStageIndicator';
import './SourceDetailsModal.css';

interface SourceDetailsModalProps {
    target: SourceDetailsTarget;
    /** The source's own files (its entries); omitted, no entry list. */
    files?: FileEntry[];
    /** Absent for a caller without capabilities.manageSources: no delete button. */
    onDeleteFile?: (fileId: string, e: React.MouseEvent) => void;
    onClose: () => void;
}

/**
 * Everything about a synced source (RSS feed, Confluence space, git
 * repository) that the source list no longer shows: its state, what it
 * holds, how and when it syncs, its error — and, where the files can be
 * attributed, its entries. The list row is the type chip and the title alone.
 */
export const SourceDetailsModal: React.FC<SourceDetailsModalProps> = ({ target, files, onDeleteFile, onClose }) => {
    const { t } = useTheme();
    const s = target.source;
    const date = (iso: string | null) => (iso ? new Date(iso).toLocaleString() : '–');
    const scheduleLabel: Record<SyncSchedule, string> = {
        manual: t('syncScheduleManual'),
        daily: t('syncScheduleDaily'),
        weekly: t('syncScheduleWeekly'),
    };
    const statusLabel = s.status === 'active' ? t('active')
        : s.status === 'paused' ? t('paused')
        : s.status === 'syncing' ? t('syncing')
        : t('feedError');

    const rows: [string, React.ReactNode][] = [
        [t('sourceStatus'), statusLabel],
    ];
    if (target.kind === 'rss') {
        rows.push([t('items'), target.source.itemCount]);
        rows.push([t('lastPolled'), date(target.source.lastPolledAt)]);
    } else if (target.kind === 'confluence') {
        rows.push([t('pages'), target.source.pageCount]);
        rows.push([t('lastSynced'), date(target.source.lastSyncedAt)]);
    } else {
        rows.push([t('gitFiles'), target.source.fileCount]);
        rows.push([t('lastSynced'), date(target.source.lastSyncedAt)]);
    }
    rows.push([t('syncScheduleLabel'), scheduleLabel[s.syncSchedule]]);
    if (s.syncSchedule !== 'manual' && s.nextSyncAt) rows.push([t('nextSync'), date(s.nextSyncAt)]);
    if ((target.kind === 'confluence' || target.kind === 'git') && target.source.status === 'syncing' && target.source.syncTotal > 0) {
        rows.push([t('syncing'), `${target.source.syncProgress}/${target.source.syncTotal} ${t('filesProcessed')}`]);
    }

    return (
        <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
            <DialogContent className="source-details" closeLabel={t('close')} aria-describedby={undefined}>
                <DialogHeader>
                    <DialogTitle className="source-details__title">
                        <span className="source-details__chip" aria-hidden="true">{SOURCE_TYPE_CHIP[target.kind]}</span>
                        <span className="source-details__name">{sourceDetailsTitle(target)}</span>
                    </DialogTitle>
                </DialogHeader>
                <dl className="source-details__facts">
                    {rows.map(([label, value]) => (
                        <div key={label} className="source-details__fact">
                            <dt>{label}</dt>
                            <dd>{value}</dd>
                        </div>
                    ))}
                </dl>
                {s.status === 'error' && s.errorMessage && (
                    <p className="source-details__error">{s.errorMessage}</p>
                )}
                {files && (
                    <ul className="source-details__list">
                        {files.length === 0 && (
                            <li className="source-details__empty">{t('rssNoEntries')}</li>
                        )}
                        {files.map(file => (
                            <li key={file.id} className="source-details__item">
                                <div className="source-details__item-main">
                                    <span className="source-details__item-name">{file.name}</span>
                                    <div className="source-details__item-meta">
                                        <span style={{ color: file.status === 'error' ? 'var(--color-error)' : undefined }}>
                                            {file.status}
                                        </span>
                                        <span>{new Date(file.createdAt).toLocaleDateString()}</span>
                                    </div>
                                    {file.currentStage && (
                                        <IngestStageIndicator
                                            stage={file.currentStage}
                                            index={file.stageIndex}
                                            total={file.stageTotal}
                                            fileName={file.name}
                                        />
                                    )}
                                </div>
                                {onDeleteFile && (
                                    <Button
                                        variant="ghost"
                                        size="icon"
                                        className="text-on-surface-variant hover:text-error"
                                        onClick={(e) => onDeleteFile(file.id, e)}
                                        title={t('delete')}
                                        aria-label={`${t('delete')} ${file.name}`}
                                    >
                                        <Trash2 size={16} aria-hidden="true" />
                                    </Button>
                                )}
                            </li>
                        ))}
                    </ul>
                )}
            </DialogContent>
        </Dialog>
    );
};

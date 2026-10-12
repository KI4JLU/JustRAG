import React, { memo } from 'react';
import { Upload } from 'lucide-react';
import { useTheme } from '../../contexts/ThemeContext';
import { SourceModal } from './SourceModal';

interface FileUploadModalProps {
    show: boolean;
    onClose: () => void;
    fileInputRef: React.RefObject<HTMLInputElement | null>;
    onDragOver: (e: React.DragEvent) => void;
    onDragEnter: (e: React.DragEvent) => void;
    onDragLeave: (e: React.DragEvent) => void;
    onDrop: (e: React.DragEvent) => void;
    isDragging: boolean;
}

const FileUploadModalComp: React.FC<FileUploadModalProps> = ({
    show, onClose, fileInputRef,
    onDragOver, onDragEnter, onDragLeave, onDrop, isDragging,
}) => {
    const { t } = useTheme();
    return (
        <SourceModal title={t('uploadFile')} show={show} onClose={onClose}>
            <button
                className={`dropzone ${isDragging ? 'dragging' : ''}`}
                onDragOver={onDragOver}
                onDragEnter={onDragEnter}
                onDragLeave={onDragLeave}
                onDrop={onDrop}
                onClick={() => fileInputRef.current?.click()}
                style={{ background: 'none', width: '100%', font: 'inherit' }}
            >
                <Upload className="dropzone-icon" size={48} aria-hidden="true" />
                <div className="dropzone-text">{t('dropFilesHere')}</div>
                <div className="dropzone-subtext">{t('orClickToUpload')}</div>
            </button>
        </SourceModal>
    );
};

export const FileUploadModal = memo(FileUploadModalComp);

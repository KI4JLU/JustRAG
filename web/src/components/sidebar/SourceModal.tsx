import React, { memo } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@ki4jlu/design-system';
import { useTheme } from '../../contexts/ThemeContext';
import './SourceModal.css';

interface SourceModalProps {
    title: string;
    show: boolean;
    onClose: () => void;
    children: React.ReactNode;
    className?: string;
}

/**
 * The frame of every "add a source" dialog (Crawl, RSS, upload, web search,
 * git, Confluence): the DS `Dialog` — its padding, radius, title line and
 * close button — with the form as the body. It used to be a hand-built
 * `.modal-content` box whose own 2rem padding wrapped a header and a body
 * that were padded again, so every source dialog had a double inset.
 */
const SourceModalComp: React.FC<SourceModalProps> = ({ title, show, onClose, children, className }) => {
    const { t } = useTheme();
    return (
        <Dialog open={show} onOpenChange={(open) => { if (!open) onClose(); }}>
            <DialogContent
                className={`source-modal${className ? ` ${className}` : ''}`}
                closeLabel={t('close')}
                aria-describedby={undefined}
            >
                <DialogHeader>
                    <DialogTitle>{title}</DialogTitle>
                </DialogHeader>
                <div className="source-modal__body">
                    {children}
                </div>
            </DialogContent>
        </Dialog>
    );
};

export const SourceModal = memo(SourceModalComp);

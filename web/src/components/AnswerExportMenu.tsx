// web/src/components/AnswerExportMenu.tsx
import { useEffect, useState, useRef } from 'react';
import { Download } from 'lucide-react';
import { MenuItem, MessageAction } from '@ki4jlu/design-system';
import type { Message } from '../types';
import { HAPTIC_PATTERNS, triggerHaptic } from '../utils/haptics';
import { useMessageExport } from '../hooks/useMessageActions';
import { AnchoredPopover } from './AnchoredPopover';

interface AnswerExportMenuProps {
  message: Message;
  kbId?: string;
  questionText?: string;
  contentRef: React.RefObject<HTMLDivElement | null>;
  onOpenChange?: (open: boolean) => void;
  t: (key: string) => string;
}

export function AnswerExportMenu({ message, kbId, questionText, contentRef, onOpenChange, t }: AnswerExportMenuProps) {
  const [open, setOpen] = useState(false);
  const exporter = useMessageExport(message, kbId, questionText, contentRef);
  const triggerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => { onOpenChange?.(open); }, [open, onOpenChange]);

  // Focus goes back to the trigger: the menu items are about to unmount.
  const close = () => {
    triggerRef.current?.focus();
    setOpen(false);
  };

  return (
    <>
      <MessageAction
        ref={triggerRef}
        tooltip={t('exportAnswer')}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => { triggerHaptic(HAPTIC_PATTERNS.action); setOpen((o) => !o); }}
      >
        <Download className="size-4" aria-hidden="true" />
      </MessageAction>
      <AnchoredPopover
        open={open}
        triggerRef={triggerRef}
        onClose={close}
        align="start"
        width={180}
        role="menu"
        ariaLabel={t('exportAnswer')}
      >
        <div className="flex flex-col p-1">
          <MenuItem type="button" role="menuitem" onClick={() => { close(); void exporter.copy(); }}>{t('copyWithCitations')}</MenuItem>
          <MenuItem type="button" role="menuitem" onClick={() => { close(); void exporter.markdown(); }}>{t('exportMarkdown')}</MenuItem>
          {exporter.docx && (
            <MenuItem type="button" role="menuitem" onClick={() => { close(); void exporter.docx?.(); }}>{t('exportDocx')}</MenuItem>
          )}
          <MenuItem type="button" role="menuitem" onClick={() => { close(); void exporter.pdf(); }}>{t('exportPdf')}</MenuItem>
        </div>
      </AnchoredPopover>
    </>
  );
}

import { useEffect, useRef, useState } from 'react';
import { Copy } from 'lucide-react';
import { Button, Tooltip, TooltipContent, TooltipTrigger } from '@ki4jlu/design-system';
import { useTheme } from '../../contexts/ThemeContext';
import { useToast } from '../../contexts/ToastContext';
import { copyToClipboard } from '../../utils/clipboard';

/** How long "Kopiert!" stays after copying. */
const COPIED_MS = 1500;

interface CopyButtonProps {
  /**
   * The text to copy. Without it (or with an empty one) the button is disabled, unless
   * `whenEmpty` says otherwise.
   */
  text: string | undefined;
  /**
   * Without a text: `disable` turns the button off, `confirm` keeps it usable — it only says
   * "Kopiert!" and leaves the clipboard as it is (the translator's boards).
   */
  whenEmpty?: 'disable' | 'confirm';
  /** Accessible name; "Kopieren" by default. */
  label?: string;
  className?: string;
}

/**
 * Copies a text to the clipboard. Its tooltip says "Kopieren" and, for a moment after a copy,
 * "Kopiert!", which screenreaders hear too.
 */
export function CopyButton({ text, label, whenEmpty = 'disable', className }: CopyButtonProps) {
  const { t } = useTheme();
  const toast = useToast();
  const [copied, setCopied] = useState(false);
  const [hovered, setHovered] = useState(false);
  const timers = useRef(new Set<ReturnType<typeof setTimeout>>());
  useEffect(() => {
    const pending = timers.current;
    return () => {
      for (const timer of pending) clearTimeout(timer);
    };
  }, []);
  const name = label ?? t('translatorCopy');
  const empty = !text;

  // Every copy hides "Kopiert!" on its own timer, none is restarted: a second copy does not keep
  // it longer than the first one's time.
  const confirm = (): void => {
    setCopied(true);
    const timer = setTimeout(() => {
      timers.current.delete(timer);
      setCopied(false);
    }, COPIED_MS);
    timers.current.add(timer);
  };

  const copy = async (): Promise<void> => {
    if (empty) {
      if (whenEmpty === 'confirm') confirm();
      return;
    }
    if (await copyToClipboard(text)) confirm();
    else toast.error(t('clipboardCopyFailed'));
  };

  return (
    <>
      <Tooltip open={copied || hovered} onOpenChange={setHovered}>
        <TooltipTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            disabled={empty && whenEmpty === 'disable'}
            aria-label={name}
            onClick={() => void copy()}
            className={className}
          >
            <Copy aria-hidden="true" className="size-4" />
          </Button>
        </TooltipTrigger>
        <TooltipContent>{copied ? t('translatorCopied') : name}</TooltipContent>
      </Tooltip>
      <span aria-live="polite" className="sr-only">
        {copied ? t('translatorCopied') : ''}
      </span>
    </>
  );
}

/** An icon button with its name as a tooltip, as the translator shows them. */
export function IconAction({
  label,
  onClick,
  disabled,
  expanded,
  controls,
  children,
  className,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  /** For a button that opens and closes a region: whether it is open, and the region's id. */
  expanded?: boolean;
  controls?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label={label}
          aria-expanded={expanded}
          aria-controls={controls}
          disabled={disabled}
          onClick={onClick}
          className={className}
        >
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

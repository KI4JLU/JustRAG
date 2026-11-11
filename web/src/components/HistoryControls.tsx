import { Button } from '@ki4jlu/design-system';
import { useCanGoBack, useRouter } from '@tanstack/react-router';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useTheme } from '../contexts/ThemeContext';
import { useCanGoForward } from '../hooks/useCanGoForward';

/**
 * History back and forward for the desktop app's title bar. The design system
 * renders `titlebarControls` only in a window with a hidden title bar; in a
 * browser, which has these buttons itself, nothing shows.
 *
 * Each is disabled while there is nowhere to go in its direction.
 */
export function HistoryControls() {
  const { t } = useTheme();
  const router = useRouter();
  const canGoBack = useCanGoBack();
  const canGoForward = useCanGoForward();
  return (
    <>
      <Button
        variant="ghost"
        size="icon"
        aria-label={t('historyBack')}
        disabled={!canGoBack}
        onClick={() => router.history.back()}
      >
        <ChevronLeft size={20} aria-hidden="true" />
      </Button>
      <Button
        variant="ghost"
        size="icon"
        aria-label={t('historyForward')}
        disabled={!canGoForward}
        onClick={() => router.history.forward()}
      >
        <ChevronRight size={20} aria-hidden="true" />
      </Button>
    </>
  );
}

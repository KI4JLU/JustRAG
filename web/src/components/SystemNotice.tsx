import { useEffect, useRef, type ReactNode } from 'react';
import { Alert, AlertAction, AlertDescription, AlertTitle, Button } from '@ki4jlu/design-system';
import { useTheme } from '../contexts/ThemeContext';
import { isExternalNoticeHref, systemNoticePlacement, type SystemNotice } from '../utils/systemNotice';

interface SystemNoticeAlertProps {
  notice: SystemNotice;
  /** Given, the alert has a close button. */
  onDismiss?: () => void;
  /**
   * Overrides the announcement. The admin preview passes `off`: it changes on
   * every keystroke and must not be read out each time.
   */
  live?: 'off' | 'polite' | 'assertive';
}

/**
 * The notice as the shell shows it, and also the admin panel's live preview,
 * so the two cannot drift. Placed by severity (`systemNoticePlacement`): an
 * outage (`error`) is the solid full-width banner above the app
 * (`Alert layout="banner"`), everything else the small pill floating over the
 * main area (`layout="pill"`). „**Titel** · Text Link" on one line. Plain
 * text with its line breaks, never HTML: the message is typed by an admin (or
 * set through the API) and shown to every user.
 *
 * Announced like a system state: `role="alert"` only for an outage,
 * `role="status"` for everything else.
 */
export function SystemNoticeAlert({ notice, onDismiss, live }: SystemNoticeAlertProps) {
  const { t } = useTheme();
  const external = notice.link ? isExternalNoticeHref(notice.link.href) : false;
  return (
    <Alert
      tone={notice.tone}
      layout={systemNoticePlacement(notice.tone)}
      live={live ?? (notice.tone === 'error' ? 'assertive' : 'polite')}
      onDismiss={onDismiss}
      dismissLabel={t('systemNoticeDismiss')}
    >
      {notice.title && <AlertTitle>{notice.title}</AlertTitle>}
      <AlertDescription className="whitespace-pre-line">{notice.text}</AlertDescription>
      {notice.link && (
        <AlertAction>
          <Button variant="link" size="sm" className="h-auto p-0 font-semibold text-current underline" asChild>
            <a
              href={notice.link.href}
              {...(external ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
            >
              {notice.link.label || t('systemNoticeLinkDefault')}
            </a>
          </Button>
        </AlertAction>
      )}
    </Alert>
  );
}

/** CSS variable carrying the banner's height, for overlays anchored under the chrome (Toast.css). */
const SYSTEM_NOTICE_HEIGHT_VAR = '--system-notice-height';

/**
 * Publishes the banner's rendered height on <html>, so the toasts — fixed
 * under the chrome bar — move down with the bar when the banner pushes it.
 * Removed again when the banner goes. No ResizeObserver (jsdom), no variable:
 * the toasts keep their old offset.
 */
export function NoticeHeight({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    const root = document.documentElement;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => root.style.setProperty(SYSTEM_NOTICE_HEIGHT_VAR, `${el.offsetHeight}px`));
    observer.observe(el);
    return () => {
      observer.disconnect();
      root.style.removeProperty(SYSTEM_NOTICE_HEIGHT_VAR);
    };
  }, []);
  return <div ref={ref}>{children}</div>;
}

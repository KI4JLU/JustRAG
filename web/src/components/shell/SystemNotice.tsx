import { Alert, AlertAction, AlertDescription, AlertTitle, Button } from '@ki4jlu/design-system';
import { useTheme } from '../../contexts/ThemeContext';
import { isExternalNoticeHref, type SystemNotice, type SystemNoticePlacement } from '../../utils/systemNotice';

interface SystemNoticeAlertProps {
  notice: SystemNotice;
  /** Given, the alert has a close button. */
  onDismiss?: () => void;
  /**
   * Overrides the announcement. The admin preview passes `off`: it changes on
   * every keystroke and must not be read out each time.
   */
  live?: 'off' | 'polite' | 'assertive';
  /** When this browser first showed the notice; at the end of the title row. */
  time?: Date;
}

/** The design system's Alert layout for each placement. */
const LAYOUT: Record<SystemNoticePlacement, 'banner' | 'pill' | 'toast'> = {
  banner: 'banner',
  inline: 'pill',
  toast: 'toast',
};

/**
 * The notice as the shell shows it, and also the admin panel's live preview,
 * so the two cannot drift. Shaped by its placement: the solid full-width
 * banner above the app (`Alert layout="banner"`), the small pill floating at
 * the top of the main area (`layout="pill"`), or the card top right in the
 * toast pile (`layout="toast"`). Plain text with its line breaks, never HTML: the
 * message is typed by an admin (or set through the API) and shown to every
 * user.
 *
 * Announced like a system state, whatever its placement: `role="alert"` only
 * for an outage, `role="status"` for everything else.
 */
export function SystemNoticeAlert({ notice, onDismiss, live, time }: SystemNoticeAlertProps) {
  const { t } = useTheme();
  const external = notice.link ? isExternalNoticeHref(notice.link.href) : false;
  return (
    <Alert
      tone={notice.tone}
      layout={LAYOUT[notice.placement]}
      live={live ?? (notice.tone === 'error' ? 'assertive' : 'polite')}
      onDismiss={onDismiss}
      dismissLabel={t('systemNoticeDismiss')}
    >
      {notice.title && <AlertTitle time={time}>{notice.title}</AlertTitle>}
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

/**
 * The card for a newer build that is waiting (contexts/AppUpdateContext.tsx),
 * for the shell's top corner. It has no close button: it stays until the
 * user switches. It does not block
 * the app either — switching reloads the page, and when that happens is the
 * user's call, as a reload loses an unsent message and a running answer.
 */
export function AppUpdateAlert({ onApply, time }: { onApply: () => void; time?: Date }) {
  const { t } = useTheme();
  return (
    <Alert tone="info" layout="toast" live="polite">
      <AlertTitle time={time}>{t('appUpdateTitle')}</AlertTitle>
      <AlertDescription>{t('appUpdateText')}</AlertDescription>
      <AlertAction>
        <Button variant="outline" size="sm" onClick={onApply}>
          {t('appUpdateReload')}
        </Button>
      </AlertAction>
    </Alert>
  );
}

import { Toaster } from '@ki4jlu/design-system';
import { useTheme } from '../../contexts/ThemeContext';

/**
 * The app's one `Toaster` (the design system's Sonner): toasts pile up top
 * right under the shell's bar, newest in front, and open into a list on
 * hover; above every dialog. The shell's corner message (a waiting update, a
 * system notice as a toast) is a toast in the same pile that does not time
 * out. Raise toasts through useToast (contexts/ToastContext.tsx).
 */
export function ToastStack() {
  const { t } = useTheme();
  return (
    <Toaster
      containerAriaLabel={t('toastRegionLabel')}
      toastOptions={{ closeButtonAriaLabel: t('close') }}
    />
  );
}

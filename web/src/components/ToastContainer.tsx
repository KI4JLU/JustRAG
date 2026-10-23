import { useEffect, useRef } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Alert, AlertDescription } from '@ki4jlu/design-system';
import { useToastContext, type Toast } from '../contexts/ToastContext';
import { useTheme } from '../contexts/ThemeContext';
import { useReducedMotion, getMotionProps } from '../hooks/useReducedMotion';
import './Toast.css';

function ToastItem({ toast, onDismiss }: { toast: Toast; onDismiss: () => void }) {
  const reducedMotion = useReducedMotion();
  const { t } = useTheme();
  const timerRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => {
    timerRef.current = setTimeout(onDismiss, toast.duration);
    return () => clearTimeout(timerRef.current);
  }, [toast.duration, onDismiss]);

  return (
    <motion.div
      layout
      {...getMotionProps(reducedMotion)}
      initial={{ opacity: 0, x: 80 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: 80 }}
      transition={{ type: 'spring', stiffness: 500, damping: 30 }}
      className="toast"
    >
      {/* Same box as every inline message (DS Alert), lifted with the
       * overlay shadow because it floats over the page. */}
      <Alert
        tone={toast.type}
        live="polite"
        onDismiss={onDismiss}
        dismissLabel={t('close')}
        className="shadow-overlay"
      >
        <AlertDescription>{toast.message}</AlertDescription>
      </Alert>
    </motion.div>
  );
}

export function ToastContainer() {
  const { toasts, removeToast } = useToastContext();

  return (
    <div className="toast-container" aria-label="Notifications">
      <AnimatePresence mode="popLayout">
        {toasts.map(t => (
          <ToastItem key={t.id} toast={t} onDismiss={() => removeToast(t.id)} />
        ))}
      </AnimatePresence>
    </div>
  );
}

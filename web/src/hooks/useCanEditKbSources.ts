import { useAuth } from '../contexts/AuthContext';
import { useKbCore } from '../contexts/KbCoreContext';
import { canEditKbSources } from '../utils/kbAccess';

/**
 * Whether the current user may edit the sources of the open KB (add, delete,
 * retry, sync, pause, reschedule). The sidebar's source controls read this one
 * hook, so the panel, its header row and the collapsed rail cannot disagree.
 */
export function useCanEditKbSources(): boolean {
    const { user } = useAuth();
    const { currentKb } = useKbCore();
    return canEditKbSources(currentKb, user?.role, user?.id);
}

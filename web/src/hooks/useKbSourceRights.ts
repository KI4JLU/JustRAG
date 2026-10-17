import { useAuth } from '../contexts/AuthContext';
import { useKbCore } from '../contexts/KbCoreContext';
import type { KbCapabilities } from '../types';
import { kbSourceRights } from '../utils/kbAccess';

/**
 * What the current user may do with the open KB's sources (see
 * kbSourceRights). Every source control — the workspace's sources column, its
 * rail, the chat answers' citations and previews, the topic search — reads
 * this one hook, so no two of them can disagree.
 */
export function useKbSourceRights(): KbCapabilities {
    const { user } = useAuth();
    const { currentKb } = useKbCore();
    return kbSourceRights(currentKb, user?.role, user?.id);
}

import {
    MessageBranch, MessageBranchNext, MessageBranchPage, MessageBranchPrevious, MessageBranchSelector,
} from '@ki4jlu/design-system';
import type { BranchInfo } from '../types';
import { useTheme } from '../contexts/ThemeContext';

interface BranchIndicatorProps {
    branchInfo: BranchInfo;
    onSwitchBranch: (siblingId: string) => void;
}

const fill = (text: string, values: Record<string, number>) =>
    text.replace(/\{(\w+)\}/g, (_, k: string) => String(values[k] ?? ''));

/**
 * „‹ 2 von 3 ›" for a question that has sibling versions (an edited
 * question starts a new branch). The DS `MessageBranch` selector — the same
 * control an answer's versions use — so both read alike. It sits UNDER the
 * question bubble, never inside it: on the bubble's primary fill the
 * secondary-text arrows were close to invisible.
 */
export function BranchIndicator({ branchInfo, onSwitchBranch }: BranchIndicatorProps) {
    const { t } = useTheme();
    const { siblingIds, currentIndex, total } = branchInfo;
    return (
        <MessageBranch
            className="w-auto"
            branch={currentIndex}
            totalBranches={total}
            onBranchChange={(i) => {
                const id = siblingIds[i];
                if (id) onSwitchBranch(id);
            }}
        >
            <MessageBranchSelector aria-label={t('answerVersions')}>
                <MessageBranchPrevious formatLabel={(target, all) => fill(t('previousVersion'), { target, total: all })} />
                <MessageBranchPage format={(current, all) => fill(t('versionPage'), { current, total: all })} />
                <MessageBranchNext formatLabel={(target, all) => fill(t('nextVersion'), { target, total: all })} />
            </MessageBranchSelector>
        </MessageBranch>
    );
}

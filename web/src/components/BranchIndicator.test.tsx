import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { BranchIndicator } from './BranchIndicator';
import type { BranchInfo } from '../types';

vi.mock('../contexts/ThemeContext', () => ({
  useTheme: () => ({
    t: (key: string) => ({
      previousVersion: 'Previous version ({target} of {total})',
      nextVersion: 'Next version ({target} of {total})',
      versionPage: '{current} of {total}',
      answerVersions: 'Versions',
    } as Record<string, string>)[key] ?? key,
  }),
}));

function makeBranchInfo(currentIndex: number, total: number): BranchInfo {
  const siblingIds = Array.from({ length: total }, (_, i) => `s${i}`);
  return { parentMessageId: 'parent', siblingIds, currentIndex, total };
}

// Oracle: the DS MessageBranch selector's own contract — a page label and
// previous/next buttons named through formatLabel, wrapping at the ends.
describe('BranchIndicator', () => {
  it('shows the current version of the total', () => {
    render(<BranchIndicator branchInfo={makeBranchInfo(1, 3)} onSwitchBranch={() => {}} />);
    expect(screen.getByText('2 of 3')).toBeInTheDocument();
  });

  it('switches to the previous sibling', async () => {
    const onSwitch = vi.fn();
    render(<BranchIndicator branchInfo={makeBranchInfo(1, 3)} onSwitchBranch={onSwitch} />);
    await userEvent.setup().click(screen.getByRole('button', { name: 'Previous version (1 of 3)' }));
    expect(onSwitch).toHaveBeenCalledWith('s0');
  });

  it('switches to the next sibling', async () => {
    const onSwitch = vi.fn();
    render(<BranchIndicator branchInfo={makeBranchInfo(1, 3)} onSwitchBranch={onSwitch} />);
    await userEvent.setup().click(screen.getByRole('button', { name: 'Next version (3 of 3)' }));
    expect(onSwitch).toHaveBeenCalledWith('s2');
  });
});

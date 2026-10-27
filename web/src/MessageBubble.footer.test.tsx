import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Button } from '@ki4jlu/design-system';
import MessageBubble from './MessageBubble';
import { messageSectionKey, useMessageSections } from './hooks/useMessageSections';
import type { BranchInfo, Message, MessageConflict, MessageVerification } from './types';

// Same harness mocks as MessageBubble.test.tsx, plus a switchable mobile flag.
vi.mock('./contexts/ThemeContext', () => ({
  useTheme: () => ({ t: (key: string) => key, language: 'en' as const }),
}));
vi.mock('./contexts/ToastContext', () => ({
  useToast: () => ({ success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() }),
}));
vi.mock('./contexts/AuthContext', () => ({
  useAuth: () => ({ user: null, siteConfigs: {} }),
}));
vi.mock('./hooks/useReducedMotion', () => ({
  useReducedMotion: () => false,
  getMotionProps: () => ({}),
}));
const copyAnswerWithCitations = vi.hoisted(() => vi.fn(async () => true));
vi.mock('./utils/exportAnswer', () => ({
  copyAnswerWithCitations,
  downloadAnswerMarkdown: vi.fn(),
  exportAnswerDocx: vi.fn(),
  printAnswerPdf: vi.fn(),
}));
let isMobile = false;
vi.mock('./contexts/MobileContext', () => ({
  useIsMobileContext: () => isMobile,
}));

beforeEach(() => { isMobile = false; });

/* ---------------------------------------------------------------------------
 * Oracle: the owner's decisions for the message footer (2026-10-22, revised):
 *  - Every message's footer — the answer's whole row (sources pill, chips,
 *    version switcher, actions) and the question's copy/edit row — shows only
 *    on hover, with keyboard focus inside the message, or (touch) on a tap of
 *    the message; on desktop the last message keeps it at rest. A popover opened from
 *    the row, or an expanded section (sources, confidence, conflicts), keeps
 *    it shown while the pointer is away.
 *  - Hiding keeps the row in the layout (visibility, not display:none), so
 *    its controls stay in the DOM.
 *  - Confidence and conflicts are in the row as soon as their frames arrive,
 *    also while streaming. The source list („Quellen · N") and the actions
 *    wait for the saved answer (a real, non-temp id — the aiMessageId frame),
 *    never while the text streams. A saved answer whose turn still runs (the
 *    post-response frames) has its actions, with regenerate/branch disabled.
 *  - „Von hier abzweigen" is offered on earlier answers only: branching from
 *    the latest one would copy the whole chat.
 * `data-revealed` is the switch the visibility classes key on (jsdom applies
 * no CSS, so the attribute is what can be asserted).
 * ------------------------------------------------------------------------- */

const answer: Message = {
  id: 'ai1',
  role: 'ai',
  content: 'Der Beitrag beträgt 50 EUR [1].',
  sources: [{ index: 1, fileName: 'satzung.pdf', fileId: 'f1', content: 'Beitrag 50 EUR', score: 1, pages: [2] }],
};
const verification: MessageVerification = { verified: true, score: 92, issues: [] };
const conflict: MessageConflict = {
  claim: 'Beitrag', sourceA: 1, sourceB: 2, kind: 'contradiction', newer: 'unknown', fileA: 'alt.md', fileB: 'neu.md',
};

const footer = () => screen.getByTestId('answer-footer');
const actions = () => screen.getByTestId('answer-actions');
const bubble = (container: HTMLElement) => container.querySelector('.message-bubble') as HTMLElement;

describe('answer footer — when it shows', () => {
  it('hides the whole footer at rest but keeps it in the layout', () => {
    render(<MessageBubble message={{ ...answer, verification, conflicts: [conflict] }} onFeedback={vi.fn()} />);
    expect(footer()).toHaveAttribute('data-revealed', 'false');
    for (const control of [
      screen.getByRole('button', { name: /answerSourcesToggle · 1/ }),
      screen.getByRole('button', { name: /verificationVerified · 92%/ }),
      screen.getByLabelText('conflictsBadge'),
      within(actions()).getByRole('button', { name: 'helpfulAnswer' }),
    ]) {
      expect(footer()).toContainElement(control);
    }
  });

  it('keeps the last message\'s footer shown at rest', () => {
    const { container } = render(<MessageBubble message={answer} isLatest onFeedback={vi.fn()} />);
    expect(footer()).toHaveAttribute('data-revealed', 'true');
    fireEvent.mouseEnter(bubble(container));
    fireEvent.mouseLeave(bubble(container));
    expect(footer()).toHaveAttribute('data-revealed', 'true');
  });

  it('keeps the last question\'s copy/edit row shown at rest', () => {
    render(<MessageBubble message={{ id: 'u1', role: 'user', content: 'Frage' }} isLatest onEdit={vi.fn()} />);
    expect(screen.getByTestId('question-actions')).toHaveAttribute('data-revealed', 'true');
  });

  it('shows the footer on hover and hides it when the pointer leaves', () => {
    const { container } = render(<MessageBubble message={answer} onFeedback={vi.fn()} />);
    fireEvent.mouseEnter(bubble(container));
    expect(footer()).toHaveAttribute('data-revealed', 'true');
    fireEvent.mouseLeave(bubble(container));
    expect(footer()).toHaveAttribute('data-revealed', 'false');
  });

  it('shows the footer while keyboard focus is inside the answer', async () => {
    const user = userEvent.setup();
    const { container } = render(
      <>
        <MessageBubble message={answer} onFeedback={vi.fn()} />
        <Button type="button">after</Button>
      </>,
    );
    await user.tab();
    expect(footer()).toHaveAttribute('data-revealed', 'true');
    await user.tab();
    expect(bubble(container)).toContainElement(document.activeElement as HTMLElement);
    expect(document.activeElement).not.toBe(bubble(container));
    expect(footer()).toHaveAttribute('data-revealed', 'true');
    act(() => screen.getByRole('button', { name: 'after' }).focus());
    expect(footer()).toHaveAttribute('data-revealed', 'false');
  });

  it.each([
    ['sources', { sourcesOpen: true }],
    ['confidence details', { confidenceOpen: true }],
    ['conflict details', { conflictsOpen: true }],
  ])('keeps the whole footer shown while the %s are expanded, with the pointer away', (_name, open) => {
    render(<MessageBubble message={{ ...answer, verification, conflicts: [conflict] }} onFeedback={vi.fn()} {...open} />);
    expect(footer()).toHaveAttribute('data-revealed', 'true');
    expect(footer()).toContainElement(within(actions()).getByRole('button', { name: 'helpfulAnswer' }));
  });

  it('keeps the footer shown while the feedback comment box is open, with the pointer away', async () => {
    const user = userEvent.setup();
    const { container } = render(<MessageBubble message={answer} onFeedback={vi.fn()} />);
    fireEvent.mouseEnter(bubble(container));
    await user.click(screen.getByRole('button', { name: 'helpfulAnswer' }));
    fireEvent.mouseLeave(bubble(container));
    // Neither pointer nor focus is on the answer now — only the open box.
    act(() => screen.getByPlaceholderText('feedbackCommentPlaceholder').blur());
    expect(screen.getByPlaceholderText('feedbackCommentPlaceholder')).toBeInTheDocument();
    expect(footer()).toHaveAttribute('data-revealed', 'true');

    // Closing hands focus back to the thumb, so the footer stays shown until
    // focus leaves the answer.
    await user.click(screen.getByRole('button', { name: 'cancel' }));
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'helpfulAnswer' }));
    act(() => (document.activeElement as HTMLElement).blur());
    fireEvent.mouseLeave(bubble(container));
    expect(footer()).toHaveAttribute('data-revealed', 'false');
  });

  it('touch: a tap on the answer shows its footer, a tap on a control inside does not toggle it', async () => {
    isMobile = true;
    const user = userEvent.setup();
    render(<MessageBubble message={answer} onFeedback={vi.fn()} />);
    expect(footer()).toHaveAttribute('data-revealed', 'false');

    await user.click(screen.getByText(/Der Beitrag beträgt/));
    expect(footer()).toHaveAttribute('data-revealed', 'true');

    await user.click(screen.getByRole('button', { name: /answerSourcesToggle/ }));
    expect(footer()).toHaveAttribute('data-revealed', 'true');
  });
});

describe('answer footer — what shows while the answer streams', () => {
  const streaming: Message = { ...answer, id: 'temp-ai-1' };

  it('withholds the sources pill and the actions while the text streams', () => {
    render(<MessageBubble message={streaming} isStreaming onFeedback={vi.fn()} onRegenerate={vi.fn()} />);
    expect(footer()).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /answerSourcesToggle/ })).toBeNull();
    expect(screen.queryByText('satzung')).toBeNull();
    expect(screen.queryByTestId('answer-actions')).toBeNull();
    expect(screen.queryByRole('button', { name: 'helpfulAnswer' })).toBeNull();
  });

  it('shows the sources pill once the answer is saved', () => {
    const { rerender } = render(<MessageBubble message={streaming} isStreaming />);
    expect(screen.queryByRole('button', { name: /answerSourcesToggle/ })).toBeNull();
    rerender(<MessageBubble message={{ ...streaming, id: 'ai-saved', renderKey: 'temp-ai-1' }} isStreaming />);
    expect(screen.getByRole('button', { name: /answerSourcesToggle · 1/ })).toBeInTheDocument();
  });

  it('shows the confidence and conflicts chips as their frames arrive', () => {
    const { rerender } = render(<MessageBubble message={streaming} isStreaming />);
    expect(screen.queryByRole('button', { name: /verificationVerified/ })).toBeNull();

    rerender(<MessageBubble message={{ ...streaming, verification }} isStreaming />);
    expect(screen.getByRole('button', { name: /verificationVerified · 92%/ })).toBeInTheDocument();
    expect(screen.queryByLabelText('conflictsBadge')).toBeNull();

    rerender(<MessageBubble message={{ ...streaming, verification, conflicts: [conflict] }} isStreaming />);
    expect(screen.getByLabelText('conflictsBadge')).toBeInTheDocument();
  });

  // A saved answer whose turn still runs (citations, fact check): the actions
  // are there, but the ones that start a new turn wait for its end.
  it('shows the actions once the answer is saved; regenerate and branch wait for the turn', () => {
    const props = { onFeedback: vi.fn(), onRegenerate: vi.fn(), onFork: vi.fn() };
    const saved: Message = { ...answer, id: 'ai-saved', renderKey: 'temp-ai-1' };
    const { rerender } = render(<MessageBubble message={saved} isStreaming {...props} />);
    for (const name of ['helpfulAnswer', 'unhelpfulAnswer']) {
      expect(within(actions()).getByRole('button', { name })).toBeEnabled();
    }
    for (const name of ['regenerateResponse', 'forkFromHere']) {
      expect(within(actions()).getByRole('button', { name })).toBeDisabled();
    }

    rerender(<MessageBubble message={saved} {...props} />);
    for (const name of ['helpfulAnswer', 'unhelpfulAnswer', 'regenerateResponse', 'forkFromHere']) {
      expect(within(actions()).getByRole('button', { name })).toBeEnabled();
    }
  });

  it('offers no branch action on the latest answer', () => {
    render(<MessageBubble message={answer} isLatest onRegenerate={vi.fn()} onFork={vi.fn()} />);
    expect(within(actions()).getByRole('button', { name: 'regenerateResponse' })).toBeInTheDocument();
    expect(within(actions()).queryByRole('button', { name: 'forkFromHere' })).toBeNull();
  });

  it('renders no footer before the first token', () => {
    render(<MessageBubble message={{ ...streaming, content: '', sources: undefined }} isStreaming />);
    expect(screen.queryByRole('button', { name: /answerSourcesToggle/ })).toBeNull();
    expect(screen.queryByTestId('answer-actions')).toBeNull();
  });

  // Oracle: messageSectionKey — a section is keyed by the render key, which
  // survives the temp→saved id remap (utils/messageTree remapMessageId). The
  // list cannot be opened before the remap any more, so this pins that it
  // opens right after it, under the saved id, and stays open once the turn ends.
  it('opens the source list on the saved answer and keeps it open as the turn ends', async () => {
    const user = userEvent.setup();
    function Harness({ message, isStreaming }: { message: Message; isStreaming?: boolean }) {
      const sections = useMessageSections();
      return (
        <MessageBubble
          message={message}
          isStreaming={isStreaming}
          sourcesOpen={sections.isOpen(messageSectionKey(message), 'sources')}
          onToggleSection={sections.toggle}
        />
      );
    }
    const saved: Message = { ...streaming, id: 'ai-saved', renderKey: 'temp-ai-1' };
    const { rerender } = render(<Harness message={streaming} isStreaming />);
    expect(screen.queryByRole('button', { name: /answerSourcesToggle/ })).toBeNull();

    rerender(<Harness message={saved} isStreaming />);
    await user.click(screen.getByRole('button', { name: /answerSourcesToggle/ }));
    expect(screen.getByText('satzung')).toBeInTheDocument();

    rerender(<Harness message={saved} />);
    expect(screen.getByText('satzung')).toBeInTheDocument();
  });
});

describe('answer footer — versions and the graph action', () => {
  const branchInfo: BranchInfo = { parentMessageId: 'u1', siblingIds: ['a', 'b', 'c'], currentIndex: 1, total: 3 };

  it('switches versions through the selector, which stays visible at rest', async () => {
    const user = userEvent.setup();
    const onSwitchBranch = vi.fn();
    render(<MessageBubble message={answer} branchInfo={branchInfo} onSwitchBranch={onSwitchBranch} />);
    const next = screen.getByRole('button', { name: 'nextVersion' });
    expect(actions()).not.toContainElement(next);

    await user.click(next);
    expect(onSwitchBranch).toHaveBeenLastCalledWith('c');
    await user.click(screen.getByRole('button', { name: 'previousVersion' }));
    expect(onSwitchBranch).toHaveBeenLastCalledWith('a');
  });

  it('offers no selector for an answer with a single version', () => {
    render(<MessageBubble message={answer} branchInfo={{ ...branchInfo, siblingIds: ['b'], currentIndex: 0, total: 1 }} onSwitchBranch={vi.fn()} />);
    expect(screen.queryByRole('button', { name: 'nextVersion' })).toBeNull();
  });

  it('opens the answer\'s knowledge graph from the action row', async () => {
    const user = userEvent.setup();
    const onViewGraph = vi.fn();
    render(<MessageBubble message={answer} onViewGraph={onViewGraph} />);
    await user.click(within(actions()).getByRole('button', { name: 'viewGraphForAnswer' }));
    expect(onViewGraph).toHaveBeenCalledWith('ai1');
  });
});

// Oracle: owner feedback on the dev preview (2026-10-22) — a question gets the
// same icon row as an answer (copy, edit), below its bubble, with the same
// visibility rule (hover, focus inside, tap).
describe('question action row', () => {
  const question: Message = { id: 'u1', role: 'user', content: 'Wie hoch ist der Beitrag?' };
  const questionActions = () => screen.getByTestId('question-actions');

  it('sits below the bubble, outside it', () => {
    const { container } = render(<MessageBubble message={question} />);
    const bubbleEl = container.querySelector('.message-user') as HTMLElement;
    expect(bubbleEl).toHaveTextContent('Wie hoch ist der Beitrag?');
    expect(bubbleEl).not.toContainElement(questionActions());
    expect(bubbleEl.compareDocumentPosition(questionActions()) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('hides the row at rest and shows it on hover', () => {
    const { container } = render(<MessageBubble message={question} />);
    expect(questionActions()).toHaveAttribute('data-revealed', 'false');
    fireEvent.mouseEnter(container.querySelector('.message-question') as HTMLElement);
    expect(questionActions()).toHaveAttribute('data-revealed', 'true');
  });

  it('copies the question text with the answer\'s copy helper', async () => {
    const user = userEvent.setup();
    render(<MessageBubble message={question} />);
    await user.click(within(questionActions()).getByRole('button', { name: 'copy' }));
    expect(copyAnswerWithCitations).toHaveBeenCalledWith(question, 'sourcesHeading');
  });

  it('starts an edit with the question\'s id and text', async () => {
    const user = userEvent.setup();
    const onEdit = vi.fn();
    render(<MessageBubble message={question} onEdit={onEdit} />);
    await user.click(within(questionActions()).getByRole('button', { name: 'editMessage' }));
    expect(onEdit).toHaveBeenCalledWith('u1', 'Wie hoch ist der Beitrag?');
  });

  // Same rule as the answer: the row needs the saved question (a real id),
  // not the end of the turn.
  it('waits for the saved question, not for the end of the turn', () => {
    const { rerender } = render(<MessageBubble message={{ ...question, id: 'temp-user-1' }} isStreaming />);
    expect(screen.queryByTestId('question-actions')).toBeNull();
    rerender(<MessageBubble message={question} isStreaming />);
    expect(within(questionActions()).getByRole('button', { name: 'copy' })).toBeInTheDocument();
  });
});

// Oracle: owner decision (2026-10-22) — the message's actions also open from
// a context menu: long-press on touch, right-click with a mouse (Radix's
// default, kept). Same actions, handlers and availability as the footer row;
// a question's menu is copy + edit.
describe('message context menu', () => {
  const question: Message = { id: 'u1', role: 'user', content: 'Wie hoch ist der Beitrag?' };
  const handlers = () => ({
    onFeedback: vi.fn(), onRegenerate: vi.fn(), onFork: vi.fn(), onCompare: vi.fn(), onViewGraph: vi.fn(), onEdit: vi.fn(),
  });
  const items = () => [...screen.getByRole('menu').querySelectorAll('[role^="menuitem"]')].map((i) => i.textContent);
  const openMenu = () => fireEvent.contextMenu(screen.getByText(/Der Beitrag beträgt|Wie hoch ist/));

  it('offers an answer\'s actions in the footer\'s order', () => {
    render(<MessageBubble message={answer} {...handlers()} />);
    openMenu();
    expect(items()).toEqual([
      'copy', 'helpfulAnswer', 'unhelpfulAnswer', 'regenerateResponse', 'forkFromHere', 'compareBranches', 'exportAnswer', 'viewGraphForAnswer',
    ]);
  });

  it('runs the same handlers as the footer', async () => {
    const user = userEvent.setup();
    const h = handlers();
    render(<MessageBubble message={answer} {...h} />);
    for (const [name, fn] of [
      ['regenerateResponse', h.onRegenerate], ['forkFromHere', h.onFork], ['compareBranches', h.onCompare], ['viewGraphForAnswer', h.onViewGraph],
    ] as const) {
      openMenu();
      await user.click(screen.getByRole('menuitem', { name }));
      expect(fn).toHaveBeenCalledWith('ai1');
    }
    openMenu();
    await user.click(screen.getByRole('menuitem', { name: 'copy' }));
    expect(copyAnswerWithCitations).toHaveBeenLastCalledWith(answer, 'sourcesHeading');
  });

  it('rates the answer, and a second rating of the same kind clears it', async () => {
    const user = userEvent.setup();
    const h = handlers();
    const { rerender } = render(<MessageBubble message={answer} {...h} />);
    openMenu();
    await user.click(screen.getByRole('menuitemcheckbox', { name: 'helpfulAnswer' }));
    expect(h.onFeedback).toHaveBeenLastCalledWith('ai1', 'positive', undefined);

    rerender(<MessageBubble message={{ ...answer, feedback: 'positive' }} {...h} />);
    openMenu();
    expect(screen.getByRole('menuitemcheckbox', { name: 'helpfulAnswer' })).toHaveAttribute('aria-checked', 'true');
    await user.click(screen.getByRole('menuitemcheckbox', { name: 'helpfulAnswer' }));
    expect(h.onFeedback).toHaveBeenLastCalledWith('ai1', null, undefined);
  });

  // An unsaved answer (a failed send leaves a `temp-error-*` bubble) has no
  // footer actions, so it has no menu either.
  it('follows the footer\'s availability rules: no menu on an unsaved answer', () => {
    render(<MessageBubble message={{ ...answer, id: 'temp-error-1' }} onRegenerate={vi.fn()} />);
    openMenu();
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('follows the footer\'s availability rules: no branch action on the latest answer', () => {
    render(<MessageBubble message={answer} isLatest {...handlers()} />);
    openMenu();
    expect(items()).toEqual([
      'copy', 'helpfulAnswer', 'unhelpfulAnswer', 'regenerateResponse', 'compareBranches', 'exportAnswer', 'viewGraphForAnswer',
    ]);
  });

  it('offers copy and edit on a question', async () => {
    const user = userEvent.setup();
    const onEdit = vi.fn();
    render(<MessageBubble message={question} onEdit={onEdit} />);
    openMenu();
    expect(items()).toEqual(['copy', 'editMessage']);
    await user.click(screen.getByRole('menuitem', { name: 'editMessage' }));
    expect(onEdit).toHaveBeenCalledWith('u1', 'Wie hoch ist der Beitrag?');
  });

  it('has no menu while the answer text streams', () => {
    render(<MessageBubble message={{ ...answer, id: 'temp-ai-1' }} isStreaming {...handlers()} />);
    openMenu();
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('touch: opens on a long-press, and the tap that ends it does not toggle the footer', () => {
    isMobile = true;
    vi.useFakeTimers();
    try {
      render(<MessageBubble message={answer} {...handlers()} />);
      const text = screen.getByText(/Der Beitrag beträgt/);
      fireEvent.pointerDown(text, { pointerType: 'touch', clientX: 10, clientY: 10 });
      act(() => { vi.advanceTimersByTime(800); });
      expect(screen.getByRole('menu')).toBeInTheDocument();
      fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' });
      fireEvent.click(text);
      expect(footer()).toHaveAttribute('data-revealed', 'false');
    } finally {
      vi.useRealTimers();
    }
  });
});

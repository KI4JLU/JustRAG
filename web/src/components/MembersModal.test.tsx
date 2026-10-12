import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import axios from 'axios';
import type { KnowledgeBase } from '../types';
import { MembersModal } from './MembersModal';
import { copyToClipboard } from '../utils/clipboard';

vi.mock('../utils/clipboard', () => ({ copyToClipboard: vi.fn() }));

// Automocks every axios method to a vi.fn() (repo convention — see
// hooks/useSharing.test.tsx). The pre-existing tests below still use
// vi.spyOn(axios, 'get') etc. per-test, which works identically whether the
// underlying property started as the real axios method or an automocked
// vi.fn(). The new invite-links tests use vi.mocked(...) directly instead,
// which requires this.
vi.mock('axios');

// framer-motion is mocked globally in src/test/setup.ts with a stable
// per-tag component cache — no per-file override needed here (see that
// file's comment for the CI-only remount flake a fresh-stub mock causes).

vi.mock('../hooks/useReducedMotion', () => ({
  useReducedMotion: () => false,
  getMotionProps: () => ({}),
}));

// Real context hooks return referentially stable values across renders (the
// provider's state/memo doesn't change just because a child re-rendered).
// These mocks do the same: hoisted, module-level singleton objects returned
// as-is on every call. A fresh object literal per call (`useX: () => ({...})`)
// would make every consumer's prop/useCallback dependency on that value
// change identity on every render, which — for fetchMembers' useCallback
// (deps include `toast`) — re-fires the mount effect several times before
// things settle and makes any assertion on axios.get's call count
// non-deterministic.
// makeOwner needs a real space for the /make owner|zum owner/i queries below
// to match — every other key just echoes back, which is enough since the
// tests select by data-testid/role rather than translated text.
const tMock = (k: string) => (k === 'makeOwner' ? 'Make owner' : k);
const themeMock = { t: tMock };
const authMock = { token: 'tok' };
const showConfirm = vi.fn();
const modalMock = { showConfirm };
const toastMock = { success: vi.fn(), error: vi.fn(), warning: vi.fn() };
vi.mock('../contexts/ThemeContext', () => ({ useTheme: () => themeMock }));
vi.mock('../contexts/AuthContext', () => ({ useAuth: () => authMock }));
vi.mock('../contexts/ModalContext', () => ({ useModalContext: () => modalMock }));
vi.mock('../contexts/ToastContext', () => ({ useToast: () => toastMock }));

const kb = { id: 'kb-1', name: 'Test KB' } as KnowledgeBase;

const noopProps = {
  shareUserId: '',
  setShareUserId: () => {},
  shareTargetUser: null,
  shareLoading: false,
  sharePermission: 'view' as const,
  setSharePermission: () => {},
  onLookupUser: () => {},
  onConfirmShare: () => {},
  notFoundUsername: null,
  onPendingInvited: () => {},
};

const members = [
  { userId: 'u1', username: 'ada', firstName: 'Ada', lastName: 'L', role: 'owner' },
  { userId: 'u2', username: 'grace', firstName: 'Grace', lastName: 'H', role: 'admin' },
  { userId: 'u3', username: 'alan', firstName: 'Alan', lastName: 'T', role: 'view' },
];

const renderModal = (myRole: string) => {
  vi.spyOn(axios, 'get').mockResolvedValue({ data: { members, pending: [] } });
  return render(<MembersModal show onClose={vi.fn()} sharingKb={kb} myRole={myRole} {...noopProps} />);
};

const pendingInvites = [
  { username: 'bob', role: 'view', createdAt: '2026-01-01T00:00:00Z' },
];

const renderModalWithPending = (myRole: string) => {
  vi.spyOn(axios, 'get').mockResolvedValue({ data: { members: [], pending: pendingInvites } });
  return render(<MembersModal show onClose={vi.fn()} sharingKb={kb} myRole={myRole} {...noopProps} />);
};

// Radix Select and DropdownMenu (behind the DS Select / ActionMenu) measure,
// scroll and capture the pointer; jsdom implements none of it.
beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn();
  Element.prototype.hasPointerCapture = vi.fn(() => false);
  Element.prototype.setPointerCapture = vi.fn();
  Element.prototype.releasePointerCapture = vi.fn();
});

/** Open a row's role Select with the keyboard (Radix Select's jsdom-safe path). */
async function openRoleSelect(row: HTMLElement) {
  within(row).getByRole('combobox').focus();
  await userEvent.keyboard('{Enter}');
  return screen.findByRole('listbox');
}

/** Open a member row's ⋮ menu. */
async function openMemberMenu(row: HTMLElement) {
  await userEvent.click(within(row).getByRole('button', { name: 'memberActions' }));
  return screen.findByRole('menu');
}

describe('MembersModal', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    showConfirm.mockReset();
    toastMock.error.mockReset();
    toastMock.success.mockReset();
  });

  it('renders the owner row with a badge, without role select or actions menu', async () => {
    renderModal('owner');
    const row = await screen.findByTestId('member-row-u1');
    expect(within(row).getByText('kbRoleOwner')).toBeInTheDocument();
    expect(within(row).queryByRole('combobox')).toBeNull();
    expect(within(row).queryByRole('button', { name: 'memberActions' })).toBeNull();
  });

  // ORACLE: kbaccess.Assignable — view, edit, admin; never owner.
  it('offers exactly view, edit and admin in the role select', async () => {
    renderModal('owner');
    const listbox = await openRoleSelect(await screen.findByTestId('member-row-u3'));
    expect(within(listbox).getAllByRole('option').map(o => o.textContent))
      .toEqual(['viewPermission', 'editPermission', 'adminPermission']);
  });

  it('hides the ownership transfer for a non-owner', async () => {
    renderModal('admin');
    const menu = await openMemberMenu(await screen.findByTestId('member-row-u2'));
    expect(within(menu).queryByRole('menuitem', { name: /make owner/i })).toBeNull();
    expect(within(menu).getByRole('menuitem', { name: 'removeShare' })).toBeInTheDocument();
  });

  it('posts the transfer for the owner', async () => {
    const post = vi.spyOn(axios, 'post').mockResolvedValue({ status: 204 });
    showConfirm.mockResolvedValue(true);
    renderModal('owner');

    const menu = await openMemberMenu(await screen.findByTestId('member-row-u2'));
    await userEvent.click(within(menu).getByRole('menuitem', { name: /make owner/i }));
    await waitFor(() => expect(post).toHaveBeenCalledWith(
      expect.stringContaining('/transfer-owner'), { userId: 'u2' }));
  });

  it('removes a member after confirming with their name', async () => {
    const del = vi.spyOn(axios, 'delete').mockResolvedValue({ status: 204 });
    showConfirm.mockResolvedValue(true);
    renderModal('owner');

    const menu = await openMemberMenu(await screen.findByTestId('member-row-u3'));
    await userEvent.click(within(menu).getByRole('menuitem', { name: 'removeShare' }));
    await waitFor(() => expect(del).toHaveBeenCalledWith(expect.stringContaining('/members/u3')));
    expect(showConfirm).toHaveBeenCalledWith('confirmRemoveShare');
    await waitFor(() => expect(screen.queryByTestId('member-row-u3')).toBeNull());
  });

  it('rolls the role select back when the request fails', async () => {
    const put = vi.spyOn(axios, 'put').mockRejectedValue(new Error('boom'));
    renderModal('owner');

    const row = await screen.findByTestId('member-row-u3');
    const listbox = await openRoleSelect(row);
    await userEvent.click(within(listbox).getByRole('option', { name: 'editPermission' }));

    expect(put).toHaveBeenCalledWith(expect.stringContaining('/members/u3'), { role: 'edit' });
    // Optimistically 'edit', back to 'view' after the failure.
    await waitFor(() => expect(within(row).getByRole('combobox')).toHaveTextContent('viewPermission'));
  });

  it('revokes a pending invite', async () => {
    const del = vi.spyOn(axios, 'delete').mockResolvedValue({ status: 204 });
    renderModalWithPending('owner');

    const row = await screen.findByTestId('pending-row-bob');
    await userEvent.click(within(row).getByRole('button', { name: /revoke|zurückziehen/i }));

    expect(del).toHaveBeenCalledWith(expect.stringContaining('/members/pending/bob'));
    await waitFor(() => expect(screen.queryByTestId('pending-row-bob')).toBeNull());
  });

  it('rolls the pending invite back when the revoke request fails', async () => {
    vi.spyOn(axios, 'delete').mockRejectedValue(new Error('boom'));
    renderModalWithPending('owner');

    const row = await screen.findByTestId('pending-row-bob');
    await userEvent.click(within(row).getByRole('button', { name: /revoke|zurückziehen/i }));

    // Optimistisch entfernt, nach dem Fehlschlag kehrt die Zeile zurueck.
    await waitFor(() => expect(screen.getByTestId('pending-row-bob')).toBeInTheDocument());
  });
});

describe('invite links tab', () => {
  // vi.mock('axios') automocks are shared vi.fn()s across the whole file;
  // unlike the vi.spyOn-based mocks above (reset by the sibling describe's
  // own vi.restoreAllMocks()), their call history persists across tests
  // unless cleared explicitly here.
  beforeEach(() => {
    vi.mocked(axios.get).mockReset();
    vi.mocked(axios.post).mockReset();
    vi.mocked(axios.delete).mockReset();
    vi.mocked(copyToClipboard).mockReset();
    showConfirm.mockReset();
    toastMock.success.mockReset();
    toastMock.error.mockReset();
  });

  it('does not fetch invite links until the tab is opened', async () => {
    const user = userEvent.setup();
    vi.mocked(axios.get).mockImplementation(async (url: string) => {
      if (url.endsWith('/invite-links')) return { data: { links: [] } };
      return { data: { members: [], pending: [] } };
    });

    render(<MembersModal show onClose={() => {}} sharingKb={kb} myRole="owner" {...noopProps} />);

    // Let the mount-time members fetch settle before asserting nothing else fired.
    await waitFor(() => expect(axios.get).toHaveBeenCalled());
    const hasInviteLinksFetch = () => vi.mocked(axios.get).mock.calls.some(
      ([url]) => String(url).endsWith('/invite-links'),
    );
    expect(hasInviteLinksFetch()).toBe(false);

    await user.click(screen.getByRole('tab', { name: /inviteLinks/i }));

    await waitFor(() => expect(hasInviteLinksFetch()).toBe(true));
  });

  it('creates a link and shows it in the list', async () => {
    const user = userEvent.setup();
    vi.mocked(axios.get).mockImplementation(async (url: string) => {
      if (url.endsWith('/invite-links')) return { data: { links: [] } };
      return { data: { members: [], pending: [] } };
    });
    vi.mocked(axios.post).mockResolvedValue({
      data: {
        id: 'l1', kbId: 'kb-1', token: 'TOKEN123', role: 'view', label: 'WS26',
        createdByName: 'prof', createdAt: '2026-08-18T10:00:00Z',
        redemptionCount: 0, lastUsedAt: null,
      },
    });

    render(<MembersModal show onClose={() => {}} sharingKb={kb} myRole="owner" {...noopProps} />);

    await user.click(screen.getByRole('tab', { name: /inviteLinks/i }));
    await user.type(screen.getByLabelText(/inviteLinkLabel/i), 'Fall26 Cohort');
    await user.click(screen.getByRole('button', { name: /createInviteLink/i }));

    await waitFor(() => {
      expect(axios.post).toHaveBeenCalledWith(
        expect.stringContaining('/api/kb/kb-1/invite-links'),
        expect.objectContaining({ role: 'view', label: 'Fall26 Cohort' }),
      );
    });
    expect(await screen.findByText('WS26')).toBeInTheDocument();
  });

  it('revokes a link after confirmation', async () => {
    const user = userEvent.setup();
    showConfirm.mockResolvedValue(true);
    vi.mocked(axios.get).mockImplementation(async (url: string) => {
      if (url.endsWith('/invite-links')) {
        return {
          data: {
            links: [{
              id: 'l1', kbId: 'kb-1', token: 'TOKEN123', role: 'view', label: 'WS26',
              createdByName: 'prof', createdAt: '2026-08-18T10:00:00Z',
              redemptionCount: 3, lastUsedAt: '2026-08-18T11:00:00Z',
            }],
          },
        };
      }
      return { data: { members: [], pending: [] } };
    });
    vi.mocked(axios.delete).mockResolvedValue({ data: {} });

    render(<MembersModal show onClose={() => {}} sharingKb={kb} myRole="owner" {...noopProps} />);

    await user.click(screen.getByRole('tab', { name: /inviteLinks/i }));
    await user.click(await screen.findByRole('button', { name: /revokeInviteLink/i }));

    await waitFor(() => {
      expect(axios.delete).toHaveBeenCalledWith(
        expect.stringContaining('/api/kb/kb-1/invite-links/l1'),
      );
    });
    await waitFor(() => expect(screen.queryByText('WS26')).not.toBeInTheDocument());
  });

  it('does not revoke when the confirmation is declined', async () => {
    const user = userEvent.setup();
    showConfirm.mockResolvedValue(false);
    vi.mocked(axios.get).mockImplementation(async (url: string) => {
      if (url.endsWith('/invite-links')) {
        return {
          data: {
            links: [{
              id: 'l1', kbId: 'kb-1', token: 'TOKEN123', role: 'view', label: 'WS26',
              createdByName: 'prof', createdAt: '2026-08-18T10:00:00Z',
              redemptionCount: 0, lastUsedAt: null,
            }],
          },
        };
      }
      return { data: { members: [], pending: [] } };
    });

    render(<MembersModal show onClose={() => {}} sharingKb={kb} myRole="owner" {...noopProps} />);

    await user.click(screen.getByRole('tab', { name: /inviteLinks/i }));
    await user.click(await screen.findByRole('button', { name: /revokeInviteLink/i }));

    expect(axios.delete).not.toHaveBeenCalled();
    expect(screen.getByText('WS26')).toBeInTheDocument();
  });

  it('copies the invite link and toasts success', async () => {
    const user = userEvent.setup();
    vi.mocked(axios.get).mockImplementation(async (url: string) => {
      if (url.endsWith('/invite-links')) {
        return {
          data: {
            links: [{
              id: 'l1', kbId: 'kb-1', token: 'TOKEN123', role: 'view', label: 'WS26',
              createdByName: 'prof', createdAt: '2026-08-18T10:00:00Z',
              redemptionCount: 0, lastUsedAt: null,
            }],
          },
        };
      }
      return { data: { members: [], pending: [] } };
    });
    vi.mocked(copyToClipboard).mockResolvedValue(true);

    render(<MembersModal show onClose={() => {}} sharingKb={kb} myRole="owner" {...noopProps} />);

    await user.click(screen.getByRole('tab', { name: /inviteLinks/i }));
    await user.click(await screen.findByRole('button', { name: /copyToClipboard/i }));

    await waitFor(() => expect(copyToClipboard).toHaveBeenCalledWith(
      expect.stringContaining('/join/TOKEN123'),
    ));
    expect(toastMock.success).toHaveBeenCalledWith('inviteLinkCopied');
    expect(toastMock.error).not.toHaveBeenCalled();
  });

  it('toasts a failure when the clipboard copy fails', async () => {
    const user = userEvent.setup();
    vi.mocked(axios.get).mockImplementation(async (url: string) => {
      if (url.endsWith('/invite-links')) {
        return {
          data: {
            links: [{
              id: 'l1', kbId: 'kb-1', token: 'TOKEN123', role: 'view', label: 'WS26',
              createdByName: 'prof', createdAt: '2026-08-18T10:00:00Z',
              redemptionCount: 0, lastUsedAt: null,
            }],
          },
        };
      }
      return { data: { members: [], pending: [] } };
    });
    vi.mocked(copyToClipboard).mockResolvedValue(false);

    render(<MembersModal show onClose={() => {}} sharingKb={kb} myRole="owner" {...noopProps} />);

    await user.click(screen.getByRole('tab', { name: /inviteLinks/i }));
    await user.click(await screen.findByRole('button', { name: /copyToClipboard/i }));

    await waitFor(() => expect(copyToClipboard).toHaveBeenCalled());
    expect(toastMock.error).toHaveBeenCalledWith('clipboardCopyFailed');
    expect(toastMock.success).not.toHaveBeenCalled();
  });
});

// The single invite is a two-step exact lookup: Enter resolves the username,
// the person shows under the field, and Enter again invites them.
describe('single invite', () => {
  beforeEach(() => { vi.restoreAllMocks(); });

  const ada = { id: 'u9', username: 'ada9', firstName: 'Ada', lastName: 'Byron' };

  function renderInvite(overrides: Partial<React.ComponentProps<typeof MembersModal>>) {
    vi.spyOn(axios, 'get').mockResolvedValue({ data: { members, pending: [] } });
    return render(<MembersModal show onClose={vi.fn()} sharingKb={kb} myRole="owner" {...noopProps} {...overrides} />);
  }

  it('looks the username up first, without inviting', async () => {
    const onLookupUser = vi.fn();
    const onConfirmShare = vi.fn();
    renderInvite({ shareUserId: 'ada9', onLookupUser, onConfirmShare });

    await userEvent.type(screen.getByLabelText('invitePerson'), '{Enter}');
    expect(onLookupUser).toHaveBeenCalledTimes(1);
    expect(onConfirmShare).not.toHaveBeenCalled();
  });

  it('shows the resolved person and invites on the second Enter', async () => {
    const onLookupUser = vi.fn();
    const onConfirmShare = vi.fn();
    renderInvite({ shareUserId: 'ada9', shareTargetUser: ada, onLookupUser, onConfirmShare });

    const candidate = await screen.findByTestId('invite-candidate');
    expect(candidate).toHaveTextContent('Ada Byron');
    expect(candidate).toHaveTextContent('@ada9');

    await userEvent.type(screen.getByLabelText('invitePerson'), '{Enter}');
    expect(onConfirmShare).toHaveBeenCalledTimes(1);
    expect(onLookupUser).not.toHaveBeenCalled();
  });

  it('looks up again when the field no longer matches the resolved person', async () => {
    const onLookupUser = vi.fn();
    const onConfirmShare = vi.fn();
    renderInvite({ shareUserId: 'alan', shareTargetUser: ada, onLookupUser, onConfirmShare });

    expect(screen.queryByTestId('invite-candidate')).toBeNull();
    await userEvent.type(screen.getByLabelText('invitePerson'), '{Enter}');
    expect(onLookupUser).toHaveBeenCalledTimes(1);
    expect(onConfirmShare).not.toHaveBeenCalled();
  });

  it('marks an existing member and does not invite them again', async () => {
    const onConfirmShare = vi.fn();
    const grace = { id: 'u2', username: 'grace', firstName: 'Grace', lastName: 'H' };
    renderInvite({ shareUserId: 'grace', shareTargetUser: grace, onConfirmShare });

    const candidate = await screen.findByTestId('invite-candidate');
    await waitFor(() => expect(candidate).toHaveTextContent('alreadyMember'));
    expect(screen.getByRole('button', { name: 'inviteAction' })).toBeDisabled();
    await userEvent.type(screen.getByLabelText('invitePerson'), '{Enter}');
    expect(onConfirmShare).not.toHaveBeenCalled();
  });

  it('offers a pending invite for an unknown username', async () => {
    const post = vi.spyOn(axios, 'post').mockResolvedValue({ data: {} });
    renderInvite({ shareUserId: 'newbie', notFoundUsername: 'newbie', sharePermission: 'edit' });

    await userEvent.click(await screen.findByRole('button', { name: 'inviteAnyway' }));
    await waitFor(() => expect(post).toHaveBeenCalledWith(
      expect.stringContaining('/members/bulk'), { usernames: ['newbie'], role: 'edit' }));
  });
});

describe('opening', () => {
  beforeEach(() => { vi.restoreAllMocks(); });

  it('starts in the username field', async () => {
    renderModal('owner');
    await waitFor(() => expect(screen.getByLabelText('invitePerson')).toHaveFocus());
  });
});

describe('member lists per tab', () => {
  beforeEach(() => { vi.restoreAllMocks(); });

  it('shows members on the single and bulk tabs, not on the invite links tab', async () => {
    vi.spyOn(axios, 'get').mockImplementation(async (url: string) => (
      url.endsWith('/invite-links') ? { data: { links: [] } } : { data: { members, pending: pendingInvites } }));
    render(<MembersModal show onClose={vi.fn()} sharingKb={kb} myRole="owner" {...noopProps} />);

    await screen.findByTestId('member-row-u1');
    expect(screen.getByTestId('pending-row-bob')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('tab', { name: /inviteLinks/ }));
    expect(screen.queryByTestId('member-row-u1')).toBeNull();
    expect(screen.queryByTestId('pending-row-bob')).toBeNull();

    await userEvent.click(screen.getByRole('tab', { name: /bulkInvite/ }));
    expect(screen.getByTestId('member-row-u1')).toBeInTheDocument();
  });
});

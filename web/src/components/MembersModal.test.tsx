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

const members = [
  { userId: 'u1', username: 'ada', firstName: 'Ada', lastName: 'L', role: 'owner' },
  { userId: 'u2', username: 'grace', firstName: 'Grace', lastName: 'H', role: 'admin' },
  { userId: 'u3', username: 'alan', firstName: 'Alan', lastName: 'T', role: 'view' },
];

const pendingInvites = [
  { username: 'bob', role: 'view', createdAt: '2026-01-01T00:00:00Z' },
];

const aLink = {
  id: 'l1', kbId: 'kb-1', token: 'TOKEN123', role: 'edit', label: 'WS26',
  createdByName: 'prof', createdAt: '2026-08-18T10:00:00Z',
  redemptionCount: 12, lastUsedAt: '2026-08-18T11:00:00Z',
};

/** GET answers: members/pending for /members, `links` for /invite-links. */
function mockGets(opts: { members?: unknown[]; pending?: unknown[]; links?: unknown[] } = {}) {
  vi.mocked(axios.get).mockImplementation(async (url: string) => (
    url.endsWith('/invite-links')
      ? { data: { links: opts.links ?? [] } }
      : { data: { members: opts.members ?? members, pending: opts.pending ?? [] } }));
}

const renderModal = (myRole = 'owner') =>
  render(<MembersModal show onClose={vi.fn()} sharingKb={kb} myRole={myRole} />);

// Radix Select and DropdownMenu (behind the DS Select / ActionMenu) measure,
// scroll and capture the pointer; jsdom implements none of it.
beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn();
  Element.prototype.hasPointerCapture = vi.fn(() => false);
  Element.prototype.setPointerCapture = vi.fn();
  Element.prototype.releasePointerCapture = vi.fn();
  // vi.mock('axios') automocks are shared vi.fn()s; reset them per test.
  vi.mocked(axios.get).mockReset();
  vi.mocked(axios.post).mockReset();
  vi.mocked(axios.put).mockReset();
  vi.mocked(axios.delete).mockReset();
  vi.mocked(copyToClipboard).mockReset();
  showConfirm.mockReset();
  toastMock.success.mockReset();
  toastMock.error.mockReset();
});

/** Open a row's role Select with the keyboard (Radix Select's jsdom-safe path). */
async function openRoleSelect(row: HTMLElement) {
  within(row).getByRole('combobox').focus();
  await userEvent.keyboard('{Enter}');
  return screen.findByRole('listbox');
}

/** Open a row's ⋮ menu by its accessible name. */
async function openMenu(row: HTMLElement, name: string | RegExp) {
  await userEvent.click(within(row).getByRole('button', { name }));
  return screen.findByRole('menu');
}

async function openAddView() {
  await userEvent.click(await screen.findByRole('button', { name: 'add' }));
  await screen.findByRole('heading', { name: 'addMembers' });
}

describe('MembersModal — member list', () => {
  it('opens on the member list with an add button, no invite form', async () => {
    mockGets();
    renderModal();
    expect(await screen.findByRole('heading', { name: 'members' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'add' })).toBeInTheDocument();
    expect(screen.queryByRole('tab')).toBeNull();
    expect(await screen.findByTestId('member-row-u1')).toBeInTheDocument();
  });

  it('renders the owner row with a badge, without role select or actions menu', async () => {
    mockGets();
    renderModal();
    const row = await screen.findByTestId('member-row-u1');
    expect(within(row).getByText('kbRoleOwner')).toBeInTheDocument();
    expect(within(row).queryByRole('combobox')).toBeNull();
    expect(within(row).queryByRole('button', { name: 'memberActions' })).toBeNull();
  });

  // ORACLE: kbaccess.Assignable — view, edit, admin; never owner.
  it('offers exactly view, edit and admin in the role select', async () => {
    mockGets();
    renderModal();
    const listbox = await openRoleSelect(await screen.findByTestId('member-row-u3'));
    expect(within(listbox).getAllByRole('option').map(o => o.textContent))
      .toEqual(['viewPermission', 'editPermission', 'adminPermission']);
  });

  it('hides the ownership transfer for a non-owner', async () => {
    mockGets();
    renderModal('admin');
    const menu = await openMenu(await screen.findByTestId('member-row-u2'), 'memberActions');
    expect(within(menu).queryByRole('menuitem', { name: /make owner/i })).toBeNull();
    expect(within(menu).getByRole('menuitem', { name: 'removeShare' })).toBeInTheDocument();
  });

  it('posts the transfer for the owner', async () => {
    mockGets();
    vi.mocked(axios.post).mockResolvedValue({ status: 204 });
    showConfirm.mockResolvedValue(true);
    renderModal();
    const menu = await openMenu(await screen.findByTestId('member-row-u2'), 'memberActions');
    await userEvent.click(within(menu).getByRole('menuitem', { name: /make owner/i }));
    await waitFor(() => expect(axios.post).toHaveBeenCalledWith(
      expect.stringContaining('/transfer-owner'), { userId: 'u2' }));
  });

  it('removes a member after confirming', async () => {
    mockGets();
    vi.mocked(axios.delete).mockResolvedValue({ status: 204 });
    showConfirm.mockResolvedValue(true);
    renderModal();
    const menu = await openMenu(await screen.findByTestId('member-row-u3'), 'memberActions');
    await userEvent.click(within(menu).getByRole('menuitem', { name: 'removeShare' }));
    await waitFor(() => expect(axios.delete).toHaveBeenCalledWith(expect.stringContaining('/members/u3')));
    await waitFor(() => expect(screen.queryByTestId('member-row-u3')).toBeNull());
  });

  it('rolls the role select back when the request fails', async () => {
    mockGets();
    vi.mocked(axios.put).mockRejectedValue(new Error('boom'));
    renderModal();
    const row = await screen.findByTestId('member-row-u3');
    const listbox = await openRoleSelect(row);
    await userEvent.click(within(listbox).getByRole('option', { name: 'editPermission' }));
    expect(axios.put).toHaveBeenCalledWith(expect.stringContaining('/members/u3'), { role: 'edit' });
    // Optimistically 'edit', back to 'view' after the failure.
    await waitFor(() => expect(within(row).getByRole('combobox')).toHaveTextContent('viewPermission'));
  });

  it('revokes a pending invite, and rolls it back when the request fails', async () => {
    mockGets({ members: [], pending: pendingInvites });
    vi.mocked(axios.delete).mockRejectedValue(new Error('boom'));
    renderModal();
    const row = await screen.findByTestId('pending-row-bob');
    await userEvent.click(within(row).getByRole('button', { name: 'revokeInvite' }));
    expect(axios.delete).toHaveBeenCalledWith(expect.stringContaining('/members/pending/bob'));
    // Optimistically removed, back after the failure.
    await waitFor(() => expect(screen.getByTestId('pending-row-bob')).toBeInTheDocument());
  });
});

describe('MembersModal — add by username', () => {
  // GET /api/users/{term}, as users.GetUser answers it: an exact id or username
  // first, else the FIRST substring hit over username / first / last name, else
  // 404. carl and grace have accounts (grace is already a member, u2).
  const directory: Record<string, { id: string; username: string; firstName: string; lastName: string }> = {
    carl: { id: 'u9', username: 'carl', firstName: 'Carl', lastName: 'Zeiss' },
    grace: { id: 'u2', username: 'grace', firstName: 'Grace', lastName: 'H' },
  };
  beforeEach(() => {
    vi.mocked(axios.isAxiosError).mockImplementation((e: unknown) => Boolean((e as { isAxiosError?: boolean })?.isAxiosError));
    vi.mocked(axios.get).mockImplementation(async (url: string) => {
      const user = /\/api\/users\/([^/?]+)$/.exec(url);
      if (user) {
        const term = decodeURIComponent(user[1]).toLowerCase();
        const people = Object.values(directory);
        const hit = people.find(p => p.id === term || p.username === term)
          ?? people.find(p => [p.username, p.firstName, p.lastName].some(f => f.toLowerCase().includes(term)));
        if (hit) return { data: hit };
        throw Object.assign(new Error('404'), { isAxiosError: true, response: { status: 404 } });
      }
      if (url.endsWith('/invite-links')) return { data: { links: [] } };
      return { data: { members, pending: [] } };
    });
  });

  const field = () => screen.getByRole('combobox', { name: 'usernamesLabel' });
  const chipTexts = () => within(screen.getByRole('list', { name: 'selectedPeople' }))
    .getAllByRole('listitem').map(li => li.textContent);

  it('goes to the add view and back through the breadcrumb', async () => {
    renderModal();
    await openAddView();
    expect(screen.getByRole('tab', { name: 'byUsername' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.queryByTestId('member-row-u1')).toBeNull();
    // ORACLE: the breadcrumb names the parent level — the KB, then the member list.
    const back = within(screen.getByRole('navigation', { name: 'breadcrumbNav' }))
      .getByRole('button', { name: 'backTo Test KB, members' });
    await userEvent.click(back);
    expect(await screen.findByTestId('member-row-u1')).toBeInTheDocument();
  });

  // ORACLE: the developer's rule (2026-10-13) — "Abbrechen" returns to the list,
  // it does not close the dialog; only the ✕ does.
  it('returns to the member list with Abbrechen, without closing the dialog', async () => {
    const onClose = vi.fn();
    render(<MembersModal show onClose={onClose} sharingKb={kb} myRole="owner" />);
    await openAddView();
    await userEvent.click(screen.getByRole('button', { name: 'cancel' }));
    expect(await screen.findByTestId('member-row-u1')).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
  });

  // ORACLE: the directory fixture above — which names have accounts, which is a
  // member — and the bulk endpoint's request shape (kbmembers bulk handler).
  it('resolves each name into a chip and adds only accounts and pending invites', async () => {
    vi.mocked(axios.post).mockResolvedValue({ data: { shared: ['carl'], pending: ['dora'], alreadyHadAccess: [] } });
    renderModal();
    await openAddView();

    await userEvent.type(field(), 'carl, dora, grace, max mustermann,');
    await waitFor(() => expect(chipTexts()).toEqual([
      'CZCarl Zeiss',
      expect.stringContaining('dora'),
      expect.stringContaining('Grace H'),
      expect.stringContaining('max mustermann'),
    ]));
    expect(chipTexts()[1]).toContain('chipPending');
    expect(chipTexts()[2]).toContain('alreadyMember');
    expect(chipTexts()[3]).toContain('chipInvalid');
    expect(screen.getByText('pendingChipsNotice')).toBeInTheDocument();
    expect(screen.getByText('skippedChipsNotice')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'addNPeople' }));
    await waitFor(() => expect(axios.post).toHaveBeenCalledWith(
      expect.stringContaining('/members/bulk'), { usernames: ['carl', 'dora'], role: 'view' }));
    expect(toastMock.success).toHaveBeenCalledWith('bulkInviteSummary');
    expect(await screen.findByRole('heading', { name: 'members' })).toBeInTheDocument();
  });

  it('suggests the exact username and adds it with Tab', async () => {
    renderModal();
    await openAddView();
    await userEvent.type(field(), 'carl');
    const option = await screen.findByRole('option', { name: /Carl Zeiss/ });
    expect(option).toHaveTextContent('tabToAdd');
    await userEvent.tab();
    await waitFor(() => expect(chipTexts()).toEqual(['CZCarl Zeiss']));
    expect(field()).toHaveValue('');
  });

  // ORACLE: the fixture's search fallback — "car" finds Carl only by substring,
  // so as a committed name it is not Carl's username.
  it('does not turn a committed partial name into whoever the search finds first', async () => {
    renderModal();
    await openAddView();
    await userEvent.type(field(), 'car,');
    await waitFor(() => expect(chipTexts()[0]).toContain('chipPending'));
    expect(chipTexts()[0]).toContain('car');
    expect(chipTexts()[0]).not.toContain('Carl Zeiss');
  });

  it('keeps one chip per person, however the name was entered', async () => {
    renderModal();
    await openAddView();
    // username, other case, and the user's id: one person.
    await userEvent.type(field(), 'carl, CARL, u9,');
    await waitFor(() => expect(chipTexts()).toEqual(['CZCarl Zeiss']));
    // ...and the suggestion row does not offer them again.
    await userEvent.type(field(), 'carl');
    await new Promise(r => setTimeout(r, 400));
    expect(screen.queryByRole('option')).toBeNull();
  });

  it('suggests by partial name and adds the chosen person with Tab', async () => {
    renderModal();
    await openAddView();
    await userEvent.type(field(), 'zei');
    // ORACLE: the fixture's search — "zei" matches only Carl's last name.
    const option = await screen.findByRole('option', { name: /Carl Zeiss/ });
    expect(option).toHaveTextContent('tabToAdd');
    await userEvent.tab();
    await waitFor(() => expect(chipTexts()).toEqual(['CZCarl Zeiss']));
    expect(field()).toHaveValue('');
  });

  it('removes a chip with its button', async () => {
    renderModal();
    await openAddView();
    await userEvent.type(field(), 'dora,');
    await waitFor(() => expect(chipTexts()[0]).toContain('chipPending'));
    await userEvent.click(screen.getByRole('button', { name: 'removeChip' }));
    expect(screen.queryByRole('list', { name: 'selectedPeople' })).toBeNull();
    expect(screen.getByRole('button', { name: 'addNPeople' })).toBeDisabled();
  });

  it('turns the names of an uploaded CSV into chips, without its header', async () => {
    renderModal();
    await openAddView();
    const csv = new File(['username\ncarl;bob\nkai\n'], 'people.csv', { type: 'text/csv' });
    await userEvent.upload(screen.getByLabelText('uploadCsv', { selector: 'input' }), csv);
    await waitFor(() => expect(chipTexts()).toHaveLength(3));
    expect(chipTexts()[0]).toContain('Carl Zeiss');
    expect(chipTexts()[1]).toContain('bob');
    expect(chipTexts()[2]).toContain('kai');
  });
});

describe('MembersModal — invite links', () => {
  async function openLinks() {
    await openAddView();
    await userEvent.click(screen.getByRole('tab', { name: 'inviteLinks' }));
  }
  const linkFetches = () => vi.mocked(axios.get).mock.calls.filter(([u]) => String(u).endsWith('/invite-links')).length;

  it('does not fetch invite links until the tab is opened', async () => {
    mockGets();
    renderModal();
    await openAddView();
    expect(linkFetches()).toBe(0);
    await userEvent.click(screen.getByRole('tab', { name: 'inviteLinks' }));
    await waitFor(() => expect(linkFetches()).toBe(1));
  });

  it('needs a title, then creates the link and lists it', async () => {
    mockGets();
    vi.mocked(axios.post).mockResolvedValue({ data: { ...aLink, role: 'view', label: 'Fall26', redemptionCount: 0, lastUsedAt: null } });
    renderModal();
    await openLinks();

    const create = screen.getByRole('button', { name: 'create' });
    expect(create).toBeDisabled();
    await userEvent.type(screen.getByLabelText(/inviteLinkTitle/), 'Fall26');
    await userEvent.click(create);
    await waitFor(() => expect(axios.post).toHaveBeenCalledWith(
      expect.stringContaining('/api/kb/kb-1/invite-links'), { role: 'view', label: 'Fall26' }));
    expect(await screen.findByText('Fall26')).toBeInTheDocument();
    expect(screen.getByText('inviteLinkNeverUsed')).toBeInTheDocument();
  });

  it('shows a link with its role and uses', async () => {
    mockGets({ links: [aLink] });
    renderModal();
    await openLinks();
    const row = (await screen.findByText('WS26')).closest('li')!;
    expect(within(row).getByText('editPermission')).toBeInTheDocument();
    expect(within(row).getByText('inviteLinkUsedTimes')).toBeInTheDocument();
  });

  it('revokes a link from its menu after confirmation, and not when declined', async () => {
    mockGets({ links: [aLink] });
    vi.mocked(axios.delete).mockResolvedValue({ data: {} });
    renderModal();
    await openLinks();
    const row = (await screen.findByText('WS26')).closest('li')!;

    showConfirm.mockResolvedValueOnce(false);
    let menu = await openMenu(row, 'inviteLinkActions');
    await userEvent.click(within(menu).getByRole('menuitem', { name: 'revokeInviteLink' }));
    expect(axios.delete).not.toHaveBeenCalled();

    showConfirm.mockResolvedValueOnce(true);
    menu = await openMenu(row, 'inviteLinkActions');
    await userEvent.click(within(menu).getByRole('menuitem', { name: 'revokeInviteLink' }));
    await waitFor(() => expect(axios.delete).toHaveBeenCalledWith(expect.stringContaining('/invite-links/l1')));
    await waitFor(() => expect(screen.queryByText('WS26')).toBeNull());
  });

  it('copies the link and toasts the outcome', async () => {
    mockGets({ links: [aLink] });
    renderModal();
    await openLinks();
    const copy = await screen.findByRole('button', { name: 'copy: WS26' });

    vi.mocked(copyToClipboard).mockResolvedValueOnce(true);
    await userEvent.click(copy);
    await waitFor(() => expect(copyToClipboard).toHaveBeenCalledWith(expect.stringContaining('/join/TOKEN123')));
    expect(toastMock.success).toHaveBeenCalledWith('inviteLinkCopied');

    vi.mocked(copyToClipboard).mockResolvedValueOnce(false);
    await userEvent.click(copy);
    await waitFor(() => expect(toastMock.error).toHaveBeenCalledWith('clipboardCopyFailed'));
  });

  it('returns to the member list with Done, without closing the dialog', async () => {
    mockGets();
    const onClose = vi.fn();
    render(<MembersModal show onClose={onClose} sharingKb={kb} myRole="owner" />);
    await openLinks();
    await userEvent.click(screen.getByRole('button', { name: 'done' }));
    expect(await screen.findByTestId('member-row-u1')).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
  });
});

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useState } from 'react';
import { render, screen, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import axios from 'axios';
import { SharingPanel } from './SharingPanel';
import { glossarySharingConfig } from '../translator/glossarySharingConfig';
import { copyToClipboard } from '../../utils/clipboard';

vi.mock('../../utils/clipboard', () => ({ copyToClipboard: vi.fn() }));
vi.mock('axios');
vi.mock('../../api', () => ({ API_BASE_URL: '' }));
vi.mock('../../hooks/useReducedMotion', () => ({ useReducedMotion: () => false, getMotionProps: () => ({}) }));

// Stable singletons, as the real context hooks return (see KbMembersPanel.test.tsx).
// Keys echo back, except the two texts whose placeholders the tests read.
const TEXTS: Record<string, string> = {
  bulkInviteSummary: '{shared} shared, {pending} pending, {already} already',
  glossaryMakeOwnerMessage: 'owner:{username}',
};
const themeMock = { t: (k: string) => TEXTS[k] ?? k, language: 'en' as const };
const authMock = { token: 'tok' };
const showConfirm = vi.fn();
const modalMock = { showConfirm };
const toastMock = { success: vi.fn(), error: vi.fn(), warning: vi.fn() };
vi.mock('../../contexts/ThemeContext', () => ({ useTheme: () => themeMock }));
vi.mock('../../contexts/AuthContext', () => ({ useAuth: () => authMock }));
vi.mock('../../contexts/ModalContext', () => ({ useModalContext: () => modalMock }));
vi.mock('../../contexts/ToastContext', () => ({ useToast: () => toastMock }));

/*
 * The sharing panel as a glossary uses it. ORACLE: API.md "Translator and glossaries" (the member,
 * bulk, pending, invite-link, transfer routes under /api/glossaries/{id}) and
 * docs/glossary-access.md (roles viewer/editor/admin, one owner, the bulk answer `shared`,
 * `pending`, `alreadyHadAccess`, an invite link opens /join-glossary/<token>).
 */
const config = glossarySharingConfig('g-1');

const members = [
  { userId: 'u1', username: 'ada', firstName: 'Ada', lastName: 'L', role: 'owner' },
  { userId: 'u2', username: 'grace', firstName: 'Grace', lastName: 'H', role: 'admin' },
  { userId: 'u3', username: 'alan', firstName: 'Alan', lastName: 'T', role: 'viewer' },
];
const pending = [{ username: 'bob', role: 'editor', createdAt: '2026-01-01T00:00:00Z' }];
const link = {
  id: 'l1', glossaryId: 'g-1', token: 'TOKEN123', role: 'editor', label: 'Kurs', createdByName: 'ada',
  createdAt: '2026-08-18T10:00:00Z', redemptionCount: 2, lastUsedAt: null,
};

// GET /api/users/{term}: carl has an account, alan is a member already (u3), dora has none.
const directory: Record<string, { id: string; username: string; firstName: string; lastName: string }> = {
  carl: { id: 'u9', username: 'carl', firstName: 'Carl', lastName: 'Zeiss' },
  alan: { id: 'u3', username: 'alan', firstName: 'Alan', lastName: 'T' },
};

function mockGets(links: unknown[] = []) {
  vi.mocked(axios.get).mockImplementation(async (url: string) => {
    const user = /\/api\/users\/([^/?]+)$/.exec(url);
    if (user) {
      const hit = directory[decodeURIComponent(user[1]).toLowerCase()];
      if (hit) return { data: hit };
      throw Object.assign(new Error('404'), { isAxiosError: true, response: { status: 404 } });
    }
    if (url.endsWith('/invite-links')) return { data: { links } };
    return { data: { members, pending } };
  });
}

function Harness({ myRole = 'owner', onOwnerChanged }: { myRole?: string; onOwnerChanged?: () => void }) {
  const [view, setView] = useState<'members' | 'add'>('members');
  return <SharingPanel config={config} myRole={myRole} view={view} onViewChange={setView} onOwnerChanged={onOwnerChanged} />;
}

beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn();
  Element.prototype.hasPointerCapture = vi.fn(() => false);
  Element.prototype.setPointerCapture = vi.fn();
  Element.prototype.releasePointerCapture = vi.fn();
  for (const method of ['get', 'post', 'put', 'delete'] as const) vi.mocked(axios[method]).mockReset();
  vi.mocked(axios.isAxiosError).mockImplementation((e: unknown) => !!(e as { isAxiosError?: boolean })?.isAxiosError);
  vi.mocked(copyToClipboard).mockReset();
  showConfirm.mockReset();
  for (const fn of Object.values(toastMock)) fn.mockReset();
});

async function openRoleSelect(row: HTMLElement) {
  within(row).getByRole('combobox').focus();
  await userEvent.keyboard('{Enter}');
  return screen.findByRole('listbox');
}

describe('SharingPanel — a glossary’s people', () => {
  it('reads the members and pending invites from the glossary’s own routes', async () => {
    mockGets();
    render(<Harness />);
    expect(await screen.findByTestId('member-row-u3')).toBeInTheDocument();
    expect(vi.mocked(axios.get)).toHaveBeenCalledWith('/api/glossaries/g-1/members');
    expect(screen.getByTestId('pending-row-bob')).toBeInTheDocument();
    // The glossary’s own texts, not the topic’s.
    expect(screen.getByText('glossaryMembersIntro')).toBeInTheDocument();
  });

  it('offers viewer, editor and admin, never owner, and saves a role change at once', async () => {
    mockGets();
    vi.mocked(axios.put).mockResolvedValue({ status: 204 });
    render(<Harness />);
    const row = await screen.findByTestId('member-row-u3');
    const listbox = await openRoleSelect(row);
    expect(within(listbox).getAllByRole('option').map(o => o.textContent))
      .toEqual(['viewPermission', 'editPermission', 'adminPermission']);
    await userEvent.click(within(listbox).getByRole('option', { name: 'editPermission' }));
    await waitFor(() => expect(axios.put).toHaveBeenCalledWith('/api/glossaries/g-1/members/u3', { role: 'editor' }));
    expect(within(row).getByRole('combobox')).toHaveTextContent('editPermission');
  });

  it('puts a role back when saving it fails', async () => {
    mockGets();
    vi.mocked(axios.put).mockRejectedValue(new Error('boom'));
    render(<Harness />);
    const row = await screen.findByTestId('member-row-u3');
    const listbox = await openRoleSelect(row);
    await userEvent.click(within(listbox).getByRole('option', { name: 'adminPermission' }));
    await waitFor(() => expect(toastMock.error).toHaveBeenCalledWith('roleChangeError'));
    expect(within(row).getByRole('combobox')).toHaveTextContent('viewPermission');
  });

  it('transfers the ownership to a member for the owner only', async () => {
    mockGets();
    vi.mocked(axios.post).mockResolvedValue({ status: 204 });
    showConfirm.mockResolvedValue(true);
    const owner = render(<Harness />);
    // Any member can take it over (the target only has to be a member), also a viewer.
    await userEvent.click(within(await screen.findByTestId('member-row-u3')).getByRole('button', { name: 'memberActions' }));
    await userEvent.click(await screen.findByRole('menuitem', { name: 'makeOwner' }));
    await waitFor(() => expect(axios.post).toHaveBeenCalledWith('/api/glossaries/g-1/transfer-owner', { userId: 'u3' }));
    expect(showConfirm.mock.calls[0][0]).toBe('owner:alan');
    owner.unmount();

    // An admin has the member list but no ownership to hand over.
    render(<Harness myRole="admin" />);
    await userEvent.click(within(await screen.findByTestId('member-row-u3')).getByRole('button', { name: 'memberActions' }));
    const menu = await screen.findByRole('menu');
    expect(within(menu).queryByRole('menuitem', { name: 'makeOwner' })).toBeNull();
    expect(within(menu).getByRole('menuitem', { name: 'glossaryRemoveShare' })).toBeInTheDocument();
  });

  it('tells the window that the ownership moved, so it reads its own record again', async () => {
    mockGets();
    vi.mocked(axios.post).mockResolvedValue({ status: 204 });
    showConfirm.mockResolvedValue(true);
    const onOwnerChanged = vi.fn();
    render(<Harness onOwnerChanged={onOwnerChanged} />);
    await userEvent.click(within(await screen.findByTestId('member-row-u3')).getByRole('button', { name: 'memberActions' }));
    await userEvent.click(await screen.findByRole('menuitem', { name: 'makeOwner' }));
    await waitFor(() => expect(onOwnerChanged).toHaveBeenCalledTimes(1));

    // A refused transfer changes nothing.
    onOwnerChanged.mockClear();
    vi.mocked(axios.post).mockRejectedValue(new Error('403'));
    await userEvent.click(within(await screen.findByTestId('member-row-u3')).getByRole('button', { name: 'memberActions' }));
    await userEvent.click(await screen.findByRole('menuitem', { name: 'makeOwner' }));
    await waitFor(() => expect(toastMock.error).toHaveBeenCalledWith('roleChangeError'));
    expect(onOwnerChanged).not.toHaveBeenCalled();
  });

  it('removes a member and withdraws a pending invite', async () => {
    mockGets();
    vi.mocked(axios.delete).mockResolvedValue({ status: 204 });
    showConfirm.mockResolvedValue(true);
    render(<Harness />);
    await userEvent.click(within(await screen.findByTestId('member-row-u3')).getByRole('button', { name: 'memberActions' }));
    await userEvent.click(await screen.findByRole('menuitem', { name: 'glossaryRemoveShare' }));
    await waitFor(() => expect(axios.delete).toHaveBeenCalledWith('/api/glossaries/g-1/members/u3'));
    await waitFor(() => expect(screen.queryByTestId('member-row-u3')).toBeNull());

    await userEvent.click(within(screen.getByTestId('pending-row-bob')).getByRole('button', { name: 'revokeInvite' }));
    expect(axios.delete).toHaveBeenCalledWith('/api/glossaries/g-1/members/pending/bob');
    await waitFor(() => expect(screen.queryByTestId('pending-row-bob')).toBeNull());
  });

  it('adds several names at once and reports shared, pending and already-had-access', async () => {
    mockGets();
    vi.mocked(axios.post).mockResolvedValue({
      data: { shared: ['carl'], pending: ['dora'], alreadyHadAccess: ['alan'] },
    });
    render(<Harness />);
    await userEvent.click(await screen.findByRole('button', { name: 'addMembers' }));
    await userEvent.type(screen.getByRole('combobox', { name: 'usernamesLabel' }), 'carl, dora, alan,');
    // carl has an account, dora gets a pending invite, alan is a member already and is left out.
    await waitFor(() => expect(screen.getByRole('button', { name: 'addNPeople' })).not.toBeDisabled());
    const chips = within(screen.getByRole('list', { name: 'selectedPeople' })).getAllByRole('listitem').map(li => li.textContent);
    expect(chips[1]).toContain('chipPending');
    expect(chips[2]).toContain('alreadyMember');

    await userEvent.click(screen.getByRole('button', { name: 'addNPeople' }));
    await waitFor(() => expect(axios.post).toHaveBeenCalledWith('/api/glossaries/g-1/members/bulk', {
      usernames: ['carl', 'dora'],
      role: 'viewer',
    }));
    // The toast carries the three counts the answer reports.
    expect(toastMock.success).toHaveBeenCalledWith('1 shared, 1 pending, 1 already');
    // Back on the member list.
    expect(await screen.findByRole('button', { name: 'addMembers' })).toBeInTheDocument();
  });

  it('creates, lists, copies and revokes an invite link that opens /join-glossary/<token>', async () => {
    mockGets([link]);
    vi.mocked(axios.post).mockResolvedValue({ data: { ...link, id: 'l2', token: 'NEWTOKEN', label: 'Neu', redemptionCount: 0 } });
    vi.mocked(axios.delete).mockResolvedValue({ status: 204 });
    vi.mocked(copyToClipboard).mockResolvedValue(true);
    showConfirm.mockResolvedValue(true);
    render(<Harness />);
    await userEvent.click(await screen.findByRole('button', { name: 'addMembers' }));
    await userEvent.click(await screen.findByRole('tab', { name: /inviteLinks/ }));
    expect(await screen.findByText('Kurs')).toBeInTheDocument();

    await userEvent.type(screen.getByLabelText(/inviteLinkTitle/), 'Neu');
    await userEvent.click(screen.getByRole('button', { name: /create/ }));
    await waitFor(() => expect(axios.post).toHaveBeenCalledWith('/api/glossaries/g-1/invite-links', { role: 'viewer', label: 'Neu' }));

    await userEvent.click(screen.getByRole('button', { name: 'copy: Kurs' }));
    expect(copyToClipboard).toHaveBeenCalledWith(`${window.location.origin}/join-glossary/TOKEN123`);

    await userEvent.click(within(screen.getByText('Kurs').closest('li') as HTMLElement).getByRole('button', { name: /inviteLinkActions/ }));
    await userEvent.click(await screen.findByRole('menuitem', { name: 'revokeInviteLink' }));
    await waitFor(() => expect(axios.delete).toHaveBeenCalledWith('/api/glossaries/g-1/invite-links/l1'));
  });
});

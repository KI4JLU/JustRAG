import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn, screen, userEvent, waitFor, within } from 'storybook/test';
import { useState } from 'react';
import { AuthProvider } from '../../contexts/AuthContext';
import { ModalProvider } from '../../contexts/ModalContext';
import { apiMockHistory } from '../../../.storybook/mockApi';
import { GlossaryDialog } from './GlossaryDialog';
import type { Glossary, GlossaryList, GlossaryRole } from './types';

/* ---------------------------------------------------------------------------
 * „Glossare verwalten": what each row offers follows the flags the list returns (`canEdit`,
 * `canManage`, `canDelete`), set here by hand as the server sets them for each role. ORACLE:
 * docs/glossary-access.md (viewer reads; editor changes entries; admin shares; owner deletes;
 * everyone but the owner can leave) and the German strings of src/i18n/translations.ts.
 * ------------------------------------------------------------------------- */

function glossary(id: string, name: string, role: GlossaryRole, extra: Partial<Glossary> = {}): Glossary {
  const rank = { viewer: 0, editor: 1, admin: 2, owner: 3 }[role];
  return {
    id,
    name,
    description: '',
    category: 'general',
    visibility: 'private',
    entryCount: 12,
    creatorName: 'Ada Lovelace',
    role,
    canEdit: rank >= 1,
    isMember: true,
    canManage: rank >= 2,
    canDelete: rank >= 3,
    createdAt: '2026-01-05T09:00:00Z',
    updatedAt: '2026-01-06T09:00:00Z',
    ...extra,
  };
}

const LIST: GlossaryList = {
  languages: ['de', 'en', 'uk', 'fr', 'es', 'it'],
  glossaries: [
    glossary('g-v', 'Wörterbuch (Leser)', 'viewer', { visibility: 'global', isMember: false }),
    glossary('g-e', 'Studiengänge (Bearbeiter)', 'editor'),
    glossary('g-a', 'Gremien (Admin)', 'admin'),
    glossary('g-o', 'Hochschulbegriffe (Besitzer)', 'owner', { entryCount: 1 }),
  ],
};

const meta = {
  title: 'Translator/GlossaryDialog',
  component: GlossaryDialog,
  parameters: { layout: 'fullscreen' },
  beforeEach: () => {
    localStorage.setItem('language', 'de');
  },
  decorators: [
    (Story) => (
      <ModalProvider>
        <Story />
      </ModalProvider>
    ),
  ],
  args: { open: true, onOpenChange: fn(), list: LIST, onChanged: fn() },
} satisfies Meta<typeof GlossaryDialog>;

export default meta;
type Story = StoryObj<typeof meta>;

const rowOf = (name: string) => within(screen.getByText(name).closest('[data-testid^="glossary-row-"]') as HTMLElement);

/** Each role sees exactly what its flags allow in its own row. */
export const RoleDependentActions: Story = {
  play: async () => {
    await screen.findByRole('dialog', { name: 'Glossare verwalten' });

    const viewer = rowOf('Wörterbuch (Leser)');
    await expect(viewer.getByRole('button', { name: /ansehen/ })).toBeInTheDocument();
    await expect(viewer.queryByRole('button', { name: /bearbeiten/ })).toBeNull();
    await expect(viewer.queryByRole('button', { name: /Freigabe/ })).toBeNull();
    await expect(viewer.queryByRole('button', { name: /löschen/ })).toBeNull();
    // A global glossary's viewer is not a member, so there is nothing to leave.
    await expect(viewer.queryByRole('button', { name: /verlassen/ })).toBeNull();

    const editor = rowOf('Studiengänge (Bearbeiter)');
    await expect(editor.getByRole('button', { name: /bearbeiten/ })).toBeInTheDocument();
    await expect(editor.getByRole('button', { name: /verlassen/ })).toBeInTheDocument();
    await expect(editor.queryByRole('button', { name: /Freigabe/ })).toBeNull();

    const admin = rowOf('Gremien (Admin)');
    await expect(admin.getByRole('button', { name: /Freigabe/ })).toBeInTheDocument();
    await expect(admin.queryByRole('button', { name: /löschen/ })).toBeNull();

    const owner = rowOf('Hochschulbegriffe (Besitzer)');
    await expect(owner.getByRole('button', { name: /löschen/ })).toBeInTheDocument();
    await expect(owner.queryByRole('button', { name: /verlassen/ })).toBeNull();
  },
};

/** „Neues Glossar": a name and at least one pair of terms are required. */
export const NewGlossary: Story = {
  play: async () => {
    await userEvent.click(await screen.findByRole('button', { name: 'Neues Glossar' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Glossar anlegen' }));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Gib dem Glossar einen Namen.'));
  },
};

/** The list is still loading: there is nothing to make before the languages of a term are known. */
export const Loading: Story = {
  args: { list: undefined },
  play: async () => {
    await expect(await screen.findByRole('status')).toBeInTheDocument();
    await expect(screen.getByRole('button', { name: 'Neues Glossar' })).toBeDisabled();
    await expect(screen.getByRole('button', { name: 'CSV importieren' })).toBeDisabled();
  },
};

/** The list could not be read: the failure is said, with a retry, instead of loading for ever. */
export const LoadFailed: Story = {
  args: { list: undefined, failed: true, onRetry: fn() },
  play: async ({ args }) => {
    await expect(await screen.findByText('Die Glossare konnten nicht geladen werden.')).toBeInTheDocument();
    await expect(screen.queryByRole('status')).toBeNull();
    await expect(screen.getByRole('button', { name: 'Neues Glossar' })).toBeDisabled();
    await expect(screen.getByRole('button', { name: 'CSV importieren' })).toBeDisabled();
    await userEvent.click(screen.getByRole('button', { name: 'Erneut versuchen' }));
    await expect(args.onRetry).toHaveBeenCalledTimes(1);
  },
};

const MEMBERS = {
  members: [
    { userId: 'u-1', username: 'ada', firstName: 'Ada', lastName: 'Lovelace', role: 'owner' },
    { userId: 'u-3', username: 'alan', firstName: 'Alan', lastName: 'Turing', role: 'viewer' },
  ],
  pending: [],
};

/** The list after the ownership of „Hochschulbegriffe" moved to somebody else: the caller is an admin now. */
const AFTER_TRANSFER: GlossaryList = {
  ...LIST,
  glossaries: LIST.glossaries.map((g) => (g.id === 'g-o' ? glossary('g-o', g.name, 'admin', { entryCount: 1 }) : g)),
};

function TransferHarness() {
  const [list, setList] = useState(LIST);
  return (
    <AuthProvider user={{ id: 'u-1', username: 'ada', role: 'user' }} token="story-token" logout={fn()} siteConfigs={{}}>
      <GlossaryDialog open onOpenChange={fn()} list={list} onChanged={() => setList(AFTER_TRANSFER)} />
    </AuthProvider>
  );
}

/**
 * After „Zum Besitzer machen" the sharing view shows the glossary as the list now has it: the
 * caller is an admin, so no second transfer is offered (the server would answer 403).
 */
export const SharingFollowsOwnershipTransfer: Story = {
  parameters: { api: { glossaryMembers: MEMBERS, glossaryWrites: true } },
  render: () => <TransferHarness />,
  play: async () => {
    await userEvent.click(await within(await screen.findByTestId('glossary-row-g-o')).findByRole('button', { name: /Freigabe/ }));
    await userEvent.click(await screen.findByRole('button', { name: 'Aktionen für alan' }));
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Zum Besitzer machen' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Übertragen' }));
    // The transfer went through and the list was read again.
    await waitFor(() =>
      expect(apiMockHistory()?.post.some((request) => request.url?.endsWith('/api/glossaries/g-o/transfer-owner'))).toBe(true),
    );

    await userEvent.click(await screen.findByRole('button', { name: 'Aktionen für alan' }));
    const menu = await screen.findByRole('menu');
    await expect(within(menu).queryByRole('menuitem', { name: 'Zum Besitzer machen' })).toBeNull();
    await expect(within(menu).getByRole('menuitem', { name: 'Aus Glossar entfernen' })).toBeInTheDocument();
  },
};

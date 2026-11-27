import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn, screen, userEvent } from 'storybook/test';
import { JoinGlossaryDialog } from './JoinGlossaryDialog';
import type { GlossaryInvitePreview } from '../translator/types';

/* ---------------------------------------------------------------------------
 * What a glossary invite link means for the person who opened it (/join-glossary/<token>), one
 * story per `status` of GET /api/glossary-invites/{token}. The expected strings are the German
 * ones of src/i18n/translations.ts; the rule is the contract's: only an accepted dialog joins.
 * ------------------------------------------------------------------------- */

const INVITE: GlossaryInvitePreview = {
  status: 'invite', glossaryId: 'g-9', glossaryName: 'Hochschulbegriffe', description: 'Fachwörter aus Studium und Lehre',
  linkRole: 'editor', role: '',
};

const meta = {
  title: 'Shell/JoinGlossaryDialog',
  component: JoinGlossaryDialog,
  parameters: { layout: 'fullscreen' },
  beforeEach: () => { localStorage.setItem('language', 'de'); },
  args: { invite: INVITE, busy: false, onAccept: fn(), onClose: fn(), onOpen: fn() },
} satisfies Meta<typeof JoinGlossaryDialog>;

export default meta;
type Story = StoryObj<typeof meta>;

/** An invitation: the role the link grants and what it lets the person do; only „Beitreten" joins. */
export const Invitation: Story = {
  play: async ({ args }) => {
    const dialog = await screen.findByRole('dialog', { name: 'Hochschulbegriffe' });
    await expect(dialog).toHaveTextContent('Fachwörter aus Studium und Lehre');
    await expect(dialog).toHaveTextContent('Du trittst als Bearbeiter bei');
    await userEvent.click(screen.getByRole('button', { name: 'Ablehnen' }));
    await expect(args.onClose).toHaveBeenCalled();
    await expect(args.onAccept).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: 'Beitreten' }));
    await expect(args.onAccept).toHaveBeenCalledTimes(1);
  },
};

/** Already a member: the link changes nothing, the dialog offers the translator. */
export const AlreadyMember: Story = {
  args: { invite: { ...INVITE, status: 'member', role: 'viewer' } },
  play: async ({ args }) => {
    await screen.findByRole('dialog', { name: 'Hochschulbegriffe' });
    await expect(screen.queryByRole('button', { name: 'Beitreten' })).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Zur Übersetzung' }));
    await expect(args.onOpen).toHaveBeenCalled();
  },
};

/** The link was revoked: it joins nothing. A stranger learns the name and nothing else. */
export const Revoked: Story = {
  args: { invite: { status: 'revoked', glossaryName: 'Hochschulbegriffe', role: '' } },
  play: async () => {
    const dialog = await screen.findByRole('dialog', { name: 'Hochschulbegriffe' });
    await expect(dialog).toHaveTextContent('Link zurückgezogen');
    await expect(screen.queryByRole('button', { name: 'Beitreten' })).toBeNull();
  },
};

/** The request is on its way: neither choice can be made twice. */
export const Joining: Story = {
  args: { busy: true },
  play: async () => {
    await screen.findByRole('dialog', { name: 'Hochschulbegriffe' });
    await expect(screen.getByRole('button', { name: 'Beitreten' })).toBeDisabled();
  },
};

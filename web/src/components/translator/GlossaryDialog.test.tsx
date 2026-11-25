import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useState } from 'react';
import { render, screen, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import axios from 'axios';
import { GlossaryDialog } from './GlossaryDialog';
import { GlossaryForm } from './GlossaryForm';
import { GlossaryImportForm } from './GlossaryImportForm';
import type { Glossary, GlossaryDetail, GlossaryList, GlossaryRole } from './types';

vi.mock('axios');
vi.mock('../../api', () => ({ API_BASE_URL: '' }));
vi.mock('../../hooks/useReducedMotion', () => ({ useReducedMotion: () => false, getMotionProps: () => ({}) }));
const TEXTS: Record<string, string> = {
  translatorGlossaryEditOne: 'edit {name}',
  translatorGlossaryViewOne: 'view {name}',
  translatorGlossaryShareOne: 'share {name}',
  translatorGlossaryDeleteOne: 'delete {name}',
  translatorGlossaryLeaveOne: 'leave {name}',
  translatorGlossarySharingTitle: 'sharing {name}',
};
const themeMock = { t: (k: string) => TEXTS[k] ?? k, language: 'en' as const };
vi.mock('../../contexts/ThemeContext', () => ({ useTheme: () => themeMock }));
vi.mock('../../contexts/AuthContext', () => ({ useAuth: () => ({ token: 'tok' }) }));
const toastMock = { success: vi.fn(), error: vi.fn(), warning: vi.fn() };
vi.mock('../../contexts/ToastContext', () => ({ useToast: () => toastMock }));
const showConfirm = vi.fn();
const modalMock = { showConfirm };
vi.mock('../../contexts/ModalContext', () => ({ useModalContext: () => modalMock }));

/*
 * Role-dependent UI of the glossary list. ORACLE: docs/glossary-access.md and the flags
 * GET /api/glossaries returns (`role`, `canEdit` = editor or better, `canManage` = admin or
 * better, `canDelete` = owner): the dialog reads the flags and does not derive the ladder, so the
 * fixtures set the flags by hand, as the server would for each role.
 */
function glossary(id: string, name: string, role: GlossaryRole, extra: Partial<Glossary> = {}): Glossary {
  const rank = { viewer: 0, editor: 1, admin: 2, owner: 3 }[role];
  return {
    id,
    name,
    description: '',
    category: 'general',
    visibility: 'private',
    entryCount: 3,
    creatorName: 'Ada L',
    role,
    canEdit: rank >= 1,
    isMember: true,
    canManage: rank >= 2,
    canDelete: rank >= 3,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-02T00:00:00Z',
    ...extra,
  };
}

const list: GlossaryList = {
  languages: ['de', 'en', 'uk', 'fr', 'es', 'it'],
  glossaries: [
    // A global glossary the caller was never added to: a viewer without a membership row.
    glossary('g-v', 'Viewer-Glossar', 'viewer', { visibility: 'global', isMember: false }),
    glossary('g-e', 'Editor-Glossar', 'editor'),
    glossary('g-a', 'Admin-Glossar', 'admin'),
    glossary('g-o', 'Owner-Glossar', 'owner'),
    // A viewer who was added: a membership row stands behind the role.
    glossary('g-m', 'Mitglied-Glossar', 'viewer'),
  ],
};

const detail = (g: Glossary): GlossaryDetail => ({
  ...g,
  entries: [{ sourceLanguage: 'de', sourceTerm: 'Hochschule', targetLanguage: 'en', targetTerm: 'university' }],
});

function renderDialog(overrides: Partial<GlossaryList> = {}) {
  const onChanged = vi.fn();
  render(<GlossaryDialog open onOpenChange={() => {}} list={{ ...list, ...overrides }} onChanged={onChanged} />);
  return { onChanged };
}

const row = (id: string) => screen.getByTestId(`glossary-row-${id}`);

beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn();
  Element.prototype.hasPointerCapture = vi.fn(() => false);
  Element.prototype.setPointerCapture = vi.fn();
  Element.prototype.releasePointerCapture = vi.fn();
  for (const method of ['get', 'post', 'put', 'patch', 'delete'] as const) vi.mocked(axios[method]).mockReset();
  vi.mocked(axios.isAxiosError).mockImplementation((e: unknown) => !!(e as { isAxiosError?: boolean })?.isAxiosError);
  showConfirm.mockReset();
  for (const fn of Object.values(toastMock)) fn.mockReset();
});

describe('GlossaryDialog — the list', () => {
  it('shows each glossary with its owner, its size and the caller’s role', () => {
    renderDialog();
    const r = within(row('g-e'));
    expect(r.getByText('Editor-Glossar')).toBeInTheDocument();
    expect(r.getByText('kbRoleEdit')).toBeInTheDocument();
    expect(r.getByText(/translatorGlossaryTerms.*translatorGlossaryOwnerName/)).toBeInTheDocument();
    expect(within(row('g-v')).getByRole('img', { name: 'translatorGlossaryVisibility_global' })).toBeInTheDocument();
    expect(within(row('g-e')).getByRole('img', { name: 'translatorGlossaryVisibility_private' })).toBeInTheDocument();
  });

  it('offers a viewer to read, never to edit, share or delete', () => {
    renderDialog();
    const r = within(row('g-v'));
    expect(r.getByRole('button', { name: 'view Viewer-Glossar' })).toBeInTheDocument();
    expect(r.queryByRole('button', { name: /^edit / })).toBeNull();
    expect(r.queryByRole('button', { name: /^share / })).toBeNull();
    expect(r.queryByRole('button', { name: /^delete / })).toBeNull();
    // Seeing a global glossary is no membership: there is nothing to leave.
    expect(r.queryByRole('button', { name: /^leave / })).toBeNull();
  });

  it('offers a member who is only a viewer to leave', () => {
    renderDialog();
    expect(within(row('g-m')).getByRole('button', { name: 'leave Mitglied-Glossar' })).toBeInTheDocument();
  });

  it('offers an editor to edit but not to share or delete', () => {
    renderDialog();
    const r = within(row('g-e'));
    expect(r.getByRole('button', { name: 'edit Editor-Glossar' })).toBeInTheDocument();
    expect(r.queryByRole('button', { name: /^share / })).toBeNull();
    expect(r.queryByRole('button', { name: /^delete / })).toBeNull();
  });

  it('offers an admin to share, still not to delete', () => {
    renderDialog();
    const r = within(row('g-a'));
    expect(r.getByRole('button', { name: 'share Admin-Glossar' })).toBeInTheDocument();
    expect(r.queryByRole('button', { name: /^delete / })).toBeNull();
    expect(r.getByRole('button', { name: 'leave Admin-Glossar' })).toBeInTheDocument();
  });

  it('offers the owner everything, and no leaving', () => {
    renderDialog();
    const r = within(row('g-o'));
    for (const name of ['edit Owner-Glossar', 'share Owner-Glossar', 'delete Owner-Glossar']) {
      expect(r.getByRole('button', { name })).toBeInTheDocument();
    }
    expect(r.queryByRole('button', { name: /^leave / })).toBeNull();
  });

  it('follows the flags the list returns, not the role name', () => {
    // A server that says an editor may manage: the dialog shows share, whatever the role says.
    renderDialog({ glossaries: [glossary('g-x', 'Sonderfall', 'editor', { canManage: true })] });
    expect(within(row('g-x')).getByRole('button', { name: 'share Sonderfall' })).toBeInTheDocument();
  });

  it('says so when there is no glossary and while the list loads', () => {
    renderDialog({ glossaries: [] });
    expect(screen.getByText('translatorGlossariesEmpty')).toBeInTheDocument();
  });
});

describe('GlossaryDialog — before the list is read', () => {
  it('offers nothing to make while the list loads, and a spinner', () => {
    render(<GlossaryDialog open onOpenChange={() => {}} list={undefined} onChanged={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'translatorGlossaryNew' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'translatorGlossaryImport' })).toBeDisabled();
    expect(screen.getByRole('status')).toBeInTheDocument();
  });

  it('shows a failure with a retry instead of loading for ever, and offers the buttons once it worked', async () => {
    const onRetry = vi.fn();
    const view = render(<GlossaryDialog open onOpenChange={() => {}} list={undefined} failed onChanged={vi.fn()} onRetry={onRetry} />);
    expect(screen.getByText('translatorGlossariesLoadFailed')).toBeInTheDocument();
    expect(screen.queryByRole('status')).toBeNull();
    expect(screen.getByRole('button', { name: 'translatorGlossaryNew' })).toBeDisabled();
    await userEvent.click(screen.getByRole('button', { name: 'translatorGlossariesRetry' }));
    expect(onRetry).toHaveBeenCalledTimes(1);

    view.rerender(<GlossaryDialog open onOpenChange={() => {}} list={list} failed={false} onChanged={vi.fn()} onRetry={onRetry} />);
    expect(screen.queryByText('translatorGlossariesLoadFailed')).toBeNull();
    expect(screen.getByRole('button', { name: 'translatorGlossaryNew' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'translatorGlossaryImport' })).toBeEnabled();
  });

  it('keeps the list it has when a later read fails', () => {
    render(<GlossaryDialog open onOpenChange={() => {}} list={list} failed onChanged={vi.fn()} />);
    expect(screen.queryByText('translatorGlossariesLoadFailed')).toBeNull();
    expect(screen.getByTestId('glossary-row-g-o')).toBeInTheDocument();
  });

  it('does not offer to make a glossary when the list names no language', () => {
    render(<GlossaryDialog open onOpenChange={() => {}} list={{ glossaries: [], languages: [] }} onChanged={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'translatorGlossaryNew' })).toBeDisabled();
  });

  it('gives a new form the languages once they are known, not only the ones it started with', async () => {
    vi.mocked(axios.post).mockResolvedValue({ data: {} });
    const view = render(<GlossaryForm glossary={null} languages={[]} onDone={() => {}} onSaved={() => {}} />);
    view.rerender(<GlossaryForm glossary={null} languages={['de', 'en', 'uk']} onDone={() => {}} onSaved={() => {}} />);
    expect(screen.getByRole('combobox', { name: /translatorGlossarySourceLanguageOf/ })).toHaveTextContent('DE');
    expect(screen.getByRole('combobox', { name: /translatorGlossaryTargetLanguageOf/ })).toHaveTextContent('EN');
    await userEvent.type(screen.getByLabelText('translatorGlossaryNameLabel'), 'Neu');
    await userEvent.type(screen.getByLabelText(/translatorGlossarySourceTermOf/), 'Hochschule');
    await userEvent.type(screen.getByLabelText(/translatorGlossaryTargetTermOf/), 'university');
    await userEvent.click(screen.getByRole('button', { name: 'translatorGlossaryCreate' }));
    await waitFor(() => expect(axios.post).toHaveBeenCalled());
    expect(vi.mocked(axios.post).mock.calls[0]![1]).toMatchObject({
      entries: [{ sourceLanguage: 'de', targetLanguage: 'en' }],
    });
  });

  it('gives the import form the languages once they are known', async () => {
    vi.mocked(axios.post).mockResolvedValue({ data: {} });
    const view = render(<GlossaryImportForm languages={[]} onDone={() => {}} onSaved={() => {}} />);
    view.rerender(<GlossaryImportForm languages={['uk', 'en', 'fr']} onDone={() => {}} onSaved={() => {}} />);
    // German is not on offer: the first language stands in for it, English is.
    expect(screen.getByRole('combobox', { name: 'translatorGlossarySourceLanguage' })).toHaveTextContent('translatorGlossaryLanguage_uk');
    expect(screen.getByRole('combobox', { name: 'translatorGlossaryTargetLanguage' })).toHaveTextContent('translatorGlossaryLanguage_en');
    await userEvent.upload(
      document.querySelector('input[type="file"]') as HTMLInputElement,
      new File(['a;b\n'], 'terms.csv', { type: 'text/csv' }),
    );
    await userEvent.click(screen.getByRole('button', { name: 'translatorGlossaryImportSubmit' }));
    await waitFor(() => expect(axios.post).toHaveBeenCalled());
    const form = vi.mocked(axios.post).mock.calls[0]![1] as FormData;
    expect(form.get('sourceLanguage')).toBe('uk');
    expect(form.get('targetLanguage')).toBe('en');
  });
});

describe('GlossaryDialog — the sharing view follows the list', () => {
  const members = [
    { userId: 'u1', username: 'ada', firstName: 'Ada', lastName: 'L', role: 'owner' },
    { userId: 'u3', username: 'alan', firstName: 'Alan', lastName: 'T', role: 'viewer' },
  ];

  /** A dialog whose list is replaced by `after` when it is told to read it again. */
  function Harness({ after }: { after: GlossaryList }) {
    const [current, setCurrent] = useState(list);
    return <GlossaryDialog open onOpenChange={() => {}} list={current} onChanged={() => setCurrent(after)} />;
  }

  it('stops offering the ownership once it was handed over', async () => {
    vi.mocked(axios.get).mockResolvedValue({ data: { members, pending: [] } });
    vi.mocked(axios.post).mockResolvedValue({ status: 204 });
    showConfirm.mockResolvedValue(true);
    // After the transfer the server lists the caller as an admin, who can still share.
    const demoted = glossary('g-o', 'Owner-Glossar', 'admin');
    render(<Harness after={{ ...list, glossaries: list.glossaries.map((g) => (g.id === 'g-o' ? demoted : g)) }} />);
    await userEvent.click(within(row('g-o')).getByRole('button', { name: 'share Owner-Glossar' }));

    const actions = async () => userEvent.click(within(await screen.findByTestId('member-row-u3')).getByRole('button', { name: 'memberActions' }));
    await actions();
    await userEvent.click(await screen.findByRole('menuitem', { name: 'makeOwner' }));
    await waitFor(() => expect(axios.post).toHaveBeenCalledWith('/api/glossaries/g-o/transfer-owner', { userId: 'u3' }));

    // The same view, the glossary as the list has it now: no second transfer (it would be a 403).
    await waitFor(async () => {
      await actions();
      const menu = await screen.findByRole('menu');
      expect(within(menu).queryByRole('menuitem', { name: 'makeOwner' })).toBeNull();
      expect(within(menu).getByRole('menuitem', { name: 'glossaryRemoveShare' })).toBeInTheDocument();
    });
  });

  it('closes when the glossary is gone from the list', async () => {
    vi.mocked(axios.get).mockResolvedValue({ data: { members, pending: [] } });
    vi.mocked(axios.patch).mockResolvedValue({ status: 204 });
    render(<Harness after={{ ...list, glossaries: list.glossaries.filter((g) => g.id !== 'g-a') }} />);
    await userEvent.click(within(row('g-a')).getByRole('button', { name: 'share Admin-Glossar' }));
    const select = await screen.findByRole('combobox', { name: 'translatorGlossaryVisibilityLabel' });
    select.focus();
    await userEvent.keyboard('{Enter}');
    await userEvent.click(
      within(await screen.findByRole('listbox')).getByRole('option', { name: 'translatorGlossaryVisibility_global' }),
    );
    expect(await screen.findByText('translatorGlossariesChoose')).toBeInTheDocument();
    expect(screen.queryByRole('combobox', { name: 'translatorGlossaryVisibilityLabel' })).toBeNull();
    expect(screen.queryByTestId('glossary-row-g-a')).toBeNull();
  });

  it('closes when the caller may no longer manage the glossary', async () => {
    vi.mocked(axios.get).mockResolvedValue({ data: { members, pending: [] } });
    vi.mocked(axios.patch).mockResolvedValue({ status: 204 });
    const lowered = glossary('g-a', 'Admin-Glossar', 'editor');
    render(<Harness after={{ ...list, glossaries: list.glossaries.map((g) => (g.id === 'g-a' ? lowered : g)) }} />);
    await userEvent.click(within(row('g-a')).getByRole('button', { name: 'share Admin-Glossar' }));
    const select = await screen.findByRole('combobox', { name: 'translatorGlossaryVisibilityLabel' });
    select.focus();
    await userEvent.keyboard('{Enter}');
    await userEvent.click(
      within(await screen.findByRole('listbox')).getByRole('option', { name: 'translatorGlossaryVisibility_global' }),
    );
    expect(await screen.findByText('translatorGlossariesChoose')).toBeInTheDocument();
  });
});

describe('GlossaryDialog — actions', () => {
  it('opens a viewer’s glossary read-only: the fields are locked and nothing can be saved', async () => {
    vi.mocked(axios.get).mockResolvedValue({ data: detail(list.glossaries[0]) });
    renderDialog();
    await userEvent.click(within(row('g-v')).getByRole('button', { name: 'view Viewer-Glossar' }));
    expect(await screen.findByDisplayValue('Hochschule')).toHaveAttribute('readonly');
    expect(screen.getByLabelText('translatorGlossaryNameLabel')).toHaveAttribute('readonly');
    expect(screen.queryByRole('button', { name: 'translatorGlossaryUpdate' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'translatorGlossaryAddPair' })).toBeNull();
    expect(vi.mocked(axios.get)).toHaveBeenCalledWith('/api/glossaries/g-v');
  });

  it('saves an editor’s change with a PUT of name, description, category and entries', async () => {
    vi.mocked(axios.get).mockResolvedValue({ data: detail(list.glossaries[1]) });
    vi.mocked(axios.put).mockResolvedValue({ data: detail(list.glossaries[1]) });
    const { onChanged } = renderDialog();
    await userEvent.click(within(row('g-e')).getByRole('button', { name: 'edit Editor-Glossar' }));
    const term = await screen.findByDisplayValue('university');
    await userEvent.clear(term);
    await userEvent.type(term, 'higher education institution');
    await userEvent.click(screen.getByRole('button', { name: 'translatorGlossaryUpdate' }));
    await waitFor(() =>
      expect(axios.put).toHaveBeenCalledWith('/api/glossaries/g-e', {
        name: 'Editor-Glossar',
        description: '',
        category: 'general',
        entries: [
          {
            sourceLanguage: 'de',
            sourceTerm: 'Hochschule',
            targetLanguage: 'en',
            targetTerm: 'higher education institution',
          },
        ],
      }),
    );
    expect(onChanged).toHaveBeenCalled();
    expect(toastMock.success).toHaveBeenCalledWith('translatorGlossaryUpdated');
  });

  it('needs a name and at least one complete pair of terms for a new glossary', async () => {
    renderDialog();
    await userEvent.click(screen.getByRole('button', { name: 'translatorGlossaryNew' }));
    await userEvent.click(await screen.findByRole('button', { name: 'translatorGlossaryCreate' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('translatorGlossaryNameRequired');
    await userEvent.type(screen.getByLabelText('translatorGlossaryNameLabel'), 'Neu');
    await userEvent.click(screen.getByRole('button', { name: 'translatorGlossaryCreate' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('translatorGlossaryTermRequired');
    expect(axios.post).not.toHaveBeenCalled();
  });

  it('creates a private glossary with its pairs', async () => {
    vi.mocked(axios.post).mockResolvedValue({ data: {} });
    renderDialog();
    await userEvent.click(screen.getByRole('button', { name: 'translatorGlossaryNew' }));
    await userEvent.type(await screen.findByLabelText('translatorGlossaryNameLabel'), ' Neu ');
    const [source, target] = [
      screen.getAllByRole('textbox').find((el) => el.getAttribute('placeholder') === 'translatorGlossarySourceTerm')!,
      screen.getAllByRole('textbox').find((el) => el.getAttribute('placeholder') === 'translatorGlossaryTargetTerm')!,
    ];
    await userEvent.type(source, 'Hochschule');
    await userEvent.type(target, 'university');
    await userEvent.click(screen.getByRole('button', { name: 'translatorGlossaryCreate' }));
    await waitFor(() =>
      expect(axios.post).toHaveBeenCalledWith('/api/glossaries', {
        name: 'Neu',
        description: '',
        category: '',
        visibility: 'private',
        entries: [{ sourceLanguage: 'de', sourceTerm: 'Hochschule', targetLanguage: 'en', targetTerm: 'university' }],
      }),
    );
  });

  it('deletes only after the owner confirmed', async () => {
    vi.mocked(axios.delete).mockResolvedValue({ status: 204 });
    showConfirm.mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    const { onChanged } = renderDialog();
    const button = within(row('g-o')).getByRole('button', { name: 'delete Owner-Glossar' });
    await userEvent.click(button);
    expect(axios.delete).not.toHaveBeenCalled();
    await userEvent.click(button);
    await waitFor(() => expect(axios.delete).toHaveBeenCalledWith('/api/glossaries/g-o'));
    expect(onChanged).toHaveBeenCalled();
  });

  it('leaves a glossary after confirming, through the membership route', async () => {
    vi.mocked(axios.delete).mockResolvedValue({ status: 204 });
    showConfirm.mockResolvedValue(true);
    const { onChanged } = renderDialog();
    await userEvent.click(within(row('g-e')).getByRole('button', { name: 'leave Editor-Glossar' }));
    await waitFor(() => expect(axios.delete).toHaveBeenCalledWith('/api/glossaries/g-e/membership'));
    expect(onChanged).toHaveBeenCalled();
  });

  it('says why a glossary could not be left (the owner’s 409, a missing membership)', async () => {
    vi.mocked(axios.delete).mockRejectedValue(
      Object.assign(new Error('409'), { isAxiosError: true, response: { status: 409, data: {} } }),
    );
    showConfirm.mockResolvedValue(true);
    renderDialog();
    await userEvent.click(within(row('g-a')).getByRole('button', { name: 'leave Admin-Glossar' }));
    await waitFor(() => expect(toastMock.error).toHaveBeenCalledWith('translatorGlossaryLeaveFailed'));
  });

  it('opens the sharing of a glossary an admin manages, with its visibility', async () => {
    vi.mocked(axios.get).mockResolvedValue({ data: { members: [], pending: [] } });
    renderDialog();
    await userEvent.click(within(row('g-a')).getByRole('button', { name: 'share Admin-Glossar' }));
    expect(await screen.findByRole('combobox', { name: 'translatorGlossaryVisibilityLabel' })).toHaveTextContent(
      'translatorGlossaryVisibility_private',
    );
    await waitFor(() => expect(axios.get).toHaveBeenCalledWith('/api/glossaries/g-a/members'));
  });

  it('changes the visibility at once and puts it back when that fails', async () => {
    vi.mocked(axios.get).mockResolvedValue({ data: { members: [], pending: [] } });
    vi.mocked(axios.patch).mockRejectedValueOnce(new Error('403')).mockResolvedValueOnce({ status: 204 });
    renderDialog();
    await userEvent.click(within(row('g-a')).getByRole('button', { name: 'share Admin-Glossar' }));
    const select = await screen.findByRole('combobox', { name: 'translatorGlossaryVisibilityLabel' });
    select.focus();
    await userEvent.keyboard('{Enter}');
    await userEvent.click(
      within(await screen.findByRole('listbox')).getByRole('option', { name: 'translatorGlossaryVisibility_global' }),
    );
    await waitFor(() => expect(axios.patch).toHaveBeenCalledWith('/api/glossaries/g-a', { visibility: 'global' }));
    await waitFor(() => expect(toastMock.error).toHaveBeenCalled());
    expect(select).toHaveTextContent('translatorGlossaryVisibility_private');
  });
});

describe('GlossaryDialog — CSV import', () => {
  it('refuses a file over 5 MiB before sending it, and posts a smaller one as multipart', async () => {
    const { onChanged } = renderDialog();
    await userEvent.click(screen.getByRole('button', { name: 'translatorGlossaryImport' }));
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    const big = new File(['x'], 'big.csv', { type: 'text/csv' });
    Object.defineProperty(big, 'size', { value: 6 * 1024 * 1024 });
    await userEvent.upload(input, big);
    await userEvent.click(screen.getByRole('button', { name: 'translatorGlossaryImportSubmit' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('errorFileTooLarge');
    expect(axios.post).not.toHaveBeenCalled();

    vi.mocked(axios.post).mockResolvedValue({ data: {} });
    const ok = new File(['Hochschule;university\n'], 'terms.csv', { type: 'text/csv' });
    // The first file named the glossary "big"; with the name emptied the next file names it again.
    await userEvent.clear(screen.getByLabelText('translatorGlossaryImportName'));
    await userEvent.upload(input, ok);
    // The file's name is the glossary's first name.
    expect(screen.getByLabelText('translatorGlossaryImportName')).toHaveValue('terms');
    await userEvent.click(screen.getByRole('button', { name: 'translatorGlossaryImportSubmit' }));
    await waitFor(() => expect(axios.post).toHaveBeenCalledTimes(1));
    const [url, form] = vi.mocked(axios.post).mock.calls[0] as [string, FormData];
    expect(url).toBe('/api/glossaries/import');
    expect(form.get('name')).toBe('terms');
    expect(form.get('sourceLanguage')).toBe('de');
    expect(form.get('targetLanguage')).toBe('en');
    expect((form.get('file') as File).name).toBe('terms.csv');
    expect(onChanged).toHaveBeenCalled();
  });
});

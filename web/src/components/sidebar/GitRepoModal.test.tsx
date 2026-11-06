import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { GitRepoModal } from './GitRepoModal';
import type { GitRepoLookup } from '../../hooks/useGitRepoLookup';

vi.mock('../../contexts/ThemeContext', () => ({
  useTheme: () => ({ t: (key: string) => key, language: 'de' }),
}));

// The lookup hook (network, debounce) has its own test; here it answers with
// whatever the case sets.
let lookup: GitRepoLookup = { status: 'idle' };
const lookupArgs = vi.fn();
vi.mock('../../hooks/useGitRepoLookup', () => ({
  useGitRepoLookup: (...args: unknown[]) => { lookupArgs(...args); return lookup; },
}));

const found = (branches: string[], defaultBranch = 'main'): GitRepoLookup =>
  ({ status: 'ok', repoUrl: 'https://github.com/o/r', defaultBranch, branches, truncated: false });

function renderModal(onAdd = vi.fn()) {
  render(<GitRepoModal kbId="kb1" show onClose={() => {}} loading={false} onAdd={onAdd} />);
  return onAdd;
}

beforeEach(() => {
  lookup = { status: 'idle' };
  lookupArgs.mockClear();
});

// Oracle: normalizeRepoURL in go-backend/internal/gitrepo/repourl.go — the
// field must show, at paste time, the URL the server will store.
describe('GitRepoModal — pasting a forge page link', () => {
  it('reduces a pull-request page link to the repository and says so', async () => {
    renderModal();
    const url = screen.getByRole('textbox', { name: 'gitRepoUrl' });
    await userEvent.click(url);
    await userEvent.paste('https://github.com/KI4JLU/Design-System/pulls');

    expect(url).toHaveValue('https://github.com/KI4JLU/Design-System');
    expect(url).toHaveAccessibleDescription(expect.stringContaining('gitRepoUrlShortened'));
    expect(url).toHaveAccessibleDescription(expect.stringContaining('/pulls'));
    expect(lookupArgs).toHaveBeenLastCalledWith('kb1', 'https://github.com/KI4JLU/Design-System', '', false, true);
  });

  it('leaves a clean repository URL alone, with no notice', async () => {
    renderModal();
    const url = screen.getByRole('textbox', { name: 'gitRepoUrl' });
    await userEvent.click(url);
    await userEvent.paste('https://github.com/o/r');
    expect(url).toHaveValue('https://github.com/o/r');
    expect(url).not.toHaveAccessibleDescription(expect.stringContaining('gitRepoUrlShortened'));
  });

  it('drops the notice once the user edits the field', async () => {
    renderModal();
    const url = screen.getByRole('textbox', { name: 'gitRepoUrl' });
    await userEvent.click(url);
    await userEvent.paste('https://github.com/o/r/issues');
    await userEvent.type(url, 'x');
    expect(url).not.toHaveAccessibleDescription(expect.stringContaining('gitRepoUrlShortened'));
  });
});

// Oracle: POST /git-repos/lookup in API.md — branches come from the forge,
// default first; branch '' on save means "follow the default branch".
describe('GitRepoModal — repository check and branch dropdown', () => {
  it('keeps the branch dropdown and the add button disabled until the repository is found', async () => {
    lookup = { status: 'checking' };
    renderModal();
    await userEvent.type(screen.getByRole('textbox', { name: 'gitRepoUrl' }), 'https://github.com/o/r');
    expect(screen.getByRole('status')).toHaveTextContent('gitRepoLookupChecking');
    expect(screen.getByRole('combobox', { name: 'gitRepoBranchLabel' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'addGitRepo' })).toBeDisabled();
  });

  it('offers the branches with the default branch first and saves the picked one', async () => {
    lookup = found(['main', 'dev', 'feature/x']);
    const onAdd = renderModal();
    await userEvent.type(screen.getByRole('textbox', { name: 'gitRepoUrl' }), 'https://github.com/o/r');

    expect(screen.getByRole('status')).toHaveTextContent('gitRepoLookupFound');
    const select = screen.getByRole('combobox', { name: 'gitRepoBranchLabel' });
    expect([...select.querySelectorAll('option')].map((o) => o.value)).toEqual(['', 'dev', 'feature/x']);
    expect(select.querySelector('option')).toHaveTextContent('gitRepoBranchDefaultOption');

    await userEvent.selectOptions(select, 'dev');
    await userEvent.click(screen.getByRole('button', { name: 'addGitRepo' }));
    expect(onAdd).toHaveBeenCalledWith(expect.objectContaining({ repoUrl: 'https://github.com/o/r', branch: 'dev' }));
  });

  it('saves no branch when the default branch stays selected', async () => {
    lookup = found(['main', 'dev']);
    const onAdd = renderModal();
    await userEvent.type(screen.getByRole('textbox', { name: 'gitRepoUrl' }), 'https://github.com/o/r');
    await userEvent.click(screen.getByRole('button', { name: 'addGitRepo' }));
    expect(onAdd).toHaveBeenCalledWith(expect.objectContaining({ branch: undefined }));
  });

  it('preselects the branch a pasted /tree/<branch> link names', async () => {
    lookup = found(['main', 'dev']);
    renderModal();
    await userEvent.click(screen.getByRole('textbox', { name: 'gitRepoUrl' }));
    await userEvent.paste('https://github.com/o/r/tree/dev');
    expect(screen.getByRole('combobox', { name: 'gitRepoBranchLabel' })).toHaveValue('dev');
  });

  it('falls back to the default branch when the linked branch does not exist', async () => {
    lookup = found(['main', 'dev']);
    const onAdd = renderModal();
    await userEvent.click(screen.getByRole('textbox', { name: 'gitRepoUrl' }));
    await userEvent.paste('https://github.com/o/r/tree/gone');
    expect(screen.getByRole('combobox', { name: 'gitRepoBranchLabel' })).toHaveValue('');
    await userEvent.click(screen.getByRole('button', { name: 'addGitRepo' }));
    expect(onAdd).toHaveBeenCalledWith(expect.objectContaining({ branch: undefined }));
  });

  it('keeps a linked branch a truncated list does not show', async () => {
    lookup = { ...found(['main', 'dev']), truncated: true } as GitRepoLookup;
    const onAdd = renderModal();
    await userEvent.click(screen.getByRole('textbox', { name: 'gitRepoUrl' }));
    await userEvent.paste('https://github.com/o/r/tree/zz-late');
    expect(screen.getByRole('combobox', { name: 'gitRepoBranchLabel' })).toHaveValue('zz-late');
    await userEvent.click(screen.getByRole('button', { name: 'addGitRepo' }));
    expect(onAdd).toHaveBeenCalledWith(expect.objectContaining({ branch: 'zz-late' }));
  });

  it('takes the branch from a typed /tree/<branch> link too, not only a pasted one', async () => {
    lookup = found(['main', 'dev']);
    const onAdd = renderModal();
    await userEvent.type(screen.getByRole('textbox', { name: 'gitRepoUrl' }), 'https://github.com/o/r/tree/dev');
    expect(screen.getByRole('combobox', { name: 'gitRepoBranchLabel' })).toHaveValue('dev');
    await userEvent.click(screen.getByRole('button', { name: 'addGitRepo' }));
    expect(onAdd).toHaveBeenCalledWith(expect.objectContaining({ repoUrl: 'https://github.com/o/r', branch: 'dev' }));
  });

  it('lets a branch past a truncated list be typed in, slashes included', async () => {
    lookup = { ...found(['main', 'dev']), truncated: true } as GitRepoLookup;
    const onAdd = renderModal();
    await userEvent.type(screen.getByRole('textbox', { name: 'gitRepoUrl' }), 'https://github.com/o/r');
    await userEvent.type(screen.getByRole('textbox', { name: 'gitRepoBranchOther' }), 'feature/zz-late');
    expect(screen.getByRole('combobox', { name: 'gitRepoBranchLabel' })).toHaveValue('feature/zz-late');
    await userEvent.click(screen.getByRole('button', { name: 'addGitRepo' }));
    expect(onAdd).toHaveBeenCalledWith(expect.objectContaining({ branch: 'feature/zz-late' }));
  });

  it('offers no free-text branch field when the list is complete', async () => {
    lookup = found(['main', 'dev']);
    renderModal();
    expect(screen.queryByRole('textbox', { name: 'gitRepoBranchOther' })).toBeNull();
  });

  it('blocks adding a repository the forge does not know and says why', async () => {
    lookup = { status: 'error', reason: 'not_found' };
    renderModal();
    const url = screen.getByRole('textbox', { name: 'gitRepoUrl' });
    await userEvent.type(url, 'https://github.com/o/nope');
    expect(screen.getByRole('status')).toHaveTextContent('gitRepoLookupNotFound');
    expect(url).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByRole('button', { name: 'addGitRepo' })).toBeDisabled();
  });

  it('does not block when only the check itself failed', async () => {
    lookup = { status: 'error', reason: 'check_failed' };
    renderModal();
    await userEvent.type(screen.getByRole('textbox', { name: 'gitRepoUrl' }), 'https://github.com/o/r');
    expect(screen.getByRole('button', { name: 'addGitRepo' })).toBeEnabled();
  });

  it('passes the token to the check for a private repository', async () => {
    renderModal();
    await userEvent.click(screen.getByRole('radio', { name: 'gitRepoPrivate' }));
    await userEvent.type(screen.getByRole('textbox', { name: 'gitRepoUrl' }), 'https://github.com/o/r');
    await userEvent.type(screen.getByLabelText('gitRepoToken'), 'pat');
    expect(lookupArgs).toHaveBeenLastCalledWith('kb1', 'https://github.com/o/r', 'pat', true, true);
  });
});

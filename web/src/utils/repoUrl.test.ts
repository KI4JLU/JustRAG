import { describe, it, expect } from 'vitest';
import { normalizeRepoUrl } from './repoUrl';

// Oracle: the same cases as TestNormalizeRepoURL in
// go-backend/internal/gitrepo/repourl_test.go — the server's answer on save.
describe('normalizeRepoUrl', () => {
  it.each([
    ['https://github.com/KI4JLU/Design-System/pulls', 'https://github.com/KI4JLU/Design-System', ''],
    ['https://github.com/KI4JLU/Design-System/pull/42/files', 'https://github.com/KI4JLU/Design-System', ''],
    ['https://github.com/o/r/tree/dev', 'https://github.com/o/r', 'dev'],
    ['https://github.com/o/r/tree/main/docs', 'https://github.com/o/r', ''],
    ['https://github.com/o/r/blob/main/README.md#L3', 'https://github.com/o/r', ''],
    ['https://github.com/o/r/?tab=readme', 'https://github.com/o/r', ''],
    ['https://github.com/o/r.git', 'https://github.com/o/r.git', ''],
    ['https://GitHub.com/o/r', 'https://github.com/o/r', ''],
    ['  https://github.com/o/r  ', 'https://github.com/o/r', ''],
    ['https://gitlab.com/g/sub/p/-/merge_requests/3', 'https://gitlab.com/g/sub/p', ''],
    ['https://gitlab.example.org/g/p/-/tree/release', 'https://gitlab.example.org/g/p', 'release'],
    ['https://gitlab.example.org/g/sub/p', 'https://gitlab.example.org/g/sub/p', ''],
    ['https://git.example.org/o/r/pulls', 'https://git.example.org/o/r', ''],
    ['https://git.example.org/o/r/src/branch/main', 'https://git.example.org/o/r', 'main'],
    ['https://codeberg.org/o/r/src/branch/main/docs', 'https://codeberg.org/o/r', ''],
    ['https://bitbucket.org/o/r/pull-requests/', 'https://bitbucket.org/o/r', ''],
    ['https://dev.azure.com/org/proj/_git/repo', 'https://dev.azure.com/org/proj/_git/repo', ''],
    ['https://git.example.org/repo.git', 'https://git.example.org/repo.git', ''],
    ['https://git.example.org:8443/o/r/issues', 'https://git.example.org:8443/o/r', ''],
    ['https://gitlab.com/team/sub/issues', 'https://gitlab.com/team/sub/issues', ''],
    ['https://git.example.org/team/sub/releases', 'https://git.example.org/team/sub/releases', ''],
    ['https://git.example.org/team/sub/src', 'https://git.example.org/team/sub/src', ''],
  ])('%s', (input, url, branch) => {
    expect(normalizeRepoUrl(input)).toEqual({ url, branch });
  });

  it.each([
    'http://github.com/o/r',
    'git@github.com:o/r.git',
    'https://',
    'https://user:pat@github.com/o/r',
    'https://github.com',
    'https://github.com/KI4JLU',
    'https://github.com/repo.git',
    'https://git.example.org/repo',
    'not a url',
  ])('refuses %s', (input) => {
    expect(normalizeRepoUrl(input)).toBeNull();
  });

  it('ignores a half-typed escape in the branch', () => {
    expect(normalizeRepoUrl('https://github.com/o/r/tree/%')).toEqual({ url: 'https://github.com/o/r', branch: '' });
  });
});

/**
 * Client mirror of `normalizeRepoURL` (go-backend/internal/gitrepo/repourl.go).
 * The server normalises again on save; this copy only lets the dialog show
 * the reduced URL the moment a forge page link is pasted. Keep the host and
 * route lists in sync with the Go file.
 */

/** Forges whose repositories always live at exactly /<owner>/<repo>. */
const OWNER_REPO_HOSTS = new Set(['github.com', 'www.github.com', 'bitbucket.org', 'codeberg.org', 'gitea.com']);

/** Hosts that put every web page behind "/-/": a path without one is kept whole. */
const GITLAB_HOSTS = new Set(['gitlab.com']);

/**
 * Page routes a self-hosted Gitea/Forgejo puts directly after /<owner>/<repo>.
 * Only words implausible as a (nested GitLab) project name; "src" counts only
 * before branch/commit/tag.
 */
const WEB_ROUTE_SEGMENTS = new Set([
  'tree', 'blob', 'raw', 'blame', 'commit', 'compare', 'pulls', 'pull',
  'pullrequests', 'merge_requests', 'issues',
]);
const GITEA_SRC_REF_KINDS = new Set(['branch', 'commit', 'tag']);

function isWebRoute(segs: string[]): boolean {
  if (segs.length < 3) return false;
  if (segs[2] === 'src') return segs.length > 3 && GITEA_SRC_REF_KINDS.has(segs[3]);
  return WEB_ROUTE_SEGMENTS.has(segs[2]);
}

export interface NormalizedRepoUrl {
  url: string;
  /** Branch a /tree/<b> or /src/branch/<b> link named; '' when none or ambiguous. */
  branch: string;
}

/**
 * Reduces a pasted link to the repository URL. Returns null for input the
 * server would refuse (not https, userinfo, no owner/repo path) — the dialog
 * leaves that text as typed and the save answers with the reason.
 */
export function normalizeRepoUrl(raw: string): NormalizedRepoUrl | null {
  let u: URL;
  try {
    u = new URL(raw.trim());
  } catch {
    return null;
  }
  if (u.protocol !== 'https:' || !u.hostname || u.username || u.password) return null;

  const segs = u.pathname.split('/').filter(Boolean);
  if (segs.length < 2 && (segs.length === 0 || !segs[0].endsWith('.git'))) return null;

  let keep = segs.length;
  let rest: string[] = [];
  if (OWNER_REPO_HOSTS.has(u.hostname)) {
    // The single-segment "<name>.git" exception is for self-hosted servers.
    if (segs.length < 2) return null;
    keep = 2;
    rest = segs.slice(2);
  } else {
    const dash = segs.indexOf('-', 2);
    if (dash !== -1) {
      keep = dash;
      rest = segs.slice(dash + 1);
    } else if (!GITLAB_HOSTS.has(u.hostname) && isWebRoute(segs)) {
      keep = 2;
      rest = segs.slice(2);
    }
  }

  let branch = '';
  if (rest.length === 2 && rest[0] === 'tree') branch = rest[1];
  else if (rest.length === 3 && rest[0] === 'src' && rest[1] === 'branch') branch = rest[2];
  try {
    branch = decodeURIComponent(branch);
  } catch {
    branch = ''; // a half-typed escape ("%") names no branch
  }

  return { url: `https://${u.host}/${segs.slice(0, keep).join('/')}`, branch };
}

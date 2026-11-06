package gitrepo

import (
	"errors"
	"net/url"
	"strings"
)

// The refusals normalizeRepoURL can return. CreateSource writes their text
// as the 400 message, so it is phrased for the person who pasted the link.
var (
	errRepoURLNotHTTPS = errors.New("repoUrl must be an https URL")
	errRepoURLUserinfo = errors.New("repoUrl must not contain a user name or password; use the access token field")
	errRepoURLNotRepo  = errors.New("repoUrl must point to a repository, e.g. https://github.com/owner/repo")
)

// ownerRepoHosts are forges whose repositories always live at exactly
// /<owner>/<repo>, so everything after the second path segment is a web
// page (pull requests, issues, a file view) and can be cut unconditionally.
var ownerRepoHosts = map[string]bool{
	"github.com":     true,
	"www.github.com": true,
	"bitbucket.org":  true,
	"codeberg.org":   true,
	"gitea.com":      true,
}

// gitlabHosts put every web page behind a "/-/" separator, so a path
// without one is a (possibly nested) project and is kept whole.
var gitlabHosts = map[string]bool{"gitlab.com": true}

// webRouteSegments are the page routes a self-hosted Gitea/Forgejo puts
// directly after /<owner>/<repo>. On an unknown host they are cut only at
// that position (index 2), so a GitLab subgroup path keeps its depth. Only
// words that are implausible as a project name are listed: "releases",
// "tags", "settings" and the like could be a nested GitLab project, and
// cutting a real repo path short is worse than leaving a page link for the
// lookup to reject. "src" counts only before branch/commit/tag (Gitea's
// file view), since "src" alone is a common project name.
var webRouteSegments = map[string]bool{
	"tree": true, "blob": true, "raw": true, "blame": true, "commit": true,
	"compare": true, "pulls": true, "pull": true, "pullrequests": true,
	"merge_requests": true, "issues": true,
}

var giteaSrcRefKinds = map[string]bool{"branch": true, "commit": true, "tag": true}

// normalizeRepoURL turns a link pasted from a forge's web UI into the URL the
// worker clones. It drops query and fragment, cuts web-page paths back to the
// repository (GitHub /pulls, /tree/<b>, /blob/…; GitLab /-/…; Gitea /src/…)
// and returns the branch a /tree/<b> or /src/branch/<b> link named, when that
// link names exactly one path segment after the route — a longer tail is
// ambiguous (branch "feature/x" vs. directory "x" on branch "feature"), so
// branch stays "" and the clone uses the default branch.
//
// It refuses non-https URLs, URLs with userinfo, and paths too short to name
// a repository. A URL it does not recognise is returned unchanged apart from
// query/fragment and a trailing slash: only the clone can prove it is a repo.
func normalizeRepoURL(raw string) (repoURL, branch string, err error) {
	u, err := url.Parse(strings.TrimSpace(raw))
	if err != nil || u.Scheme != "https" || u.Host == "" {
		return "", "", errRepoURLNotHTTPS
	}
	if u.User != nil {
		return "", "", errRepoURLUserinfo
	}

	var segs []string
	for _, s := range strings.Split(u.Path, "/") {
		if s != "" {
			segs = append(segs, s)
		}
	}
	// A bare host or an owner page (https://github.com/KI4JLU) is not a
	// repository. A single segment is accepted only as an explicit
	// "<name>.git" on a self-hosted server.
	if len(segs) < 2 && (len(segs) == 0 || !strings.HasSuffix(segs[0], ".git")) {
		return "", "", errRepoURLNotRepo
	}

	host := strings.ToLower(u.Hostname())
	keep, rest := len(segs), []string(nil)
	switch {
	case ownerRepoHosts[host]:
		// The single-segment "<name>.git" exception is for self-hosted
		// servers; on these forges a repository always has an owner.
		if len(segs) < 2 {
			return "", "", errRepoURLNotRepo
		}
		keep, rest = 2, segs[2:]
	default:
		for i := 2; i < len(segs); i++ {
			if segs[i] == "-" { // GitLab: /<group…>/<project>/-/<route>
				keep, rest = i, segs[i+1:]
				break
			}
		}
		if keep == len(segs) && !gitlabHosts[host] && isWebRoute(segs) {
			keep, rest = 2, segs[2:]
		}
	}

	switch {
	case len(rest) == 2 && rest[0] == "tree":
		branch = rest[1]
	case len(rest) == 3 && rest[0] == "src" && rest[1] == "branch":
		branch = rest[2]
	}

	u.Host = strings.ToLower(u.Host)
	u.Path = "/" + strings.Join(segs[:keep], "/")
	u.RawPath = ""
	u.RawQuery = ""
	u.ForceQuery = false
	u.Fragment = ""
	u.RawFragment = ""
	return u.String(), branch, nil
}

// isWebRoute reports whether segs[2] starts a forge web page on a host the
// normaliser has no list for.
func isWebRoute(segs []string) bool {
	if len(segs) < 3 {
		return false
	}
	if segs[2] == "src" {
		return len(segs) > 3 && giteaSrcRefKinds[segs[3]]
	}
	return webRouteSegments[segs[2]]
}

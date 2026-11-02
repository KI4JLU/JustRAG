package gitrepo

import (
	"context"
	"errors"
	"fmt"
	"net/url"
	"sort"
	"strings"
	"time"

	"github.com/go-git/go-git/v5"
	"github.com/go-git/go-git/v5/config"
	"github.com/go-git/go-git/v5/plumbing"
	"github.com/go-git/go-git/v5/plumbing/transport"
	githttp "github.com/go-git/go-git/v5/plumbing/transport/http"
	"github.com/go-git/go-git/v5/storage/memory"
)

// lookupTimeout bounds one ls-remote. The lookup runs while the add dialog
// waits, so a slow forge is reported as unreachable rather than hanging it.
const lookupTimeout = 15 * time.Second

// maxLookupBranches caps the branch list a lookup returns: a repository with
// thousands of branches would otherwise ship them all into a dropdown.
const maxLookupBranches = 500

// RemoteBranches is what an ls-remote of a repository found.
type RemoteBranches struct {
	// DefaultBranch is the branch HEAD points at; "" when the server did not
	// advertise it.
	DefaultBranch string
	// Branches is sorted with DefaultBranch first, then alphabetically.
	Branches  []string
	Truncated bool
}

// Lookup failure reasons. They are the `code` of the 422 the lookup route
// answers with, so the dialog can say what to do next.
var (
	ErrLookupNotFound     = errors.New("repository not found or private")
	ErrLookupAuthFailed   = errors.New("access token rejected")
	ErrLookupEmpty        = errors.New("repository is empty")
	ErrLookupUnreachable  = errors.New("repository could not be reached")
	errLookupNoTransport  = errors.New("gitrepo: refusing https lookup without an SSRF-safe transport")
	errLookupInvalidInput = errors.New("gitrepo: invalid lookup url")
)

// ListRemoteBranches asks the server for the repository's branches without
// cloning anything (the "ls-remote" step of a clone). It goes through the
// same process-wide SSRF-safe transport as the sync and fails closed when
// none is installed.
func ListRemoteBranches(ctx context.Context, repoURL, token string) (*RemoteBranches, error) {
	if err := validateRepoURL(repoURL); err != nil {
		return nil, fmt.Errorf("%w: %w", errLookupInvalidInput, err)
	}
	u, _ := url.Parse(repoURL) // validated above
	if err := requireSafeTransport(u.Scheme, false, safeTransportInstalled); err != nil {
		return nil, errLookupNoTransport
	}
	if err := checkTarget(ctx, repoURL); err != nil {
		return nil, fmt.Errorf("%w: %w", ErrLookupUnreachable, err)
	}

	ctx, cancel := context.WithTimeout(ctx, lookupTimeout)
	defer cancel()

	remote := git.NewRemote(memory.NewStorage(), &config.RemoteConfig{Name: "origin", URLs: []string{repoURL}})
	opts := &git.ListOptions{}
	if token != "" {
		opts.Auth = &githttp.BasicAuth{Username: "git", Password: token}
	}
	refs, err := remote.ListContext(ctx, opts)
	if err != nil {
		return nil, classifyLookupError(err)
	}
	return branchesFromRefs(refs), nil
}

func classifyLookupError(err error) error {
	switch {
	case errors.Is(err, transport.ErrRepositoryNotFound), errors.Is(err, transport.ErrAuthenticationRequired):
		// Forges answer an unknown repo with an auth challenge, so the two
		// are indistinguishable without credentials.
		return fmt.Errorf("%w: %w", ErrLookupNotFound, err)
	case errors.Is(err, transport.ErrAuthorizationFailed):
		return fmt.Errorf("%w: %w", ErrLookupAuthFailed, err)
	case errors.Is(err, transport.ErrEmptyRemoteRepository):
		return fmt.Errorf("%w: %w", ErrLookupEmpty, err)
	default:
		return fmt.Errorf("%w: %w", ErrLookupUnreachable, err)
	}
}

func branchesFromRefs(refs []*plumbing.Reference) *RemoteBranches {
	out := &RemoteBranches{}
	var names []string
	for _, r := range refs {
		switch {
		case r.Name() == plumbing.HEAD && r.Type() == plumbing.SymbolicReference && r.Target().IsBranch():
			out.DefaultBranch = r.Target().Short()
		case r.Name().IsBranch():
			names = append(names, r.Name().Short())
		}
	}
	sort.Slice(names, func(i, j int) bool {
		if (names[i] == out.DefaultBranch) != (names[j] == out.DefaultBranch) {
			return names[i] == out.DefaultBranch
		}
		return strings.ToLower(names[i]) < strings.ToLower(names[j])
	})
	if len(names) > maxLookupBranches {
		names, out.Truncated = names[:maxLookupBranches], true
	}
	out.Branches = names
	return out
}

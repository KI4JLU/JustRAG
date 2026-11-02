package gitrepo

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"reflect"
	"strings"
	"testing"

	"github.com/go-git/go-git/v5/plumbing"
	"github.com/go-git/go-git/v5/plumbing/transport"
)

// Oracle: what `git ls-remote --symref` prints for such a repository — HEAD
// as a symbolic ref to the default branch, branches under refs/heads/.
func TestBranchesFromRefs(t *testing.T) {
	h := plumbing.ZeroHash
	refs := []*plumbing.Reference{
		plumbing.NewSymbolicReference(plumbing.HEAD, "refs/heads/main"),
		plumbing.NewHashReference("refs/heads/zeta", h),
		plumbing.NewHashReference("refs/heads/main", h),
		plumbing.NewHashReference("refs/heads/Alpha", h),
		plumbing.NewHashReference("refs/heads/feature/x", h),
		plumbing.NewHashReference("refs/tags/v1", h),
		plumbing.NewHashReference("refs/pull/1/head", h),
	}
	got := branchesFromRefs(refs)
	if got.DefaultBranch != "main" {
		t.Fatalf("default = %q", got.DefaultBranch)
	}
	want := []string{"main", "Alpha", "feature/x", "zeta"}
	if !reflect.DeepEqual(got.Branches, want) {
		t.Fatalf("branches = %v, want %v", got.Branches, want)
	}
}

func TestBranchesFromRefsTruncates(t *testing.T) {
	var refs []*plumbing.Reference
	for i := 0; i < maxLookupBranches+5; i++ {
		refs = append(refs, plumbing.NewHashReference(plumbing.NewBranchReferenceName(fmt.Sprintf("b%04d", i)), plumbing.ZeroHash))
	}
	got := branchesFromRefs(refs)
	if len(got.Branches) != maxLookupBranches || !got.Truncated {
		t.Fatalf("len=%d truncated=%v", len(got.Branches), got.Truncated)
	}
}

func TestClassifyLookupError(t *testing.T) {
	cases := map[error]error{
		transport.ErrRepositoryNotFound:     ErrLookupNotFound,
		transport.ErrAuthenticationRequired: ErrLookupNotFound,
		transport.ErrAuthorizationFailed:    ErrLookupAuthFailed,
		transport.ErrEmptyRemoteRepository:  ErrLookupEmpty,
		errors.New("dial tcp: blocked"):     ErrLookupUnreachable,
	}
	for in, want := range cases {
		if got := classifyLookupError(in); !errors.Is(got, want) {
			t.Errorf("classify(%v) = %v, want %v", in, got, want)
		}
	}
}

func doLookup(t *testing.T, h *Handler, body string) *httptest.ResponseRecorder {
	t.Helper()
	rec := httptest.NewRecorder()
	h.LookupRepo(rec, httptest.NewRequest(http.MethodPost, "/api/kb/kb1/git-repos/lookup", strings.NewReader(body)))
	return rec
}

func TestLookupRepoNormalizesAndListsBranches(t *testing.T) {
	h := NewHandler(&fakeStore{gitRepoEnabled: true}, "test-jwt-secret-at-least-32-bytes-long!!", nil)
	var gotURL, gotToken string
	h.listBranches = func(_ context.Context, u, tok string) (*RemoteBranches, error) {
		gotURL, gotToken = u, tok
		return &RemoteBranches{DefaultBranch: "main", Branches: []string{"main", "dev"}}, nil
	}
	rec := doLookup(t, h, `{"repoUrl":"https://github.com/o/r/tree/dev","accessToken":"pat"}`)
	if rec.Code != http.StatusOK {
		t.Fatalf("status %d: %s", rec.Code, rec.Body)
	}
	if gotURL != "https://github.com/o/r" || gotToken != "pat" {
		t.Fatalf("listed %q with token %q", gotURL, gotToken)
	}
	var resp lookupResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
		t.Fatal(err)
	}
	want := lookupResponse{RepoURL: "https://github.com/o/r", URLBranch: "dev", DefaultBranch: "main", Branches: []string{"main", "dev"}}
	if !reflect.DeepEqual(resp, want) {
		t.Fatalf("resp = %+v, want %+v", resp, want)
	}
}

func TestLookupRepoFailureCodes(t *testing.T) {
	for _, tc := range []struct {
		err  error
		code string
	}{
		{classifyLookupError(transport.ErrAuthenticationRequired), "not_found"},
		{classifyLookupError(transport.ErrAuthorizationFailed), "auth_failed"},
		{classifyLookupError(transport.ErrEmptyRemoteRepository), "empty"},
		{classifyLookupError(errors.New("timeout")), "unreachable"},
	} {
		h := NewHandler(&fakeStore{gitRepoEnabled: true}, "test-jwt-secret-at-least-32-bytes-long!!", nil)
		h.listBranches = func(context.Context, string, string) (*RemoteBranches, error) { return nil, tc.err }
		rec := doLookup(t, h, `{"repoUrl":"https://github.com/o/r"}`)
		if rec.Code != http.StatusUnprocessableEntity || !strings.Contains(rec.Body.String(), `"code":"`+tc.code+`"`) {
			t.Errorf("%v: got %d %s, want 422 %s", tc.err, rec.Code, rec.Body, tc.code)
		}
	}
}

func TestLookupRepoRefusesBeforeNetwork(t *testing.T) {
	for name, tc := range map[string]struct {
		enabled bool
		body    string
		status  int
	}{
		"disabled":   {false, `{"repoUrl":"https://github.com/o/r"}`, http.StatusForbidden},
		"owner page": {true, `{"repoUrl":"https://github.com/o"}`, http.StatusBadRequest},
		"http":       {true, `{"repoUrl":"http://github.com/o/r"}`, http.StatusBadRequest},
		"bad body":   {true, `{`, http.StatusBadRequest},
	} {
		h := NewHandler(&fakeStore{gitRepoEnabled: tc.enabled}, "test-jwt-secret-at-least-32-bytes-long!!", nil)
		called := false
		h.listBranches = func(context.Context, string, string) (*RemoteBranches, error) {
			called = true
			return &RemoteBranches{}, nil
		}
		rec := doLookup(t, h, tc.body)
		if rec.Code != tc.status || called {
			t.Errorf("%s: status %d (want %d), network called=%v", name, rec.Code, tc.status, called)
		}
	}
}

func TestListRemoteBranchesFailsClosedWithoutSafeTransport(t *testing.T) {
	if safeTransportInstalled {
		t.Skip("a safe transport is installed process-wide")
	}
	if _, err := ListRemoteBranches(context.Background(), "https://github.com/o/r", ""); !errors.Is(err, errLookupNoTransport) {
		t.Fatalf("err = %v, want errLookupNoTransport", err)
	}
}

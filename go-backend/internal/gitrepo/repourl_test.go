package gitrepo

import (
	"bytes"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"
)

// Oracle: the clone URL each forge documents for the repository the pasted
// page belongs to, and the branch that page shows.
func TestNormalizeRepoURL(t *testing.T) {
	cases := []struct {
		name, in, wantURL, wantBranch string
	}{
		{"github pulls", "https://github.com/KI4JLU/Design-System/pulls", "https://github.com/KI4JLU/Design-System", ""},
		{"github pull", "https://github.com/KI4JLU/Design-System/pull/42/files", "https://github.com/KI4JLU/Design-System", ""},
		{"github tree branch", "https://github.com/o/r/tree/dev", "https://github.com/o/r", "dev"},
		{"github tree with dir is ambiguous", "https://github.com/o/r/tree/main/docs", "https://github.com/o/r", ""},
		{"github blob", "https://github.com/o/r/blob/main/README.md#L3", "https://github.com/o/r", ""},
		{"github query and slash", "https://github.com/o/r/?tab=readme", "https://github.com/o/r", ""},
		{"github clone url untouched", "https://github.com/o/r.git", "https://github.com/o/r.git", ""},
		{"github host case", "https://GitHub.com/o/r", "https://github.com/o/r", ""},
		{"surrounding whitespace", "  https://github.com/o/r  ", "https://github.com/o/r", ""},
		{"gitlab merge request", "https://gitlab.com/g/sub/p/-/merge_requests/3", "https://gitlab.com/g/sub/p", ""},
		{"gitlab tree branch", "https://gitlab.example.org/g/p/-/tree/release", "https://gitlab.example.org/g/p", "release"},
		{"gitlab subgroup kept", "https://gitlab.example.org/g/sub/p", "https://gitlab.example.org/g/sub/p", ""},
		{"gitea pulls", "https://git.example.org/o/r/pulls", "https://git.example.org/o/r", ""},
		{"gitea src branch", "https://git.example.org/o/r/src/branch/main", "https://git.example.org/o/r", "main"},
		{"codeberg src", "https://codeberg.org/o/r/src/branch/main/docs", "https://codeberg.org/o/r", ""},
		{"bitbucket pull requests", "https://bitbucket.org/o/r/pull-requests/", "https://bitbucket.org/o/r", ""},
		{"azure untouched", "https://dev.azure.com/org/proj/_git/repo", "https://dev.azure.com/org/proj/_git/repo", ""},
		{"single .git segment", "https://git.example.org/repo.git", "https://git.example.org/repo.git", ""},
		{"port kept", "https://git.example.org:8443/o/r/issues", "https://git.example.org:8443/o/r", ""},
		{"gitlab.com project named like a route", "https://gitlab.com/team/sub/issues", "https://gitlab.com/team/sub/issues", ""},
		{"nested project named releases", "https://git.example.org/team/sub/releases", "https://git.example.org/team/sub/releases", ""},
		{"project named src", "https://git.example.org/team/sub/src", "https://git.example.org/team/sub/src", ""},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got, branch, err := normalizeRepoURL(tc.in)
			if err != nil {
				t.Fatalf("normalizeRepoURL(%q): %v", tc.in, err)
			}
			if got != tc.wantURL || branch != tc.wantBranch {
				t.Fatalf("normalizeRepoURL(%q) = %q, %q; want %q, %q", tc.in, got, branch, tc.wantURL, tc.wantBranch)
			}
		})
	}
}

func TestNormalizeRepoURLRefuses(t *testing.T) {
	cases := []struct {
		in   string
		want error
	}{
		{"http://github.com/o/r", errRepoURLNotHTTPS},
		{"git@github.com:o/r.git", errRepoURLNotHTTPS},
		{"https://", errRepoURLNotHTTPS},
		{"https://user:pat@github.com/o/r", errRepoURLUserinfo},
		{"https://github.com", errRepoURLNotRepo},
		{"https://github.com/KI4JLU", errRepoURLNotRepo},
		{"https://github.com/repo.git", errRepoURLNotRepo},
		{"https://git.example.org/repo", errRepoURLNotRepo},
	}
	for _, tc := range cases {
		if _, _, err := normalizeRepoURL(tc.in); !errors.Is(err, tc.want) {
			t.Errorf("normalizeRepoURL(%q) err = %v, want %v", tc.in, err, tc.want)
		}
	}
}

func TestCreateSourceStoresNormalizedURLAndBranch(t *testing.T) {
	fs := &fakeStore{gitRepoEnabled: true}
	h := NewHandler(fs, "test-jwt-secret-at-least-32-bytes-long!!", nil)
	body, _ := json.Marshal(map[string]any{"repoUrl": "https://github.com/o/r/tree/dev"})
	rec := httptest.NewRecorder()
	h.CreateSource(rec, httptest.NewRequest("POST", "/api/kb/kb1/git-repos", bytes.NewReader(body)))
	if rec.Code != http.StatusCreated {
		t.Fatalf("expected 201, got %d (%s)", rec.Code, rec.Body)
	}
	if fs.created.RepoURL != "https://github.com/o/r" {
		t.Fatalf("stored repoUrl = %q", fs.created.RepoURL)
	}
	if fs.created.Branch == nil || *fs.created.Branch != "dev" {
		t.Fatalf("stored branch = %v, want dev", fs.created.Branch)
	}
}

func TestCreateSourceExplicitBranchWins(t *testing.T) {
	fs := &fakeStore{gitRepoEnabled: true}
	h := NewHandler(fs, "test-jwt-secret-at-least-32-bytes-long!!", nil)
	body, _ := json.Marshal(map[string]any{"repoUrl": "https://github.com/o/r/tree/dev", "branch": "main"})
	rec := httptest.NewRecorder()
	h.CreateSource(rec, httptest.NewRequest("POST", "/api/kb/kb1/git-repos", bytes.NewReader(body)))
	if rec.Code != http.StatusCreated {
		t.Fatalf("expected 201, got %d (%s)", rec.Code, rec.Body)
	}
	if fs.created.Branch == nil || *fs.created.Branch != "main" {
		t.Fatalf("stored branch = %v, want main", fs.created.Branch)
	}
}

func TestCreateSourceRejectsOwnerPage(t *testing.T) {
	fs := &fakeStore{gitRepoEnabled: true}
	h := NewHandler(fs, "test-jwt-secret-at-least-32-bytes-long!!", nil)
	body, _ := json.Marshal(map[string]any{"repoUrl": "https://github.com/KI4JLU"})
	rec := httptest.NewRecorder()
	h.CreateSource(rec, httptest.NewRequest("POST", "/api/kb/kb1/git-repos", bytes.NewReader(body)))
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d", rec.Code)
	}
	if fs.created != nil {
		t.Fatal("source stored despite refusal")
	}
}

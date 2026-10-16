package files_test

import (
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/justrag/go-backend/internal/files"
	"github.com/justrag/go-backend/internal/kbaccess"
)

// The three file-id routes have no {id} KB in the path, so the kbaccess
// middleware cannot gate them; each handler resolves the caller's role and
// capabilities itself (sourceAccess → kbaccess.EffectiveRole +
// kbaccess.CapabilitiesFor). These tests follow TestRetryForbiddenWithoutEdit:
// the store hands back a KB with the flags under test and the caller's
// kb_members role, and the handler is called directly.
//
// Oracle: the expected status per (route, role, flag), written by hand from
// the spec —
//   - download (GET /api/files/{id}/download, viewer_download_sources): a
//     viewer only with the flag on; an editor regardless of viewer flags.
//   - delete / retry (editor_manage_sources): an editor only with the flag
//     on; a viewer never, even with every flag on.
//
// plus a side-effect check that is independent of the status code: a refused
// download streams no bytes, a refused delete removes nothing, a refused
// retry resets nothing.

func sourcePermFile() *files.FileInfo {
	return &files.FileInfo{
		ID: "file-1", KbID: "kb-1", Name: "doc.pdf", Type: "application/pdf",
		StoragePath: strPtr("owner/kb-1/doc.pdf"),
	}
}

var everyFlag = kbaccess.SourcePermissions{
	ViewerSeeSources: true, ViewerSelectSources: true, ViewerDownloadSources: true,
	ViewerSeeCitations: true, EditorManageSources: true,
}

// allBut returns every flag on except the one cleared by clear, so an "off"
// case cannot pass because some unrelated flag was also off.
func allBut(clear func(*kbaccess.SourcePermissions)) kbaccess.SourcePermissions {
	p := everyFlag
	clear(&p)
	return p
}

func onlyDownload(p *kbaccess.SourcePermissions) { p.ViewerDownloadSources = false }
func onlyManage(p *kbaccess.SourcePermissions)   { p.EditorManageSources = false }

func TestDownloadFollowsViewerDownloadSources(t *testing.T) {
	cases := []struct {
		name  string
		role  string
		flags kbaccess.SourcePermissions
		want  int
	}{
		{"viewer_flag_on", kbaccess.RoleView, kbaccess.SourcePermissions{ViewerDownloadSources: true}, http.StatusOK},
		{"viewer_flag_off", kbaccess.RoleView, allBut(onlyDownload), http.StatusForbidden},
		{"editor_flag_on", kbaccess.RoleEdit, kbaccess.SourcePermissions{ViewerDownloadSources: true}, http.StatusOK},
		{"editor_flag_off", kbaccess.RoleEdit, kbaccess.SourcePermissions{}, http.StatusOK},
		{"kb_admin_flag_off", kbaccess.RoleAdmin, kbaccess.SourcePermissions{}, http.StatusOK},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			store := &mockStore{
				file: sourcePermFile(),
				kb:   &kbaccess.KnowledgeBase{ID: "kb-1", UserID: strPtr("owner"), Sources: tc.flags},
				role: tc.role,
			}
			stor := &mockStorage{stream: io.NopCloser(strings.NewReader("PDF content"))}
			h := files.NewHandler(store, stor, noopChunks())

			req := newRequest(http.MethodGet, "/api/files/file-1/download")
			req.SetPathValue("id", "file-1")
			req = withUser(req, ownerUser())
			rr := httptest.NewRecorder()
			h.Download(rr, req)

			if rr.Code != tc.want {
				t.Fatalf("status %d, want %d", rr.Code, tc.want)
			}
			streamed := rr.Body.String() == "PDF content"
			if streamed != (tc.want == http.StatusOK) {
				t.Fatalf("file content streamed = %v with status %d", streamed, rr.Code)
			}
		})
	}
}

func TestDeleteFollowsEditorManageSources(t *testing.T) {
	cases := []struct {
		name  string
		role  string
		flags kbaccess.SourcePermissions
		want  int
	}{
		{"editor_flag_on", kbaccess.RoleEdit, kbaccess.SourcePermissions{EditorManageSources: true}, http.StatusNoContent},
		{"editor_flag_off", kbaccess.RoleEdit, allBut(onlyManage), http.StatusForbidden},
		{"viewer_every_flag_on", kbaccess.RoleView, everyFlag, http.StatusForbidden},
		{"viewer_flag_off", kbaccess.RoleView, kbaccess.SourcePermissions{}, http.StatusForbidden},
		{"kb_admin_flag_off", kbaccess.RoleAdmin, kbaccess.SourcePermissions{}, http.StatusNoContent},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			store := &mockStore{
				file: sourcePermFile(),
				kb:   &kbaccess.KnowledgeBase{ID: "kb-1", UserID: strPtr("owner"), Sources: tc.flags},
				role: tc.role,
			}
			h := files.NewHandler(store, &mockStorage{}, noopChunks())

			req := newRequest(http.MethodDelete, "/api/files/file-1")
			req.SetPathValue("id", "file-1")
			req = withUser(req, ownerUser())
			rr := httptest.NewRecorder()
			h.Delete(rr, req)

			if rr.Code != tc.want {
				t.Fatalf("status %d, want %d", rr.Code, tc.want)
			}
			deleted := len(store.deletedIDs) > 0
			if deleted != (tc.want == http.StatusNoContent) {
				t.Fatalf("file row deleted = %v with status %d", deleted, rr.Code)
			}
		})
	}
}

func TestRetryFollowsEditorManageSources(t *testing.T) {
	cases := []struct {
		name  string
		role  string
		flags kbaccess.SourcePermissions
		want  int
	}{
		{"editor_flag_on", kbaccess.RoleEdit, kbaccess.SourcePermissions{EditorManageSources: true}, http.StatusOK},
		{"editor_flag_off", kbaccess.RoleEdit, allBut(onlyManage), http.StatusForbidden},
		{"viewer_every_flag_on", kbaccess.RoleView, everyFlag, http.StatusForbidden},
		{"viewer_flag_off", kbaccess.RoleView, kbaccess.SourcePermissions{}, http.StatusForbidden},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			store := retryFixtureStore()
			store.kb = &kbaccess.KnowledgeBase{ID: "kb-1", UserID: strPtr("someone-else"), Sources: tc.flags}
			store.role = tc.role
			enq := &recordingEnqueuer{}
			h := files.NewHandlerWithEnqueuer(store, &mockStorage{}, &mockChunkDeleter{}, enq)

			w := doRetry(h)

			if w.Code != tc.want {
				t.Fatalf("status %d, want %d", w.Code, tc.want)
			}
			if store.resetCalled != (tc.want == http.StatusOK) || (len(enq.tasks) > 0) != (tc.want == http.StatusOK) {
				t.Fatalf("reset called = %v, tasks = %d with status %d", store.resetCalled, len(enq.tasks), w.Code)
			}
		})
	}
}

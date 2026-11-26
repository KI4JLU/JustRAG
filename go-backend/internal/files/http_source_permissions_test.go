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
//   - download (GET /api/files/{id}/download): a viewer only with
//     viewer_see_sources AND viewer_download_sources on, an editor only
//     with editor_see_sources AND editor_download_sources on (the pyramid:
//     download requires seeing the sources); the other role's flags never
//     help, and the preview flag never grants the download.
//   - preview (GET /api/files/{id}/preview): as download, but the role's
//     preview flag OR its download flag will do (download includes the
//     preview, Sten 2026-11-24).
//   - delete / retry ("edit sources", fixed by role): an editor whenever
//     editor_see_sources is on (the pyramid), whatever the other flags; a
//     viewer never, even with every flag on.
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
	ViewerSeeSources: true, ViewerPreviewSources: true, ViewerDownloadSources: true, ViewerSeeCitations: true,
	EditorSeeSources: true, EditorAddSources: true, EditorPreviewSources: true, EditorDownloadSources: true,
	EditorSeeCitations: true,
}

// allBut returns every flag on except the one cleared by clear, so an "off"
// case cannot pass because some unrelated flag was also off.
func allBut(clear func(*kbaccess.SourcePermissions)) kbaccess.SourcePermissions {
	p := everyFlag
	clear(&p)
	return p
}

func viewerDownload(p *kbaccess.SourcePermissions) { p.ViewerDownloadSources = false }
func editorDownload(p *kbaccess.SourcePermissions) { p.EditorDownloadSources = false }

// viewerReadOff / editorReadOff clear both flags that grant the preview.
func viewerReadOff(p *kbaccess.SourcePermissions) {
	p.ViewerPreviewSources, p.ViewerDownloadSources = false, false
}

func editorReadOff(p *kbaccess.SourcePermissions) {
	p.EditorPreviewSources, p.EditorDownloadSources = false, false
}

func TestDownloadFollowsDownloadSourcesFlags(t *testing.T) {
	cases := []struct {
		name  string
		role  string
		flags kbaccess.SourcePermissions
		want  int
	}{
		{"viewer_flag_on", kbaccess.RoleView, kbaccess.SourcePermissions{ViewerSeeSources: true, ViewerDownloadSources: true}, http.StatusOK},
		{"viewer_flag_on_see_off", kbaccess.RoleView, allBut(func(p *kbaccess.SourcePermissions) { p.ViewerSeeSources = false }), http.StatusForbidden},
		{"viewer_flag_off", kbaccess.RoleView, allBut(viewerDownload), http.StatusForbidden},
		{"viewer_preview_only", kbaccess.RoleView, kbaccess.SourcePermissions{ViewerSeeSources: true, ViewerPreviewSources: true}, http.StatusForbidden},
		{"editor_flag_on", kbaccess.RoleEdit, kbaccess.SourcePermissions{EditorSeeSources: true, EditorDownloadSources: true}, http.StatusOK},
		{"editor_flag_on_see_off", kbaccess.RoleEdit, allBut(func(p *kbaccess.SourcePermissions) { p.EditorSeeSources = false }), http.StatusForbidden},
		{"editor_flag_off", kbaccess.RoleEdit, allBut(editorDownload), http.StatusForbidden},
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

func TestPreviewFollowsPreviewSourcesFlags(t *testing.T) {
	cases := []struct {
		name  string
		role  string
		flags kbaccess.SourcePermissions
		want  int
	}{
		{"viewer_preview_on", kbaccess.RoleView, kbaccess.SourcePermissions{ViewerSeeSources: true, ViewerPreviewSources: true}, http.StatusOK},
		{"viewer_download_on", kbaccess.RoleView, kbaccess.SourcePermissions{ViewerSeeSources: true, ViewerDownloadSources: true}, http.StatusOK},
		{"viewer_preview_on_see_off", kbaccess.RoleView, allBut(func(p *kbaccess.SourcePermissions) { p.ViewerSeeSources = false }), http.StatusForbidden},
		{"viewer_preview_and_download_off", kbaccess.RoleView, allBut(viewerReadOff), http.StatusForbidden},
		{"editor_preview_on", kbaccess.RoleEdit, kbaccess.SourcePermissions{EditorSeeSources: true, EditorPreviewSources: true}, http.StatusOK},
		{"editor_preview_and_download_off", kbaccess.RoleEdit, allBut(editorReadOff), http.StatusForbidden},
		{"kb_admin_flags_off", kbaccess.RoleAdmin, kbaccess.SourcePermissions{}, http.StatusOK},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			file := sourcePermFile()
			file.ID = textPreviewFileID
			store := &mockStore{
				file: file,
				kb:   &kbaccess.KnowledgeBase{ID: "kb-1", UserID: strPtr("owner"), Sources: tc.flags},
				role: tc.role,
			}
			stor := &mockStorage{stream: io.NopCloser(strings.NewReader("PDF content"))}
			h := files.NewHandler(store, stor, noopChunks())

			req := newRequest(http.MethodGet, "/api/files/"+textPreviewFileID+"/preview")
			req.SetPathValue("id", textPreviewFileID)
			req = withUser(req, ownerUser())
			rr := httptest.NewRecorder()
			h.Preview(rr, req)

			if rr.Code != tc.want {
				t.Fatalf("status %d, want %d", rr.Code, tc.want)
			}
			streamed := rr.Body.String() == "PDF content"
			if streamed != (tc.want == http.StatusOK) {
				t.Fatalf("file content streamed = %v with status %d", streamed, rr.Code)
			}
			if tc.want == http.StatusOK && !strings.HasPrefix(rr.Header().Get("Content-Disposition"), "inline;") {
				t.Fatalf("Content-Disposition = %q, want inline", rr.Header().Get("Content-Disposition"))
			}
		})
	}
}

// A path id that is not a UUID is refused before any lookup.
func TestPreviewRejectsInvalidID(t *testing.T) {
	h := files.NewHandler(&mockStore{}, &mockStorage{}, noopChunks())
	req := newRequest(http.MethodGet, "/api/files/urn:uuid:x/preview")
	req.SetPathValue("id", "urn:uuid:x")
	req = withUser(req, ownerUser())
	rr := httptest.NewRecorder()
	h.Preview(rr, req)
	if rr.Code != http.StatusBadRequest {
		t.Fatalf("status %d, want 400", rr.Code)
	}
}

func TestDeleteNeedsManageSources(t *testing.T) {
	cases := []struct {
		name  string
		role  string
		flags kbaccess.SourcePermissions
		want  int
	}{
		{"editor_every_flag_on", kbaccess.RoleEdit, everyFlag, http.StatusNoContent},
		{"editor_see_only", kbaccess.RoleEdit, kbaccess.SourcePermissions{EditorSeeSources: true}, http.StatusNoContent},
		{"editor_see_off", kbaccess.RoleEdit, allBut(func(p *kbaccess.SourcePermissions) { p.EditorSeeSources = false }), http.StatusForbidden},
		{"viewer_every_flag_on", kbaccess.RoleView, everyFlag, http.StatusForbidden},
		{"viewer_no_flags", kbaccess.RoleView, kbaccess.SourcePermissions{}, http.StatusForbidden},
		{"kb_admin_no_flags", kbaccess.RoleAdmin, kbaccess.SourcePermissions{}, http.StatusNoContent},
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

func TestRetryNeedsManageSources(t *testing.T) {
	cases := []struct {
		name  string
		role  string
		flags kbaccess.SourcePermissions
		want  int
	}{
		{"editor_every_flag_on", kbaccess.RoleEdit, everyFlag, http.StatusOK},
		{"editor_see_only", kbaccess.RoleEdit, kbaccess.SourcePermissions{EditorSeeSources: true}, http.StatusOK},
		{"editor_see_off", kbaccess.RoleEdit, allBut(func(p *kbaccess.SourcePermissions) { p.EditorSeeSources = false }), http.StatusForbidden},
		{"viewer_every_flag_on", kbaccess.RoleView, everyFlag, http.StatusForbidden},
		{"viewer_no_flags", kbaccess.RoleView, kbaccess.SourcePermissions{}, http.StatusForbidden},
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

// The file-id routes honour a preview like the KB routes do. Oracle: the
// preview contract on kbaccess.PreviewRoleHeader — reads are served as the
// previewed role (an owner previewing a viewer without viewer_preview_sources
// is refused the in-app preview), a preview never writes (delete and retry
// are refused before anything changes), and a malformed value is a 400.
func TestFileRoutesHonourPreview(t *testing.T) {
	noViewerPreview := kbaccess.SourcePermissions{ViewerSeeSources: true}
	cases := []struct {
		name, method, preview string
		want                  int
	}{
		{"owner previews viewer, preview refused", http.MethodGet, kbaccess.RoleView, http.StatusForbidden},
		{"owner without preview, preview served", http.MethodGet, "", http.StatusOK},
		{"malformed preview", http.MethodGet, "owner", http.StatusBadRequest},
		{"delete in a preview", http.MethodDelete, kbaccess.RoleEdit, http.StatusForbidden},
		{"delete malformed preview", http.MethodDelete, "x", http.StatusBadRequest},
		{"delete without preview", http.MethodDelete, "", http.StatusNoContent},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			file := sourcePermFile()
			file.ID = textPreviewFileID
			store := &mockStore{
				file: file,
				kb:   &kbaccess.KnowledgeBase{ID: "kb-1", UserID: strPtr("owner"), Sources: noViewerPreview},
				role: kbaccess.RoleOwner,
			}
			stor := &mockStorage{stream: io.NopCloser(strings.NewReader("PDF content"))}
			h := files.NewHandler(store, stor, noopChunks())

			path := "/api/files/" + textPreviewFileID
			if tc.method == http.MethodGet {
				path += "/preview"
			}
			req := newRequest(tc.method, path)
			req.SetPathValue("id", textPreviewFileID)
			if tc.preview != "" {
				req.Header.Set(kbaccess.PreviewRoleHeader, tc.preview)
			}
			req = withUser(req, ownerUser())
			rr := httptest.NewRecorder()
			if tc.method == http.MethodGet {
				h.Preview(rr, req)
			} else {
				h.Delete(rr, req)
			}
			if rr.Code != tc.want {
				t.Fatalf("status %d, want %d (body %s)", rr.Code, tc.want, rr.Body)
			}
			if deleted := len(store.deletedIDs) > 0; deleted != (tc.want == http.StatusNoContent) {
				t.Fatalf("file row deleted = %v with status %d", deleted, rr.Code)
			}
		})
	}
}

// Retry in a preview is refused before the reset. Oracle: as above.
func TestRetryRefusedInPreview(t *testing.T) {
	store := retryFixtureStore()
	store.kb = &kbaccess.KnowledgeBase{ID: "kb-1", UserID: strPtr("owner")}
	store.role = kbaccess.RoleOwner
	enq := &recordingEnqueuer{}
	h := files.NewHandlerWithEnqueuer(store, &mockStorage{}, &mockChunkDeleter{}, enq)
	req := newRequest(http.MethodPost, "/api/files/file-1/retry")
	req.SetPathValue("id", "file-1")
	req.Header.Set(kbaccess.PreviewRoleHeader, kbaccess.RoleEdit)
	req = withUser(req, ownerUser())
	rr := httptest.NewRecorder()
	h.Retry(rr, req)
	if rr.Code != http.StatusForbidden || store.resetCalled || len(enq.tasks) > 0 {
		t.Fatalf("status %d, reset %v, tasks %d; want 403 and nothing changed", rr.Code, store.resetCalled, len(enq.tasks))
	}
}

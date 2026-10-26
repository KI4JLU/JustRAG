package files_test

import (
	"archive/zip"
	"bytes"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/justrag/go-backend/internal/files"
	"github.com/justrag/go-backend/internal/kbaccess"
)

const textPreviewFileID = "6f1c2a3b-4d5e-4f60-8a7b-9c0d1e2f3a4b"

// docxBytes builds a minimal Word document holding paragraphs.
func docxBytes(t *testing.T, paragraphs ...string) []byte {
	t.Helper()
	var body strings.Builder
	for _, p := range paragraphs {
		body.WriteString(`<w:p><w:r><w:t>` + p + `</w:t></w:r></w:p>`)
	}
	var buf bytes.Buffer
	zw := zip.NewWriter(&buf)
	f, err := zw.Create("word/document.xml")
	if err != nil {
		t.Fatal(err)
	}
	doc := `<?xml version="1.0" encoding="UTF-8"?>` +
		`<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>` +
		body.String() + `</w:body></w:document>`
	if _, err := f.Write([]byte(doc)); err != nil {
		t.Fatal(err)
	}
	if err := zw.Close(); err != nil {
		t.Fatal(err)
	}
	return buf.Bytes()
}

// textPreviewRequest runs GET /api/files/{id}/text as the owner of a KB
// holding one file named name with type mime and the given stored bytes.
func textPreviewRequest(t *testing.T, id, name, mime string, blob []byte, role string) *httptest.ResponseRecorder {
	t.Helper()
	ownerID := "user-1"
	store := &mockStore{
		file: &files.FileInfo{
			ID: textPreviewFileID, KbID: "kb-1", Name: name, Type: mime,
			StoragePath: strPtr("users/user-1/" + textPreviewFileID),
		},
		kb:   &kbaccess.KnowledgeBase{ID: "kb-1", UserID: &ownerID},
		role: role,
	}
	stor := &mockStorage{stream: io.NopCloser(bytes.NewReader(blob))}
	h := files.NewHandler(store, stor, noopChunks())

	req := newRequest(http.MethodGet, "/api/files/"+id+"/text")
	req.SetPathValue("id", id)
	req = withUser(req, ownerUser())
	rr := httptest.NewRecorder()
	h.Text(rr, req)
	return rr
}

func errorCode(t *testing.T, rr *httptest.ResponseRecorder) string {
	t.Helper()
	var body struct {
		Code string `json:"code"`
	}
	if err := json.Unmarshal(rr.Body.Bytes(), &body); err != nil {
		t.Fatalf("decode error body %q: %v", rr.Body.String(), err)
	}
	return body.Code
}

// The oracle is the document's own paragraphs: the preview returns exactly
// the text the Word file holds, in order.
func TestText_ExtractsWordDocument(t *testing.T) {
	blob := docxBytes(t, "Hallo Welt", "Zweiter Absatz")
	rr := textPreviewRequest(t, textPreviewFileID, "Bericht.docx",
		"application/vnd.openxmlformats-officedocument.wordprocessingml.document", blob, kbaccess.RoleOwner)

	if rr.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200; body %s", rr.Code, rr.Body.String())
	}
	var body struct {
		Text     string `json:"text"`
		Markdown bool   `json:"markdown"`
	}
	if err := json.Unmarshal(rr.Body.Bytes(), &body); err != nil {
		t.Fatal(err)
	}
	first, second := strings.Index(body.Text, "Hallo Welt"), strings.Index(body.Text, "Zweiter Absatz")
	if first < 0 || second < first {
		t.Errorf("text = %q, want both paragraphs in order", body.Text)
	}
	if body.Markdown {
		t.Error("markdown = true for a Word document, want false")
	}
}

// A stored name without the extension still resolves by MIME type (a
// Confluence attachment's title).
func TestText_MatchesByMimeType(t *testing.T) {
	blob := docxBytes(t, "Anhang")
	rr := textPreviewRequest(t, textPreviewFileID, "Protokoll Sitzung",
		"application/vnd.openxmlformats-officedocument.wordprocessingml.document", blob, kbaccess.RoleOwner)
	if rr.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200; body %s", rr.Code, rr.Body.String())
	}
}

func TestText_Refusals(t *testing.T) {
	tests := []struct {
		name       string
		id         string
		fileName   string
		mime       string
		blob       []byte
		role       string
		wantStatus int
		wantCode   string
	}{
		{
			name: "pdf is previewed from the download", id: textPreviewFileID,
			fileName: "a.pdf", mime: "application/pdf", blob: []byte("%PDF-1.7"), role: kbaccess.RoleOwner,
			wantStatus: http.StatusUnsupportedMediaType, wantCode: "unsupported_file_type",
		},
		{
			name: "image is previewed from the download", id: textPreviewFileID,
			fileName: "a.png", mime: "image/png", blob: []byte{0x89, 'P', 'N', 'G'}, role: kbaccess.RoleOwner,
			wantStatus: http.StatusUnsupportedMediaType, wantCode: "unsupported_file_type",
		},
		{
			name: "corrupt word file", id: textPreviewFileID,
			fileName: "kaputt.docx", mime: "", blob: []byte("not a zip"), role: kbaccess.RoleOwner,
			wantStatus: http.StatusUnprocessableEntity, wantCode: "file_unreadable",
		},
		{
			name: "invalid id", id: "file-abc",
			fileName: "a.docx", role: kbaccess.RoleOwner,
			wantStatus: http.StatusBadRequest,
		},
		{
			name: "no role on the KB", id: textPreviewFileID,
			fileName: "a.docx", blob: docxBytes(t, "geheim"), role: "",
			wantStatus: http.StatusForbidden,
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			rr := textPreviewRequest(t, tt.id, tt.fileName, tt.mime, tt.blob, tt.role)
			if rr.Code != tt.wantStatus {
				t.Fatalf("status = %d, want %d; body %s", rr.Code, tt.wantStatus, rr.Body.String())
			}
			if tt.wantCode != "" {
				if got := errorCode(t, rr); got != tt.wantCode {
					t.Errorf("code = %q, want %q", got, tt.wantCode)
				}
			}
		})
	}
}

func TestText_Unauthenticated(t *testing.T) {
	h := files.NewHandler(&mockStore{}, &mockStorage{}, noopChunks())
	req := newRequest(http.MethodGet, "/api/files/"+textPreviewFileID+"/text")
	req.SetPathValue("id", textPreviewFileID)
	rr := httptest.NewRecorder()
	h.Text(rr, req)
	if rr.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d, want 401", rr.Code)
	}
}

// The text preview reads what the download would hand out, so it follows the
// same flags. Oracle: the download's expected status per case, from
// TestDownloadFollowsDownloadSourcesFlags; a refused request returns no text.
func TestTextFollowsDownloadSourcesFlags(t *testing.T) {
	cases := []struct {
		name  string
		role  string
		flags kbaccess.SourcePermissions
		want  int
	}{
		{"viewer_flag_on", kbaccess.RoleView, kbaccess.SourcePermissions{ViewerSeeSources: true, ViewerDownloadSources: true}, http.StatusOK},
		{"viewer_flag_on_see_off", kbaccess.RoleView, allBut(func(p *kbaccess.SourcePermissions) { p.ViewerSeeSources = false }), http.StatusForbidden},
		{"viewer_flag_off", kbaccess.RoleView, allBut(viewerDownload), http.StatusForbidden},
		{"editor_flag_off", kbaccess.RoleEdit, allBut(editorDownload), http.StatusForbidden},
		{"kb_admin_flag_off", kbaccess.RoleAdmin, kbaccess.SourcePermissions{}, http.StatusOK},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			store := &mockStore{
				file: &files.FileInfo{
					ID: textPreviewFileID, KbID: "kb-1", Name: "geheim.docx",
					StoragePath: strPtr("owner/kb-1/geheim.docx"),
				},
				kb:   &kbaccess.KnowledgeBase{ID: "kb-1", UserID: strPtr("owner"), Sources: tc.flags},
				role: tc.role,
			}
			stor := &mockStorage{stream: io.NopCloser(bytes.NewReader(docxBytes(t, "Geheimer Inhalt")))}
			h := files.NewHandler(store, stor, noopChunks())

			req := newRequest(http.MethodGet, "/api/files/"+textPreviewFileID+"/text")
			req.SetPathValue("id", textPreviewFileID)
			req = withUser(req, ownerUser())
			rr := httptest.NewRecorder()
			h.Text(rr, req)

			if rr.Code != tc.want {
				t.Fatalf("status %d, want %d", rr.Code, tc.want)
			}
			leaked := strings.Contains(rr.Body.String(), "Geheimer Inhalt")
			if leaked != (tc.want == http.StatusOK) {
				t.Fatalf("text returned = %v with status %d", leaked, rr.Code)
			}
		})
	}
}

// Oracle: the archive's declared uncompressed size. A Word file that would
// expand past the limit is refused before any parser reads it.
func TestText_RefusesAnArchiveThatExpandsPastTheLimit(t *testing.T) {
	defer files.SetTextPreviewMaxExpanded(64)()
	blob := docxBytes(t, strings.Repeat("Absatz ", 100))
	rr := textPreviewRequest(t, textPreviewFileID, "gross.docx", "", blob, kbaccess.RoleOwner)
	if rr.Code != http.StatusRequestEntityTooLarge {
		t.Fatalf("status = %d, want 413; body %s", rr.Code, rr.Body.String())
	}
	if got := errorCode(t, rr); got != "file_too_large" {
		t.Errorf("code = %q, want file_too_large", got)
	}
}

package kb_test

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/justrag/go-backend/internal/auth"
	"github.com/justrag/go-backend/internal/kb"
	"github.com/justrag/go-backend/internal/kbaccess"
	"github.com/justrag/go-backend/internal/store"
)

// ---------------------------------------------------------------------------
// Mock store
// ---------------------------------------------------------------------------

var _ kb.UpdateStore = (*mockUpdateStore)(nil)

type mockUpdateStore struct {
	kb    *kb.KBRow
	files []kb.FileRow
	total int
	err   error

	// reread, when set, is what GetKnowledgeBase returns instead of kb, so a
	// test can tell the re-read row apart from the update's RETURNING row.
	reread                         *kb.KBRow
	rereadErr                      error
	rereadCalls                    int
	gotRereadKBID, gotRereadUserID string
}

func (m *mockUpdateStore) UpdateKnowledgeBase(_ context.Context, _ string, _ kb.KBUpdate) (*kb.KBRow, error) {
	return m.kb, m.err
}

func (m *mockUpdateStore) GetKnowledgeBase(_ context.Context, kbID, userID string) (*kb.KBRow, error) {
	m.rereadCalls++
	m.gotRereadKBID, m.gotRereadUserID = kbID, userID
	if m.rereadErr != nil {
		return nil, m.rereadErr
	}
	if m.reread != nil {
		return m.reread, nil
	}
	return m.kb, nil
}

func (m *mockUpdateStore) ListFiles(_ context.Context, _ string, _, _ int) ([]kb.FileRow, int, error) {
	return m.files, m.total, m.err
}

func (m *mockUpdateStore) GetKBChunkConfig(_ context.Context, _ string) (int, int, error) {
	return 0, 0, m.err
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// injectKBAccess returns a copy of r with a KBAccessResult injected into the
// context, mirroring what kbaccess.RequireKBRole does in production.
func injectKBAccess(r *http.Request, kbID string) *http.Request {
	return injectKBAccessAs(r, &kbaccess.KnowledgeBase{ID: kbID, IsGlobal: false}, kbaccess.RoleOwner, auth.RoleUser)
}

// injectKBAccessAs is the explicit-role variant: it injects both the resolved
// KBAccessResult (role) and the auth claims (system role), which is what the
// rename gate reads.
func injectKBAccessAs(r *http.Request, kbRow *kbaccess.KnowledgeBase, role, sysRole string) *http.Request {
	access := &kbaccess.KBAccessResult{
		KB:      kbRow,
		IsOwner: role == kbaccess.RoleOwner,
		Role:    role,
	}
	ctx := kbaccess.WithAccess(r.Context(), access)
	ctx = auth.WithUser(ctx, &auth.Claims{ID: "user-1", Username: "u", Role: sysRole})
	return r.WithContext(ctx)
}

func makeKBRow(id, name string) *kb.KBRow {
	desc := "Test description"
	lang := "de"
	return &kb.KBRow{
		ID:          id,
		Name:        name,
		Description: &desc,
		Language:    lang,
		IsGlobal:    false,
		IsPublished: true,
		CreatedAt:   time.Date(2024, 1, 1, 0, 0, 0, 0, time.UTC),
	}
}

func makeFileRow(id, name string) kb.FileRow {
	size := 1024
	return kb.FileRow{
		ID:        id,
		Name:      name,
		Type:      "pdf",
		Size:      &size,
		Status:    "ready",
		Progress:  100,
		Origin:    "upload",
		CreatedAt: time.Date(2024, 6, 1, 0, 0, 0, 0, time.UTC),
	}
}

// ---------------------------------------------------------------------------
// UpdateKB tests
// ---------------------------------------------------------------------------

// TestUpdateKB_Valid checks that a valid PATCH body returns the updated KB with 200.
func TestUpdateKB_Valid(t *testing.T) {
	store := &mockUpdateStore{
		kb: makeKBRow("kb-1", "Updated KB"),
	}
	h := kb.NewUpdateHandler(store, nil)

	body := map[string]any{"name": "Updated KB"}
	b, _ := json.Marshal(body)

	r := httptest.NewRequest(http.MethodPatch, "/api/kb/kb-1", bytes.NewReader(b))
	r.Header.Set("Content-Type", "application/json")
	r = injectKBAccess(r, "kb-1")

	w := httptest.NewRecorder()
	h.UpdateKB(w, r)

	resp := w.Result()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("expected 200, got %d", resp.StatusCode)
	}

	var result kb.KBRow
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		t.Fatalf("failed to decode response: %v", err)
	}
	if result.ID != "kb-1" {
		t.Errorf("expected id=kb-1, got %q", result.ID)
	}
	if result.Name != "Updated KB" {
		t.Errorf("expected name=%q, got %q", "Updated KB", result.Name)
	}
}

// TestUpdateKB_NotFound checks that store.ErrNotFound yields 404.
func TestUpdateKB_NotFound(t *testing.T) {
	mockStore := &mockUpdateStore{err: store.ErrNotFound}
	h := kb.NewUpdateHandler(mockStore, nil)

	body := map[string]any{"name": "Ghost KB"}
	b, _ := json.Marshal(body)

	r := httptest.NewRequest(http.MethodPatch, "/api/kb/missing", bytes.NewReader(b))
	r.Header.Set("Content-Type", "application/json")
	r = injectKBAccess(r, "missing")

	w := httptest.NewRecorder()
	h.UpdateKB(w, r)

	if w.Result().StatusCode != http.StatusNotFound {
		t.Fatalf("expected 404, got %d", w.Result().StatusCode)
	}
}

// TestUpdateKB_ReturnsTheCallerAwareRow pins the PATCH response shape: the UI
// replaces its card with it, so it must be the caller-aware GET row (stats,
// favorite, categories), not the update's RETURNING row. The fake returns
// two visibly different rows from the two calls; the oracle is which one the
// test put where, and the user id the request was authenticated as.
func TestUpdateKB_ReturnsTheCallerAwareRow(t *testing.T) {
	returning := makeKBRow("kb-1", "Renamed")
	reread := makeKBRow("kb-1", "Renamed")
	reread.FileCount = 7
	reread.UserFilters = &kb.UserFilters{IsFavorite: true, UserCategoryIDs: []string{"cat-1"}}
	st := &mockUpdateStore{kb: returning, reread: reread}
	h := kb.NewUpdateHandler(st, nil)

	r := httptest.NewRequest(http.MethodPatch, "/api/kb/kb-1", strings.NewReader(`{"description":"d"}`))
	r = injectKBAccess(r, "kb-1")
	w := httptest.NewRecorder()
	h.UpdateKB(w, r)

	if w.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200 (body: %s)", w.Code, w.Body)
	}
	if st.rereadCalls != 1 || st.gotRereadKBID != "kb-1" || st.gotRereadUserID != "user-1" {
		t.Fatalf("re-read calls=%d kb=%q user=%q, want one call for (kb-1, user-1)",
			st.rereadCalls, st.gotRereadKBID, st.gotRereadUserID)
	}
	var got map[string]any
	if err := json.Unmarshal(w.Body.Bytes(), &got); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if got["fileCount"] != float64(7) {
		t.Errorf("fileCount = %v, want 7 from the re-read row", got["fileCount"])
	}
	if got["isFavorite"] != true {
		t.Errorf("isFavorite = %v, want true from the re-read row", got["isFavorite"])
	}
	if ids, ok := got["userCategoryIds"].([]any); !ok || len(ids) != 1 || ids[0] != "cat-1" {
		t.Errorf("userCategoryIds = %v, want [cat-1]", got["userCategoryIds"])
	}
}

// A KB deleted between the write and the re-read is a 404, and a failed
// re-read is a 500 — never a silent fallback to the incomplete RETURNING row.
func TestUpdateKB_RereadFailures(t *testing.T) {
	h := kb.NewUpdateHandler(&goneAfterUpdateStore{&mockUpdateStore{kb: makeKBRow("kb-1", "x")}}, nil)
	r := injectKBAccess(httptest.NewRequest(http.MethodPatch, "/api/kb/kb-1", strings.NewReader(`{}`)), "kb-1")
	w := httptest.NewRecorder()
	h.UpdateKB(w, r)
	if w.Code != http.StatusNotFound {
		t.Errorf("deleted before re-read: status = %d, want 404", w.Code)
	}

	broken := &mockUpdateStore{kb: makeKBRow("kb-1", "x"), rereadErr: errors.New("db down")}
	h = kb.NewUpdateHandler(broken, nil)
	r = injectKBAccess(httptest.NewRequest(http.MethodPatch, "/api/kb/kb-1", strings.NewReader(`{}`)), "kb-1")
	w = httptest.NewRecorder()
	h.UpdateKB(w, r)
	if w.Code != http.StatusInternalServerError {
		t.Errorf("failed re-read: status = %d, want 500", w.Code)
	}
}

// goneAfterUpdateStore succeeds the update and then finds no row on re-read.
type goneAfterUpdateStore struct{ *mockUpdateStore }

func (g *goneAfterUpdateStore) GetKnowledgeBase(_ context.Context, _, _ string) (*kb.KBRow, error) {
	return nil, nil
}

// TestUpdateKB_InvalidBody checks that a malformed body yields 400.
func TestUpdateKB_InvalidBody(t *testing.T) {
	store := &mockUpdateStore{}
	h := kb.NewUpdateHandler(store, nil)

	r := httptest.NewRequest(http.MethodPatch, "/api/kb/kb-1", bytes.NewReader([]byte("not-json")))
	r.Header.Set("Content-Type", "application/json")
	r = injectKBAccess(r, "kb-1")

	w := httptest.NewRecorder()
	h.UpdateKB(w, r)

	if w.Result().StatusCode != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d", w.Result().StatusCode)
	}
}

// ---------------------------------------------------------------------------
// ListFiles tests
// ---------------------------------------------------------------------------

// TestListFiles_DefaultPagination checks that the default limit/offset are applied
// and that the response envelope matches the store data.
func TestListFiles_DefaultPagination(t *testing.T) {
	files := []kb.FileRow{
		makeFileRow("f-1", "document.pdf"),
		makeFileRow("f-2", "report.pdf"),
	}
	store := &mockUpdateStore{files: files, total: 2}
	h := kb.NewUpdateHandler(store, nil)

	r := httptest.NewRequest(http.MethodGet, "/api/kb/kb-1/files", nil)
	r = injectKBAccess(r, "kb-1")

	w := httptest.NewRecorder()
	h.ListFiles(w, r)

	resp := w.Result()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("expected 200, got %d", resp.StatusCode)
	}

	var result []kb.FileRow
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		t.Fatalf("failed to decode response: %v", err)
	}

	if len(result) != 2 {
		t.Errorf("expected 2 files, got %d", len(result))
	}
	if result[0].ID != "f-1" {
		t.Errorf("expected first file id=f-1, got %q", result[0].ID)
	}
}

// TestListFiles_CustomPagination checks that explicit limit/offset query params are forwarded.
func TestListFiles_CustomPagination(t *testing.T) {
	store := &mockUpdateStore{files: []kb.FileRow{makeFileRow("f-3", "extra.pdf")}, total: 10}
	h := kb.NewUpdateHandler(store, nil)

	r := httptest.NewRequest(http.MethodGet, "/api/kb/kb-1/files?limit=5&offset=5", nil)
	r = injectKBAccess(r, "kb-1")

	w := httptest.NewRecorder()
	h.ListFiles(w, r)

	resp := w.Result()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("expected 200, got %d", resp.StatusCode)
	}

	var files []kb.FileRow
	if err := json.NewDecoder(resp.Body).Decode(&files); err != nil {
		t.Fatalf("failed to decode response: %v", err)
	}
	if len(files) != 1 {
		t.Errorf("expected 1 file, got %d", len(files))
	}
}

// TestListFiles_EmptyResult checks that an empty file list returns an empty array (not null).
func TestListFiles_EmptyResult(t *testing.T) {
	store := &mockUpdateStore{files: nil, total: 0}
	h := kb.NewUpdateHandler(store, nil)

	r := httptest.NewRequest(http.MethodGet, "/api/kb/kb-1/files", nil)
	r = injectKBAccess(r, "kb-1")

	w := httptest.NewRecorder()
	h.ListFiles(w, r)

	resp := w.Result()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("expected 200, got %d", resp.StatusCode)
	}

	var files []kb.FileRow
	if err := json.NewDecoder(resp.Body).Decode(&files); err != nil {
		t.Fatalf("failed to decode response: %v", err)
	}
	if files == nil {
		t.Error("expected non-nil empty array, got null")
	}
	if len(files) != 0 {
		t.Errorf("expected 0 files, got %d", len(files))
	}
}

// TestListFiles_ErrorFieldsSerialized checks that errorStage/errorMessage are
// emitted for errored files and omitted entirely for healthy ones.
func TestListFiles_ErrorFieldsSerialized(t *testing.T) {
	stage, msg := "parse", "The file could not be parsed"
	bad := makeFileRow("f-bad", "broken.pdf")
	bad.Status = "error"
	bad.ErrorStage = &stage
	bad.ErrorMessage = &msg
	good := makeFileRow("f-good", "fine.pdf")

	store := &mockUpdateStore{files: []kb.FileRow{bad, good}, total: 2}
	h := kb.NewUpdateHandler(store, nil)

	r := httptest.NewRequest(http.MethodGet, "/api/kb/kb-1/files", nil)
	r = injectKBAccess(r, "kb-1")
	w := httptest.NewRecorder()
	h.ListFiles(w, r)

	body := w.Body.String()
	if !strings.Contains(body, `"errorStage":"parse"`) {
		t.Errorf("errorStage missing from response: %s", body)
	}
	if !strings.Contains(body, `"errorMessage":"The file could not be parsed"`) {
		t.Errorf("errorMessage missing from response: %s", body)
	}
	if strings.Count(body, "errorStage") != 1 {
		t.Errorf("errorStage must be omitted for non-error files: %s", body)
	}
}

// TestListFiles_StageFieldsSerialized checks that currentStage/stageIndex/stageTotal
// are emitted for in-progress files and omitted entirely for idle ones.
func TestListFiles_StageFieldsSerialized(t *testing.T) {
	stage := "embed"
	idx, total := 3, 5
	active := makeFileRow("f-active", "doc.pdf")
	active.Status = "processing"
	active.CurrentStage = &stage
	active.StageIndex = &idx
	active.StageTotal = &total
	idle := makeFileRow("f-idle", "done.pdf")

	store := &mockUpdateStore{files: []kb.FileRow{active, idle}, total: 2}
	h := kb.NewUpdateHandler(store, nil)

	r := httptest.NewRequest(http.MethodGet, "/api/kb/kb-1/files", nil)
	r = injectKBAccess(r, "kb-1")
	w := httptest.NewRecorder()
	h.ListFiles(w, r)

	body := w.Body.String()
	if !strings.Contains(body, `"currentStage":"embed"`) {
		t.Errorf("currentStage missing: %s", body)
	}
	if !strings.Contains(body, `"stageIndex":3`) {
		t.Errorf("stageIndex missing: %s", body)
	}
	if !strings.Contains(body, `"stageTotal":5`) {
		t.Errorf("stageTotal missing: %s", body)
	}
	if strings.Count(body, "currentStage") != 1 {
		t.Errorf("currentStage must be omitted for idle files: %s", body)
	}
	if strings.Count(body, "stageIndex") != 1 {
		t.Errorf("stageIndex must be omitted for idle files: %s", body)
	}
	if strings.Count(body, "stageTotal") != 1 {
		t.Errorf("stageTotal must be omitted for idle files: %s", body)
	}
}

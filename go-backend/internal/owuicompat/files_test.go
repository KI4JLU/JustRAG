package owuicompat

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"unicode/utf8"

	"github.com/justrag/go-backend/internal/cascade"
	"github.com/justrag/go-backend/internal/uploadcheck"
	"github.com/justrag/go-backend/internal/userfiles"
)

type fakeLibrary struct {
	bySHA map[string]*userfiles.UserFile // content → row (dedup)
	n     int
}

func (l *fakeLibrary) Ingest(_ context.Context, owner string, up *uploadcheck.Upload) (*userfiles.UserFile, bool, error) {
	buf := new(bytes.Buffer)
	_, _ = buf.ReadFrom(up.File)
	key := buf.String()
	if l.bySHA == nil {
		l.bySHA = map[string]*userfiles.UserFile{}
	}
	if row, ok := l.bySHA[key]; ok {
		return row, false, nil
	}
	l.n++
	row := &userfiles.UserFile{ID: "00000000-0000-0000-0000-00000000000" + string(rune('0'+l.n)), OwnerUserID: owner, Name: up.Header.Filename}
	l.bySHA[key] = row
	return row, true, nil
}

type fakeDeleter struct {
	fail      error
	files     []string
	userFiles []string
	kbs       []string
}

func (d *fakeDeleter) DeleteFiles(_ context.Context, ids []string) error {
	if d.fail != nil {
		return d.fail
	}
	d.files = append(d.files, ids...)
	return nil
}
func (d *fakeDeleter) DeleteUserFile(_ context.Context, _, id string) error {
	if d.fail != nil {
		return d.fail
	}
	d.userFiles = append(d.userFiles, id)
	return nil
}
func (d *fakeDeleter) DeleteKB(_ context.Context, id string) error {
	d.kbs = append(d.kbs, id)
	return nil
}

func uploadReq(t *testing.T, filename, content, metadata string) *http.Request {
	t.Helper()
	body := new(bytes.Buffer)
	mw := multipart.NewWriter(body)
	fw, _ := mw.CreateFormFile("file", filename)
	_, _ = fw.Write([]byte(content))
	if metadata != "" {
		_ = mw.WriteField("metadata", metadata)
	}
	_ = mw.Close()
	r := httptest.NewRequest("POST", "/owui/api/v1/files/", body)
	r.Header.Set("Content-Type", mw.FormDataContentType())
	return r
}

func newFilesHandler() (*Handler, *fakeStore, *fakeDeleter) {
	st, del := newFakeStore(), &fakeDeleter{}
	return NewHandler(Deps{Store: st, Library: &fakeLibrary{}, Deleter: del, Config: fakeConfig{enabled: true}}), st, del
}

func decode(t *testing.T, rec *httptest.ResponseRecorder) map[string]any {
	t.Helper()
	var m map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &m); err != nil {
		t.Fatalf("body not a JSON object: %q", rec.Body.String())
	}
	return m
}

func TestUploadReturnsIDAndCompleted(t *testing.T) {
	h, st, _ := newFilesHandler()
	rec := do(http.HandlerFunc(h.UploadFile), uploadReq(t, "owui_x_file_81.pdf", "pdfbytes", `{"ilias_title":"Skript","ilias_author":"Doe"}`))
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d body=%s", rec.Code, rec.Body)
	}
	m := decode(t, rec)
	id, _ := m["id"].(string)
	if id == "" || m["data"].(map[string]any)["status"] != "completed" {
		t.Fatalf("body = %v", m)
	}
	h2, _ := st.GetHandle(context.Background(), testOwner, id)
	if h2 == nil || h2.Metadata["ilias_author"] != "Doe" || h2.Unsupported {
		t.Fatalf("stored handle = %+v", h2)
	}
}

func TestUploadUnsupportedTypeIsCompletedNotStored(t *testing.T) {
	h, st, _ := newFilesHandler()
	rec := do(http.HandlerFunc(h.UploadFile), uploadReq(t, "owui_x_file_9.zip", "zipbytes", ""))
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d body=%s", rec.Code, rec.Body)
	}
	id := decode(t, rec)["id"].(string)
	got, _ := st.GetHandle(context.Background(), testOwner, id)
	if got == nil || !got.Unsupported || got.UserFileID != "" {
		t.Fatalf("handle = %+v, want unsupported without user file", got)
	}
	status := do(http.HandlerFunc(h.FileStatus), withID(httptest.NewRequest("GET", "/owui/api/v1/files/"+id, nil), id))
	if decode(t, status)["data"].(map[string]any)["status"] != "completed" {
		t.Fatalf("status body = %s", status.Body)
	}
}

func TestSameBytesGetTwoHandles(t *testing.T) {
	h, _, _ := newFilesHandler()
	a := decode(t, do(http.HandlerFunc(h.UploadFile), uploadReq(t, "a.pdf", "same", "")))["id"]
	b := decode(t, do(http.HandlerFunc(h.UploadFile), uploadReq(t, "b.pdf", "same", "")))["id"]
	if a == b {
		t.Fatal("identical bytes produced one handle id")
	}
}

func TestStatusUnknownIDIs200Failed(t *testing.T) {
	h, _, _ := newFilesHandler()
	for _, id := range []string{"22222222-2222-2222-2222-222222222222", "not-a-uuid"} {
		rec := do(http.HandlerFunc(h.FileStatus), withID(httptest.NewRequest("GET", "/x", nil), id))
		if rec.Code != http.StatusOK || decode(t, rec)["data"].(map[string]any)["status"] != "failed" {
			t.Fatalf("id %q: %d %s", id, rec.Code, rec.Body)
		}
	}
}

func TestListFilesEmptyIDPoll(t *testing.T) {
	h, _, _ := newFilesHandler()
	rec := do(http.HandlerFunc(h.ListFiles), httptest.NewRequest("GET", "/owui/api/v1/files/", nil))
	var arr []any
	if rec.Code != http.StatusOK || json.Unmarshal(rec.Body.Bytes(), &arr) != nil {
		t.Fatalf("want 200 + JSON array, got %d %s", rec.Code, rec.Body)
	}
}

func TestDeleteUnknownIs200Object(t *testing.T) {
	h, _, del := newFilesHandler()
	rec := do(http.HandlerFunc(h.DeleteFile), withID(httptest.NewRequest("DELETE", "/x", nil), "22222222-2222-2222-2222-222222222222"))
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d", rec.Code)
	}
	decode(t, rec)
	if len(del.userFiles)+len(del.files) != 0 {
		t.Fatal("deleter called for an unknown id")
	}
}

func TestDeleteSharedBytesKeepsOtherHandle(t *testing.T) {
	h, st, del := newFilesHandler()
	a := decode(t, do(http.HandlerFunc(h.UploadFile), uploadReq(t, "a.pdf", "same", "")))["id"].(string)
	b := decode(t, do(http.HandlerFunc(h.UploadFile), uploadReq(t, "b.pdf", "same", "")))["id"].(string)

	do(http.HandlerFunc(h.DeleteFile), withID(httptest.NewRequest("DELETE", "/x", nil), a))
	if len(del.userFiles) != 0 {
		t.Fatalf("library file deleted while handle b still uses it: %v", del.userFiles)
	}
	if got, _ := st.GetHandle(context.Background(), testOwner, b); got == nil {
		t.Fatal("handle b vanished")
	}
	do(http.HandlerFunc(h.DeleteFile), withID(httptest.NewRequest("DELETE", "/x", nil), b))
	if len(del.userFiles) != 1 {
		t.Fatalf("library file not deleted with the last handle: %v", del.userFiles)
	}
}

func TestDeleteFileCascadeFailureKeepsHandle(t *testing.T) {
	h, st, del := newFilesHandler()
	id := decode(t, do(http.HandlerFunc(h.UploadFile), uploadReq(t, "a.pdf", "x", "")))["id"].(string)
	del.fail = errors.New("boom")
	rec := do(http.HandlerFunc(h.DeleteFile), withID(httptest.NewRequest("DELETE", "/x", nil), id))
	if rec.Code != http.StatusInternalServerError {
		t.Fatalf("status = %d, want 500", rec.Code)
	}
	if _, ok := decode(t, rec)["detail"]; !ok {
		t.Fatalf("no detail: %s", rec.Body)
	}
	if got, _ := st.GetHandle(context.Background(), testOwner, id); got == nil {
		t.Fatal("handle dropped although the cascade failed")
	}
	del.fail = nil
	rec = do(http.HandlerFunc(h.DeleteFile), withID(httptest.NewRequest("DELETE", "/x", nil), id))
	if rec.Code != http.StatusOK || len(del.userFiles) != 1 {
		t.Fatalf("retry: status=%d userFiles=%v", rec.Code, del.userFiles)
	}
	if got, _ := st.GetHandle(context.Background(), testOwner, id); got != nil {
		t.Fatal("handle still present after successful retry")
	}
}

func TestDeleteFileUserFileNotFoundCountsAsSuccess(t *testing.T) {
	h, st, del := newFilesHandler()
	id := decode(t, do(http.HandlerFunc(h.UploadFile), uploadReq(t, "a.pdf", "x", "")))["id"].(string)
	del.fail = cascade.ErrUserFileNotFound
	rec := do(http.HandlerFunc(h.DeleteFile), withID(httptest.NewRequest("DELETE", "/x", nil), id))
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", rec.Code)
	}
	if got, _ := st.GetHandle(context.Background(), testOwner, id); got != nil {
		t.Fatal("handle kept")
	}
}

func TestUploadUnsupportedLongUmlautNameStaysValidUTF8(t *testing.T) {
	h, st, _ := newFilesHandler()
	rec := do(http.HandlerFunc(h.UploadFile), uploadReq(t, strings.Repeat("ä", 200)+".zip", "zipbytes", ""))
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d body=%s", rec.Code, rec.Body)
	}
	got, _ := st.GetHandle(context.Background(), testOwner, decode(t, rec)["id"].(string))
	if got == nil || !utf8.ValidString(got.Filename) || len(got.Filename) > 255 {
		t.Fatalf("handle = %+v", got)
	}
}

func TestUploadMissingFileFieldIs400Detail(t *testing.T) {
	h, _, _ := newFilesHandler()
	r := httptest.NewRequest("POST", "/owui/api/v1/files/", bytes.NewBufferString("x"))
	r.Header.Set("Content-Type", "multipart/form-data; boundary=zzz")
	rec := do(http.HandlerFunc(h.UploadFile), r)
	if rec.Code != http.StatusBadRequest || decode(t, rec)["detail"] == nil {
		t.Fatalf("got %d %s", rec.Code, rec.Body)
	}
}

// withID sets the {id} path value the ServeMux would set.
func withID(r *http.Request, id string) *http.Request {
	r.SetPathValue("id", id)
	return r
}

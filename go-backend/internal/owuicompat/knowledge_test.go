package owuicompat

import (
	"bytes"
	"context"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/justrag/go-backend/internal/files"
	"github.com/justrag/go-backend/internal/kb"
)

type fakeCreator struct{ names []string }

func (c *fakeCreator) CreateKnowledgeBase(_ context.Context, name string, _ *string, _ string, _ *string) (*kb.KBRow, error) {
	c.names = append(c.names, name)
	return &kb.KBRow{ID: "33333333-3333-3333-3333-33333333333" + string(rune('0'+len(c.names))), Name: name, CreatedAt: time.Now()}, nil
}

type fakeAdder struct {
	st     *fakeStore
	result string // files.AddStatus*
	reason string
	calls  int
}

func (a *fakeAdder) AddLibraryFiles(_ context.Context, _, kbID string, _ bool, ids []string) ([]files.AddResult, error) {
	a.calls++
	out := []files.AddResult{}
	for _, id := range ids {
		// Like the real AddLibraryFiles: a library file already in the KB is a duplicate.
		if _, exists := a.st.kbFiles[kbID+"|"+id]; exists && a.result == files.AddStatusAdded {
			out = append(out, files.AddResult{UserFileID: id, Status: files.AddStatusDuplicate})
			continue
		}
		r := files.AddResult{UserFileID: id, Status: a.result, Error: a.reason}
		if a.result == files.AddStatusAdded {
			r.FileID = "44444444-4444-4444-4444-44444444444" + string(rune('0'+a.calls))
			a.st.kbFiles[kbID+"|"+id] = r.FileID
		}
		out = append(out, r)
	}
	return out, nil
}

func newKnowledgeHandler() (*Handler, *fakeStore, *fakeAdder, *fakeDeleter) {
	st, del := newFakeStore(), &fakeDeleter{}
	add := &fakeAdder{st: st, result: files.AddStatusAdded}
	h := NewHandler(Deps{Store: st, Library: &fakeLibrary{}, Adder: add, Creator: &fakeCreator{},
		Deleter: del, Config: fakeConfig{enabled: true}})
	return h, st, add, del
}

func jsonReq(method, path, body string) *http.Request {
	r := httptest.NewRequest(method, path, bytes.NewBufferString(body))
	r.Header.Set("Content-Type", "application/json")
	return r
}

func createKB(t *testing.T, h *Handler) string {
	t.Helper()
	rec := do(http.HandlerFunc(h.CreateKnowledge), jsonReq("POST", "/x", `{"name":"Statistik I (4711)","description":""}`))
	if rec.Code != http.StatusOK {
		t.Fatalf("create: %d %s", rec.Code, rec.Body)
	}
	return decode(t, rec)["id"].(string)
}

func upload(t *testing.T, h *Handler, name, content string) string {
	t.Helper()
	return decode(t, do(http.HandlerFunc(h.UploadFile), uploadReq(t, name, content, "")))["id"].(string)
}

func TestCreateKnowledgeRegistersOwnership(t *testing.T) {
	h, st, _, _ := newKnowledgeHandler()
	id := createKB(t, h)
	if ok, _ := st.OwnsKnowledge(context.Background(), testOwner, id); !ok {
		t.Fatal("created KB not registered")
	}
}

func TestAddReturnsIDAndIsIdempotent(t *testing.T) {
	h, _, add, _ := newKnowledgeHandler()
	kbID := createKB(t, h)
	fid := upload(t, h, "a.pdf", "a")
	for i := 0; i < 2; i++ {
		if i == 1 {
			add.result = files.AddStatusDuplicate
		}
		rec := do(http.HandlerFunc(h.AddToKnowledge), withID(jsonReq("POST", "/x", `{"file_id":"`+fid+`"}`), kbID))
		if rec.Code != http.StatusOK || decode(t, rec)["id"] != kbID {
			t.Fatalf("add #%d: %d %s", i, rec.Code, rec.Body)
		}
	}
}

func TestAddUnsupportedIsOKWithoutIngest(t *testing.T) {
	h, _, add, _ := newKnowledgeHandler()
	kbID := createKB(t, h)
	fid := upload(t, h, "x.zip", "z")
	rec := do(http.HandlerFunc(h.AddToKnowledge), withID(jsonReq("POST", "/x", `{"file_id":"`+fid+`"}`), kbID))
	if rec.Code != http.StatusOK || decode(t, rec)["id"] != kbID {
		t.Fatalf("got %d %s", rec.Code, rec.Body)
	}
	if add.calls != 0 {
		t.Fatal("unsupported file was sent to ingest")
	}
}

func TestAddKBFullReturnsNoID(t *testing.T) {
	h, _, add, _ := newKnowledgeHandler()
	kbID := createKB(t, h)
	fid := upload(t, h, "a.pdf", "a")
	add.result, add.reason = files.AddStatusError, "kb_full"
	rec := do(http.HandlerFunc(h.AddToKnowledge), withID(jsonReq("POST", "/x", `{"file_id":"`+fid+`"}`), kbID))
	m := decode(t, rec)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200 (plugin throws on >=400)", rec.Code)
	}
	if _, has := m["id"]; has {
		t.Fatalf("body %v carries id; the plugin would mark the file as added", m)
	}
}

func TestAddForeignKnowledgeIs404(t *testing.T) {
	h, _, _, _ := newKnowledgeHandler()
	fid := upload(t, h, "a.pdf", "a")
	rec := do(http.HandlerFunc(h.AddToKnowledge), withID(jsonReq("POST", "/x", `{"file_id":"`+fid+`"}`), "55555555-5555-5555-5555-555555555555"))
	if rec.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want 404", rec.Code)
	}
}

func TestRemoveDeletesKBFileOnlyWhenUnshared(t *testing.T) {
	h, _, _, del := newKnowledgeHandler()
	kbID := createKB(t, h)
	a := upload(t, h, "a.pdf", "same")
	b := upload(t, h, "b.pdf", "same")
	for _, fid := range []string{a, b} {
		do(http.HandlerFunc(h.AddToKnowledge), withID(jsonReq("POST", "/x", `{"file_id":"`+fid+`"}`), kbID))
	}
	do(http.HandlerFunc(h.RemoveFromKnowledge), withID(jsonReq("POST", "/x?delete_file=false", `{"file_id":"`+a+`"}`), kbID))
	if len(del.files) != 0 {
		t.Fatalf("KB file deleted while b still links it: %v", del.files)
	}
	rec := do(http.HandlerFunc(h.RemoveFromKnowledge), withID(jsonReq("POST", "/x?delete_file=false", `{"file_id":"`+b+`"}`), kbID))
	if rec.Code != http.StatusOK || len(del.files) != 1 {
		t.Fatalf("got %d, deleted %v", rec.Code, del.files)
	}
	decode(t, rec)
}

func TestDeleteKnowledge(t *testing.T) {
	h, _, _, del := newKnowledgeHandler()
	kbID := createKB(t, h)
	rec := do(http.HandlerFunc(h.DeleteKnowledge), withID(httptest.NewRequest("DELETE", "/x", nil), kbID))
	if rec.Code != http.StatusOK || len(del.kbs) != 1 {
		t.Fatalf("got %d, deleted %v", rec.Code, del.kbs)
	}
	decode(t, rec)
}

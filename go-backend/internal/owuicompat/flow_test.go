package owuicompat

import (
	"net/http"
	"strings"
	"testing"

	"github.com/justrag/go-backend/internal/chat"
)

func pluginMux(h *Handler) *http.ServeMux {
	mux := http.NewServeMux()
	g := func(f http.HandlerFunc) http.Handler { return h.Gate(f) }
	mux.Handle("GET /owui/api/models", g(h.Models))
	mux.Handle("POST /owui/api/chat/completions", g(h.ChatCompletions))
	mux.Handle("POST /owui/api/v1/files/{$}", g(h.UploadFile))
	mux.Handle("GET /owui/api/v1/files/{$}", g(h.ListFiles))
	mux.Handle("GET /owui/api/v1/files/{id}", g(h.FileStatus))
	mux.Handle("DELETE /owui/api/v1/files/{id}", g(h.DeleteFile))
	mux.Handle("POST /owui/api/v1/knowledge/create", g(h.CreateKnowledge))
	mux.Handle("POST /owui/api/v1/knowledge/{id}/file/add", g(h.AddToKnowledge))
	mux.Handle("POST /owui/api/v1/knowledge/{id}/file/remove", g(h.RemoveFromKnowledge))
	return mux
}

func TestPluginCronFlowThenChat(t *testing.T) {
	st, del := newFakeStore(), &fakeDeleter{}
	add := &fakeAdder{st: st, result: "added"}
	ans := &fakeAnswerer{chunks: []string{"ok [1]"}}
	h := NewHandler(Deps{Store: st, Library: &fakeLibrary{}, Adder: add, Creator: &fakeCreator{},
		Deleter: del, Config: fakeConfig{enabled: true}, Answerer: ans})
	mux := pluginMux(h)

	// addFiles → checkFiles (same run) → updateContexts.
	up := uploadReq(t, "owui_a_file_81.pdf", "pdf", `{"ilias_title":"Skript"}`)
	fid := decode(t, do(mux, up))["id"].(string)
	if s := decode(t, do(mux, jsonReq("GET", "/owui/api/v1/files/"+fid, "")))["data"].(map[string]any)["status"]; s != "completed" {
		t.Fatalf("status after upload = %v", s)
	}
	kbID := decode(t, do(mux, jsonReq("POST", "/owui/api/v1/knowledge/create", `{"name":"Kurs (1)","description":""}`)))["id"].(string)
	if got := decode(t, do(mux, jsonReq("POST", "/owui/api/v1/knowledge/"+kbID+"/file/add", `{"file_id":"`+fid+`"}`)))["id"]; got != kbID {
		t.Fatalf("add id = %v", got)
	}

	// Chat: the citation carries the handle the plugin stored.
	kbFile := st.links[kbID][fid]
	ans.prepared = &Prepared{Sources: []chat.ChatSource{{FileName: "owui_a_file_81.pdf", FileID: kbFile, Content: "c", Pages: []int{2}}}}
	rec := do(mux, jsonReq("POST", "/owui/api/chat/completions", chatBody(true, kbID, "")))
	if !strings.Contains(rec.Body.String(), `"file_id":"`+fid+`"`) {
		t.Fatalf("chat sources do not carry the handle: %s", rec.Body)
	}

	// Content changed: remove from collection → status GET → delete → re-upload.
	do(mux, jsonReq("POST", "/owui/api/v1/knowledge/"+kbID+"/file/remove?delete_file=false", `{"file_id":"`+fid+`"}`))
	if rec := do(mux, jsonReq("GET", "/owui/api/v1/files/"+fid, "")); rec.Code != http.StatusOK {
		t.Fatalf("pre-delete status GET = %d", rec.Code)
	}
	if rec := do(mux, jsonReq("DELETE", "/owui/api/v1/files/"+fid, "")); rec.Code != http.StatusOK {
		t.Fatalf("delete = %d", rec.Code)
	}
	// A second delete of the same id (cron retry) must not wedge.
	if rec := do(mux, jsonReq("GET", "/owui/api/v1/files/"+fid, "")); rec.Code != http.StatusOK {
		t.Fatalf("status of deleted id = %d", rec.Code)
	}
	// The empty-id poll hits the list route, not a 404/405.
	if rec := do(mux, jsonReq("GET", "/owui/api/v1/files/", "")); rec.Code != http.StatusOK {
		t.Fatalf("empty-id poll = %d", rec.Code)
	}
}

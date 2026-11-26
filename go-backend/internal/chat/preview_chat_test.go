package chat

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/justrag/go-backend/internal/kbaccess"
)

// A chat started in a preview is read as the previewed role: the KB owner
// reading their own "view" preview chat gets it stripped (viewers see no
// citations on this KB), and their ordinary chat on the same KB in full.
// Oracle: CapabilitiesFor's table — view follows viewer_see_citations
// (off), owner sees everything.
func TestGetMessages_PreviewChatReadAsPreviewedRole(t *testing.T) {
	view := kbaccess.RoleView
	sources, _ := json.Marshal([]ChatSource{{Index: 1, FileName: "geheim.pdf", FileID: "file-1"}})
	store := &mockStore{chats: map[string]*ChatRow{
		"preview": {ID: "preview", KbID: "kb1", UserID: "user1", PreviewRole: &view},
		"plain":   {ID: "plain", KbID: "kb1", UserID: "user1"},
	}}
	access := &fakeKBAccessStore{kb: &kbaccess.KnowledgeBase{ID: "kb1"}, role: kbaccess.RoleOwner}
	h := NewHandler(store, nil, nil, WithKBAccess(access))

	read := func(chatID string) string {
		store.messages = []MessageRow{{ID: "a1", ChatID: chatID, Role: "ai", Content: citingAnswerFull, Sources: sources}}
		r := injectUser(httptest.NewRequest(http.MethodGet, "/api/chats/"+chatID+"/messages", nil), "user1")
		r.SetPathValue("id", chatID)
		w := httptest.NewRecorder()
		h.GetMessages(w, r)
		if w.Code != http.StatusOK {
			t.Fatalf("%s: status = %d", chatID, w.Code)
		}
		return w.Body.String()
	}

	if body := read("preview"); strings.Contains(body, "geheim") || !strings.Contains(body, citingAnswerStripped) {
		t.Errorf("preview chat: want the stripped answer, got %s", body)
	}
	if body := read("plain"); !strings.Contains(body, "geheim.pdf") || !strings.Contains(body, citingAnswerFull) {
		t.Errorf("ordinary chat: want the full answer, got %s", body)
	}
}

// resolveOrCreateChat keeps a chat in the preview it was started in.
// Oracle: its doc comment — a new chat stores the request's preview, an
// existing one answers with its stored preview, and a request previewing a
// different role is a 409.
func TestResolveOrCreateChat_Preview(t *testing.T) {
	view := kbaccess.RoleView
	cases := []struct {
		name        string
		chatID      string
		preview     string
		wantStatus  int
		wantPreview string
	}{
		{"new chat in a preview", "", kbaccess.RoleView, 0, kbaccess.RoleView},
		{"preview chat, no header", "preview", "", 0, kbaccess.RoleView},
		{"preview chat, same preview", "preview", kbaccess.RoleView, 0, kbaccess.RoleView},
		{"preview chat, other preview", "preview", kbaccess.RoleEdit, http.StatusConflict, ""},
		{"ordinary chat in a preview", "plain", kbaccess.RoleView, http.StatusConflict, ""},
		{"ordinary chat, no header", "plain", "", 0, ""},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			store := &mockStore{chats: map[string]*ChatRow{
				"preview": {ID: "preview", KbID: "kb1", UserID: "user1", PreviewRole: &view},
				"plain":   {ID: "plain", KbID: "kb1", UserID: "user1"},
			}}
			h := NewHandler(store, nil, nil)
			w := httptest.NewRecorder()
			id, preview, ok := h.resolveOrCreateChat(context.Background(), w, c.chatID, "kb1", "user1", "Frage", "", c.preview)
			if c.wantStatus != 0 {
				if ok || w.Code != c.wantStatus {
					t.Fatalf("ok = %v, status = %d; want refusal with %d", ok, w.Code, c.wantStatus)
				}
				return
			}
			if !ok {
				t.Fatalf("refused with %d: %s", w.Code, w.Body)
			}
			if preview != c.wantPreview {
				t.Errorf("preview = %q, want %q", preview, c.wantPreview)
			}
			if c.chatID == "" {
				created := store.chats[id]
				if created == nil || created.PreviewRole == nil || *created.PreviewRole != c.preview {
					t.Errorf("created chat = %+v, want preview role %q stored", created, c.preview)
				}
			}
		})
	}
}

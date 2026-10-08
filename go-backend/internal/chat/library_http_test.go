package chat

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/justrag/go-backend/internal/ai"
	"github.com/justrag/go-backend/internal/longmem"
	"github.com/justrag/go-backend/internal/mcp"
	"github.com/justrag/go-backend/internal/parser"
	"github.com/justrag/go-backend/internal/sessionmem"
	"github.com/justrag/go-backend/internal/userfiles"
)

// ---------------------------------------------------------------------------
// Fakes for the KB-less library chat endpoint (P3-R4/R5).
// ---------------------------------------------------------------------------

const (
	libUser      = "user1"
	libOtherUser = "user2"
	libChatID    = "11111111-1111-4111-8111-111111111111"
	libNewChatID = "22222222-2222-4222-8222-222222222222"
	libFileA     = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
	libFileB     = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"
	libFileForgn = "ffffffff-ffff-4fff-8fff-ffffffffffff"
)

// libStore is mockStore plus the LibraryChatStore surface; it records the
// AddMessage params (sources included) and every refs replacement.
type libStore struct {
	*mockStore
	mu       sync.Mutex
	refs     map[string][]string
	replaced map[string][]string
	added    []AddMessageParams
}

func newLibStore() *libStore {
	return &libStore{mockStore: newMockStore(), refs: map[string][]string{}, replaced: map[string][]string{}}
}

func (s *libStore) AddMessage(ctx context.Context, p AddMessageParams) (*MessageRow, error) {
	s.mu.Lock()
	s.added = append(s.added, p)
	s.mu.Unlock()
	return s.mockStore.AddMessage(ctx, p)
}

func (s *libStore) CreateLibraryChat(_ context.Context, userID, title string) (*ChatRow, error) {
	c := &ChatRow{ID: libNewChatID, UserID: userID, Title: title, Type: "library", CreatedAt: time.Now(), UpdatedAt: time.Now()}
	s.chats[c.ID] = c
	return c, nil
}

func (s *libStore) GetLibraryChats(_ context.Context, userID string) ([]ChatRow, error) {
	var out []ChatRow
	for _, c := range s.chats {
		if c.UserID == userID && c.Type == "library" && c.KbID == "" {
			out = append(out, *c)
		}
	}
	return out, nil
}

func (s *libStore) GetChatFileRefs(_ context.Context, chatID string) ([]string, error) {
	return append([]string{}, s.refs[chatID]...), nil
}

func (s *libStore) ReplaceChatFileRefs(_ context.Context, chatID string, ids []string) error {
	s.replaced[chatID] = append([]string{}, ids...)
	s.refs[chatID] = append([]string{}, ids...)
	return nil
}

var _ LibraryChatStore = (*libStore)(nil)

// fakeLibFiles mirrors userfiles.Store.Get's contract: ErrNotFound for a
// missing, foreign or malformed id.
type fakeLibFiles struct {
	files map[string]*userfiles.UserFile
}

func (f *fakeLibFiles) Get(_ context.Context, ownerID, id string) (*userfiles.UserFile, error) {
	if _, err := uuid.Parse(id); err != nil {
		return nil, userfiles.ErrNotFound
	}
	uf, ok := f.files[id]
	if !ok || uf.OwnerUserID != ownerID {
		return nil, userfiles.ErrNotFound
	}
	return uf, nil
}

type fakeLibText struct {
	mu     sync.Mutex
	texts  map[string]*parser.ParseResult
	errs   map[string]error
	called []string
}

func (f *fakeLibText) Text(_ context.Context, uf *userfiles.UserFile) (*parser.ParseResult, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.called = append(f.called, uf.ID)
	if err := f.errs[uf.ID]; err != nil {
		return nil, err
	}
	return f.texts[uf.ID], nil
}

// libAI is a fake model provider: streams "Antwort [1]" for a streaming
// request and returns a JSON array for any unary completion (follow-ups). It
// records every request body so tests can count the unary calls and assert
// the answer request carried no tools.
type libAI struct {
	mu     sync.Mutex
	bodies []string
}

func (a *libAI) resolver(t *testing.T) *ai.ConfigResolver {
	t.Helper()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		raw, _ := io.ReadAll(r.Body)
		a.mu.Lock()
		a.bodies = append(a.bodies, r.URL.Path+" "+string(raw))
		a.mu.Unlock()
		if strings.HasSuffix(r.URL.Path, "/embeddings") {
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"data":[{"embedding":[0.1,0.2,0.3]}]}`))
			return
		}
		var probe struct {
			Stream bool `json:"stream"`
		}
		_ = json.Unmarshal(raw, &probe)
		if probe.Stream {
			w.Header().Set("Content-Type", "text/event-stream")
			_, _ = w.Write([]byte("data: {\"choices\":[{\"index\":0,\"delta\":{\"content\":\"Antwort [1]\"}}]}\n\n"))
			_, _ = w.Write([]byte("data: [DONE]\n\n"))
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"choices":[{"message":{"content":"[\"Weiter?\"]"}}]}`))
	}))
	t.Cleanup(srv.Close)
	return ai.NewConfigResolver(&chatTestConfigStore{baseURL: srv.URL + "/v1/", model: "fake-model"})
}

func (a *libAI) snapshot() []string {
	a.mu.Lock()
	defer a.mu.Unlock()
	return append([]string(nil), a.bodies...)
}

type libChatFixture struct {
	h     *Handler
	store *libStore
	files *fakeLibFiles
	text  *fakeLibText
	ai    *libAI
	usage *fakeUsageRecorder
}

func newLibChatFixture(t *testing.T, cfg map[string]*string) *libChatFixture {
	t.Helper()
	fx := &libChatFixture{
		store: newLibStore(),
		files: &fakeLibFiles{files: map[string]*userfiles.UserFile{
			libFileA:     {ID: libFileA, OwnerUserID: libUser, Name: "alpha.txt"},
			libFileB:     {ID: libFileB, OwnerUserID: libUser, Name: "beta.txt"},
			libFileForgn: {ID: libFileForgn, OwnerUserID: libOtherUser, Name: "secret.txt"},
		}},
		text: &fakeLibText{
			texts: map[string]*parser.ParseResult{
				libFileA: {Text: "Alpha sagt: Der Himmel ist blau."},
				libFileB: {Text: "Beta sagt: Das Gras ist gruen."},
			},
			errs: map[string]error{},
		},
		ai:    &libAI{},
		usage: &fakeUsageRecorder{},
	}
	if cfg == nil {
		cfg = map[string]*string{}
	}
	fx.h = NewHandler(fx.store, fx.ai.resolver(t), erroringSearcher{},
		WithSiteConfigReader(&fakeSiteConfigReader{values: cfg}),
		WithUsageRecorder(fx.usage),
		WithLibraryChat(fx.store, fx.files, fx.text),
	)
	return fx
}

func (fx *libChatFixture) send(t *testing.T, body string, stream bool) *httptest.ResponseRecorder {
	t.Helper()
	target := "/api/library/chat"
	if stream {
		target += "?stream=true"
	}
	r := httptest.NewRequest(http.MethodPost, target, strings.NewReader(body))
	r.Header.Set("Content-Type", "application/json")
	r = injectUser(r, libUser)
	w := httptest.NewRecorder()
	fx.h.SendLibraryMessage(w, r)
	return w
}

// sseFrames splits an SSE body into decoded frames; "[DONE]" is kept as a
// nil map so its position can be asserted.
func sseFrames(t *testing.T, body string) []map[string]any {
	t.Helper()
	var out []map[string]any
	for _, line := range strings.Split(body, "\n") {
		if !strings.HasPrefix(line, "data: ") {
			continue
		}
		payload := strings.TrimPrefix(line, "data: ")
		if payload == "[DONE]" {
			out = append(out, nil)
			continue
		}
		var m map[string]any
		if err := json.Unmarshal([]byte(payload), &m); err != nil {
			t.Fatalf("bad frame %q: %v", payload, err)
		}
		out = append(out, m)
	}
	return out
}

func (fx *libChatFixture) seedLibraryChat(id, owner string, refs ...string) {
	fx.store.chats[id] = &ChatRow{ID: id, UserID: owner, Type: "library", Title: "t"}
	fx.store.refs[id] = refs
}

// ---------------------------------------------------------------------------
// Send
// ---------------------------------------------------------------------------

func TestSendLibraryMessage_NewChatStreamsKBFramesAndPersistsRefs(t *testing.T) {
	fx := newLibChatFixture(t, nil)
	w := fx.send(t, `{"message":"Welche Farbe hat der Himmel?","fileIds":["`+libFileA+`","`+libFileB+`"]}`, true)
	if w.Code != http.StatusOK {
		t.Fatalf("status %d: %s", w.Code, w.Body.String())
	}
	frames := sseFrames(t, w.Body.String())
	if len(frames) < 4 {
		t.Fatalf("frames = %v", frames)
	}
	open := frames[0]
	if open["chatId"] != libNewChatID || open["userMessageId"] != "user-msg-id" {
		t.Fatalf("opening frame = %v", open)
	}
	srcs, _ := open["sources"].([]any)
	if len(srcs) != 2 {
		t.Fatalf("sources = %v", open["sources"])
	}
	for i, want := range []string{libFileA, libFileB} {
		s := srcs[i].(map[string]any)
		if s["userFileId"] != want {
			t.Errorf("source %d userFileId = %v, want %s", i, s["userFileId"], want)
		}
		if fid, ok := s["fileId"]; ok && fid != "" {
			t.Errorf("source %d fileId = %v, want empty", i, fid)
		}
	}
	// Order: opening → content → aiMessageId → … → [DONE] last.
	idxContent, idxAI := -1, -1
	for i, f := range frames {
		if f == nil {
			continue
		}
		if _, ok := f["content"]; ok && idxContent < 0 {
			idxContent = i
		}
		if _, ok := f["aiMessageId"]; ok {
			idxAI = i
		}
	}
	if idxContent < 1 || idxAI <= idxContent {
		t.Fatalf("frame order wrong: content at %d, aiMessageId at %d: %v", idxContent, idxAI, frames)
	}
	if frames[len(frames)-1] != nil {
		t.Fatalf("last frame is not [DONE]: %v", frames[len(frames)-1])
	}
	if got := fx.store.replaced[libNewChatID]; len(got) != 2 || got[0] != libFileA || got[1] != libFileB {
		t.Errorf("refs replaced = %v", got)
	}
	// Persisted AI message carries the library sources.
	var aiMsg *AddMessageParams
	for i := range fx.store.added {
		if fx.store.added[i].Role == "ai" {
			aiMsg = &fx.store.added[i]
		}
	}
	if aiMsg == nil || len(aiMsg.Sources) != 2 || aiMsg.Sources[0].UserFileID != libFileA {
		t.Fatalf("persisted ai message = %+v", aiMsg)
	}
	ev := fx.usage.snapshot()
	if len(ev) != 1 || ev[0].KbID != "" || ev[0].UserID != libUser {
		t.Errorf("usage events = %+v", ev)
	}
}

func TestSendLibraryMessage_JSONMode(t *testing.T) {
	fx := newLibChatFixture(t, nil)
	w := fx.send(t, `{"message":"Himmel?","fileIds":["`+libFileA+`"]}`, false)
	if w.Code != http.StatusOK {
		t.Fatalf("status %d: %s", w.Code, w.Body.String())
	}
	var resp struct {
		ChatID      string       `json:"chatId"`
		AIMessageID string       `json:"aiMessageId"`
		Sources     []ChatSource `json:"sources"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatal(err)
	}
	if resp.ChatID != libNewChatID || resp.AIMessageID == "" || len(resp.Sources) != 1 || resp.Sources[0].UserFileID != libFileA {
		t.Fatalf("resp = %+v", resp)
	}
}

func TestSendLibraryMessage_ExistingChatUsesStoredRefs(t *testing.T) {
	fx := newLibChatFixture(t, nil)
	fx.seedLibraryChat(libChatID, libUser, libFileB)
	w := fx.send(t, `{"message":"Gras?","chatId":"`+libChatID+`"}`, true)
	if w.Code != http.StatusOK {
		t.Fatalf("status %d: %s", w.Code, w.Body.String())
	}
	if len(fx.text.called) != 1 || fx.text.called[0] != libFileB {
		t.Errorf("text source called for %v, want only %s", fx.text.called, libFileB)
	}
	if _, ok := fx.store.replaced[libChatID]; ok {
		t.Error("stored refs must not be replaced when the body carries no fileIds")
	}
	if frames := sseFrames(t, w.Body.String()); frames[0]["chatId"] != libChatID {
		t.Errorf("chatId = %v", frames[0]["chatId"])
	}
}

func TestSendLibraryMessage_ExistingChatBodyIDsReplaceRefs(t *testing.T) {
	fx := newLibChatFixture(t, nil)
	fx.seedLibraryChat(libChatID, libUser, libFileB)
	w := fx.send(t, `{"message":"Himmel?","chatId":"`+libChatID+`","fileIds":["`+libFileA+`"]}`, true)
	if w.Code != http.StatusOK {
		t.Fatalf("status %d: %s", w.Code, w.Body.String())
	}
	if got := fx.store.replaced[libChatID]; len(got) != 1 || got[0] != libFileA {
		t.Errorf("replaced = %v", got)
	}
}

func TestSendLibraryMessage_RejectsBadFileIDs(t *testing.T) {
	many := make([]string, 21)
	for i := range many {
		many[i] = `"` + uuid.NewString() + `"`
	}
	cases := []struct {
		name string
		ids  string
		code int
	}{
		{"foreign", `["` + libFileForgn + `"]`, http.StatusNotFound},
		{"malformed", `["not-a-uuid"]`, http.StatusNotFound},
		{"missing", `["` + uuid.NewString() + `"]`, http.StatusNotFound},
		{"too many", `[` + strings.Join(many, ",") + `]`, http.StatusBadRequest},
		{"none", `[]`, http.StatusBadRequest},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			fx := newLibChatFixture(t, nil)
			w := fx.send(t, `{"message":"x","fileIds":`+tc.ids+`}`, true)
			if w.Code != tc.code {
				t.Fatalf("status %d, want %d: %s", w.Code, tc.code, w.Body.String())
			}
			if strings.Contains(w.Body.String(), "secret.txt") {
				t.Error("error names the foreign file")
			}
			if len(fx.store.chats) != 0 {
				t.Errorf("a chat was created on a rejected turn: %v", fx.store.chats)
			}
			if len(fx.usage.snapshot()) != 0 {
				t.Error("usage recorded on a rejected turn")
			}
		})
	}
}

func TestSendLibraryMessage_RejectsNonLibraryOrForeignChat(t *testing.T) {
	cases := map[string]func(fx *libChatFixture) string{
		"kb chat": func(fx *libChatFixture) string {
			fx.store.chats[libChatID] = &ChatRow{ID: libChatID, KbID: "kb1", UserID: libUser, Type: "chat"}
			return libChatID
		},
		"library-typed chat with a kb": func(fx *libChatFixture) string {
			fx.store.chats[libChatID] = &ChatRow{ID: libChatID, KbID: "kb1", UserID: libUser, Type: "library"}
			return libChatID
		},
		"foreign library chat": func(fx *libChatFixture) string {
			fx.seedLibraryChat(libChatID, libOtherUser, libFileA)
			return libChatID
		},
		"missing chat": func(*libChatFixture) string { return libChatID },
		"malformed":    func(*libChatFixture) string { return "nope" },
	}
	for name, seed := range cases {
		t.Run(name, func(t *testing.T) {
			fx := newLibChatFixture(t, nil)
			id := seed(fx)
			w := fx.send(t, `{"message":"x","chatId":"`+id+`","fileIds":["`+libFileA+`"]}`, true)
			if w.Code != http.StatusNotFound {
				t.Fatalf("status %d, want 404: %s", w.Code, w.Body.String())
			}
			if len(fx.store.replaced) != 0 {
				t.Error("refs replaced on a rejected chat")
			}
		})
	}
}

func TestSendLibraryMessage_TooLarge(t *testing.T) {
	fx := newLibChatFixture(t, map[string]*string{
		"chat_library_fulltext_max_tokens": strPtr("4000"),
		"chat_longcontext_max_tokens":      strPtr("10000"),
	})
	fx.text.texts[libFileA] = &parser.ParseResult{Text: bigText(4000)}
	w := fx.send(t, `{"message":"x","fileIds":["`+libFileA+`"]}`, true)
	if w.Code != http.StatusBadRequest {
		t.Fatalf("status %d: %s", w.Code, w.Body.String())
	}
	if !strings.Contains(w.Body.String(), "selected files are too large for one chat turn (") ||
		!strings.Contains(w.Body.String(), "maximum 10000)") {
		t.Errorf("body = %s", w.Body.String())
	}
	if len(fx.store.chats) != 0 {
		t.Error("chat created on a too-large turn")
	}
}

func TestSendLibraryMessage_UnparseableNamesFile(t *testing.T) {
	fx := newLibChatFixture(t, nil)
	fx.text.errs[libFileB] = ErrUnparseable
	w := fx.send(t, `{"message":"x","fileIds":["`+libFileA+`","`+libFileB+`"]}`, true)
	if w.Code != http.StatusBadRequest {
		t.Fatalf("status %d: %s", w.Code, w.Body.String())
	}
	if !strings.Contains(w.Body.String(), "beta.txt") {
		t.Errorf("body does not name the file: %s", w.Body.String())
	}
	if strings.Contains(w.Body.String(), ErrUnparseable.Error()) {
		t.Errorf("body echoes the error: %s", w.Body.String())
	}
}

func TestSendLibraryMessage_TextSourceErrorIs500(t *testing.T) {
	fx := newLibChatFixture(t, nil)
	fx.text.errs[libFileA] = errors.New("s3 down: secret-bucket")
	w := fx.send(t, `{"message":"x","fileIds":["`+libFileA+`"]}`, true)
	if w.Code != http.StatusInternalServerError {
		t.Fatalf("status %d: %s", w.Code, w.Body.String())
	}
	if strings.Contains(w.Body.String(), "secret-bucket") {
		t.Errorf("body leaks the cause: %s", w.Body.String())
	}
}

func TestSendLibraryMessage_StoredRefsAllDeleted(t *testing.T) {
	t.Run("no refs left", func(t *testing.T) {
		fx := newLibChatFixture(t, nil)
		fx.seedLibraryChat(libChatID, libUser)
		w := fx.send(t, `{"message":"x","chatId":"`+libChatID+`"}`, true)
		if w.Code != http.StatusBadRequest || !strings.Contains(w.Body.String(), "no library files selected") {
			t.Fatalf("status %d: %s", w.Code, w.Body.String())
		}
	})
	t.Run("ref to a since-deleted file is skipped", func(t *testing.T) {
		fx := newLibChatFixture(t, nil)
		gone := uuid.NewString()
		fx.seedLibraryChat(libChatID, libUser, gone, libFileA)
		w := fx.send(t, `{"message":"x","chatId":"`+libChatID+`"}`, true)
		if w.Code != http.StatusOK {
			t.Fatalf("status %d: %s", w.Code, w.Body.String())
		}
		if len(fx.text.called) != 1 || fx.text.called[0] != libFileA {
			t.Errorf("text called for %v", fx.text.called)
		}
	})
	t.Run("only deleted refs", func(t *testing.T) {
		fx := newLibChatFixture(t, nil)
		fx.seedLibraryChat(libChatID, libUser, uuid.NewString())
		w := fx.send(t, `{"message":"x","chatId":"`+libChatID+`"}`, true)
		if w.Code != http.StatusBadRequest || !strings.Contains(w.Body.String(), "no library files selected") {
			t.Fatalf("status %d: %s", w.Code, w.Body.String())
		}
	})
}

func TestSendLibraryMessage_RejectsRegenerate(t *testing.T) {
	fx := newLibChatFixture(t, nil)
	fx.seedLibraryChat(libChatID, libUser, libFileA)
	w := fx.send(t, `{"message":"x","chatId":"`+libChatID+`","regenerateOfMessageId":"`+uuid.NewString()+`"}`, true)
	if w.Code != http.StatusBadRequest {
		t.Fatalf("status %d: %s", w.Code, w.Body.String())
	}
}

// ---------------------------------------------------------------------------
// Library mode skips every KB-bound post-response task (Review Focus 4).
// ---------------------------------------------------------------------------

type spyLongmem struct {
	longmem.Store
	mu    sync.Mutex
	calls int
}

func (s *spyLongmem) hit() { s.mu.Lock(); s.calls++; s.mu.Unlock() }
func (s *spyLongmem) n() int {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.calls
}
func (s *spyLongmem) Insert(context.Context, string, string, string, string, float64, []float64) error {
	s.hit()
	return nil
}
func (s *spyLongmem) Recall(context.Context, string, string, int, int) ([]longmem.Memory, error) {
	s.hit()
	return nil, nil
}
func (s *spyLongmem) RecallSemantic(context.Context, string, string, []float64, int, int) ([]longmem.Memory, error) {
	s.hit()
	return nil, nil
}
func (s *spyLongmem) NearestMemories(context.Context, string, string, []float64, int) ([]longmem.Memory, error) {
	s.hit()
	return nil, nil
}
func (s *spyLongmem) InsertWithSupersede(context.Context, string, string, string, string, float64, []float64, []int64) error {
	s.hit()
	return nil
}

type spySessionMem struct {
	mu    sync.Mutex
	calls int
}

func (s *spySessionMem) hit() { s.mu.Lock(); s.calls++; s.mu.Unlock() }
func (s *spySessionMem) Get(context.Context, string) (sessionmem.SessionMemory, error) {
	s.hit()
	return sessionmem.SessionMemory{}, nil
}
func (s *spySessionMem) AppendNote(context.Context, string, sessionmem.SessionNote) error {
	s.hit()
	return nil
}
func (s *spySessionMem) AppendFinding(context.Context, string, sessionmem.FindingRef) error {
	s.hit()
	return nil
}
func (s *spySessionMem) Delete(context.Context, string) error { s.hit(); return nil }

// toolCatalogDispatcher is a real MCPDispatcher with a non-empty answer-tool
// catalog, so a writer that offered answer tools would put "tools" into the
// answer request (asserted below).
func toolCatalogDispatcher() *MCPDispatcher {
	reg := mcp.NewRegistry()
	reg.RegisterBuiltin(mcp.Tool{Name: "calculator", Description: "math",
		InputSchema: json.RawMessage(`{"type":"object"}`)})
	return NewMCPDispatcher(reg)
}

func TestSendLibraryMessage_LibraryModeSkipsKBBoundTasks(t *testing.T) {
	for _, stream := range []bool{true, false} {
		name := "json"
		if stream {
			name = "stream"
		}
		t.Run(name, func(t *testing.T) {
			on := strPtr("true")
			fx := newLibChatFixture(t, map[string]*string{
				"chat_longmem_enabled":                on,
				"chat_session_memory_enabled":         on,
				"chat_answer_tools_enabled":           on,
				"factcheck_in_chat":                   on,
				"chat_factuality_verifier_enabled":    on,
				"chat_factuality_verifier_always_run": on,
				"chat_self_rag_enabled":               on,
				"chat_factuality_gate_enabled":        on,
				"chat_conflict_surfacing_enabled":     on,
				"chat_tabular_query_enabled":          on,
				"chat_citation_spans_enabled":         on,
				"ragas_sampling_enabled":              on,
				"ragas_sampling_rate":                 strPtr("1"),
			})
			lm, sm, td := &spyLongmem{}, &spySessionMem{}, toolCatalogDispatcher()
			dr, fd, tl := &fakeDecisionRecorder{}, &fakeFileDates{}, &fakeTabularQueryLogger{}
			fx.h.longmemStore = lm
			fx.h.sessionMemory = sm
			fx.h.toolDispatcher = td
			fx.h.decisionRecorder = dr
			fx.h.fileDates = fd
			fx.h.tabularQueryLog = tl

			w := fx.send(t, `{"message":"Himmel?","fileIds":["`+libFileA+`"]}`, stream)
			if w.Code != http.StatusOK {
				t.Fatalf("status %d: %s", w.Code, w.Body.String())
			}
			// Let any stray fire-and-forget goroutine land before asserting.
			time.Sleep(50 * time.Millisecond)

			if n := lm.n(); n != 0 {
				t.Errorf("longmem store called %d times", n)
			}
			if sm.calls != 0 {
				t.Errorf("session memory called %d times", sm.calls)
			}
			dr.mu.Lock()
			if dr.called {
				t.Error("agent decision recorded for a library turn")
			}
			dr.mu.Unlock()
			if fd.calls != 0 {
				t.Errorf("file dates looked up %d times", fd.calls)
			}
			if got := tl.calls(); len(got) != 0 {
				t.Errorf("tabular query log rows: %v", got)
			}

			// The model provider saw exactly: one answer completion without
			// tools, and one unary completion (follow-up questions). Any
			// factcheck / verifier / Self-RAG / longmem-extract / span call
			// would be a further unary completion.
			unary, answer := 0, 0
			for _, b := range fx.ai.snapshot() {
				if !strings.Contains(b, "/chat/completions") {
					continue
				}
				if strings.Contains(b, `"tool_choice"`) || strings.Contains(b, `"tools"`) {
					t.Errorf("answer request carried tools: %s", b)
				}
				var probe struct {
					Stream bool `json:"stream"`
				}
				_ = json.Unmarshal([]byte(b[strings.Index(b, " ")+1:]), &probe)
				if probe.Stream {
					answer++
				} else {
					unary++
				}
			}
			wantAnswer, wantUnary := 1, 1
			if !stream {
				// Non-streaming: the answer itself is a unary completion.
				wantAnswer, wantUnary = 0, 2
			}
			if answer != wantAnswer || unary != wantUnary {
				t.Errorf("model calls: %d streaming + %d unary, want %d + %d: %v", answer, unary, wantAnswer, wantUnary, fx.ai.snapshot())
			}
		})
	}
}

// ---------------------------------------------------------------------------
// List / Get
// ---------------------------------------------------------------------------

func TestListLibraryChats_OnlyOwnLibraryChats(t *testing.T) {
	fx := newLibChatFixture(t, nil)
	fx.seedLibraryChat(libChatID, libUser, libFileA, libFileB)
	fx.seedLibraryChat(libNewChatID, libOtherUser, libFileForgn)
	fx.store.chats["33333333-3333-4333-8333-333333333333"] = &ChatRow{ID: "33333333-3333-4333-8333-333333333333", KbID: "kb1", UserID: libUser, Type: "chat"}

	r := injectUser(httptest.NewRequest(http.MethodGet, "/api/library/chats", nil), libUser)
	w := httptest.NewRecorder()
	fx.h.ListLibraryChats(w, r)
	if w.Code != http.StatusOK {
		t.Fatalf("status %d: %s", w.Code, w.Body.String())
	}
	var resp struct {
		Items []struct {
			ID      string   `json:"id"`
			Title   string   `json:"title"`
			FileIDs []string `json:"fileIds"`
		} `json:"items"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatal(err)
	}
	if len(resp.Items) != 1 || resp.Items[0].ID != libChatID || len(resp.Items[0].FileIDs) != 2 {
		t.Fatalf("items = %+v", resp.Items)
	}
	for _, k := range []string{`"createdAt"`, `"updatedAt"`, `"fileIds"`} {
		if !strings.Contains(w.Body.String(), k) {
			t.Errorf("response lacks %s: %s", k, w.Body.String())
		}
	}
}

func TestListLibraryChats_EmptyIsArray(t *testing.T) {
	fx := newLibChatFixture(t, nil)
	r := injectUser(httptest.NewRequest(http.MethodGet, "/api/library/chats", nil), libUser)
	w := httptest.NewRecorder()
	fx.h.ListLibraryChats(w, r)
	if w.Code != http.StatusOK || !strings.Contains(w.Body.String(), `"items":[]`) {
		t.Fatalf("status %d: %s", w.Code, w.Body.String())
	}
}

func TestGetLibraryChat(t *testing.T) {
	fx := newLibChatFixture(t, nil)
	fx.seedLibraryChat(libChatID, libUser, libFileA)
	fx.seedLibraryChat(libNewChatID, libOtherUser)
	kbChat := "33333333-3333-4333-8333-333333333333"
	fx.store.chats[kbChat] = &ChatRow{ID: kbChat, KbID: "kb1", UserID: libUser, Type: "chat"}

	get := func(id string) *httptest.ResponseRecorder {
		r := injectUser(httptest.NewRequest(http.MethodGet, "/api/library/chats/"+id, nil), libUser)
		r.SetPathValue("id", id)
		w := httptest.NewRecorder()
		fx.h.GetLibraryChat(w, r)
		return w
	}
	w := get(libChatID)
	if w.Code != http.StatusOK {
		t.Fatalf("own chat: %d %s", w.Code, w.Body.String())
	}
	var item struct {
		ID      string   `json:"id"`
		FileIDs []string `json:"fileIds"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &item); err != nil {
		t.Fatal(err)
	}
	if item.ID != libChatID || len(item.FileIDs) != 1 || item.FileIDs[0] != libFileA {
		t.Fatalf("item = %+v", item)
	}
	for _, id := range []string{kbChat, libNewChatID, uuid.NewString(), "bad"} {
		if w := get(id); w.Code != http.StatusNotFound {
			t.Errorf("GET %s: %d, want 404", id, w.Code)
		}
	}
}

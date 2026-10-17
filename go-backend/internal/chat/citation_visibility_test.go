package chat

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"

	"github.com/justrag/go-backend/internal/ai"
	"github.com/justrag/go-backend/internal/kbaccess"
)

// withKBAccess puts the KBAccessResult RequireKBRole would build onto r: the
// KB with the given source flags and the caller's resolved role.
func withKBAccess(r *http.Request, kbID, role string, flags kbaccess.SourcePermissions) *http.Request {
	kb := &kbaccess.KnowledgeBase{ID: kbID, Sources: flags}
	return r.WithContext(kbaccess.WithAccess(r.Context(), &kbaccess.KBAccessResult{KB: kb, Role: role}))
}

// citingAnswerDeltas is a streamed answer whose citation markers are split
// across deltas the way a model's tokens split them.
var citingAnswerDeltas = []string{"Die Frist beträgt 3 Tage [", "1]. Ausnahmen [2, ", "3] gelten", " [1]."}

// The oracles below are hand-written: the answer with and without markers.
const (
	citingAnswerFull     = "Die Frist beträgt 3 Tage [1]. Ausnahmen [2, 3] gelten [1]."
	citingAnswerStripped = "Die Frist beträgt 3 Tage. Ausnahmen gelten."
)

// citingModelResolver serves a fake model: a streamed request gets the
// deltas, a unary one the full answer.
func citingModelResolver(t *testing.T) *ai.ConfigResolver {
	t.Helper()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var probe struct {
			Stream bool `json:"stream"`
		}
		_ = json.NewDecoder(r.Body).Decode(&probe)
		if probe.Stream {
			w.Header().Set("Content-Type", "text/event-stream")
			for _, d := range citingAnswerDeltas {
				b, _ := json.Marshal(map[string]any{"choices": []any{map[string]any{"index": 0, "delta": map[string]string{"content": d}}}})
				_, _ = w.Write([]byte("data: " + string(b) + "\n\n"))
			}
			_, _ = w.Write([]byte("data: [DONE]\n\n"))
			return
		}
		b, _ := json.Marshal(map[string]any{"choices": []any{map[string]any{"message": map[string]string{"content": citingAnswerFull}}}})
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write(b)
	}))
	t.Cleanup(srv.Close)
	return ai.NewConfigResolver(&chatTestConfigStore{baseURL: srv.URL + "/v1/", model: "fake-model"})
}

// capturingStore records the AI message SendMessage persists.
type capturingStore struct {
	*mockStore
	mu sync.Mutex
	ai *AddMessageParams
}

func (s *capturingStore) AddMessage(ctx context.Context, p AddMessageParams) (*MessageRow, error) {
	if p.Role == "ai" {
		s.mu.Lock()
		cp := p
		s.ai = &cp
		s.mu.Unlock()
	}
	return s.mockStore.AddMessage(ctx, p)
}

func TestStripCitationMarkers(t *testing.T) {
	cases := []struct{ in, want string }{
		{"Satz [1].", "Satz."},
		{"Satz [1, 2, 5] und mehr", "Satz und mehr"},
		{"Satz[3]", "Satz"},
		{"[1] am Anfang", " am Anfang"},
		{"kein Marker", "kein Marker"},
		{"ein [Link](https://x) bleibt", "ein [Link](https://x) bleibt"},
		{"[0] ist kein Zitat", "[0] ist kein Zitat"},
		{"Liste [12a] bleibt", "Liste [12a] bleibt"},
		{"zwei [1][2] direkt", "zwei direkt"},
		{"Zeile [4]\nnächste", "Zeile\nnächste"},
	}
	for _, c := range cases {
		if got := StripCitationMarkers(c.in); got != c.want {
			t.Errorf("StripCitationMarkers(%q) = %q, want %q", c.in, got, c.want)
		}
	}
}

// Every way of cutting the answer into two chunks, and one byte per chunk,
// must give the same stripped text as the hand-written oracle.
func TestCitationMarkerStream_AnySplit(t *testing.T) {
	run := func(chunks []string) string {
		var s CitationMarkerStream
		var b strings.Builder
		for _, c := range chunks {
			b.WriteString(s.Feed(c))
		}
		b.WriteString(s.Flush())
		return b.String()
	}
	for i := 0; i <= len(citingAnswerFull); i++ {
		if got := run([]string{citingAnswerFull[:i], citingAnswerFull[i:]}); got != citingAnswerStripped {
			t.Fatalf("split at %d: got %q, want %q", i, got, citingAnswerStripped)
		}
	}
	var bytes []string
	for i := 0; i < len(citingAnswerFull); i++ {
		bytes = append(bytes, citingAnswerFull[i:i+1])
	}
	if got := run(bytes); got != citingAnswerStripped {
		t.Fatalf("byte by byte: got %q, want %q", got, citingAnswerStripped)
	}
	// A "[" that turns out not to be a marker is released unchanged.
	if got := run([]string{"siehe [", "Link](x) und [", "a]"}); got != "siehe [Link](x) und [a]" {
		t.Fatalf("non-marker bracket: got %q", got)
	}
}

func TestCitationFilter_NilPassesThrough(t *testing.T) {
	var f *CitationFilter
	frame := map[string]any{"sources": []ChatSource{{FileName: "a.pdf"}}}
	got := f.Frames(frame)
	if len(got) != 1 || got[0].(map[string]any)["sources"].([]ChatSource)[0].FileName != "a.pdf" {
		t.Fatalf("nil filter changed the frame: %#v", got)
	}
	if f.Flush() != nil {
		t.Fatal("nil filter flushed something")
	}
}

// Every attributing key of the chat wire format is emptied or dropped; the
// oracle is the JSON a client would receive, searched for the file name,
// file id, chunk text and quote that went in.
func TestCitationFilter_RedactsEveryAttributingFrame(t *testing.T) {
	src := []ChatSource{{Index: 1, FileName: "geheim.pdf", FileID: "file-1", Content: "Quelltext", Pages: []int{4}}}
	frames := []map[string]any{
		{"sources": src, "chatId": "c1", "userMessageId": "u1", "enhancedQuery": ""},
		{"conflicts": []MessageConflict{{Claim: "x", FileA: "geheim.pdf", FileB: "b.pdf"}}},
		{"agentTrajectory": TrajectoryEvent{Stage: "hop", Chunks: []TrajChunkRef{{Idx: 1, FileName: "geheim.pdf"}}, RefinedText: "neu [1]"}},
		{"verification": &MessageVerification{
			Verified:   true,
			Score:      0.9,
			Citations:  []CitationStatus{{Verified: true, Method: "span", Span: &CitationSpanRef{Start: 0, End: 9}}},
			Factuality: &FactualityVerification{FlaggedClaims: []FlaggedClaimStatus{{ClaimText: "Behauptung [1]", Reason: "unsupported", CitedN: 1}}},
			SelfRAG:    &SelfRAGVerification{Relevance: []ChunkRelevanceStatus{{N: 1, Verdict: "relevant"}}},
		}},
		{"structuredTable": &StructuredTable{
			Columns: []TableColumn{{Key: "id", Label: "ID", DeriveFrom: "filename"}, {Key: "wert", Label: "Wert"}},
			Rows:    []TableRow{{"_file_id": "file-1", "_file_name": "geheim.pdf", "_source_idx": 1, "id": "geheim", "wert": "42"}},
		}},
		{"comparisonFindings": []Finding{{Issue: "Widerspruch", CitedFileIDs: []string{"file-1"}, CitedQuote: "Quelltext"}}},
		{"stage": "decision", "decision": "agent_tool_call_result", "tool": "kb_search", "preview": "[1] geheim.pdf: Quelltext", "args": `{"q":"x"}`},
	}
	f := NewCitationFilter()
	var out []any
	for _, fr := range frames {
		out = append(out, f.Frames(fr)...)
	}
	b, _ := json.Marshal(out)
	wire := string(b)
	for _, leak := range []string{"geheim", "file-1", "Quelltext", `"cited_n"`, `"citations"`, "[1]"} {
		if strings.Contains(wire, leak) {
			t.Errorf("redacted frames still carry %q: %s", leak, wire)
		}
	}
	for _, keep := range []string{`"sources":[]`, `"chatId":"c1"`, `"verified":true`, `"claim_text":"Behauptung"`, `"wert":"42"`, `"issue":"Widerspruch"`, `"tool":"kb_search"`, `"isrel":[]`} {
		if !strings.Contains(wire, keep) {
			t.Errorf("redacted frames lost %s: %s", keep, wire)
		}
	}
	if len(out) != len(frames)-1 {
		t.Errorf("got %d frames, want %d (the conflicts-only frame dropped)", len(out), len(frames)-1)
	}
}

// Held-back answer text goes out before the next non-text frame, so the
// answer stays ahead of aiMessageId: "Ende" is sent at once, the " [" that
// might have opened a marker is held and flushed before aiMessageId.
func TestCitationFilter_FlushesTextBeforeNextFrame(t *testing.T) {
	f := NewCitationFilter()
	var out []any
	out = append(out, f.Frames(map[string]string{"content": "Ende ["})...)
	out = append(out, f.Frames(map[string]string{"aiMessageId": "m1"})...)
	b, _ := json.Marshal(out)
	if got, want := string(b), `[{"content":"Ende"},{"content":" ["},{"aiMessageId":"m1"}]`; got != want {
		t.Fatalf("frames = %s, want %s", got, want)
	}
}

// streamCitingTurn runs one streamed standard-path turn with the given
// caller role and KB flags and returns the body plus what was persisted.
func streamCitingTurn(t *testing.T, role string, flags kbaccess.SourcePermissions, stream bool) (string, *AddMessageParams) {
	t.Helper()
	store := &capturingStore{mockStore: newMockStore()}
	values := map[string]*string{
		"citation_validation_enabled": strPtr("false"),
		"factcheck_in_chat":           strPtr("false"),
		"crag_enabled":                strPtr("true"),
	}
	h := NewHandler(store, citingModelResolver(t), gradedSearcher{}, WithSiteConfigReader(&fakeSiteConfigReader{values: values}))
	url := "/api/kb/kb1/chat?stream=false"
	if stream {
		url = "/api/kb/kb1/chat?stream=true"
	}
	r := httptest.NewRequest(http.MethodPost, url, strings.NewReader(`{"message": "hello"}`))
	r.Header.Set("Content-Type", "application/json")
	r = injectUser(r, "user1")
	r = withKBAccess(r, "kb1", role, flags)
	r.SetPathValue("id", "kb1")
	w := httptest.NewRecorder()
	h.SendMessage(w, r)
	if w.Code != http.StatusOK {
		t.Fatalf("status = %d, body %s", w.Code, w.Body.String())
	}
	return w.Body.String(), store.ai
}

// streamedContent joins the {"content": …} frames of an SSE body.
func streamedContent(t *testing.T, body string) string {
	t.Helper()
	var b strings.Builder
	for _, line := range strings.Split(body, "\n") {
		data, ok := strings.CutPrefix(line, "data: ")
		if !ok || data == "[DONE]" {
			continue
		}
		var fr map[string]any
		if err := json.Unmarshal([]byte(data), &fr); err != nil {
			t.Fatalf("frame %q: %v", data, err)
		}
		if s, ok := fr["content"].(string); ok {
			b.WriteString(s)
		}
	}
	return b.String()
}

func TestSendMessage_CitationVisibility(t *testing.T) {
	cases := []struct {
		name    string
		role    string
		flags   kbaccess.SourcePermissions
		visible bool
	}{
		{"viewer, flag off", kbaccess.RoleView, kbaccess.SourcePermissions{}, false},
		{"viewer, flag on", kbaccess.RoleView, kbaccess.SourcePermissions{ViewerSeeCitations: true}, true},
		{"editor, flag off", kbaccess.RoleEdit, kbaccess.SourcePermissions{ViewerSeeCitations: true}, false},
		{"admin, flags off", kbaccess.RoleAdmin, kbaccess.SourcePermissions{}, true},
	}
	for _, c := range cases {
		for _, stream := range []bool{true, false} {
			name := c.name + map[bool]string{true: ", stream", false: ", json"}[stream]
			t.Run(name, func(t *testing.T) {
				body, stored := streamCitingTurn(t, c.role, c.flags, stream)
				answer := ""
				if stream {
					answer = streamedContent(t, body)
				} else {
					var resp map[string]any
					if err := json.Unmarshal([]byte(body), &resp); err != nil {
						t.Fatalf("body: %v", err)
					}
					answer, _ = resp["answer"].(string)
				}
				hasSource := strings.Contains(body, "f1.md") || strings.Contains(body, `"fileId"`) || strings.Contains(body, "some content")
				if c.visible {
					if !hasSource || answer != citingAnswerFull {
						t.Fatalf("citations should be visible: answer %q, body %s", answer, body)
					}
				} else {
					if hasSource || answer != citingAnswerStripped || !strings.Contains(body, `"sources":[]`) {
						t.Fatalf("citations should be hidden: answer %q, body %s", answer, body)
					}
				}
				// Stored in full, whoever asked.
				if stored == nil || stored.Content != citingAnswerFull || len(stored.Sources) != 1 || stored.Sources[0].FileName != "f1.md" {
					t.Fatalf("persisted AI message = %+v, want the full answer and its source", stored)
				}
			})
		}
	}
}

// fakeKBAccessStore is a kbaccess.KBStore over one KB whose flags the test
// changes between reads.
type fakeKBAccessStore struct {
	kb   *kbaccess.KnowledgeBase
	role string
}

func (s *fakeKBAccessStore) GetKBByID(_ context.Context, id string) (*kbaccess.KnowledgeBase, error) {
	if s.kb == nil || s.kb.ID != id {
		return nil, nil
	}
	cp := *s.kb
	return &cp, nil
}

func (s *fakeKBAccessStore) GetKBRole(_ context.Context, _, _ string) (string, error) {
	return s.role, nil
}

// A stored message is stripped at READ time for the current reader and the
// KB's current flags: the same row reads stripped while viewer_see_citations
// is off and complete once it is on.
func TestGetMessages_RedactsAtReadTime(t *testing.T) {
	sources, _ := json.Marshal([]ChatSource{{Index: 1, FileName: "geheim.pdf", FileID: "file-1", Content: "Quelltext"}})
	stored := []MessageRow{
		{ID: "u1", ChatID: "c1", Role: "user", Content: "Frage [1]?"},
		{ID: "a1", ChatID: "c1", Role: "ai", Content: citingAnswerFull, Sources: sources,
			Verification: &MessageVerification{Verified: true, Citations: []CitationStatus{{Verified: true}}},
			Conflicts:    []MessageConflict{{Claim: "x", FileA: "geheim.pdf"}}},
	}
	store := &mockStore{chats: map[string]*ChatRow{"c1": {ID: "c1", KbID: "kb1", UserID: "user1"}}}
	access := &fakeKBAccessStore{kb: &kbaccess.KnowledgeBase{ID: "kb1"}, role: kbaccess.RoleView}
	h := NewHandler(store, nil, nil, WithKBAccess(access))

	read := func() string {
		store.messages = append([]MessageRow(nil), stored...)
		r := httptest.NewRequest(http.MethodGet, "/api/chats/c1/messages", nil)
		r = injectUser(r, "user1")
		r.SetPathValue("id", "c1")
		w := httptest.NewRecorder()
		h.GetMessages(w, r)
		if w.Code != http.StatusOK {
			t.Fatalf("status = %d", w.Code)
		}
		return w.Body.String()
	}

	hidden := read()
	for _, leak := range []string{"geheim", "file-1", "Quelltext", "[1].", `"citations"`, `"conflicts"`} {
		if strings.Contains(hidden, leak) {
			t.Errorf("flag off: response carries %q: %s", leak, hidden)
		}
	}
	if !strings.Contains(hidden, citingAnswerStripped) || !strings.Contains(hidden, "Frage [1]?") {
		t.Errorf("flag off: want the stripped answer and the user's own text unchanged: %s", hidden)
	}

	access.kb.Sources.ViewerSeeCitations = true
	visible := read()
	for _, want := range []string{"geheim.pdf", "Quelltext", citingAnswerFull, `"citations"`, `"conflicts"`} {
		if !strings.Contains(visible, want) {
			t.Errorf("flag on: response lacks %q: %s", want, visible)
		}
	}
}

// No way to resolve the reader's capability (no access store) hides
// citations rather than showing them.
func TestGetMessages_FailsClosedWithoutAccessStore(t *testing.T) {
	sources, _ := json.Marshal([]ChatSource{{Index: 1, FileName: "geheim.pdf"}})
	store := &mockStore{
		chats:    map[string]*ChatRow{"c1": {ID: "c1", KbID: "kb1", UserID: "user1"}},
		messages: []MessageRow{{ID: "a1", ChatID: "c1", Role: "ai", Content: "x [1]", Sources: sources}},
	}
	h := NewHandler(store, nil, nil)
	r := injectUser(httptest.NewRequest(http.MethodGet, "/api/chats/c1/messages", nil), "user1")
	r.SetPathValue("id", "c1")
	w := httptest.NewRecorder()
	h.GetMessages(w, r)
	if strings.Contains(w.Body.String(), "geheim") {
		t.Fatalf("citations leaked without an access store: %s", w.Body.String())
	}
}

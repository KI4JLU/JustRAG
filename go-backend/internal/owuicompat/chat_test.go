package owuicompat

import (
	"bufio"
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"strings"
	"testing"

	"github.com/justrag/go-backend/internal/ai"
	"github.com/justrag/go-backend/internal/chat"
)

type fakeAnswerer struct {
	prepared    *Prepared
	prepareErr  error
	chunks      []string
	midErr      error
	gotKB       string
	gotEffort   string
	gotTemp     float64
	gotSystem   string
	prepareCall int
}

func (a *fakeAnswerer) Prepare(_ context.Context, kbID, _, systemPrefix string, _ []ai.ChatHistoryEntry) (*Prepared, error) {
	a.prepareCall++
	a.gotKB = kbID
	if a.prepareErr != nil {
		return nil, a.prepareErr
	}
	p := *a.prepared
	p.SystemPrompt = systemPrefix + "|" + p.SystemPrompt
	return &p, nil
}
func (a *fakeAnswerer) Stream(_ context.Context, kbID string, _ []ai.ChatHistoryEntry, _, system, effort string, temp float64) (<-chan ai.StreamEvent, error) {
	a.gotKB, a.gotEffort, a.gotTemp, a.gotSystem = kbID, effort, temp, system
	ch := make(chan ai.StreamEvent, len(a.chunks)+1)
	for _, c := range a.chunks {
		ch <- ai.StreamEvent{Content: c}
	}
	ch <- ai.StreamEvent{Done: true, Err: a.midErr}
	close(ch)
	return ch, nil
}
func (a *fakeAnswerer) Generate(_ context.Context, kbID string, _ []ai.ChatHistoryEntry, _, system string, _ bool) (string, error) {
	a.gotKB, a.gotSystem = kbID, system
	return strings.Join(a.chunks, ""), nil
}

func newChatHandler(ans *fakeAnswerer) (*Handler, *fakeStore) {
	st := newFakeStore()
	return NewHandler(Deps{Store: st, Answerer: ans, Config: fakeConfig{enabled: true}}), st
}

const kbA = "66666666-6666-6666-6666-666666666666"

func chatBody(stream bool, files string, extra string) string {
	s := `{"model":"x","stream":` + map[bool]string{true: "true", false: "false"}[stream] +
		`,"messages":[{"role":"system","content":"Du bist Tutor."},{"role":"user","content":"Was ist ILIAS?"}]`
	if files != "" {
		s += `,"files":[{"type":"collection","id":"` + files + `"}]`
	}
	return s + extra + "}"
}

// sseLines returns the non-empty lines of an SSE body.
func sseLines(body string) []string {
	var out []string
	sc := bufio.NewScanner(strings.NewReader(body))
	for sc.Scan() {
		if l := sc.Text(); l != "" {
			out = append(out, l)
		}
	}
	return out
}

func TestStreamWithCollectionSendsSourcesFirst(t *testing.T) {
	ans := &fakeAnswerer{prepared: &Prepared{SystemPrompt: "kb", Sources: []chat.ChatSource{{FileName: "a.pdf", FileID: "f1", Content: "c"}}},
		chunks: []string{"Antwort ", "[1]"}}
	h, st := newChatHandler(ans)
	_ = st.RegisterKnowledge(context.Background(), kbA, testOwner)
	_ = st.LinkFile(context.Background(), kbA, "h1", "f1")
	st.handles["h1"] = FileHandle{ID: "h1", OwnerUserID: testOwner}

	rec := do(http.HandlerFunc(h.ChatCompletions), jsonReq("POST", "/owui/api/chat/completions", chatBody(true, kbA, "")))
	lines := sseLines(rec.Body.String())
	if len(lines) < 3 || !strings.HasPrefix(lines[0], `data: {"sources":`) {
		t.Fatalf("first frame is not sources: %v", lines)
	}
	if !strings.Contains(lines[0], `"file_id":"h1"`) {
		t.Fatalf("sources frame lacks handle id: %s", lines[0])
	}
	var content strings.Builder
	for _, l := range lines[1:] {
		if l == "data: [DONE]" {
			continue
		}
		var c struct {
			Choices []struct{ Delta struct{ Content string } } `json:"choices"`
		}
		if err := json.Unmarshal([]byte(strings.TrimPrefix(l, "data: ")), &c); err == nil && len(c.Choices) > 0 {
			content.WriteString(c.Choices[0].Delta.Content)
		}
	}
	if content.String() != "Antwort [1]" || lines[len(lines)-1] != "data: [DONE]" {
		t.Fatalf("content %q, last %q", content.String(), lines[len(lines)-1])
	}
	if ans.gotKB != kbA {
		t.Fatalf("answered with kb %q", ans.gotKB)
	}
}

func TestNoCollectionIsPassthrough(t *testing.T) {
	ans := &fakeAnswerer{chunks: []string{"Titel"}}
	h, _ := newChatHandler(ans)
	rec := do(http.HandlerFunc(h.ChatCompletions), jsonReq("POST", "/x", chatBody(false, "", "")))
	if rec.Code != http.StatusOK || ans.prepareCall != 0 || ans.gotKB != "" {
		t.Fatalf("code %d prepare %d kb %q", rec.Code, ans.prepareCall, ans.gotKB)
	}
	var resp struct {
		Choices []struct {
			Message struct{ Role, Content string }
		} `json:"choices"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil || resp.Choices[0].Message.Content != "Titel" {
		t.Fatalf("body %s", rec.Body)
	}
	if !strings.Contains(ans.gotSystem, "Du bist Tutor.") {
		t.Fatalf("system prompt %q lost the request's system message", ans.gotSystem)
	}
}

func TestForeignCollectionIs404Detail(t *testing.T) {
	h, _ := newChatHandler(&fakeAnswerer{})
	rec := do(http.HandlerFunc(h.ChatCompletions), jsonReq("POST", "/x", chatBody(true, kbA, "")))
	if rec.Code != http.StatusNotFound || !strings.Contains(rec.Body.String(), `"detail"`) {
		t.Fatalf("got %d %s", rec.Code, rec.Body)
	}
}

func TestStreamMidStreamErrorIsRawDetailLine(t *testing.T) {
	ans := &fakeAnswerer{chunks: []string{"Teil"}, midErr: errors.New("upstream reset")}
	h, _ := newChatHandler(ans)
	rec := do(http.HandlerFunc(h.ChatCompletions), jsonReq("POST", "/x", chatBody(true, "", "")))
	lines := sseLines(rec.Body.String())
	var found bool
	for _, l := range lines {
		if strings.HasPrefix(l, `{"detail":`) {
			found = true
			if strings.Contains(l, "upstream reset") {
				t.Fatalf("internal error text leaked: %s", l)
			}
		}
	}
	if !found || lines[len(lines)-1] != "data: [DONE]" {
		t.Fatalf("lines = %v", lines)
	}
}

func TestReasoningAndTemperatureMapping(t *testing.T) {
	cases := []struct {
		extra, want string
	}{
		{``, ""},
		{`,"reasoning_effort":"none"`, ""},
		{`,"reasoning_effort":"high"`, "high"},
		{`,"think":true`, "medium"},
		{`,"think":false,"reasoning_effort":"high"`, ""},
		{`,"options":{"think":true}`, "medium"},
	}
	for _, c := range cases {
		ans := &fakeAnswerer{chunks: []string{"x"}}
		h, _ := newChatHandler(ans)
		do(http.HandlerFunc(h.ChatCompletions), jsonReq("POST", "/x", chatBody(true, "", c.extra+`,"temperature":0.7`)))
		if ans.gotEffort != c.want || ans.gotTemp != 0.7 {
			t.Errorf("%s: effort %q temp %v, want %q 0.7", c.extra, ans.gotEffort, ans.gotTemp, c.want)
		}
	}
}

func TestBadBodiesAre400Detail(t *testing.T) {
	h, _ := newChatHandler(&fakeAnswerer{})
	for _, body := range []string{`{`, `{"messages":[]}`, `{"messages":[{"role":"system","content":"x"}]}`} {
		rec := do(http.HandlerFunc(h.ChatCompletions), jsonReq("POST", "/x", body))
		if rec.Code != http.StatusBadRequest || !strings.Contains(rec.Body.String(), `"detail"`) {
			t.Errorf("%s: got %d %s", body, rec.Code, rec.Body)
		}
	}
}

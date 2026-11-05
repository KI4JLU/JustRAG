package chat

import (
	"context"
	"io"
	"net/http"
	"net/http/httptest"
	"regexp"
	"strings"
	"testing"

	"github.com/justrag/go-backend/internal/ai"
)

// stepEvents keeps the agentTrajectory events of an Emit capture, in order.
func stepEvents(evs []map[string]any) []TrajectoryEvent {
	var out []TrajectoryEvent
	for _, e := range evs {
		if te, ok := e["agentTrajectory"].(TrajectoryEvent); ok {
			out = append(out, te)
		}
	}
	return out
}

// Oracle: the search step names the question the user asked — the tabular
// router's promoted query is a retrieval hint only — with the hit count and
// the files the searcher returned.
func TestPrepareChatContext_EmitsSearchStep(t *testing.T) {
	searcher := &tabRecordingSearcher{chunks: tabTestChunks()}
	var evs []map[string]any
	if _, err := PrepareChatContext(context.Background(), nil, searcher, nil, ChatContextParams{
		KbID:          "kb1",
		SearchQuery:   tabTestQuery,
		Language:      "de",
		TabularRouter: tabFiringRouter(),
		Emit:          collectEvents(&evs),
	}); err != nil {
		t.Fatalf("PrepareChatContext: %v", err)
	}
	if searcher.gotQuery != tabTestPromoted {
		t.Fatalf("searcher got %q, want the promoted query (fixture sanity)", searcher.gotQuery)
	}
	steps := stepEvents(evs)
	if len(steps) != 1 {
		t.Fatalf("steps = %+v, want exactly the search step", steps)
	}
	got := steps[0]
	if got.Stage != retrievalStage || got.Step != 1 || got.Query != tabTestQuery || got.Findings != 3 {
		t.Fatalf("search step = %+v, want stage %q step 1, the asked query, 3 hits", got, retrievalStage)
	}
	if len(got.Chunks) != 3 || got.Chunks[0].FileName != "a.pdf" || got.Chunks[2].FileName != "b.pdf" {
		t.Fatalf("search step chunks = %+v, want the three hits", got.Chunks)
	}
}

// reduceTestResolver answers the evidentiality scorer (its prompt asks for
// "scores") with one passage below the 0.3 threshold, and every other
// non-streaming call — the sufficient-context judge — with "insufficient".
func reduceTestResolver(t *testing.T) *ai.ConfigResolver {
	t.Helper()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body, _ := io.ReadAll(r.Body)
		w.Header().Set("Content-Type", "application/json")
		if strings.Contains(string(body), "scores") {
			_, _ = w.Write([]byte(`{"choices":[{"message":{"content":"{\"scores\":[0.9,0.1,0.9]}"}}]}`))
			return
		}
		_, _ = w.Write([]byte(`{"choices":[{"message":{"content":"{\"sufficient\":false}"}}]}`))
	}))
	t.Cleanup(srv.Close)
	return ai.NewConfigResolver(&chatTestConfigStore{baseURL: srv.URL + "/v1/", model: "fake-model"})
}

// Oracle: the scorer drops one of three passages and the judge says
// insufficient, so after the search step come the reduction (same row,
// step 1, Dropped 1) and the gate's refusal; the turn abstains.
func TestPrepareChatContext_EmitsReductionAndInsufficientSteps(t *testing.T) {
	reader := &fakeSiteConfigReader{values: map[string]*string{
		"chat_context_compression_enabled":    strPtr("true"),
		"chat_context_compression_min_chunks": strPtr("1"),
		"chat_sufficient_context_enabled":     strPtr("true"),
	}}
	var evs []map[string]any
	chatCtx, err := PrepareChatContext(context.Background(), reduceTestResolver(t), &tabRecordingSearcher{chunks: tabTestChunks()}, reader, ChatContextParams{
		KbID:        "kb1",
		SearchQuery: "Wie hoch ist die Gebühr?",
		Language:    "de",
		Emit:        collectEvents(&evs),
	})
	if err != nil {
		t.Fatalf("PrepareChatContext: %v", err)
	}
	if !chatCtx.Abstain {
		t.Fatal("the insufficient verdict did not make the turn abstain (fixture sanity)")
	}
	steps := stepEvents(evs)
	if len(steps) != 3 {
		t.Fatalf("steps = %+v, want search, reduction, refusal", steps)
	}
	if s := steps[0]; s.Stage != retrievalStage || s.Findings != 3 {
		t.Errorf("step 0 = %+v, want the search step with 3 hits", s)
	}
	if s := steps[1]; s.Stage != retrievalStage || s.Step != 1 || s.Decision != "context_reduced" || s.Dropped != 1 {
		t.Errorf("step 1 = %+v, want context_reduced on step 1 with 1 dropped", s)
	}
	if s := steps[2]; s.Stage != "decision" || s.Decision != "insufficient_context" {
		t.Errorf("step 2 = %+v, want the insufficient_context decision", s)
	}
}

// Oracle: a recency question with a lister fires the listing; the step
// carries the files listed and the window start as an ISO date, before the
// search step.
func TestPrepareChatContext_EmitsRecencyStep(t *testing.T) {
	lister := &fakeRecencyLister{docs: []RecencyDoc{{ID: "f1", Name: "a.md"}, {ID: "f2", Name: "b.md"}}}
	var evs []map[string]any
	if _, err := PrepareChatContext(context.Background(), nil, &tabRecordingSearcher{chunks: tabTestChunks()}, nil, ChatContextParams{
		KbID:          "kb1",
		SearchQuery:   "Welche neuen Meldungen gibt es?",
		Language:      "de",
		RecencyLister: lister,
		Emit:          collectEvents(&evs),
	}); err != nil {
		t.Fatalf("PrepareChatContext: %v", err)
	}
	steps := stepEvents(evs)
	if len(steps) < 2 || steps[0].Stage != "recency_listing" || steps[1].Stage != retrievalStage {
		t.Fatalf("steps = %+v, want the recency listing, then the search", steps)
	}
	if steps[0].Findings != 2 || !regexp.MustCompile(`^\d{4}-\d{2}-\d{2}$`).MatchString(steps[0].Reason) {
		t.Errorf("recency step = %+v, want 2 files and an ISO window start", steps[0])
	}
}

// Oracle: the loop's trace callbacks become agentTrajectory events — the
// call with its search text and argument preview, the result with its hit
// count, a failed dispatch as agent_tool_call_failed — and the result
// preview (source text) stays off the event.
func TestAnswerToolSteps(t *testing.T) {
	var evs []map[string]any
	trace := answerToolSteps(collectEvents(&evs))
	trace("decision", "agent_tool_call", "kb_search", map[string]any{"tool": "kb_search", "args": `{"query":"Frist"}`, "query": "Frist"})
	trace("decision", "agent_tool_call_result", "kb_search", map[string]any{"tool": "kb_search", "preview": "[1] geheim.pdf: Quelltext", "findings": 4, "failed": false})
	trace("decision", "agent_tool_call_result", "web_search", map[string]any{"tool": "web_search", "preview": `{"error":"x"}`, "findings": 0, "failed": true})

	steps := stepEvents(evs)
	if len(steps) != 3 || len(evs) != 3 {
		t.Fatalf("frames = %+v, want three agentTrajectory frames and nothing else", evs)
	}
	if s := steps[0]; s.Decision != "agent_tool_call" || s.Reason != "kb_search" || s.Query != "Frist" || s.Args != `{"query":"Frist"}` {
		t.Errorf("call = %+v", s)
	}
	if s := steps[1]; s.Decision != "agent_tool_call_result" || s.Reason != "kb_search" || s.Findings != 4 {
		t.Errorf("result = %+v", s)
	}
	if s := steps[2]; s.Decision != "agent_tool_call_failed" || s.Reason != "web_search" {
		t.Errorf("failed result = %+v", s)
	}
	for _, s := range steps {
		if strings.Contains(s.Args+s.Query+s.Reason, "geheim") {
			t.Errorf("result preview leaked into a step: %+v", s)
		}
	}
}

func TestToolQueryArg(t *testing.T) {
	for raw, want := range map[string]string{
		`{"query":"  Frist "}`:           "Frist",
		`{"q":"Antrag"}`:                 "Antrag",
		`{"question":"Wer?","query":""}`: "Wer?",
		`{"expression":"1+1"}`:           "",
		`not json`:                       "",
	} {
		if got := toolQueryArg(raw); got != want {
			t.Errorf("toolQueryArg(%s) = %q, want %q", raw, got, want)
		}
	}
}

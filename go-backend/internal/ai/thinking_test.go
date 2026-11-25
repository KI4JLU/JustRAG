package ai

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"reflect"
	"strconv"
	"strings"
	"sync/atomic"
	"testing"

	"github.com/justrag/go-backend/internal/logctx"
	"github.com/justrag/go-backend/internal/prompts"
)

// resolverWithModel is resolverForServer for one chat model whose reasoning flag
// the test sets.
func resolverWithModel(srvURL, model string, reasoning bool) *ConfigResolver {
	return NewConfigResolver(&mockStore{
		activeProvider: &AIProviderInfo{ID: "prov-test", Name: "Test", APIKey: "test-key", BaseURL: srvURL},
		modelsByProv: map[string][]AIModelInfo{
			"prov-test": {{Name: model, IsReasoning: reasoning}},
		},
		kbOverrides: map[string]*KBModelOverrides{},
	})
}

func TestStructuredCompletion_ThinkingSwitch(t *testing.T) {
	tests := []struct {
		name      string
		reasoning bool // the model's chat_models entry is flagged as reasoning
		optOut    bool // the caller used WithoutThinking
		want      map[string]any
	}{
		{"reasoning model and opt-out turns thinking off", true, true, map[string]any{"enable_thinking": false}},
		{"reasoning model without opt-out is left alone", true, false, nil},
		{"plain model with opt-out keeps its request bytes", false, true, nil},
		{"plain model without opt-out is left alone", false, false, nil},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			var captured map[string]any
			srv := buildChatServer(t, func(w http.ResponseWriter, r *http.Request) {
				if err := json.NewDecoder(r.Body).Decode(&captured); err != nil {
					t.Fatalf("decode request: %v", err)
				}
				writeChatJSON(w, chatResponse(`{"ok":true}`, ""))
			})
			resolver := resolverWithModel(srv.URL, "fast-model", tc.reasoning)
			ctx := context.Background()
			if tc.optOut {
				ctx = WithoutThinking(ctx)
			}

			if _, err := GenerateCompletionStructured(ctx, resolver, "u", "s", "", "", testSpec); err != nil {
				t.Fatalf("unexpected error: %v", err)
			}

			got, present := captured["chat_template_kwargs"]
			if tc.want == nil {
				if present {
					t.Errorf("chat_template_kwargs = %v, want it absent", got)
				}
				return
			}
			if !reflect.DeepEqual(got, tc.want) {
				t.Errorf("chat_template_kwargs = %v, want %v", got, tc.want)
			}
		})
	}
}

// The fast-tier tasks the admin lists under "Globaler Fast-Tier-Default" ask a
// reasoning-flagged model not to think; the tasks that plan or write are left
// alone. Each call reaches a fake provider and the request it sends is read;
// the task's own parsing of the empty answer is not under test.
func TestFastTierTasksTurnThinkingOff(t *testing.T) {
	ctx := context.Background()
	tests := []struct {
		name string
		call func(r *ConfigResolver)
		off  bool // the request asks the model not to think
	}{
		{"CRAG grader", func(r *ConfigResolver) {
			_, _ = GradeRelevance(ctx, r, "q", []string{"chunk"}, "", "")
		}, true},
		{"KB router", func(r *ConfigResolver) {
			_, _ = RouteKB(ctx, r, "q", []prompts.KBRouterCandidate{{ID: "a", Name: "A"}}, "", "")
		}, true},
		{"Self-RAG verifier", func(r *ConfigResolver) {
			_, _ = VerifySelfRAG(ctx, r, "q", "a", "src", "", "de", "")
		}, true},
		{"KG extractor", func(r *ConfigResolver) {
			_, _ = ExtractKG(ctx, r, "doc", "body", "chunk", "", "de", "")
		}, true},
		{"long-term memory extraction", func(r *ConfigResolver) {
			_, _ = ExtractSalientFacts(ctx, r, "user", "answer", "", "de", "")
		}, true},
		{"long-term memory conflict", func(r *ConfigResolver) {
			_, _ = ClassifyLongmemConflict(ctx, r, LongmemCandidate{Content: "new"}, []LongmemCandidate{{ID: 1, Content: "old"}}, "", "de", "")
		}, true},
		{"DAG critic", func(r *ConfigResolver) {
			_, _ = CritiqueDAGProgress(ctx, r, "q", nil, nil, map[string]bool{}, map[string]bool{}, "", "de", "")
		}, true},
		{"contextual enrichment", func(r *ConfigResolver) {
			_, _ = GenerateChunkContext(ctx, r, "f.pdf", ContextDoc{}, "chunk", "", "")
		}, true},
		{"query classifier (capped helper)", func(r *ConfigResolver) {
			_, _ = ClassifyQueryComplexity(ctx, r, "q", "", "de", "")
		}, true},
		{"conversation condense (capped helper)", func(r *ConfigResolver) {
			_, _ = GenerateCompletionCapped(ctx, r, "u", "s", "", "", 64, "condense")
		}, true},
		{"query rewriting is left to think", func(r *ConfigResolver) {
			_, _ = RewriteQuery(ctx, r, "q", "", "de")
		}, false},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			var captured map[string]any
			srv := buildChatServer(t, func(w http.ResponseWriter, r *http.Request) {
				_ = json.NewDecoder(r.Body).Decode(&captured)
				writeChatJSON(w, chatResponse(`{}`, ""))
			})
			tc.call(resolverWithModel(srv.URL, "fast-model", true))

			if captured == nil {
				t.Fatal("the task sent no request")
			}
			got, present := captured["chat_template_kwargs"]
			switch {
			case tc.off && !reflect.DeepEqual(got, map[string]any{"enable_thinking": false}):
				t.Errorf("chat_template_kwargs = %v, want enable_thinking=false", got)
			case !tc.off && present:
				t.Errorf("chat_template_kwargs = %v, want it absent", got)
			}
		})
	}
}

// rejectingKwargsServer is a provider that does not know chat_template_kwargs:
// it answers 400 (or the given status) to a request that carries the field
// and, as a real one does, echoes the submitted request in the error body.
type rejectingKwargsServer struct {
	status   int
	requests atomic.Int32
	withKw   atomic.Int32 // requests that carried the field
}

func (s *rejectingKwargsServer) handler(rejectSchema bool) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		s.requests.Add(1)
		var body map[string]any
		_ = json.NewDecoder(r.Body).Decode(&body)
		_, hasKw := body["chat_template_kwargs"]
		if hasKw {
			s.withKw.Add(1)
		}
		rf, _ := body["response_format"].(map[string]any)
		switch {
		case hasKw && !rejectSchema:
			w.WriteHeader(s.status)
			_, _ = w.Write([]byte(`{"error":"Unrecognized request argument supplied: chat_template_kwargs CANARY-TERM"}`))
		case rejectSchema && rf != nil && rf["type"] == "json_schema":
			w.WriteHeader(s.status)
			_, _ = w.Write([]byte(`{"error":"response_format json_schema not supported CANARY-TERM"}`))
		default:
			writeChatJSON(w, chatResponse(`{"ok":true}`, ""))
		}
	}
}

func TestThinkingKwargsRejectedByEndpoint_RetriesOnceAndRemembers(t *testing.T) {
	for _, status := range []int{http.StatusBadRequest, http.StatusUnprocessableEntity} {
		t.Run(http.StatusText(status), func(t *testing.T) {
			fake := &rejectingKwargsServer{status: status}
			srv := buildChatServer(t, fake.handler(false))
			resolver := resolverWithModel(srv.URL, "fast-model", true)
			ctx := WithoutThinking(context.Background())

			res, err := GenerateCompletionStructured(ctx, resolver, "u", "s", "", "", testSpec)
			if err != nil || res == nil || res.Content != `{"ok":true}` {
				t.Fatalf("first call = %+v, %v; want the answer of the retry without the field", res, err)
			}
			if got := fake.requests.Load(); got != 2 {
				t.Errorf("requests after the first call = %d, want 2 (one rejected, one retry)", got)
			}
			if got := fake.withKw.Load(); got != 1 {
				t.Errorf("requests with chat_template_kwargs = %d, want 1", got)
			}

			// Cache hit: the endpoint is remembered, the next call sends the field no more.
			if _, err := GenerateCompletionStructured(ctx, resolver, "u", "s", "", "", testSpec); err != nil {
				t.Fatalf("second call: %v", err)
			}
			if got := fake.requests.Load(); got != 3 {
				t.Errorf("requests after the second call = %d, want 3 (no probe again)", got)
			}
			if got := fake.withKw.Load(); got != 1 {
				t.Errorf("the second call sent chat_template_kwargs again (%d requests carried it)", got)
			}
		})
	}
}

// A rejection that is not about the field (here: the strict schema) must not
// make the endpoint look like one that refuses chat_template_kwargs.
func TestThinkingKwargsRejection_SchemaRejectionIsNotBlamedOnTheField(t *testing.T) {
	fake := &rejectingKwargsServer{status: http.StatusBadRequest}
	srv := buildChatServer(t, fake.handler(true))
	resolver := resolverWithModel(srv.URL, "fast-model", true)
	ctx := WithoutThinking(context.Background())

	if _, err := GenerateCompletionStructured(ctx, resolver, "u", "s", "", "", testSpec); err != nil {
		t.Fatalf("the schema downgrade must still succeed: %v", err)
	}
	if thinkingKwargsRejected.has(baseURLOf(t, resolver), "fast-model") {
		t.Error("an endpoint that only refuses the strict schema was remembered as refusing chat_template_kwargs")
	}
	// Three requests: field + schema (rejected), schema alone (rejected: the
	// field was not the cause), field + json_object (answered).
	if got, want := fake.requests.Load(), int32(3); got != want {
		t.Errorf("requests = %d, want %d", got, want)
	}
	if got, want := fake.withKw.Load(), int32(2); got != want {
		t.Errorf("requests with the field = %d, want %d (the field is put back for the downgraded call)", got, want)
	}
}

func TestThinkingKwargsRejection_OtherModelsKeepTheirBytesAndTheirErrors(t *testing.T) {
	var requests atomic.Int32
	srv := buildChatServer(t, func(w http.ResponseWriter, r *http.Request) {
		requests.Add(1)
		var body map[string]any
		_ = json.NewDecoder(r.Body).Decode(&body)
		if _, has := body["chat_template_kwargs"]; has {
			t.Error("a model that is not flagged as reasoning must not get chat_template_kwargs")
		}
		w.WriteHeader(http.StatusBadRequest)
	})
	resolver := resolverWithModel(srv.URL, "plain-model", false)
	_, err := GenerateCompletionStructured(WithoutThinking(context.Background()), resolver, "u", "s", "", "plain-model", nil)
	if err == nil {
		t.Fatal("a 400 on a plain request must stay an error")
	}
	if got := requests.Load(); got != 1 {
		t.Errorf("requests = %d, want 1 (a deterministic 4xx is not retried)", got)
	}
}

func TestEndpointModelSetIsBounded(t *testing.T) {
	var s endpointModelSet
	for i := range 3 * thinkingKwargsCacheMax {
		s.add("http://endpoint/", "model-"+strconv.Itoa(i))
		if n := s.len(); n > thinkingKwargsCacheMax {
			t.Fatalf("set grew to %d entries, cap is %d", n, thinkingKwargsCacheMax)
		}
	}
	s.add("http://endpoint/", "last")
	if !s.has("http://endpoint/", "last") || s.has("http://other/", "last") {
		t.Error("lookup is per (base URL, model)")
	}
}

func TestThinkingModeWhenOptedOut(t *testing.T) {
	cfg := &ResolvedConfig{ReasoningModels: []string{"qwen3"}}
	if got := cfg.ThinkingModeWhenOptedOut("qwen3"); got != ThinkingOff {
		t.Errorf("reasoning model: %q, want %q", got, ThinkingOff)
	}
	if got := cfg.ThinkingModeWhenOptedOut("gpt"); got != ThinkingDefault {
		t.Errorf("plain model: %q, want %q", got, ThinkingDefault)
	}
	var none *ResolvedConfig
	if got := none.ThinkingModeWhenOptedOut("qwen3"); got != ThinkingDefault {
		t.Errorf("nil config: %q, want %q", got, ThinkingDefault)
	}
}

// A provider's error body may echo the submitted text; the log lines of the
// completion layer carry the failure class and the status, never the body.
func TestCompletionLogsNeverCarryTheProviderBody(t *testing.T) {
	const canary = "CANARY-USER-TEXT-4711"
	srv := buildChatServer(t, func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusBadRequest)
		_, _ = w.Write([]byte(`{"error":"cannot parse ` + canary + `"}`))
	})
	var buf bytes.Buffer
	logctx.SetBase(slog.New(slog.NewTextHandler(&buf, &slog.HandlerOptions{Level: slog.LevelDebug})))
	t.Cleanup(func() { logctx.SetBase(nil) })

	resolver := resolverWithModel(srv.URL, "fast-model", true)
	_, err := GenerateCompletionStructured(WithoutThinking(context.Background()), resolver, "u", "s", "", "", testSpec)
	if err == nil {
		t.Fatal("expected the failing provider to produce an error")
	}
	logged := buf.String()
	if !strings.Contains(logged, "ai.structured.strict_schema_rejected_falling_back") && !strings.Contains(logged, "ai.thinking.kwargs_rejected_retrying_without") {
		t.Fatalf("expected a fallback log line, got: %s", logged)
	}
	if strings.Contains(logged, canary) {
		t.Errorf("the provider's body reached the log: %s", logged)
	}
	if !strings.Contains(logged, "upstream_status=400") {
		t.Errorf("the log line should name the upstream status: %s", logged)
	}
}

func TestFailureClass(t *testing.T) {
	tests := []struct {
		name       string
		err        error
		wantClass  string
		wantStatus int
	}{
		{"provider answer", fmt.Errorf("wrapped: %w", &APIError{StatusCode: 502, Body: "SECRET-BODY"}), FailureUpstream, 502},
		{"deadline", fmt.Errorf("x: %w", context.DeadlineExceeded), FailureTimeout, 0},
		{"canceled", context.Canceled, FailureCanceled, 0},
		{"no provider", ErrNoActiveProvider, FailureNoProvider, 0},
		{"malformed", ErrMalformedJSON, FailureMalformed, 0},
		{"anything else", errors.New("dial tcp: refused"), FailureTransport, 0},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			class, status := FailureClass(tc.err)
			if class != tc.wantClass || status != tc.wantStatus {
				t.Errorf("FailureClass = (%q, %d), want (%q, %d)", class, status, tc.wantClass, tc.wantStatus)
			}
		})
	}
}

// baseURLOf is the base URL the resolver gives its test provider.
func baseURLOf(t *testing.T, r *ConfigResolver) string {
	t.Helper()
	cfg, err := r.Resolve(context.Background(), "")
	if err != nil {
		t.Fatalf("resolve: %v", err)
	}
	return cfg.BaseURL
}

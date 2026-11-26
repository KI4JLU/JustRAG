package ai

import (
	"context"
	"net/http"
	"slices"
	"sync"
)

type thinkingOffKey struct{}

// WithoutThinking returns a context that asks structured completions to run a
// reasoning-flagged model without its thinking phase. A Qwen3-style model
// behind our LiteLLM → vLLM gateway thinks by default and bills that as
// completion tokens: a two-sentence translation spent 478 of 510 tokens on
// reasoning and took about five seconds instead of half a second. Callers
// whose task needs no reasoning opt in: the translator, and the fast-tier tasks
// the admin lists under "Globaler Fast-Tier-Default" (CRAG grader, KG
// extractor, contextual enrichment, Self-RAG verifier, DAG critic, long-term
// memory extraction and conflict check, KB router, RAPTOR summaries) and the
// capped helpers of the chat path (condense, classifier, follow-ups, factcheck:
// thinking spends their small output cap before the answer). The planners,
// query rewriting and answer generation are left to think.
//
// Only a model whose chat_models entry is flagged as reasoning receives the
// switch; every other model keeps the request bytes it had before, so a
// provider that rejects unknown parameters is not affected. A reasoning-flagged
// model on an endpoint that does not know chat_template_kwargs (only vLLM and
// LiteLLM in front of it do) answers 400/422: the completion layer then asks
// once more without the field and remembers the endpoint (see
// thinkingKwargsRejected), so later calls skip it.
func WithoutThinking(ctx context.Context) context.Context {
	return context.WithValue(ctx, thinkingOffKey{}, true)
}

// How a task that opted out with WithoutThinking runs on a model, as the index
// fingerprint records it (a copied index must not come from the other mode).
const (
	// ThinkingOff: the request asks the model not to think.
	ThinkingOff = "off"
	// ThinkingDefault: the model keeps its default behaviour.
	ThinkingDefault = "default"
)

// ThinkingModeWhenOptedOut returns ThinkingOff for a model the admin flagged as
// reasoning and ThinkingDefault for every other: the mode an opted-in task
// runs in on that model. It is the configured policy; an endpoint that rejects
// the switch (thinkingKwargsRejected) is a runtime fallback, not a mode.
func (c *ResolvedConfig) ThinkingModeWhenOptedOut(model string) string {
	if c != nil && slices.Contains(c.ReasoningModels, model) {
		return ThinkingOff
	}
	return ThinkingDefault
}

// noThinkingKwargs returns the chat_template_kwargs for a call, nil unless ctx
// carries WithoutThinking, the model is one the admin flagged as reasoning and
// the endpoint is not known to reject the field.
func noThinkingKwargs(ctx context.Context, config *ResolvedConfig, model string) map[string]any {
	if off, _ := ctx.Value(thinkingOffKey{}).(bool); !off {
		return nil
	}
	if config.ThinkingModeWhenOptedOut(model) != ThinkingOff {
		return nil
	}
	if thinkingKwargsRejected.has(config.BaseURL, model) {
		return nil
	}
	return map[string]any{"enable_thinking": false}
}

// rejectedRequestParams reports whether err is the answer of an endpoint that
// refuses the request as malformed (400) or unprocessable (422): what a server
// that does not know chat_template_kwargs says to it.
func rejectedRequestParams(err error) bool {
	status, ok := upstreamStatus(err)
	return ok && (status == http.StatusBadRequest || status == http.StatusUnprocessableEntity)
}

// thinkingKwargsCacheMax bounds the endpoint memory: a deployment has a handful
// of (endpoint, model) pairs, so reaching the cap means something is minting
// them, and the memory starts over.
const thinkingKwargsCacheMax = 256

// thinkingKwargsRejected remembers per (base URL, model) that the endpoint
// answered the chat_template_kwargs switch with 400/422 and then accepted the
// same request without it. It lives for the process: an admin who changes the
// endpoint behind the same URL restarts the server anyway, and a wrong entry
// costs only a model that thinks.
var thinkingKwargsRejected = &endpointModelSet{}

type endpointModel struct{ baseURL, model string }

// endpointModelSet is a small mutex-guarded, bounded set of (base URL, model).
type endpointModelSet struct {
	mu sync.Mutex
	m  map[endpointModel]struct{}
}

func (s *endpointModelSet) has(baseURL, model string) bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	_, ok := s.m[endpointModel{baseURL, model}]
	return ok
}

func (s *endpointModelSet) add(baseURL, model string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.m == nil || len(s.m) >= thinkingKwargsCacheMax {
		s.m = make(map[endpointModel]struct{}, 8)
	}
	s.m[endpointModel{baseURL, model}] = struct{}{}
}

func (s *endpointModelSet) len() int {
	s.mu.Lock()
	defer s.mu.Unlock()
	return len(s.m)
}

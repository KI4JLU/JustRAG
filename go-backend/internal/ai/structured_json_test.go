package ai

import (
	"context"
	"errors"
	"strings"
	"testing"
)

// scriptedCompletion answers the i-th call with replies[i] (the last one
// repeated) and records the user prompts.
func scriptedCompletion(t *testing.T, replies ...string) (*ConfigResolver, *[]string) {
	t.Helper()
	var prompts []string
	r := newTestResolverWithCompletion(t, func(_ context.Context, _ *ConfigResolver, prompt, _, _, _ string) (*CompletionResult, error) {
		prompts = append(prompts, prompt)
		return &CompletionResult{Content: replies[min(len(prompts), len(replies))-1]}, nil
	})
	return r, &prompts
}

// Oracle: the helper's contract — a malformed answer is asked for once more,
// with the retry note changing the user prompt (so a temperature-0 model does
// not repeat itself); the second, valid answer is decoded.
func TestCompleteStructuredJSON_RetriesMalformed(t *testing.T) {
	r, prompts := scriptedCompletion(t, `{"description": "abgeschnit`, `{"description": "ok"}`)
	var out struct {
		Description string `json:"description"`
	}
	if err := CompleteStructuredJSON(context.Background(), r, "USER", "SYS", "kb", "m", kbDescriptionSpec, &out); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if out.Description != "ok" {
		t.Errorf("decoded %q, want ok", out.Description)
	}
	if len(*prompts) != 2 || (*prompts)[0] != "USER" || !strings.HasPrefix((*prompts)[1], "USER") || !strings.Contains((*prompts)[1], structuredJSONRetryNote) {
		t.Errorf("prompts %q, want USER then USER + retry note", *prompts)
	}
}

// Oracle: the helper's contract — no retry for a valid first answer (also one
// wrapped in prose or a code fence), ErrMalformedJSON after two malformed
// answers, and a transport error returned at once without a retry.
func TestCompleteStructuredJSON_ValidGiveUpAndTransport(t *testing.T) {
	var out map[string]any
	r, prompts := scriptedCompletion(t, "Hier:\n```json\n{\"a\": 1}\n```")
	if err := CompleteStructuredJSON(context.Background(), r, "U", "S", "kb", "", nil, &out); err != nil || len(*prompts) != 1 {
		t.Errorf("wrapped object: err %v after %d calls, want nil after 1", err, len(*prompts))
	}
	r, prompts = scriptedCompletion(t, "kein JSON")
	if err := CompleteStructuredJSON(context.Background(), r, "U", "S", "kb", "", nil, &out); !errors.Is(err, ErrMalformedJSON) || len(*prompts) != structuredJSONAttempts {
		t.Errorf("garbage: err %v after %d calls, want ErrMalformedJSON after %d", err, len(*prompts), structuredJSONAttempts)
	}
	boom := errors.New("boom")
	if err := CompleteStructuredJSON(context.Background(), stubCompletionError(t, boom), "U", "S", "kb", "", nil, &out); !errors.Is(err, boom) {
		t.Errorf("transport: err %v, want boom", err)
	}
}

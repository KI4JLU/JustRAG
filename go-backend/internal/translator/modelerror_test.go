package translator

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/justrag/go-backend/internal/ai"
)

func TestCompletionTimeoutFollowsTheText(t *testing.T) {
	tests := []struct {
		name string
		text string
		want time.Duration
	}{
		{"short text gets the minimum plus its share", `["Hallo."]`, completionTimeoutMin + 10*completionTimeoutPerRune},
		{"counts characters, not bytes", `["ä"]`, completionTimeoutMin + 5*completionTimeoutPerRune},
		{"a long text is capped under the write timeout", strings.Repeat("x", 50_000), completionTimeoutMax},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			if got := completionTimeoutFor(tc.text); got != tc.want {
				t.Errorf("completionTimeoutFor = %v, want %v", got, tc.want)
			}
		})
	}
	if completionTimeoutMax >= 120*time.Second {
		t.Errorf("the cap %v must stay below the server's 120s write timeout", completionTimeoutMax)
	}
}

func TestClassifyModelError(t *testing.T) {
	tests := []struct {
		name        string
		err         error
		timeout     bool
		unavailable bool
	}{
		{"the call ran out of time", fmt.Errorf("ai: all 3 attempts failed: %w", context.DeadlineExceeded), true, false},
		{"no provider is active", fmt.Errorf("ai: resolve config: %w", ai.ErrNoActiveProvider), false, true},
		{"the provider rejects the key", fmt.Errorf("ai: all 3 attempts failed: %w", &ai.APIError{StatusCode: http.StatusUnauthorized, Body: "no key"}), false, true},
		{"the provider forbids the call", &ai.APIError{StatusCode: http.StatusForbidden}, false, true},
		{"the provider has a server error", &ai.APIError{StatusCode: http.StatusInternalServerError}, false, false},
		{"the answer is no JSON object", ai.ErrMalformedJSON, false, false},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			got := classifyModelError(tc.err)
			if !errors.Is(got, ErrModel) || !errors.Is(got, tc.err) {
				t.Errorf("%v must still be an ErrModel wrapping its cause", got)
			}
			if errors.Is(got, ErrModelTimeout) != tc.timeout || errors.Is(got, ErrModelUnavailable) != tc.unavailable {
				t.Errorf("timeout = %v, unavailable = %v, want %v and %v",
					errors.Is(got, ErrModelTimeout), errors.Is(got, ErrModelUnavailable), tc.timeout, tc.unavailable)
			}
		})
	}
}

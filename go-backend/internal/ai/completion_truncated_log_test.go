package ai

import (
	"bytes"
	"context"
	"log/slog"
	"net/http"
	"strings"
	"testing"
)

// Not parallel: swaps the process-wide default logger.
func TestGenerateCompletionCapped_LogsTruncatedWithTask(t *testing.T) {
	srv := buildChatServer(t, func(w http.ResponseWriter, r *http.Request) {
		resp := chatResponse("cut", "")
		resp["choices"].([]map[string]any)[0]["finish_reason"] = "length"
		writeChatJSON(w, resp)
	})
	var buf bytes.Buffer
	prev := slog.Default()
	slog.SetDefault(slog.New(slog.NewTextHandler(&buf, nil)))
	defer slog.SetDefault(prev)

	if _, err := GenerateCompletionCapped(context.Background(), resolverForServer(srv, "main"), "q", "s", "", "", 8, "classify"); err != nil {
		t.Fatal(err)
	}
	out := buf.String()
	for _, want := range []string{"ai.helper.truncated", "task=classify", "model=main", "max_tokens=8"} {
		if !strings.Contains(out, want) {
			t.Fatalf("log missing %q:\n%s", want, out)
		}
	}
}

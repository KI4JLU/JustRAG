package ai

import (
	"context"
	"errors"
	"net/http"
	"os"
	"path/filepath"
	"testing"
)

// KI-960: a file over the limit fails with ErrAudioTooLarge before any
// request goes out, and a file at the limit is not refused for its size.
func TestTranscribe_OverLimitIsErrAudioTooLarge(t *testing.T) {
	defer SetSTTMaxFileBytesForTest(1024)()
	store := &mockStore{
		activeProvider: &AIProviderInfo{ID: "p", Name: "jlu", BaseURL: "http://127.0.0.1:1/v1"},
		modelsByProv:   map[string][]AIModelInfo{"p": {{Name: "whisper", IsStt: true}}},
	}
	resolver := NewConfigResolver(store)
	dir := t.TempDir()
	write := func(name string, n int) string {
		p := filepath.Join(dir, name)
		if err := os.WriteFile(p, make([]byte, n), 0o600); err != nil {
			t.Fatal(err)
		}
		return p
	}

	_, err := TranscribeAudioFromPath(context.Background(), resolver, http.DefaultClient, write("big.mp3", 1025), "", "big.mp3", "audio/mpeg")
	if !errors.Is(err, ErrAudioTooLarge) {
		t.Fatalf("over limit: err = %v, want ErrAudioTooLarge", err)
	}
	// At the limit the request is attempted (and fails on the dead address),
	// but not with the size error.
	_, err = TranscribeAudioFromPath(context.Background(), resolver, http.DefaultClient, write("ok.mp3", 1024), "", "ok.mp3", "audio/mpeg")
	if errors.Is(err, ErrAudioTooLarge) {
		t.Fatalf("at limit: got the size error %v", err)
	}
}

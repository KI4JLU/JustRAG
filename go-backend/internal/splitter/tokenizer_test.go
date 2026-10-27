package splitter

import (
	"strings"
	"testing"
	"time"
	"unicode/utf8"
)

func TestCountTokens_NonEmpty(t *testing.T) {
	t.Parallel()
	count := CountTokens("Hello, world! This is a test.")
	if count <= 0 {
		t.Errorf("expected positive token count, got %d", count)
	}
	if count >= 20 {
		t.Errorf("expected fewer than 20 tokens for short string, got %d", count)
	}
	t.Logf("token count for test string: %d", count)
}

func TestCountTokens_Empty(t *testing.T) {
	t.Parallel()
	count := CountTokens("")
	if count != 0 {
		t.Errorf("expected 0 for empty string, got %d", count)
	}
}

func TestCountTokens_BasicSentence(t *testing.T) {
	t.Parallel()
	count := CountTokens("The quick brown fox jumps over the lazy dog.")
	if count <= 0 {
		t.Errorf("expected positive token count, got %d", count)
	}
	t.Logf("token count for basic sentence: %d", count)
}

func TestTruncateToTokens_Unchanged(t *testing.T) {
	t.Parallel()
	for _, tc := range []struct {
		name, text string
		budget     int
	}{
		{"empty", "", 100},
		{"zero budget", "hello world", 0},
		{"negative budget", "hello world", -1},
		{"within budget", "short text", 1000},
	} {
		if got := TruncateToTokens(tc.text, tc.budget); got != tc.text {
			t.Errorf("%s: got %q, want the input unchanged", tc.name, got)
		}
	}
}

// TestTruncateToTokens_MultiByteSweep is the regression test for the binary
// search this replaced, which looped forever when its cut landed next to a
// multi-byte rune (German text: budget 8 already hung). Oracle: CountTokens
// on the result, plus prefix and UTF-8 validity checks. The sweep runs under
// a deadline so a hang fails the test instead of the test binary's timeout.
func TestTruncateToTokens_MultiByteSweep(t *testing.T) {
	t.Parallel()
	texts := map[string]string{
		"german": strings.Repeat("Prüfungsübersicht für Hochschulabschlüsse, Maßnahmen und Ärger. ", 40),
		"mixed":  strings.Repeat("Größe 😀 東京 naïve — façade “quoted” ", 40),
	}
	done := make(chan struct{})
	go func() {
		defer close(done)
		for name, text := range texts {
			total := CountTokens(text)
			for budget := 1; budget < total; budget++ {
				got := TruncateToTokens(text, budget)
				if !strings.HasPrefix(text, got) {
					t.Errorf("%s budget=%d: result is not a prefix of the input", name, budget)
					return
				}
				if !utf8.ValidString(got) {
					t.Errorf("%s budget=%d: result is not valid UTF-8", name, budget)
					return
				}
				n := CountTokens(got)
				if n > budget {
					t.Errorf("%s budget=%d: result has %d tokens", name, budget, n)
					return
				}
				// A cut back to a rune start drops at most one token's
				// worth of bytes; anything much shorter means the head was
				// thrown away.
				if n < budget-3 {
					t.Errorf("%s budget=%d: result has only %d tokens", name, budget, n)
					return
				}
			}
		}
	}()
	select {
	case <-done:
	case <-time.After(30 * time.Second):
		t.Fatal("TruncateToTokens did not return within 30s")
	}
}

func TestTruncateRunes(t *testing.T) {
	t.Parallel()
	for _, tc := range []struct {
		s     string
		limit int
		want  string
	}{
		{"Größe", 3, "Grö"},
		{"Größe", 5, "Größe"},
		{"Größe", 10, "Größe"},
		{"Größe", 0, ""},
		{"", 3, ""},
	} {
		if got := truncateRunes(tc.s, tc.limit); got != tc.want {
			t.Errorf("truncateRunes(%q, %d) = %q, want %q", tc.s, tc.limit, got, tc.want)
		}
	}
}

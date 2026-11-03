package rustparser

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"sync/atomic"
	"testing"
	"time"

	"github.com/prometheus/client_golang/prometheus/testutil"

	"github.com/justrag/go-backend/internal/parser"
)

// stubParser is a controllable parser for the shadow tests.
type stubParser struct {
	name  string
	delay time.Duration
	res   *parser.ParseResult
	err   error
	// done, when non-nil, is closed when Parse returns, so tests can wait
	// for the detached shadow run to finish.
	done chan struct{}
}

func (s *stubParser) Name() string              { return s.name }
func (s *stubParser) CanParse(_, _ string) bool { return true }
func (s *stubParser) Parse(_ context.Context, _ parser.ParseContext) (*parser.ParseResult, error) {
	if s.delay > 0 {
		time.Sleep(s.delay)
	}
	if s.done != nil {
		close(s.done)
	}
	return s.res, s.err
}

// TestShadowReturnsPrimaryResult is the safety property of the whole
// wrapper: a slow, failing shadow must not delay or corrupt the result the
// caller sees.
func TestShadowReturnsPrimaryResult(t *testing.T) {
	primary := &stubParser{name: "primary", res: &parser.ParseResult{Text: "primary text", IsMarkdown: true}}
	shadow := &stubParser{name: "shadow", delay: 2 * time.Second, err: errors.New("shadow boom"), done: make(chan struct{})}
	p := &ShadowParser{Primary: primary, Shadow: shadow, Timeout: time.Second}

	start := time.Now()
	res, err := p.Parse(context.Background(), parser.ParseContext{FileName: "x.docx"})
	elapsed := time.Since(start)

	if err != nil {
		t.Fatalf("primary result must pass through unchanged: %v", err)
	}
	if res.Text != "primary text" || !res.IsMarkdown {
		t.Errorf("primary result altered: %+v", res)
	}
	if elapsed > 50*time.Millisecond {
		t.Errorf("primary result took %v; the shadow must not block it", elapsed)
	}
	if p.Name() != "primary" {
		t.Errorf("Name() = %q, want the primary's name %q", p.Name(), "primary")
	}
	select {
	case <-shadow.done:
	case <-time.After(3 * time.Second):
		t.Error("shadow run never completed")
	}
}

// TestShadowWritesDumpFile checks that with Dir set, one finished shadow run
// lands a JSON file named by the file's sha256 holding both results in the
// goldset parsedump shape.
func TestShadowWritesDumpFile(t *testing.T) {
	dir := t.TempDir()
	file := filepath.Join(dir, "doc.docx")
	fileBytes := []byte("PK\x03\x04 fake zip")
	if err := os.WriteFile(file, fileBytes, 0o644); err != nil {
		t.Fatalf("write fixture: %v", err)
	}

	primary := &stubParser{name: "primary", res: &parser.ParseResult{Text: "alpha beta", IsMarkdown: true}}
	shadow := &stubParser{name: "shadow", res: &parser.ParseResult{Text: "beta gamma", IsMarkdown: true}}
	p := &ShadowParser{Primary: primary, Shadow: shadow, Dir: dir}

	if _, err := p.Parse(context.Background(), parser.ParseContext{FilePath: file, FileName: "doc.docx"}); err != nil {
		t.Fatalf("parse: %v", err)
	}

	sum := sha256.Sum256(fileBytes)
	path := filepath.Join(dir, hex.EncodeToString(sum[:])+".json")
	// The stub signals its own return before the wrapper writes the dump,
	// so poll for the file rather than trusting that signal.
	var data []byte
	var err error
	deadline := time.Now().Add(3 * time.Second)
	for {
		data, err = os.ReadFile(path)
		if err == nil {
			break
		}
		if time.Now().After(deadline) {
			t.Fatalf("dump not written: %v", err)
		}
		time.Sleep(10 * time.Millisecond)
	}

	var dump struct {
		Primary struct {
			Parser     string   `json:"parser"`
			Doc        string   `json:"doc"`
			Text       string   `json:"text"`
			IsMarkdown bool     `json:"is_markdown"`
			Error      *string  `json:"error"`
			Pages      []string `json:"pages"`
		} `json:"primary"`
		Shadow struct {
			Parser     string   `json:"parser"`
			Doc        string   `json:"doc"`
			Text       string   `json:"text"`
			IsMarkdown bool     `json:"is_markdown"`
			Error      *string  `json:"error"`
			Pages      []string `json:"pages"`
		} `json:"shadow"`
	}
	if err := json.Unmarshal(data, &dump); err != nil {
		t.Fatalf("dump is not valid JSON: %v\n%s", err, data)
	}
	if dump.Primary.Parser != "primary" || dump.Shadow.Parser != "shadow" {
		t.Errorf("parser names: primary=%q shadow=%q", dump.Primary.Parser, dump.Shadow.Parser)
	}
	if dump.Primary.Doc != "doc" || dump.Shadow.Doc != "doc" {
		t.Errorf("doc id: primary=%q shadow=%q, want %q", dump.Primary.Doc, dump.Shadow.Doc, "doc")
	}
	if dump.Primary.Text != "alpha beta" || !dump.Primary.IsMarkdown {
		t.Errorf("primary dump: %+v", dump.Primary)
	}
	if dump.Shadow.Text != "beta gamma" || !dump.Shadow.IsMarkdown {
		t.Errorf("shadow dump: %+v", dump.Shadow)
	}
	if dump.Primary.Error != nil || dump.Shadow.Error != nil {
		t.Errorf("unexpected errors in dump: primary=%v shadow=%v", dump.Primary.Error, dump.Shadow.Error)
	}
}

// TestShadowSkipsWhenSaturated checks the concurrency cap: with two shadow
// runs in flight, a third is skipped (and counted), not queued — shadow
// traffic must never back up ingestion.
func TestShadowSkipsWhenSaturated(t *testing.T) {
	release := make(chan struct{})
	blocking := &blockingParser{release: release}
	primary := &stubParser{name: "primary", res: &parser.ParseResult{Text: "x"}}
	p := &ShadowParser{Primary: primary, Shadow: blocking}

	pctx := parser.ParseContext{FileName: "x.docx"}
	// Occupy both slots; each call's shadow run blocks until release.
	if _, err := p.Parse(context.Background(), pctx); err != nil {
		t.Fatalf("first parse: %v", err)
	}
	if _, err := p.Parse(context.Background(), pctx); err != nil {
		t.Fatalf("second parse: %v", err)
	}
	deadline := time.Now().Add(2 * time.Second)
	for atomic.LoadInt32(&blocking.hits) < 2 {
		if time.Now().After(deadline) {
			t.Fatalf("timeout waiting for both shadow slots (hits=%d)", blocking.hits)
		}
		time.Sleep(5 * time.Millisecond)
	}

	// The third call must skip its shadow run and still return promptly.
	if _, err := p.Parse(context.Background(), pctx); err != nil {
		t.Fatalf("third parse: %v", err)
	}
	if got := atomic.LoadInt32(&blocking.hits); got != 2 {
		t.Errorf("shadow started while saturated: %d runs in flight, want 2", got)
	}
	if got := testutil.ToFloat64(shadowTotal.WithLabelValues("skipped")); got != 1 {
		t.Errorf("skipped counter = %v, want 1", got)
	}

	close(release)
}

// blockingParser holds its slot until released; hits counts accepted runs.
type blockingParser struct {
	release chan struct{}
	hits    int32
}

func (b *blockingParser) Name() string              { return "blocking" }
func (b *blockingParser) CanParse(_, _ string) bool { return true }
func (b *blockingParser) Parse(_ context.Context, _ parser.ParseContext) (*parser.ParseResult, error) {
	atomic.AddInt32(&b.hits, 1)
	<-b.release
	return &parser.ParseResult{Text: "blocked"}, nil
}

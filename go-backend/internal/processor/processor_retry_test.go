package processor

import (
	"context"
	"errors"
	"slices"
	"testing"

	"github.com/hibiken/asynq"

	"github.com/justrag/go-backend/internal/parser"
)

// failingParser matches every file and always fails to parse — a stand-in
// for a transient parse failure (Docling timeout) that a retry may fix.
type failingParser struct{}

func (failingParser) Name() string                 { return "failing" }
func (failingParser) CanParse(string, string) bool { return true }
func (failingParser) Parse(context.Context, parser.ParseContext) (*parser.ParseResult, error) {
	return nil, errors.New("transient parse failure")
}

// withAttempt pins the asynq attempt counters ProcessFile sees.
func withAttempt(t *testing.T, retried, maxRetry int) {
	t.Helper()
	origCount, origMax := getRetryCount, getMaxRetry
	t.Cleanup(func() { getRetryCount, getMaxRetry = origCount, origMax })
	getRetryCount = func(context.Context) (int, bool) { return retried, true }
	getMaxRetry = func(context.Context) (int, bool) { return maxRetry, true }
}

func processWithFailingParser(t *testing.T, store *mockStore) error {
	t.Helper()
	factory := parser.NewFactory()
	factory.Register(failingParser{})
	p := NewProcessor(factory, nil, nil, store)
	return p.ProcessFile(context.Background(), ProcessFileInput{
		FileID:   "file-1",
		FilePath: "/tmp/x.pdf",
		FileName: "x.pdf",
		MimeType: "application/pdf",
		KBID:     "kb-1",
	})
}

// A failed attempt that asynq will retry must not flip the file to 'error':
// the UI would show "failed" until the retry silently turns it 'completed'.
func TestProcessFile_RetryableFailureOnNonFinalAttempt_KeepsProcessing(t *testing.T) {
	withAttempt(t, 0, 3)
	store := &mockStore{}

	if err := processWithFailingParser(t, store); err == nil {
		t.Fatal("expected an error so asynq retries, got nil")
	}
	if slices.Contains(store.statuses, "error") {
		t.Errorf("non-final attempt wrote status 'error': %v", store.statuses)
	}
}

func TestProcessFile_RetryableFailureOnFinalAttempt_MarksError(t *testing.T) {
	withAttempt(t, 3, 3)
	store := &mockStore{}

	if err := processWithFailingParser(t, store); err == nil {
		t.Fatal("expected an error, got nil")
	}
	if !slices.Contains(store.statuses, "error") {
		t.Errorf("final attempt did not write status 'error': %v", store.statuses)
	}
	if len(store.errStages) != 1 || store.errStages[0] != "parse" {
		t.Errorf("error stage: want [parse], got %v", store.errStages)
	}
}

// An unsupported type never succeeds on retry: mark it failed right away
// and tell asynq not to retry.
func TestProcessFile_UnsupportedTypeOnFirstAttempt_FailsFastWithoutRetry(t *testing.T) {
	withAttempt(t, 0, 3)
	store := &mockStore{}
	p := NewProcessor(parser.NewFactory(), nil, nil, store)

	err := p.ProcessFile(context.Background(), ProcessFileInput{
		FileID:   "file-1",
		FilePath: "/tmp/x.bin",
		FileName: "unknown.bin",
		MimeType: "application/octet-stream",
		KBID:     "kb-1",
	})
	if !errors.Is(err, asynq.SkipRetry) {
		t.Errorf("want error wrapping asynq.SkipRetry, got %v", err)
	}
	if len(store.errStages) != 1 || store.errStages[0] != "unsupported_type" {
		t.Errorf("error stage: want [unsupported_type], got %v", store.errStages)
	}
}

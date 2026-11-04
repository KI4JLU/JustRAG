package worker

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"testing"

	"github.com/hibiken/asynq"

	"github.com/justrag/go-backend/internal/jobs"
	"github.com/justrag/go-backend/internal/processor"
)

// rowLinks is a Links lookup that also answers FileExists, like
// *files.PGStore. exists is the test's oracle for the files row.
type rowLinks struct {
	fakeLinks
	exists bool
}

func (r *rowLinks) FileExists(context.Context, string) (bool, error) { return r.exists, nil }

type countingProc struct {
	calls int
	err   error
}

func (c *countingProc) ProcessFileWithResult(context.Context, processor.ProcessFileInput) (processor.ProcessOutcome, error) {
	c.calls++
	return processor.ProcessOutcome{}, c.err
}

func runDeleted(t *testing.T, links LibraryLinkLookup, proc fileProcessor) error {
	t.Helper()
	raw, _ := json.Marshal(jobs.FileProcessingPayload{FileID: "f1", KbID: "kb1", FilePath: "kb1/x.pdf"})
	h := NewFileProcessingHandlerWithDeps(FileProcessingDeps{Proc: proc, Links: links})
	return h(context.Background(), asynq.NewTask(jobs.TypeFileProcessing, raw))
}

// KI-828: a task whose file was deleted while queued never reaches the
// processor and is revoked (no retry, no dead-letter entry).
func TestFileHandler_DeletedFileIsRevokedBeforeProcessing(t *testing.T) {
	proc := &countingProc{}
	err := runDeleted(t, &rowLinks{exists: false}, proc)
	if !errors.Is(err, asynq.RevokeTask) || !errors.Is(err, processor.ErrFileDeleted) {
		t.Fatalf("err = %v, want RevokeTask wrapping ErrFileDeleted", err)
	}
	if proc.calls != 0 {
		t.Errorf("processor called %d times, want 0", proc.calls)
	}
}

// Deleted mid-run: the processor reports ErrFileDeleted, and the handler
// revokes instead of letting asynq retry.
func TestFileHandler_DeletedMidRunIsRevoked(t *testing.T) {
	proc := &countingProc{err: fmt.Errorf("%w (fileId f1)", processor.ErrFileDeleted)}
	err := runDeleted(t, &rowLinks{exists: true}, proc)
	if proc.calls != 1 {
		t.Fatalf("processor calls = %d, want 1", proc.calls)
	}
	if !errors.Is(err, asynq.RevokeTask) {
		t.Fatalf("err = %v, want RevokeTask", err)
	}
}

// Any other failure keeps asynq's retry: no revoke.
func TestFileHandler_OtherErrorStillRetries(t *testing.T) {
	proc := &countingProc{err: errors.New("embedding timeout")}
	err := runDeleted(t, &rowLinks{exists: true}, proc)
	if err == nil || errors.Is(err, asynq.RevokeTask) || errors.Is(err, asynq.SkipRetry) {
		t.Fatalf("err = %v, want a plain retryable error", err)
	}
}

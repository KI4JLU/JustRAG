package worker

import (
	"context"
	"encoding/json"
	"os"
	"testing"

	"github.com/hibiken/asynq"

	"github.com/justrag/go-backend/internal/jobs"
	"github.com/justrag/go-backend/internal/processor"
	"github.com/justrag/go-backend/internal/storage"
)

const fixture = "%PDF-1.4 fixture body"

// localStore returns real local-disk storage rooted in a temp dir holding one
// blob at key. The key is deliberately NOT a valid path from the test's
// working directory, so a handler that passes it through unresolved fails.
func localStore(t *testing.T, key string) storage.Storage {
	t.Helper()
	st, err := storage.New(storage.Config{DataDir: t.TempDir()})
	if err != nil {
		t.Fatal(err)
	}
	if st.IsS3() {
		t.Fatal("expected local storage")
	}
	if err := st.StoreFile(context.Background(), key, []byte(fixture), "application/pdf"); err != nil {
		t.Fatal(err)
	}
	return st
}

// readingProc reads the file at the path it is handed, the way a parser
// would. The oracle is the fixture content, not any path the worker computed.
type readingProc struct {
	content string
	readErr error
}

func (r *readingProc) ProcessFileWithResult(_ context.Context, in processor.ProcessFileInput) (processor.ProcessOutcome, error) {
	b, err := os.ReadFile(in.FilePath)
	r.content, r.readErr = string(b), err
	return processor.ProcessOutcome{}, nil
}

// KI-825: with local storage the parser must get a readable file, not the
// bare storage key.
func TestFileHandler_LocalStorageHandsParserAReadableFile(t *testing.T) {
	key := "admin/kb-825/report.pdf"
	st := localStore(t, key)
	proc := &readingProc{}
	raw, _ := json.Marshal(jobs.FileProcessingPayload{FileID: "f1", KbID: "kb-825", FilePath: key})
	h := NewFileProcessingHandlerWithDeps(FileProcessingDeps{Proc: proc, Storage: st})
	if err := h(context.Background(), asynq.NewTask(jobs.TypeFileProcessing, raw)); err != nil {
		t.Fatal(err)
	}
	if proc.readErr != nil || proc.content != fixture {
		t.Fatalf("parser read %q (%v), want the stored fixture", proc.content, proc.readErr)
	}
}

func TestMaterializeBlob_LocalStorageAndCleanup(t *testing.T) {
	key := "u/kb/page.html"
	st := localStore(t, key)
	path, cleanup, err := materializeBlob(context.Background(), st, key, "justrag-test-*")
	if err != nil {
		t.Fatal(err)
	}
	if b, err := os.ReadFile(path); err != nil || string(b) != fixture {
		t.Fatalf("temp file = %q (%v), want fixture", b, err)
	}
	cleanup()
	if _, err := os.Stat(path); !os.IsNotExist(err) {
		t.Errorf("temp file still there after cleanup (%v)", err)
	}
	if _, _, err := materializeBlob(context.Background(), st, "u/kb/missing.html", "justrag-test-*"); err == nil {
		t.Error("missing blob must error")
	}
}

// No backend wired (unit tests elsewhere): the path passes through.
func TestMaterializeBlob_NilStoragePassesThrough(t *testing.T) {
	path, cleanup, err := materializeBlob(context.Background(), nil, "x/y.pdf", "p-*")
	if err != nil || path != "x/y.pdf" {
		t.Fatalf("got %q, %v", path, err)
	}
	cleanup()
}

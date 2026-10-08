package worker

import (
	"context"
	"encoding/json"
	"errors"
	"testing"

	"github.com/hibiken/asynq"
	"github.com/prometheus/client_golang/prometheus/testutil"

	"github.com/justrag/go-backend/internal/jobs"
	"github.com/justrag/go-backend/internal/observability"
	"github.com/justrag/go-backend/internal/processor"
)

type fakeFileProcessor struct {
	got     processor.ProcessFileInput
	outcome processor.ProcessOutcome
	err     error
}

func (f *fakeFileProcessor) ProcessFileWithResult(_ context.Context, in processor.ProcessFileInput) (processor.ProcessOutcome, error) {
	f.got = in
	return f.outcome, f.err
}

type fakeOwners struct {
	calls int
	owner string
	err   error
}

func (f *fakeOwners) UserFileOwner(context.Context, string) (string, error) {
	f.calls++
	return f.owner, f.err
}

func runHandler(t *testing.T, fp *fakeFileProcessor, ow *fakeOwners, pl jobs.FileProcessingPayload) error {
	t.Helper()
	raw, _ := json.Marshal(pl)
	h := NewFileProcessingHandlerWithOwners(fp, nil, nil, ow)
	return h(context.Background(), asynq.NewTask(jobs.TypeFileProcessing, raw))
}

func addCount(mode string) float64 {
	return testutil.ToFloat64(observability.UserFileAddTotalForTest().WithLabelValues(mode))
}

func TestFileHandler_LibraryPayloadRecordsModeAndPassesOwner(t *testing.T) {
	for _, tc := range []struct {
		hit  bool
		mode string
	}{{true, "ingest_cached_parse"}, {false, "ingest"}} {
		fp := &fakeFileProcessor{outcome: processor.ProcessOutcome{ParseCacheHit: tc.hit}}
		ow := &fakeOwners{owner: "owner-9"}
		before := addCount(tc.mode)
		if err := runHandler(t, fp, ow, jobs.FileProcessingPayload{FileID: "f", KbID: "k", UserFileID: "uf-1"}); err != nil {
			t.Fatal(err)
		}
		if fp.got.UserFileID != "uf-1" || fp.got.OwnerUserID != "owner-9" {
			t.Errorf("input = %+v", fp.got)
		}
		if d := addCount(tc.mode) - before; d != 1 {
			t.Errorf("%s delta = %v, want 1", tc.mode, d)
		}
	}
}

func TestFileHandler_OwnerLookupFailureProceedsWithoutOwner(t *testing.T) {
	fp := &fakeFileProcessor{}
	ow := &fakeOwners{err: errors.New("db down")}
	if err := runHandler(t, fp, ow, jobs.FileProcessingPayload{FileID: "f", UserFileID: "uf-1"}); err != nil {
		t.Fatal(err)
	}
	if fp.got.OwnerUserID != "" {
		t.Errorf("owner = %q, want empty", fp.got.OwnerUserID)
	}
}

func TestFileHandler_NonLibraryPayloadNoLookupNoMetric(t *testing.T) {
	fp := &fakeFileProcessor{outcome: processor.ProcessOutcome{ParseCacheHit: true}}
	ow := &fakeOwners{owner: "x"}
	b1, b2 := addCount("ingest"), addCount("ingest_cached_parse")
	if err := runHandler(t, fp, ow, jobs.FileProcessingPayload{FileID: "f", KbID: "k"}); err != nil {
		t.Fatal(err)
	}
	if ow.calls != 0 {
		t.Error("owner lookup must not be called")
	}
	if addCount("ingest") != b1 || addCount("ingest_cached_parse") != b2 {
		t.Error("no metric expected")
	}
}

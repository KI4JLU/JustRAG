package processor

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/justrag/go-backend/internal/logctx"
)

// ErrFileDeleted reports that the file's row was deleted while (or before)
// it was being ingested (KI-828). The run stops, removes what it wrote, and
// the worker does not retry it: there is nothing left to ingest into.
var ErrFileDeleted = errors.New("processor: file was deleted during ingestion")

// FileRowChecker is implemented by a ProcessorStore that can tell whether a
// files row still exists (*files.PGStore does). Without it the processor
// cannot notice a deletion and ingests to the end, as before.
type FileRowChecker interface {
	FileExists(ctx context.Context, fileID string) (bool, error)
}

// fileRowPollInterval is how often a running ingest re-checks its files row.
// One primary-key lookup per interval and file; a variable for tests.
var fileRowPollInterval = 15 * time.Second

// fileRowGone reports whether the row is known to be gone. A failed lookup
// counts as present: a database hiccup must not abort a healthy ingest.
func fileRowGone(ctx context.Context, rc FileRowChecker, fileID string) bool {
	ok, err := rc.FileExists(ctx, fileID)
	if err != nil {
		if ctx.Err() == nil {
			logctx.From(ctx).Warn("processor: file row check failed; continuing", "fileId", fileID, "error", err)
		}
		return false
	}
	return !ok
}

// watchFileRow returns a context that is canceled with cause ErrFileDeleted
// once the files row disappears, checked every fileRowPollInterval. Every
// stage already honours ctx (LLM, embedding and DB calls), so a long stage
// stops within one interval instead of running to the end. stop releases the
// watcher; call it when the run ends.
func watchFileRow(ctx context.Context, rc FileRowChecker, fileID string) (wctx context.Context, stop func()) {
	wctx, cancel := context.WithCancelCause(ctx)
	done := make(chan struct{})
	go func() {
		t := time.NewTicker(fileRowPollInterval)
		defer t.Stop()
		for {
			select {
			case <-done:
				return
			case <-wctx.Done():
				return
			case <-t.C:
				if fileRowGone(wctx, rc, fileID) {
					cancel(ErrFileDeleted)
					return
				}
			}
		}
	}()
	return wctx, func() {
		close(done)
		cancel(nil)
	}
}

// removeDeletedFileOutput deletes what a run wrote for a file whose row was
// deleted meanwhile. The delete cascade (internal/cascade) already ran when
// the row went, so anything written after it would stay behind with no row
// pointing at it: vector and parent chunks, HyPE questions and the file's KG
// contribution. Tabular tables need nothing here: their catalog rows carry a
// cascading FK to files, so those writes fail on their own. Best-effort and
// detached from the canceled run context.
func (p *Processor) removeDeletedFileOutput(ctx context.Context, kbID, fileID string) {
	ctx = context.WithoutCancel(ctx)
	log := logctx.From(ctx)
	if p.cleaner != nil {
		if err := p.cleaner.DeleteChunksByFileIDAllDims(ctx, fileID); err != nil {
			log.Warn("processor: deleted-file chunk cleanup failed; orphan chunks possible", "fileId", fileID, "error", err)
		}
		if err := p.cleaner.DeleteParentChunksByFileID(ctx, fileID); err != nil {
			log.Warn("processor: deleted-file parent cleanup failed; orphan rows possible", "fileId", fileID, "error", err)
		}
		if h, ok := p.cleaner.(interface {
			DeleteHyPEByFileIDAllDims(ctx context.Context, fileID string) error
		}); ok {
			if err := h.DeleteHyPEByFileIDAllDims(ctx, fileID); err != nil {
				log.Warn("processor: deleted-file hype cleanup failed; orphan rows possible", "fileId", fileID, "error", err)
			}
		}
	}
	if p.kgCleaner != nil && kbID != "" {
		if err := p.kgCleaner.DeleteKGForFile(ctx, kbID, fileID); err != nil {
			log.Warn("processor: deleted-file kg cleanup failed; orphan kg rows possible", "fileId", fileID, "error", err)
		}
	}
}

// guardDeletedFile wraps one ingest run. A file already deleted before it
// starts is not touched. One deleted during the run is stopped (see
// watchFileRow) and its output removed; either way the run returns an error
// wrapping ErrFileDeleted, also when the run itself had already returned
// nil (the row went after its last ctx check).
func (p *Processor) guardDeletedFile(ctx context.Context, in ProcessFileInput, run func(context.Context) error) error {
	rc, ok := p.store.(FileRowChecker)
	if !ok || in.FileID == "" {
		return run(ctx)
	}
	if fileRowGone(ctx, rc, in.FileID) {
		return fmt.Errorf("%w (fileId %s, before start)", ErrFileDeleted, in.FileID)
	}
	wctx, stop := watchFileRow(ctx, rc, in.FileID)
	err := run(wctx)
	stop()
	if errors.Is(context.Cause(wctx), ErrFileDeleted) {
		p.removeDeletedFileOutput(ctx, in.KBID, in.FileID)
		return fmt.Errorf("%w (fileId %s)", ErrFileDeleted, in.FileID)
	}
	return err
}

package worker

import (
	"context"
	"fmt"
	"log/slog"

	"github.com/justrag/go-backend/internal/jobs"
	"github.com/justrag/go-backend/internal/observability"
	"github.com/justrag/go-backend/internal/processor"
	"github.com/justrag/go-backend/internal/vector"
)

// copyProcessor is the part of *processor.Processor copy mode calls.
type copyProcessor interface {
	IndexFingerprint(ctx context.Context, kbID string, chunkSize, chunkOverlap int) (string, error)
	TextSearchConfig(ctx context.Context, kbID string) string
	CachedParseText(ctx context.Context, kbID, ownerUserID, userFileID, mimeType, fileName string) (string, bool)
	KGExtractionEnabled(ctx context.Context, kbID string) bool
	RebuildKGForFile(ctx context.Context, kbID, fileID, fileName, userFileID, documentBody string) error
}

// copyStore is the main-DB surface copy mode needs. *files.PGStore satisfies
// it.
type copyStore interface {
	FindCopyDonor(ctx context.Context, userFileID, fp, excludeFileID string) (string, error)
	MarkCopied(ctx context.Context, fileID, fp string) error
	UpdateFileStatus(ctx context.Context, fileID, status string) error
	GetFileScreeningInfo(ctx context.Context, fileID string) (origin, kbVisibility string, err error)
	processor.ScreeningStore
}

// copyIndex is the vector-DB surface copy mode needs. *vector.ChunkService
// satisfies it.
type copyIndex interface {
	CopyFileIndex(ctx context.Context, srcFileID, dstFileID, dstKbID, pgConfig string) (vector.CopyResult, error)
	GetFileLeafTextAllDims(ctx context.Context, kbID, fileID string) (string, error)
	DeleteChunksByFileIDAllDims(ctx context.Context, fileID string) error
	DeleteParentChunksByFileID(ctx context.Context, fileID string) error
	DeleteHyPEByFileIDAllDims(ctx context.Context, fileID string) error
}

// CopyDeps enables copy mode on the file-processing handler.
type CopyDeps struct {
	Proc   copyProcessor
	Store  copyStore
	Index  copyIndex
	Reader processor.SiteConfigReader
}

// tryCopy serves a library-backed file by copying a donor KB copy's index.
//
// (false, nil): no copy was made — no fingerprint, no donor, or the copy
// failed and the target's partial index was cleaned — and the caller runs the
// normal ingest in the same attempt (P2-R6). (true, nil): the file is
// completed. (true, err): the index was copied but the terminal status write
// failed; returning the error lets asynq retry, and the copy is idempotent.
func (c *CopyDeps) tryCopy(ctx context.Context, pl jobs.FileProcessingPayload, chunkSize, chunkOverlap int, ownerID string) (bool, error) {
	fileID, kbID, ufID := pl.FileID, pl.KbID, pl.UserFileID
	log := slog.With("fileId", fileID, "kbId", kbID, "userFileId", ufID)

	fp, err := c.Proc.IndexFingerprint(ctx, kbID, chunkSize, chunkOverlap)
	if err != nil || fp == "" {
		log.Info("copy mode skipped: fingerprint not computed", "error", err)
		return false, nil
	}
	donor, err := c.Store.FindCopyDonor(ctx, ufID, fp, fileID)
	if err != nil {
		log.Warn("copy mode skipped: donor lookup failed", "error", err)
		return false, nil
	}
	if donor == "" {
		return false, nil
	}
	log = log.With("donorFileId", donor)

	// 'processing' also clears any stale fingerprint on the target, so it
	// can never serve as a donor while its index is being replaced.
	if err := c.Store.UpdateFileStatus(ctx, fileID, "processing"); err != nil {
		log.Warn("copy mode skipped: status update failed", "error", err)
		return false, nil
	}

	if _, err := c.Index.CopyFileIndex(ctx, donor, fileID, kbID, c.Proc.TextSearchConfig(ctx, kbID)); err != nil {
		log.Warn("copy mode failed; falling back to ingest", "error", err)
		c.cleanTarget(ctx, fileID)
		return false, nil
	}

	// The donor must still be a donor now that the copy committed: had it
	// started re-ingesting (status flipped, fingerprint cleared) while the
	// copy ran, the copy may hold a half-deleted index. Recheck and discard.
	again, err := c.Store.FindCopyDonor(ctx, ufID, fp, fileID)
	if err != nil || again != donor {
		log.Warn("copy mode discarded: donor changed during the copy; falling back to ingest",
			"recheckDonor", again, "error", err)
		c.cleanTarget(ctx, fileID)
		return false, nil
	}

	// Lazily read the copied leaf text: screening and the KG body fallback
	// both need it, and neither may need it at all.
	var leaf string
	leafRead := false
	leafText := func() (string, error) {
		if leafRead {
			return leaf, nil
		}
		t, lerr := c.Index.GetFileLeafTextAllDims(ctx, kbID, fileID)
		if lerr != nil {
			return "", lerr
		}
		leaf, leafRead = t, true
		return leaf, nil
	}

	// P2-R8: the copy screens the target, which may sit in a public KB
	// where the donor (private) was never screened.
	if processor.ScreeningEnabled(ctx, c.Reader) {
		origin, vis, serr := c.Store.GetFileScreeningInfo(ctx, fileID)
		switch {
		case serr != nil:
			log.Warn("copy mode: read screening info failed", "error", serr)
		case processor.ShouldScreen(origin, vis):
			if text, lerr := leafText(); lerr != nil {
				log.Warn("copy mode: read leaf text for screening failed", "error", lerr)
			} else {
				processor.ScreenAndRecord(ctx, c.Store, c.Reader, fileID, origin, text)
			}
		}
	}

	if err := c.Store.MarkCopied(ctx, fileID, fp); err != nil {
		return true, fmt.Errorf("copy mode: mark copied: %w", err)
	}
	observability.RecordUserFileAdd("copy")
	log.Info("copy mode: index copied from donor")

	// KG is replayed through the extraction cache, after the status is
	// terminal — like the ingest path, a KG failure never reverts it, and
	// RebuildKGForFile's "is anything still ingesting?" mindmap recompute
	// must not count this file. Best-effort.
	if c.Proc.KGExtractionEnabled(ctx, kbID) {
		body, ok := c.Proc.CachedParseText(ctx, kbID, ownerID, ufID, pl.MimeType, pl.OriginalName)
		if !ok {
			t, lerr := leafText()
			if lerr != nil {
				log.Warn("copy mode: read leaf text for KG failed", "error", lerr)
			}
			body = t
		}
		if err := c.Proc.RebuildKGForFile(ctx, kbID, fileID, pl.OriginalName, ufID, body); err != nil {
			log.Warn("copy mode: kg rebuild failed", "error", err)
		}
	}
	return true, nil
}

// cleanTarget removes whatever a failed copy may have left on the target.
// CopyFileIndex is one transaction, so normally nothing is left; this is the
// guarantee for the rest (Review Focus 5). Best-effort: the ingest that
// follows deletes the target's chunks and parents itself.
func (c *CopyDeps) cleanTarget(ctx context.Context, fileID string) {
	if err := c.Index.DeleteChunksByFileIDAllDims(ctx, fileID); err != nil {
		slog.Warn("copy mode: cleanup chunks failed", "fileId", fileID, "error", err)
	}
	if err := c.Index.DeleteParentChunksByFileID(ctx, fileID); err != nil {
		slog.Warn("copy mode: cleanup parents failed", "fileId", fileID, "error", err)
	}
	if err := c.Index.DeleteHyPEByFileIDAllDims(ctx, fileID); err != nil {
		slog.Warn("copy mode: cleanup hype failed", "fileId", fileID, "error", err)
	}
}

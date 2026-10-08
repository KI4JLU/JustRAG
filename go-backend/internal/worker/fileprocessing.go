package worker

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"os"

	"github.com/hibiken/asynq"
	"github.com/justrag/go-backend/internal/jobs"
	"github.com/justrag/go-backend/internal/observability"
	"github.com/justrag/go-backend/internal/processor"
	"github.com/justrag/go-backend/internal/storage"
)

// FileProcessingPayload is an alias for jobs.FileProcessingPayload so that
// existing callers (e.g. files package) keep compiling during the migration.
type FileProcessingPayload = jobs.FileProcessingPayload

// KBChunkConfigStore looks up per-KB chunk settings.
type KBChunkConfigStore interface {
	GetKBChunkConfig(ctx context.Context, kbID string) (chunkSize, chunkOverlap int, err error)
}

// QueryCacheInvalidator nukes cached SearchResults for a KB when the
// underlying chunk inventory changes (ingestion completion, re-ingest).
// Wired through *vector.SearchService in production. Optional — a nil
// invalidator skips the call (the TTL fallback eventually corrects any
// missed invalidation).
type QueryCacheInvalidator interface {
	InvalidateQueryCache(ctx context.Context, kbID string) error
}

// invalidateKBQueryCache fires the optional query-cache invalidation
// hook. Fail-safe: nil invalidator is a no-op; errors are logged but
// never propagated, since the cache is best-effort.
func invalidateKBQueryCache(ctx context.Context, qc QueryCacheInvalidator, kbID, reason string) {
	if qc == nil || kbID == "" {
		return
	}
	if err := qc.InvalidateQueryCache(ctx, kbID); err != nil {
		slog.Warn("query_cache: invalidate failed",
			"kb_id", kbID, "reason", reason, "error", err)
	}
}

// OwnerLookup resolves the owner of a user-library file. The worker uses it to
// key the parse cache; a failed lookup just disables the cache for the task.
type OwnerLookup interface {
	UserFileOwner(ctx context.Context, userFileID string) (string, error)
}

// NewFileProcessingHandler returns an asynq.HandlerFunc that processes a single file.
// It looks up the KB's chunk settings before processing.
// If storage is S3, the file is downloaded to a temp path first.
//
// queryCache is optional — when non-nil, the handler nukes cached
// SearchResults for the KB after a successful ingestion so freshly
// embedded chunks are visible immediately rather than after the cache TTL.
func NewFileProcessingHandler(proc *processor.Processor, kbStore KBChunkConfigStore, queryCache QueryCacheInvalidator, stor ...storage.Storage) asynq.HandlerFunc {
	return NewFileProcessingHandlerWithOwners(proc, kbStore, queryCache, nil, stor...)
}

// NewFileProcessingHandlerWithOwners is NewFileProcessingHandler plus the
// owner lookup that enables the library parse cache. owners may be nil.
func NewFileProcessingHandlerWithOwners(proc *processor.Processor, kbStore KBChunkConfigStore, queryCache QueryCacheInvalidator, owners OwnerLookup, stor ...storage.Storage) asynq.HandlerFunc {
	var storageBackend storage.Storage
	if len(stor) > 0 {
		storageBackend = stor[0]
	}
	return func(ctx context.Context, task *asynq.Task) error {
		var payload jobs.FileProcessingPayload
		if err := json.Unmarshal(task.Payload(), &payload); err != nil {
			return fmt.Errorf("unmarshal file processing payload: %w", err)
		}

		slog.Info("processing file",
			"fileId", payload.FileID,
			"kbId", payload.KbID,
			"fileName", payload.OriginalName,
		)

		// Look up KB-specific chunk settings (0 means use defaults)
		chunkSize, chunkOverlap := 0, 0
		if kbStore != nil && payload.KbID != "" {
			cs, co, err := kbStore.GetKBChunkConfig(ctx, payload.KbID)
			if err == nil {
				chunkSize, chunkOverlap = cs, co
			}
		}

		// If storage is S3, stream the file to a temp path for local processing.
		// Uses ReadFileStream to avoid buffering the entire file in memory.
		localPath := payload.FilePath
		if storageBackend != nil && storageBackend.IsS3() {
			stream, dlErr := storageBackend.ReadFileStream(ctx, payload.FilePath)
			if dlErr != nil {
				return fmt.Errorf("download file from storage: %w", dlErr)
			}
			tmpFile, tmpErr := os.CreateTemp("", "justrag-file-*")
			if tmpErr != nil {
				stream.Close()
				return fmt.Errorf("create temp file: %w", tmpErr)
			}
			defer os.Remove(tmpFile.Name())
			if _, wErr := io.Copy(tmpFile, stream); wErr != nil {
				stream.Close()
				tmpFile.Close()
				return fmt.Errorf("write temp file: %w", wErr)
			}
			stream.Close()
			tmpFile.Close()
			localPath = tmpFile.Name()
		}

		// Library-backed payloads carry UserFileID; the owner is read from the
		// database rather than trusted from the payload. A failed lookup only
		// costs the parse cache.
		ownerID := ""
		if payload.UserFileID != "" && owners != nil {
			o, oerr := owners.UserFileOwner(ctx, payload.UserFileID)
			if oerr != nil {
				slog.Warn("parse cache disabled: owner lookup failed",
					"fileId", payload.FileID, "userFileId", payload.UserFileID, "error", oerr)
			} else {
				ownerID = o
			}
		}

		outcome, err := proc.ProcessFileWithResult(ctx, processor.ProcessFileInput{
			FileID:       payload.FileID,
			FilePath:     localPath,
			FileName:     payload.OriginalName,
			MimeType:     payload.MimeType,
			KBID:         payload.KbID,
			ChunkSize:    chunkSize,
			ChunkOverlap: chunkOverlap,
			UserFileID:   payload.UserFileID,
			OwnerUserID:  ownerID,
		})
		if err != nil {
			slog.Error("file processing failed",
				"fileId", payload.FileID,
				"error", err,
			)
			return err
		}

		if payload.UserFileID != "" {
			if outcome.ParseCacheHit {
				observability.RecordUserFileAdd("ingest_cached_parse")
			} else {
				observability.RecordUserFileAdd("ingest")
			}
		}

		// Ingestion success — nuke any cached SearchResults for this KB so
		// freshly embedded chunks are visible to subsequent searches without
		// waiting for the cache TTL. Best-effort: failures log and continue.
		invalidateKBQueryCache(ctx, queryCache, payload.KbID, "file_added")

		slog.Info("file processing completed", "fileId", payload.FileID)
		return nil
	}
}

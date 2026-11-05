package worker

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"

	"github.com/hibiken/asynq"
	"github.com/justrag/go-backend/internal/jobs"
	"github.com/justrag/go-backend/internal/processor"
	"github.com/justrag/go-backend/internal/storage"
)

// URLProcessingPayload is an alias for jobs.URLProcessingPayload so that
// existing callers keep compiling during the migration.
type URLProcessingPayload = jobs.URLProcessingPayload

// NewURLProcessingHandler returns an asynq.HandlerFunc that processes a file
// previously saved to storage (e.g. a crawled URL). The blob is streamed to
// a temp file for the parser on every backend (materializeBlob).
//
// queryCache is optional — when non-nil, the handler nukes cached
// SearchResults for the KB after a successful ingestion.
func NewURLProcessingHandler(proc *processor.Processor, stor storage.Storage, kbStore KBChunkConfigStore, queryCache QueryCacheInvalidator) asynq.HandlerFunc {
	return func(ctx context.Context, task *asynq.Task) error {
		var payload jobs.URLProcessingPayload
		if err := json.Unmarshal(task.Payload(), &payload); err != nil {
			return fmt.Errorf("unmarshal url processing payload: %w", err)
		}

		slog.Info("processing URL content",
			"fileId", payload.FileID,
			"kbId", payload.KbID,
			"filePath", payload.FilePath,
			"fileName", payload.OriginalName,
		)

		// Stream the blob to a temp file, whatever the backend: a storage
		// path is never a filesystem path (see materializeBlob, KI-825).
		localPath, cleanup, err := materializeBlob(ctx, stor, payload.FilePath, "justrag-url-*")
		if err != nil {
			return err
		}
		defer cleanup()

		chunkSize, chunkOverlap := 0, 0
		if kbStore != nil && payload.KbID != "" {
			cs, co, err := kbStore.GetKBChunkConfig(ctx, payload.KbID)
			if err == nil {
				chunkSize, chunkOverlap = cs, co
			}
		}

		if err := proc.ProcessFile(ctx, processor.ProcessFileInput{
			FileID:       payload.FileID,
			FilePath:     localPath,
			FileName:     payload.OriginalName,
			MimeType:     payload.MimeType,
			KBID:         payload.KbID,
			ChunkSize:    chunkSize,
			ChunkOverlap: chunkOverlap,
		}); err != nil {
			slog.Error("URL processing failed",
				"fileId", payload.FileID,
				"error", err,
			)
			return err
		}

		invalidateKBQueryCache(ctx, queryCache, payload.KbID, "file_added")

		slog.Info("URL processing completed", "fileId", payload.FileID)
		return nil
	}
}

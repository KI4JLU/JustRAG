package worker

import (
	"context"
	"fmt"
	"io"
	"os"

	"github.com/justrag/go-backend/internal/storage"
)

// materializeBlob streams the blob at storagePath to a temp file and returns
// its path plus a cleanup that removes it. It does this for every backend,
// local disk included: a storage path is a key into the backend, never a
// filesystem path (local storage keeps it under its data dir, so handing the
// raw key to a parser opened a file that did not exist; KI-825). With no
// backend wired (tests), storagePath is returned unchanged.
func materializeBlob(ctx context.Context, stor storage.Storage, storagePath, pattern string) (path string, cleanup func(), err error) {
	if stor == nil {
		return storagePath, func() {}, nil
	}
	stream, err := stor.ReadFileStream(ctx, storagePath)
	if err != nil {
		return "", nil, fmt.Errorf("download file from storage: %w", err)
	}
	defer stream.Close()
	tmp, err := os.CreateTemp("", pattern)
	if err != nil {
		return "", nil, fmt.Errorf("create temp file: %w", err)
	}
	remove := func() { os.Remove(tmp.Name()) } //nolint:errcheck // best-effort temp cleanup
	if _, err := io.Copy(tmp, stream); err != nil {
		tmp.Close()
		remove()
		return "", nil, fmt.Errorf("write temp file: %w", err)
	}
	if err := tmp.Close(); err != nil {
		remove()
		return "", nil, fmt.Errorf("close temp file: %w", err)
	}
	return tmp.Name(), remove, nil
}

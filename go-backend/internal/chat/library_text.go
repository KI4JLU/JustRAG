package chat

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"

	"github.com/justrag/go-backend/internal/libpaths"
	"github.com/justrag/go-backend/internal/logctx"
	"github.com/justrag/go-backend/internal/parser"
	"github.com/justrag/go-backend/internal/storage"
	"github.com/justrag/go-backend/internal/userfiles"
)

// ErrUnparseable means no parser handles the library file or the parser failed
// on its content. Storage, IO and context errors are never mapped to it.
// Callers must test with errors.Is and show a fixed user message; the cause is
// logged here, never carried in the error text.
var ErrUnparseable = errors.New("library file cannot be parsed")

// LibraryTextSource resolves a library file to parsed text for library chat.
type LibraryTextSource struct {
	stor    storage.Storage
	factory *parser.Factory
}

// NewLibraryTextSource builds a source over the blob store and parser factory.
func NewLibraryTextSource(stor storage.Storage, factory *parser.Factory) *LibraryTextSource {
	return &LibraryTextSource{stor: stor, factory: factory}
}

// Text returns the parsed text of uf (owner-scoping is the caller's job): the
// cached chat-text object if present, else the blob is parsed now (KbID ""
// selects the global AI provider), cached unless Degraded, and returned.
// Two concurrent misses may both parse and both write identical content.
// uf must already have been fetched owner-scoped by the caller.
func (s *LibraryTextSource) Text(ctx context.Context, uf *userfiles.UserFile) (*parser.ParseResult, error) {
	if s == nil || s.stor == nil || s.factory == nil || uf == nil {
		return nil, ErrUnparseable
	}
	if err := ctx.Err(); err != nil {
		return nil, fmt.Errorf("library text %s: %w", uf.ID, err)
	}
	key := libpaths.ChatTextKey(uf.OwnerUserID, uf.ID)
	if ok, err := s.stor.FileExists(ctx, key); err == nil && ok {
		if raw, rerr := s.stor.ReadFile(ctx, key); rerr == nil {
			var cached parser.ParseResult
			if json.Unmarshal(raw, &cached) == nil {
				return &cached, nil
			}
		}
	}

	p := s.factory.GetParser(uf.Mime, uf.Name)
	if p == nil {
		return nil, ErrUnparseable
	}
	res, err := s.parseBlob(ctx, p, uf)
	if err != nil {
		var pe *parseFailure
		if errors.As(err, &pe) && ctx.Err() == nil {
			logctx.From(ctx).Warn("library text: parse failed", "user_file_id", uf.ID, "error", pe.err)
			return nil, ErrUnparseable
		}
		if pe != nil {
			err = pe.err
		}
		return nil, fmt.Errorf("library text %s: %w", uf.ID, err)
	}
	if res == nil {
		return nil, ErrUnparseable
	}
	if !res.Degraded {
		if raw, merr := json.Marshal(res); merr == nil {
			if perr := s.stor.StoreFile(ctx, key, raw, "application/json"); perr != nil {
				logctx.From(ctx).Warn("library text: cache write failed", "user_file_id", uf.ID, "error", perr)
			}
		}
	}
	return res, nil
}

// parseFailure marks an error that came from the parser itself.
type parseFailure struct{ err error }

func (e *parseFailure) Error() string { return e.err.Error() }

func (s *LibraryTextSource) parseBlob(ctx context.Context, p parser.Parser, uf *userfiles.UserFile) (*parser.ParseResult, error) {
	rc, err := s.stor.ReadFileStream(ctx, uf.StoragePath)
	if err != nil {
		return nil, err
	}
	defer rc.Close()
	tmp, err := os.CreateTemp("", "libtext-*"+filepath.Ext(uf.Name))
	if err != nil {
		return nil, err
	}
	defer os.Remove(tmp.Name())
	n, err := io.Copy(tmp, rc)
	if cerr := tmp.Close(); err == nil {
		err = cerr
	}
	if err != nil {
		return nil, err
	}
	res, err := p.Parse(ctx, parser.ParseContext{
		FilePath: tmp.Name(),
		FileName: uf.Name,
		MimeType: uf.Mime,
		FileSize: n,
	})
	if err != nil {
		return nil, &parseFailure{err: err}
	}
	return res, nil
}

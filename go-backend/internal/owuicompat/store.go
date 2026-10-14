// Package owuicompat serves the subset of the Open WebUI HTTP API that the
// ILIAS LfAssistant plugin's "Open WebUI RAG" mode calls, mapped onto the
// user file library, private KBs and the RAG chat pipeline. Spec:
// docs/superpowers/specs/2026-10-14-ilias-openwebui-compat-design.md.
package owuicompat

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/justrag/go-backend/internal/pgxutil"
)

// ErrInvalidID is returned for an id that is not a UUID. Handlers treat it
// exactly like "not found".
var ErrInvalidID = errors.New("owuicompat: invalid id")

// FileHandle is one upload as the plugin sees it.
type FileHandle struct {
	ID          string
	OwnerUserID string
	UserFileID  string
	Filename    string
	Metadata    map[string]any
	Unsupported bool
	CreatedAt   time.Time
}

// NewHandle is the insert payload of CreateHandle.
type NewHandle struct {
	ID, OwnerUserID, UserFileID, Filename string
	Metadata                              map[string]any
	Unsupported                           bool
}

// Store is the persistence the handlers need. PGStore is its only
// production implementation; tests use an in-memory fake.
type Store interface {
	CreateHandle(ctx context.Context, h NewHandle) (*FileHandle, error)
	GetHandle(ctx context.Context, ownerID, id string) (*FileHandle, error)
	ListHandles(ctx context.Context, ownerID string) ([]FileHandle, error)
	DeleteHandle(ctx context.Context, ownerID, id string) (deleted bool, lastForUserFile bool, orphanFileIDs []string, err error)
	// HandleCleanupPlan is DeleteHandle's computation without the delete:
	// the cascade runs first, the handle goes only after it succeeded.
	HandleCleanupPlan(ctx context.Context, ownerID, id string) (found bool, lastForUserFile bool, orphanFileIDs []string, err error)

	RegisterKnowledge(ctx context.Context, kbID, ownerID string) error
	OwnsKnowledge(ctx context.Context, ownerID, kbID string) (bool, error)
	KBFileForUserFile(ctx context.Context, kbID, userFileID string) (string, error)
	LinkFile(ctx context.Context, kbID, handleID, fileID string) error
	UnlinkFile(ctx context.Context, kbID, handleID string) (orphanFileID string, err error)
	// UnlinkPlan reports the files row UnlinkFile would orphan, deleting nothing.
	UnlinkPlan(ctx context.Context, kbID, handleID string) (orphanFileID string, err error)
	HandlesForFiles(ctx context.Context, kbID string, fileIDs []string) (map[string]FileHandle, error)
}

// PGStore implements Store on the main database.
type PGStore struct{ pool *pgxpool.Pool }

func NewPGStore(pool *pgxpool.Pool) *PGStore { return &PGStore{pool: pool} }

func validUUID(s string) bool { _, err := uuid.Parse(s); return err == nil }

func nullIfEmpty(s string) any {
	if s == "" {
		return nil
	}
	return s
}

const handleCols = `id::text, owner_user_id::text, COALESCE(user_file_id::text, ''), filename, metadata, unsupported, created_at`

func scanHandle(row pgx.Row) (*FileHandle, error) {
	var h FileHandle
	var meta []byte
	if err := row.Scan(&h.ID, &h.OwnerUserID, &h.UserFileID, &h.Filename, &meta, &h.Unsupported, &h.CreatedAt); err != nil {
		return nil, err
	}
	if len(meta) > 0 {
		if err := json.Unmarshal(meta, &h.Metadata); err != nil {
			return nil, fmt.Errorf("owuicompat: decode metadata: %w", err)
		}
	}
	return &h, nil
}

func (s *PGStore) CreateHandle(ctx context.Context, h NewHandle) (*FileHandle, error) {
	meta := h.Metadata
	if meta == nil {
		meta = map[string]any{}
	}
	b, err := json.Marshal(meta)
	if err != nil {
		return nil, fmt.Errorf("owuicompat: encode metadata: %w", err)
	}
	return scanHandle(s.pool.QueryRow(ctx,
		`INSERT INTO owui_files (id, owner_user_id, user_file_id, filename, metadata, unsupported)
		 VALUES ($1::uuid, $2::uuid, $3::uuid, $4, $5::jsonb, $6)
		 RETURNING `+handleCols,
		h.ID, h.OwnerUserID, nullIfEmpty(h.UserFileID), h.Filename, b, h.Unsupported))
}

func (s *PGStore) GetHandle(ctx context.Context, ownerID, id string) (*FileHandle, error) {
	if !validUUID(id) || !validUUID(ownerID) {
		return nil, nil
	}
	h, err := scanHandle(s.pool.QueryRow(ctx,
		`SELECT `+handleCols+` FROM owui_files WHERE id = $1::uuid AND owner_user_id = $2::uuid`, id, ownerID))
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	return h, err
}

func (s *PGStore) ListHandles(ctx context.Context, ownerID string) ([]FileHandle, error) {
	rows, err := s.pool.Query(ctx,
		`SELECT `+handleCols+` FROM owui_files WHERE owner_user_id = $1::uuid ORDER BY created_at`, ownerID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []FileHandle{}
	for rows.Next() {
		h, err := scanHandle(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, *h)
	}
	return out, rows.Err()
}

func (s *PGStore) DeleteHandle(ctx context.Context, ownerID, id string) (bool, bool, []string, error) {
	if !validUUID(id) || !validUUID(ownerID) {
		return false, false, nil, nil
	}
	var deleted, last bool
	orphans := []string{}
	err := pgxutil.WithTx(ctx, s.pool, func(tx pgx.Tx) error {
		var userFileID *string
		err := tx.QueryRow(ctx,
			`SELECT user_file_id::text FROM owui_files WHERE id = $1::uuid AND owner_user_id = $2::uuid FOR UPDATE`,
			id, ownerID).Scan(&userFileID)
		if errors.Is(err, pgx.ErrNoRows) {
			return nil
		}
		if err != nil {
			return err
		}
		// KB files rows linked through this handle and through no other one.
		rows, err := tx.Query(ctx, `
			SELECT k.file_id::text FROM owui_knowledge_files k
			 WHERE k.owui_file_id = $1::uuid AND k.file_id IS NOT NULL
			   AND NOT EXISTS (SELECT 1 FROM owui_knowledge_files o
			                    WHERE o.file_id = k.file_id AND o.owui_file_id <> $1::uuid)`, id)
		if err != nil {
			return err
		}
		for rows.Next() {
			var f string
			if err := rows.Scan(&f); err != nil {
				rows.Close()
				return err
			}
			orphans = append(orphans, f)
		}
		rows.Close()
		if err := rows.Err(); err != nil {
			return err
		}
		if _, err := tx.Exec(ctx, `DELETE FROM owui_files WHERE id = $1::uuid`, id); err != nil {
			return err
		}
		deleted = true
		if userFileID != nil {
			var others bool
			if err := tx.QueryRow(ctx,
				`SELECT EXISTS (SELECT 1 FROM owui_files WHERE user_file_id = $1::uuid AND owner_user_id = $2::uuid)`,
				*userFileID, ownerID).Scan(&others); err != nil {
				return err
			}
			last = !others
		}
		return nil
	})
	return deleted, last, orphans, err
}

func (s *PGStore) HandleCleanupPlan(ctx context.Context, ownerID, id string) (bool, bool, []string, error) {
	if !validUUID(id) || !validUUID(ownerID) {
		return false, false, nil, nil
	}
	var userFileID *string
	err := s.pool.QueryRow(ctx,
		`SELECT user_file_id::text FROM owui_files WHERE id = $1::uuid AND owner_user_id = $2::uuid`,
		id, ownerID).Scan(&userFileID)
	if errors.Is(err, pgx.ErrNoRows) {
		return false, false, nil, nil
	}
	if err != nil {
		return false, false, nil, err
	}
	orphans := []string{}
	rows, err := s.pool.Query(ctx, `
		SELECT k.file_id::text FROM owui_knowledge_files k
		 WHERE k.owui_file_id = $1::uuid AND k.file_id IS NOT NULL
		   AND NOT EXISTS (SELECT 1 FROM owui_knowledge_files o
		                    WHERE o.file_id = k.file_id AND o.owui_file_id <> $1::uuid)`, id)
	if err != nil {
		return false, false, nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var f string
		if err := rows.Scan(&f); err != nil {
			return false, false, nil, err
		}
		orphans = append(orphans, f)
	}
	if err := rows.Err(); err != nil {
		return false, false, nil, err
	}
	last := false
	if userFileID != nil {
		var others bool
		if err := s.pool.QueryRow(ctx,
			`SELECT EXISTS (SELECT 1 FROM owui_files WHERE user_file_id = $1::uuid AND owner_user_id = $2::uuid AND id <> $3::uuid)`,
			*userFileID, ownerID, id).Scan(&others); err != nil {
			return false, false, nil, err
		}
		last = !others
	}
	return true, last, orphans, nil
}

func (s *PGStore) UnlinkPlan(ctx context.Context, kbID, handleID string) (string, error) {
	if !validUUID(kbID) || !validUUID(handleID) {
		return "", nil
	}
	var orphan *string
	err := s.pool.QueryRow(ctx, `
		SELECT k.file_id::text FROM owui_knowledge_files k
		 WHERE k.kb_id = $1::uuid AND k.owui_file_id = $2::uuid AND k.file_id IS NOT NULL
		   AND NOT EXISTS (SELECT 1 FROM owui_knowledge_files o
		                    WHERE o.kb_id = k.kb_id AND o.file_id = k.file_id AND o.owui_file_id <> k.owui_file_id)`,
		kbID, handleID).Scan(&orphan)
	if errors.Is(err, pgx.ErrNoRows) || orphan == nil {
		return "", nil
	}
	return *orphan, err
}

func (s *PGStore) RegisterKnowledge(ctx context.Context, kbID, ownerID string) error {
	_, err := s.pool.Exec(ctx,
		`INSERT INTO owui_knowledge (kb_id, owner_user_id) VALUES ($1::uuid, $2::uuid) ON CONFLICT DO NOTHING`,
		kbID, ownerID)
	return err
}

func (s *PGStore) OwnsKnowledge(ctx context.Context, ownerID, kbID string) (bool, error) {
	if !validUUID(kbID) || !validUUID(ownerID) {
		return false, nil
	}
	var ok bool
	err := s.pool.QueryRow(ctx,
		`SELECT EXISTS (SELECT 1 FROM owui_knowledge WHERE kb_id = $1::uuid AND owner_user_id = $2::uuid)`,
		kbID, ownerID).Scan(&ok)
	return ok, err
}

func (s *PGStore) KBFileForUserFile(ctx context.Context, kbID, userFileID string) (string, error) {
	var id string
	err := s.pool.QueryRow(ctx,
		`SELECT id::text FROM files WHERE kb_id = $1::uuid AND user_file_id = $2::uuid`, kbID, userFileID).Scan(&id)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", nil
	}
	return id, err
}

func (s *PGStore) LinkFile(ctx context.Context, kbID, handleID, fileID string) error {
	_, err := s.pool.Exec(ctx,
		`INSERT INTO owui_knowledge_files (kb_id, owui_file_id, file_id) VALUES ($1::uuid, $2::uuid, $3::uuid)
		 ON CONFLICT (kb_id, owui_file_id) DO UPDATE SET file_id = EXCLUDED.file_id`,
		kbID, handleID, nullIfEmpty(fileID))
	return err
}

func (s *PGStore) UnlinkFile(ctx context.Context, kbID, handleID string) (string, error) {
	if !validUUID(kbID) || !validUUID(handleID) {
		return "", nil
	}
	var orphan string
	err := pgxutil.WithTx(ctx, s.pool, func(tx pgx.Tx) error {
		var fileID *string
		err := tx.QueryRow(ctx,
			`DELETE FROM owui_knowledge_files WHERE kb_id = $1::uuid AND owui_file_id = $2::uuid RETURNING file_id::text`,
			kbID, handleID).Scan(&fileID)
		if errors.Is(err, pgx.ErrNoRows) || (err == nil && fileID == nil) {
			return nil
		}
		if err != nil {
			return err
		}
		var shared bool
		if err := tx.QueryRow(ctx,
			`SELECT EXISTS (SELECT 1 FROM owui_knowledge_files WHERE kb_id = $1::uuid AND file_id = $2::uuid)`,
			kbID, *fileID).Scan(&shared); err != nil {
			return err
		}
		if !shared {
			orphan = *fileID
		}
		return nil
	})
	return orphan, err
}

func (s *PGStore) HandlesForFiles(ctx context.Context, kbID string, fileIDs []string) (map[string]FileHandle, error) {
	out := map[string]FileHandle{}
	if len(fileIDs) == 0 {
		return out, nil
	}
	rows, err := s.pool.Query(ctx, `
		SELECT DISTINCT ON (k.file_id) k.file_id::text, `+qualified("o")+`
		  FROM owui_knowledge_files k JOIN owui_files o ON o.id = k.owui_file_id
		 WHERE k.kb_id = $1::uuid AND k.file_id = ANY($2::uuid[])
		 ORDER BY k.file_id, o.id`, kbID, fileIDs)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var fileID string
		var h FileHandle
		var meta []byte
		if err := rows.Scan(&fileID, &h.ID, &h.OwnerUserID, &h.UserFileID, &h.Filename, &meta, &h.Unsupported, &h.CreatedAt); err != nil {
			return nil, err
		}
		if len(meta) > 0 {
			_ = json.Unmarshal(meta, &h.Metadata)
		}
		out[fileID] = h
	}
	return out, rows.Err()
}

// qualified prefixes handleCols' columns with a table alias.
func qualified(alias string) string {
	return alias + `.id::text, ` + alias + `.owner_user_id::text, COALESCE(` + alias + `.user_file_id::text, ''), ` +
		alias + `.filename, ` + alias + `.metadata, ` + alias + `.unsupported, ` + alias + `.created_at`
}

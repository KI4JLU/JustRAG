package userfiles

import (
	"context"
	"errors"
	"fmt"
	"os"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/justrag/go-backend/internal/logctx"
	"github.com/justrag/go-backend/internal/observability"
	"github.com/justrag/go-backend/internal/storage"
)

const (
	// OrphanGrace protects in-flight uploads and parses: an object younger
	// than this is never deleted, whatever the database says.
	OrphanGrace = 24 * time.Hour
	// OrphanMaxPerRun caps deletions per tick.
	OrphanMaxPerRun = 500
	// OrphanInterval / OrphanInitialDelay schedule the maintenance loop.
	OrphanInterval     = 6 * time.Hour
	OrphanInitialDelay = 10 * time.Minute

	usersPrefix = "users/"
)

// OrphanStore is the database side of the sweep.
type OrphanStore interface {
	// OwnerIDs lists every user id (text form).
	OwnerIDs(ctx context.Context) ([]string, error)
	// BlobReferenced reports whether any user_files or files row points at
	// the storage key (userFileID is the canonical-UUID tail of the key).
	BlobReferenced(ctx context.Context, ownerID, userFileID, key string) (bool, error)
	// LibraryFileExists reports whether user_files has (id, owner).
	LibraryFileExists(ctx context.Context, ownerID, userFileID string) (bool, error)
}

// OrphanSweeper deletes library blobs and parse/chat-text cache objects under
// users/ that no database row refers to any more (failed uploads, deletes that
// lost a race, caches of removed files).
//
// Scope: it enumerates user ids from the users table and lists
// "users/<id>/" per user, so memory is bounded by one user's objects and users
// with zero user_files rows are covered. Objects of a user whose users row was
// deleted are therefore not swept (account deletion removes them through the
// cascade; a leftover there is accepted rather than listing all of users/).
type OrphanSweeper struct {
	store OrphanStore
	stor  storage.Storage
	now   func() time.Time

	// pending / deleter remove chat attachments nothing references any more
	// (WithPendingChatFiles). Optional.
	pending PendingChatStore
	deleter ChatAttachmentDeleter
}

// ChatAttachmentDeleter deletes a chat attachment only if, inside its own
// transaction, nothing references it and it was last uploaded before
// staleBefore (implemented by *cascade.Deleter). The sweep's listing is a
// candidate list, never the decision: a file can be sent, promoted or
// uploaded again between the listing and the delete.
type ChatAttachmentDeleter interface {
	DeleteChatAttachment(ctx context.Context, ownerID, userFileID string, staleBefore time.Time) (bool, error)
}

// PendingFile is a chat-scoped user file (migration 0090) that no message,
// KB file or library chat references.
type PendingFile struct {
	ID      string
	OwnerID string
}

// PendingChatStore lists unreferenced chat attachments.
type PendingChatStore interface {
	// PendingChatFiles returns up to limit chat-scoped user files last
	// uploaded (updated_at) before olderThan that nothing references.
	PendingChatFiles(ctx context.Context, olderThan time.Time, limit int) ([]PendingFile, error)
}

// WithPendingChatFiles makes every sweep also delete chat attachments that
// were uploaded but never sent, or whose chats are gone (a chat delete
// removes its own attachments right away; a KB or account delete leaves them
// to this). The OrphanGrace applies: an upload is kept for 24 h, long enough
// for the message it was uploaded for, counted from the latest upload of the
// same bytes (PGStore.Insert refreshes updated_at on a chat dedup hit).
func (s *OrphanSweeper) WithPendingChatFiles(store PendingChatStore, deleter ChatAttachmentDeleter) *OrphanSweeper {
	s.pending = store
	s.deleter = deleter
	return s
}

func NewOrphanSweeper(store OrphanStore, stor storage.Storage) *OrphanSweeper {
	return &OrphanSweeper{store: store, stor: stor, now: time.Now}
}

// RunOnce performs one sweep and returns the number of deleted objects. Any
// storage or database error in the blob/cache sweep aborts the tick; nothing
// is ever deleted on a failed check. The chat-attachment step runs first with
// its own OrphanMaxPerRun budget and only logs its errors, so a file that
// keeps failing cannot stop the blob/cache sweep on every tick.
func (s *OrphanSweeper) RunOnce(ctx context.Context) (int, error) {
	owners, err := s.store.OwnerIDs(ctx)
	if err != nil {
		return 0, fmt.Errorf("userfiles: sweep: list owners: %w", err)
	}
	cutoff := s.now().Add(-OrphanGrace)
	chatDeleted := s.sweepChatAttachments(ctx, cutoff)
	deleted := 0
	for _, owner := range owners {
		if !canonicalID(owner) {
			continue
		}
		if deleted >= OrphanMaxPerRun {
			break
		}
		prefix := usersPrefix + owner + "/"
		objs, err := s.stor.List(ctx, prefix)
		if err != nil {
			return deleted, fmt.Errorf("userfiles: sweep: list %s: %w", prefix, err)
		}
		for _, o := range objs {
			if deleted >= OrphanMaxPerRun {
				break
			}
			if o.ModTime.IsZero() || !o.ModTime.Before(cutoff) {
				// Zero = the backend gave no timestamp: fail closed.
				continue
			}
			kind, ufid := classifyKey(prefix, o.Key)
			if kind == "" {
				continue
			}
			var orphan bool
			switch kind {
			case "blob":
				ref, err := s.store.BlobReferenced(ctx, owner, ufid, o.Key)
				if err != nil {
					return deleted, fmt.Errorf("userfiles: sweep: check blob: %w", err)
				}
				orphan = !ref
			case "cache":
				ok, err := s.store.LibraryFileExists(ctx, owner, ufid)
				if err != nil {
					return deleted, fmt.Errorf("userfiles: sweep: check cache owner: %w", err)
				}
				orphan = !ok
			}
			if !orphan {
				continue
			}
			if err := s.stor.DeleteFile(ctx, o.Key); err != nil && !errors.Is(err, os.ErrNotExist) {
				return deleted, fmt.Errorf("userfiles: sweep: delete %s: %w", o.Key, err)
			}
			deleted++
			observability.RecordUserFileOrphanDeleted(kind)
		}
	}
	return chatDeleted + deleted, nil
}

// sweepChatAttachments deletes up to OrphanMaxPerRun chat attachments that
// were never sent or whose chats are gone, and returns how many it deleted.
// Errors are logged, never returned (see RunOnce).
func (s *OrphanSweeper) sweepChatAttachments(ctx context.Context, cutoff time.Time) int {
	if s.pending == nil || s.deleter == nil {
		return 0
	}
	log := logctx.From(ctx)
	files, err := s.pending.PendingChatFiles(ctx, cutoff, OrphanMaxPerRun)
	if err != nil {
		log.Warn("userfiles: sweep: list pending chat files", "error", err)
		return 0
	}
	deleted := 0
	for _, f := range files {
		if ctx.Err() != nil {
			break
		}
		ok, err := s.deleter.DeleteChatAttachment(ctx, f.OwnerID, f.ID, cutoff)
		if err != nil {
			log.Warn("userfiles: sweep: delete chat attachment", "user_file_id", f.ID, "error", err)
			continue
		}
		if ok {
			deleted++
			observability.RecordUserFileOrphanDeleted("chat_attachment")
		}
	}
	return deleted
}

// classifyKey returns ("blob", "") for prefix+<id>, ("cache", ufid) for
// prefix+parses/<ufid>/<rest> with a UUID ufid, and ("", "") for anything else
// (never deleted).
func classifyKey(prefix, key string) (kind, ufid string) {
	rest := strings.TrimPrefix(key, prefix)
	if rest == key || rest == "" {
		return "", ""
	}
	if !strings.Contains(rest, "/") {
		if canonicalID(rest) {
			return "blob", rest
		}
		return "", ""
	}
	if after, ok := strings.CutPrefix(rest, "parses/"); ok {
		id, tail, found := strings.Cut(after, "/")
		if found && tail != "" && canonicalID(id) {
			return "cache", id
		}
	}
	return "", ""
}

// Run loops until ctx is done: first sweep after OrphanInitialDelay, then
// every OrphanInterval.
func (s *OrphanSweeper) Run(ctx context.Context) {
	t := time.NewTimer(OrphanInitialDelay)
	defer t.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-t.C:
		}
		n, err := s.RunOnce(ctx)
		if err != nil {
			logctx.From(ctx).Error("userfiles orphan sweep failed", "error", err, "deleted", n)
		} else if n > 0 {
			logctx.From(ctx).Info("userfiles orphan sweep completed", "deleted", n)
		}
		t.Reset(OrphanInterval)
	}
}

// PGOrphanStore is the Postgres-backed OrphanStore (and LibraryTotals source).
type PGOrphanStore struct{ pool *pgxpool.Pool }

var _ PendingChatStore = (*PGOrphanStore)(nil)

func (s *PGOrphanStore) PendingChatFiles(ctx context.Context, olderThan time.Time, limit int) ([]PendingFile, error) {
	rows, err := s.pool.Query(ctx, `
		SELECT uf.id::text, uf.owner_user_id::text
		  FROM user_files uf
		 WHERE uf.scope = 'chat' AND uf.updated_at < $1
		   AND NOT EXISTS (SELECT 1 FROM message_attachments ma WHERE ma.user_file_id = uf.id)
		   AND NOT EXISTS (SELECT 1 FROM files f WHERE f.user_file_id = uf.id)
		   AND NOT EXISTS (SELECT 1 FROM chat_file_refs r WHERE r.user_file_id = uf.id)
		 ORDER BY uf.updated_at
		 LIMIT $2`, olderThan, limit)
	if err != nil {
		return nil, fmt.Errorf("pending chat files: %w", err)
	}
	defer rows.Close()
	var out []PendingFile
	for rows.Next() {
		var f PendingFile
		if err := rows.Scan(&f.ID, &f.OwnerID); err != nil {
			return nil, fmt.Errorf("pending chat files: scan: %w", err)
		}
		out = append(out, f)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("pending chat files: rows: %w", err)
	}
	return out, nil
}

func NewOrphanStore(pool *pgxpool.Pool) *PGOrphanStore { return &PGOrphanStore{pool: pool} }

var _ OrphanStore = (*PGOrphanStore)(nil)

func (s *PGOrphanStore) OwnerIDs(ctx context.Context) ([]string, error) {
	rows, err := s.pool.Query(ctx, `SELECT id::text FROM users`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var ids []string
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			return nil, err
		}
		ids = append(ids, id)
	}
	return ids, rows.Err()
}

func (s *PGOrphanStore) BlobReferenced(ctx context.Context, ownerID, userFileID, key string) (bool, error) {
	// Primary-key lookup first: every live blob hits here, so the common
	// case never touches an unindexed column. Only a miss (a genuine orphan
	// candidate, rare) falls through to files, where user_files.id doubles as
	// files.user_file_id for KB copies and storage_path covers legacy rows.
	var ok bool
	if err := s.pool.QueryRow(ctx, `
		SELECT EXISTS(SELECT 1 FROM user_files
		              WHERE id = $1::uuid AND owner_user_id = $2::uuid AND storage_path = $3)`,
		userFileID, ownerID, key).Scan(&ok); err != nil || ok {
		return ok, err
	}
	err := s.pool.QueryRow(ctx, `
		SELECT EXISTS(SELECT 1 FROM user_files WHERE storage_path = $1)
		    OR EXISTS(SELECT 1 FROM files WHERE user_file_id = $2::uuid OR storage_path = $1)`,
		key, userFileID).Scan(&ok)
	return ok, err
}

func (s *PGOrphanStore) LibraryFileExists(ctx context.Context, ownerID, userFileID string) (bool, error) {
	var ok bool
	err := s.pool.QueryRow(ctx,
		`SELECT EXISTS(SELECT 1 FROM user_files WHERE id = $1::uuid AND owner_user_id = $2::uuid)`,
		userFileID, ownerID).Scan(&ok)
	return ok, err
}

// LibraryTotals returns the deployment-wide library file count and byte sum.
func (s *PGOrphanStore) LibraryTotals(ctx context.Context) (int64, int64, error) {
	var n, b int64
	err := s.pool.QueryRow(ctx, `SELECT count(*), coalesce(sum(size),0)::bigint FROM user_files`).Scan(&n, &b)
	return n, b, err
}

// TotalsSource supplies the library totals.
type TotalsSource interface {
	LibraryTotals(ctx context.Context) (files, bytes int64, err error)
}

// RefreshLibraryGauges reads the totals and hands them to set (normally
// observability.SetUserFileTotals); a failed read leaves the gauges untouched.
func RefreshLibraryGauges(ctx context.Context, src TotalsSource, set func(files, bytes float64)) error {
	n, b, err := src.LibraryTotals(ctx)
	if err != nil {
		return err
	}
	set(float64(n), float64(b))
	return nil
}

// canonicalID reports whether s is a UUID in canonical lower-case dashed form.
// Anything else (urn:uuid:, braces, no dashes, upper case) is skipped by the
// sweep rather than risking a failed ::uuid cast that would abort every tick.
func canonicalID(s string) bool {
	u, err := uuid.Parse(s)
	return err == nil && u.String() == s
}

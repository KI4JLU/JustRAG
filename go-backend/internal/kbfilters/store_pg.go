// Package kbfilters owns the two per-user topic filters behind the shell's
// chip row: favourites (a star on any topic the user can see) and the user's
// own categories plus their assignments.
//
// Both are display state, never an access grant — favouriting or tagging a
// topic the caller can already open grants nothing, and neither table is
// consulted by any access decision. Deliberately separate from
// internal/kbcategories: that is one system-admin-curated taxonomy over PUBLIC
// KBs (the catalog's filter tabs); these rows are owned by one user and may
// point at any topic that user can see.
package kbfilters

import (
	"context"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/justrag/go-backend/internal/pgxutil"
)

var (
	// ErrDuplicateName means the (user_id, LOWER(name)) unique index rejected
	// the write: this user already has a category with that name.
	ErrDuplicateName = errors.New("kbfilters: a category with that name already exists")
	// ErrNotFound means no category with that id exists *for this user*. The
	// store never distinguishes "does not exist" from "belongs to someone
	// else" — the handler answers 404 either way, so a probe cannot use the
	// status code to enumerate other users' category ids.
	ErrNotFound = errors.New("kbfilters: category not found")
)

// UserCategory is one chip in the caller's own filter row.
type UserCategory struct {
	ID        string `json:"id"        db:"id"`
	Name      string `json:"name"      db:"name"`
	SortOrder int    `json:"sortOrder" db:"sort_order"`
}

// Store is the per-user filter data layer. PGStore is its only
// implementation. Every method takes the caller's user id: there is no
// "current user" in this layer, and no method can read or write another
// user's rows.
type Store interface {
	AddFavourite(ctx context.Context, userID, kbID string) error
	RemoveFavourite(ctx context.Context, userID, kbID string) error

	ListCategories(ctx context.Context, userID string) ([]UserCategory, error)
	CreateCategory(ctx context.Context, userID, name string, sortOrder int) (*UserCategory, error)
	UpdateCategory(ctx context.Context, userID, catID, name string, sortOrder int) (*UserCategory, error)
	DeleteCategory(ctx context.Context, userID, catID string) error

	AssignCategory(ctx context.Context, userID, catID, kbID string) error
	UnassignCategory(ctx context.Context, userID, catID, kbID string) error
}

// PGStore is the Postgres-backed Store.
type PGStore struct {
	pool *pgxpool.Pool
}

// NewStore creates a PGStore over the main pool.
func NewStore(pool *pgxpool.Pool) *PGStore {
	return &PGStore{pool: pool}
}

// Compile-time interface assertion.
var _ Store = (*PGStore)(nil)

// AddFavourite stars a KB for this user. Idempotent: the row's existence is
// the flag, so a second PUT must not be an error.
func (s *PGStore) AddFavourite(ctx context.Context, userID, kbID string) error {
	_, err := s.pool.Exec(ctx, `
		INSERT INTO kb_favourites (user_id, kb_id)
		VALUES ($1::uuid, $2::uuid)
		ON CONFLICT (user_id, kb_id) DO NOTHING`, userID, kbID)
	if err != nil {
		return fmt.Errorf("AddFavourite: %w", err)
	}
	return nil
}

// RemoveFavourite un-stars a KB. Deleting rather than storing a false flag:
// unlike kb_subscriptions there is nothing for an absent row to override, so
// a "not favourite" row would be dead data.
func (s *PGStore) RemoveFavourite(ctx context.Context, userID, kbID string) error {
	_, err := s.pool.Exec(ctx, `
		DELETE FROM kb_favourites WHERE user_id = $1::uuid AND kb_id = $2::uuid`, userID, kbID)
	if err != nil {
		return fmt.Errorf("RemoveFavourite: %w", err)
	}
	return nil
}

// ListCategories returns this user's categories in chip order.
func (s *PGStore) ListCategories(ctx context.Context, userID string) ([]UserCategory, error) {
	return pgxutil.QueryRows[UserCategory](ctx, s.pool, `
		SELECT id::text, name, sort_order
		FROM kb_user_categories
		WHERE user_id = $1::uuid
		ORDER BY sort_order, name`, userID)
}

// CreateCategory inserts a category owned by userID, mapping the
// case-insensitive unique-name violation to ErrDuplicateName so the handler
// can answer 409 instead of 500.
func (s *PGStore) CreateCategory(ctx context.Context, userID, name string, sortOrder int) (*UserCategory, error) {
	var c UserCategory
	err := s.pool.QueryRow(ctx, `
		INSERT INTO kb_user_categories (user_id, name, sort_order)
		VALUES ($1::uuid, $2, $3)
		RETURNING id::text, name, sort_order`, userID, name, sortOrder).
		Scan(&c.ID, &c.Name, &c.SortOrder)
	if isUniqueViolation(err) {
		return nil, ErrDuplicateName
	}
	if err != nil {
		return nil, fmt.Errorf("CreateCategory: %w", err)
	}
	return &c, nil
}

// UpdateCategory renames and reorders one of this user's categories. The
// user_id predicate is what makes another user's category indistinguishable
// from a missing one.
func (s *PGStore) UpdateCategory(ctx context.Context, userID, catID, name string, sortOrder int) (*UserCategory, error) {
	var c UserCategory
	err := s.pool.QueryRow(ctx, `
		UPDATE kb_user_categories SET name = $3, sort_order = $4
		WHERE id = $1::uuid AND user_id = $2::uuid
		RETURNING id::text, name, sort_order`, catID, userID, name, sortOrder).
		Scan(&c.ID, &c.Name, &c.SortOrder)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	if isUniqueViolation(err) {
		return nil, ErrDuplicateName
	}
	if err != nil {
		return nil, fmt.Errorf("UpdateCategory: %w", err)
	}
	return &c, nil
}

// DeleteCategory removes one of this user's categories. Its assignments go
// with it through the composite FK's ON DELETE CASCADE — a deleted chip must
// stop filtering, not block the delete.
func (s *PGStore) DeleteCategory(ctx context.Context, userID, catID string) error {
	tag, err := s.pool.Exec(ctx, `
		DELETE FROM kb_user_categories WHERE id = $1::uuid AND user_id = $2::uuid`, catID, userID)
	if err != nil {
		return fmt.Errorf("DeleteCategory: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}

// AssignCategory tags a KB with one of this user's categories. Idempotent.
//
// Ownership is NOT checked here. The composite FK (category_id, user_id) ->
// kb_user_categories (id, user_id) rejects a category belonging to somebody
// else with SQLSTATE 23503, and that rejection is translated to ErrNotFound —
// so the rule lives in the schema and holds for every writer, not just this
// one. A missing KB raises the same code via the knowledge_bases FK; both
// mean "the thing you named is not there for you", so one error suffices.
func (s *PGStore) AssignCategory(ctx context.Context, userID, catID, kbID string) error {
	_, err := s.pool.Exec(ctx, `
		INSERT INTO kb_user_category_links (user_id, category_id, kb_id)
		VALUES ($1::uuid, $2::uuid, $3::uuid)
		ON CONFLICT (user_id, category_id, kb_id) DO NOTHING`, userID, catID, kbID)
	if isForeignKeyViolation(err) {
		return ErrNotFound
	}
	if err != nil {
		return fmt.Errorf("AssignCategory: %w", err)
	}
	return nil
}

// UnassignCategory removes the tag. Idempotent — a DELETE of something that
// is already gone is the state the caller asked for.
func (s *PGStore) UnassignCategory(ctx context.Context, userID, catID, kbID string) error {
	_, err := s.pool.Exec(ctx, `
		DELETE FROM kb_user_category_links
		WHERE user_id = $1::uuid AND category_id = $2::uuid AND kb_id = $3::uuid`,
		userID, catID, kbID)
	if err != nil {
		return fmt.Errorf("UnassignCategory: %w", err)
	}
	return nil
}

// isUniqueViolation reports whether err is Postgres SQLSTATE 23505.
func isUniqueViolation(err error) bool {
	var pgErr *pgconn.PgError
	return errors.As(err, &pgErr) && pgErr.Code == "23505"
}

// isForeignKeyViolation reports whether err is Postgres SQLSTATE 23503.
func isForeignKeyViolation(err error) bool {
	var pgErr *pgconn.PgError
	return errors.As(err, &pgErr) && pgErr.Code == "23503"
}

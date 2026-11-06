// Package kbcategories owns the catalog's taxonomy: a flat, system-admin
// curated list of categories, plus the many-to-many assignment of knowledge
// bases to them. Deliberately flat — nesting would need a tree UI and a
// recursive query for a filter chip row.
package kbcategories

import (
	"context"
	"errors"
	"fmt"
	"strings"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/justrag/go-backend/internal/pgxutil"
)

var (
	// ErrDuplicateName means the unique index on kb_categories.name rejected
	// the write.
	ErrDuplicateName = errors.New("kbcategories: a category with that name already exists")
	// ErrNotFound means no category with that id exists.
	ErrNotFound = errors.New("kbcategories: category not found")
)

// ColorSlots is the number of category colours (--color-category-1..N).
const ColorSlots = 9

// Category is one entry of the catalog taxonomy. Color (a lowercase #rrggbb,
// migration 0096) is its freely picked colour; while it is nil the palette
// slot ColorSlot (1..ColorSlots, migration 0093) gives it one, fixed per
// category so two never collide.
type Category struct {
	ID        string  `json:"id"        db:"id"`
	Name      string  `json:"name"      db:"name"`
	SortOrder int     `json:"sortOrder" db:"sort_order"`
	ColorSlot *int    `json:"colorSlot" db:"color_slot"`
	Color     *string `json:"color"     db:"color"`
}

// Store is the category data layer. PGStore is its only implementation.
type Store interface {
	List(ctx context.Context) ([]Category, error)
	// Create inserts a category; a nil colorSlot takes the least-used slot
	// (lowest first), so the first nine categories never share a colour. A nil
	// color leaves the palette slot in charge.
	Create(ctx context.Context, name string, sortOrder int, colorSlot *int, color *string) (*Category, error)
	// Update renames and reorders a category; a nil colorSlot or color keeps
	// it, an empty color clears it back to the palette slot.
	Update(ctx context.Context, id, name string, sortOrder int, colorSlot *int, color *string) (*Category, error)
	Delete(ctx context.Context, id string) error
	SetKBCategories(ctx context.Context, kbID string, categoryIDs []string) error
	ListKBCategories(ctx context.Context, kbID string) ([]Category, error)
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

// List returns every category in display order.
func (s *PGStore) List(ctx context.Context) ([]Category, error) {
	return pgxutil.QueryRows[Category](ctx, s.pool,
		`SELECT id, name, sort_order, color_slot, color FROM kb_categories ORDER BY sort_order, name`)
}

// Create inserts a category, mapping the unique-name violation to
// ErrDuplicateName so the handler can answer 409 instead of 500.
func (s *PGStore) Create(ctx context.Context, name string, sortOrder int, colorSlot *int, color *string) (*Category, error) {
	var c Category
	err := s.pool.QueryRow(ctx, `
		INSERT INTO kb_categories (name, sort_order, color_slot, color)
		VALUES ($1, $2, COALESCE($3::smallint, (
			SELECT s::smallint FROM generate_series(1, 9) s
			LEFT JOIN kb_categories c ON c.color_slot = s
			GROUP BY s ORDER BY count(c.id), s LIMIT 1)), NULLIF($4::text, ''))
		RETURNING id::text, name, sort_order, color_slot, color`, name, sortOrder, colorSlot, color).
		Scan(&c.ID, &c.Name, &c.SortOrder, &c.ColorSlot, &c.Color)
	if isUniqueViolation(err) {
		return nil, ErrDuplicateName
	}
	if err != nil {
		return nil, fmt.Errorf("Create: %w", err)
	}
	return &c, nil
}

// Update renames and reorders a category.
func (s *PGStore) Update(ctx context.Context, id, name string, sortOrder int, colorSlot *int, color *string) (*Category, error) {
	var c Category
	err := s.pool.QueryRow(ctx, `
		UPDATE kb_categories SET name = $2, sort_order = $3, color_slot = COALESCE($4::smallint, color_slot),
			color = CASE WHEN $5::text IS NULL THEN color ELSE NULLIF($5::text, '') END
		WHERE id = $1::uuid
		RETURNING id::text, name, sort_order, color_slot, color`, id, name, sortOrder, colorSlot, color).
		Scan(&c.ID, &c.Name, &c.SortOrder, &c.ColorSlot, &c.Color)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	if isUniqueViolation(err) {
		return nil, ErrDuplicateName
	}
	if err != nil {
		return nil, fmt.Errorf("Update: %w", err)
	}
	return &c, nil
}

// Delete removes a category. Assignments in kb_category_links vanish with it
// via ON DELETE CASCADE — a removed category should stop filtering, not block
// deletion.
func (s *PGStore) Delete(ctx context.Context, id string) error {
	tag, err := s.pool.Exec(ctx, `DELETE FROM kb_categories WHERE id = $1::uuid`, id)
	if err != nil {
		return fmt.Errorf("Delete: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}

// SetKBCategories replaces a KB's category assignments wholesale, in one
// transaction. The handler allows at most one (MaxKBCategories); the store
// keeps taking a list so older multi-category rows stay readable. Replace-all rather than add/remove deltas: the UI is a
// checkbox list, and a delta API would need the client to compute the
// difference against a list it may have fetched before someone else changed
// it.
func (s *PGStore) SetKBCategories(ctx context.Context, kbID string, categoryIDs []string) error {
	return pgxutil.WithTx(ctx, s.pool, func(tx pgx.Tx) error {
		if _, err := tx.Exec(ctx,
			`DELETE FROM kb_category_links WHERE kb_id = $1::uuid`, kbID); err != nil {
			return fmt.Errorf("SetKBCategories: clear: %w", err)
		}
		if len(categoryIDs) == 0 {
			return nil
		}
		if _, err := tx.Exec(ctx, `
			INSERT INTO kb_category_links (kb_id, category_id)
			SELECT $1::uuid, unnest($2::uuid[])
			ON CONFLICT DO NOTHING`, kbID, categoryIDs); err != nil {
			return fmt.Errorf("SetKBCategories: insert: %w", err)
		}
		return nil
	})
}

// ListKBCategories returns the categories assigned to one KB.
func (s *PGStore) ListKBCategories(ctx context.Context, kbID string) ([]Category, error) {
	return pgxutil.QueryRows[Category](ctx, s.pool, `
		SELECT c.id, c.name, c.sort_order, c.color_slot, c.color
		FROM kb_categories c
		JOIN kb_category_links l ON l.category_id = c.id
		WHERE l.kb_id = $1::uuid
		ORDER BY c.sort_order, c.name`, kbID)
}

// isUniqueViolation reports whether err is Postgres SQLSTATE 23505.
func isUniqueViolation(err error) bool {
	var pgErr *pgconn.PgError
	return errors.As(err, &pgErr) && pgErr.Code == "23505"
}

// normalizeName trims surrounding whitespace; the empty result is rejected by
// the handler.
func normalizeName(in string) string {
	return strings.TrimSpace(in)
}

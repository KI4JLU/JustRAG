package translator

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/justrag/go-backend/internal/glossaryaccess"
	"github.com/justrag/go-backend/internal/pgxutil"
)

// GlossarySummary is a glossary as the list shows it. Role is the caller's
// effective role (glossaryaccess.EffectiveRole) and the three flags are what
// that role allows, so the UI reads the decision instead of re-deriving the
// ladder. IsMember tells a role held by a membership row, which can be left,
// from the viewer role every user has on a global glossary, which cannot.
type GlossarySummary struct {
	ID          string    `json:"id"          db:"id"`
	Name        string    `json:"name"        db:"name"`
	Description string    `json:"description" db:"description"`
	Category    string    `json:"category"    db:"category"`
	Visibility  string    `json:"visibility"  db:"visibility"`
	EntryCount  int       `json:"entryCount"  db:"entry_count"`
	CreatorName string    `json:"creatorName" db:"creator_name"`
	Role        string    `json:"role"        db:"role"`
	IsMember    bool      `json:"isMember"    db:"is_member"`
	CanEdit     bool      `json:"canEdit"     db:"-"`
	CanManage   bool      `json:"canManage"   db:"-"`
	CanDelete   bool      `json:"canDelete"   db:"-"`
	CreatedAt   time.Time `json:"createdAt"   db:"created_at"`
	UpdatedAt   time.Time `json:"updatedAt"   db:"updated_at"`
}

// flags derives the three capability flags from Role.
func (g *GlossarySummary) flags() {
	g.CanEdit = glossaryaccess.AtLeast(g.Role, glossaryaccess.RoleEditor)
	g.CanManage = glossaryaccess.AtLeast(g.Role, glossaryaccess.RoleAdmin)
	g.CanDelete = g.Role == glossaryaccess.RoleOwner
}

// GlossaryDetail is a glossary with its entries.
type GlossaryDetail struct {
	GlossarySummary
	Entries []GlossaryEntry `json:"entries"`
}

// GlossaryInput is a new glossary, or all of an edited one: an update replaces
// name, description, category and entries as given, so an empty description or
// category clears it. Only a new glossary gets the default category.
type GlossaryInput struct {
	Name        string          `json:"name"`
	Description string          `json:"description"`
	Category    string          `json:"category"`
	Visibility  string          `json:"visibility"`
	Entries     []GlossaryEntry `json:"entries"`
}

// GlossaryStore is the glossary data layer. PGStore is its only
// implementation. Who may call what is decided before the store is reached:
// the route gate resolves the caller's role through internal/glossaryaccess.
type GlossaryStore interface {
	GlossaryReader
	List(ctx context.Context, userID string) ([]GlossarySummary, error)
	Get(ctx context.Context, id string) (*GlossaryDetail, error)
	Create(ctx context.Context, ownerID string, in GlossaryInput) (string, error)
	Update(ctx context.Context, id string, in GlossaryInput) error
	SetVisibility(ctx context.Context, id, visibility string) error
	Delete(ctx context.Context, id string) error
}

// PGStore is the Postgres-backed GlossaryStore.
type PGStore struct{ pool *pgxpool.Pool }

// NewStore creates a PGStore over the main pool.
func NewStore(pool *pgxpool.Pool) *PGStore { return &PGStore{pool: pool} }

var _ GlossaryStore = (*PGStore)(nil)

const creatorNameSQL = `COALESCE(NULLIF(TRIM(COALESCE(ou.first_name, '') || ' ' || COALESCE(ou.last_name, '')), ''), ou.username, '')`

// List returns every glossary the caller can open, by name, with their role.
// The ladder is rendered once, in glossaryaccess.VisibleGlossariesCTE.
func (s *PGStore) List(ctx context.Context, userID string) ([]GlossarySummary, error) {
	sql := `WITH ` + glossaryaccess.VisibleGlossariesCTE + `
		SELECT g.id::text AS id, g.name, g.description, g.category, g.visibility,
		       jsonb_array_length(g.entries) AS entry_count,
		       ` + creatorNameSQL + ` AS creator_name,
		       v.role AS role,
		       EXISTS (SELECT 1 FROM glossary_members m
		               WHERE m.glossary_id = g.id AND m.user_id = $1::uuid) AS is_member,
		       g.created_at, g.updated_at
		FROM glossaries g
		JOIN visible_glossaries v ON v.id = g.id AND v.role IS NOT NULL
		LEFT JOIN glossary_members om ON om.glossary_id = g.id AND om.role = 'owner'
		LEFT JOIN users ou ON ou.id = om.user_id
		ORDER BY lower(g.name), g.id`
	rows, err := pgxutil.QueryRows[GlossarySummary](ctx, s.pool, sql, userID)
	if err != nil {
		return nil, fmt.Errorf("List glossaries: %w", err)
	}
	for i := range rows {
		rows[i].flags()
	}
	return rows, nil
}

type detailRow struct {
	GlossarySummary
	Entries []GlossaryEntry `db:"entries"`
}

// Get returns a glossary with its entries; Role, IsMember and the flags are left
// for the caller to fill from the gate's access result. It returns nil when missing.
func (s *PGStore) Get(ctx context.Context, id string) (*GlossaryDetail, error) {
	row, err := pgxutil.QueryOne[detailRow](ctx, s.pool, `
		SELECT g.id::text AS id, g.name, g.description, g.category, g.visibility,
		       jsonb_array_length(g.entries) AS entry_count,
		       `+creatorNameSQL+` AS creator_name,
		       '' AS role, false AS is_member, g.created_at, g.updated_at, g.entries
		FROM glossaries g
		LEFT JOIN glossary_members om ON om.glossary_id = g.id AND om.role = 'owner'
		LEFT JOIN users ou ON ou.id = om.user_id
		WHERE g.id = $1::uuid`, id)
	if err != nil {
		return nil, fmt.Errorf("Get glossary: %w", err)
	}
	if row == nil {
		return nil, nil
	}
	if row.Entries == nil {
		row.Entries = []GlossaryEntry{}
	}
	return &GlossaryDetail{GlossarySummary: row.GlossarySummary, Entries: row.Entries}, nil
}

// Create stores a glossary and its owner row in one transaction.
func (s *PGStore) Create(ctx context.Context, ownerID string, in GlossaryInput) (string, error) {
	var id string
	err := pgxutil.WithTx(ctx, s.pool, func(tx pgx.Tx) error {
		if err := tx.QueryRow(ctx, `
			INSERT INTO glossaries (name, description, category, visibility, entries)
			VALUES ($1, $2, $3, $4, $5)
			RETURNING id::text`, in.Name, in.Description, in.Category, in.Visibility, in.Entries).Scan(&id); err != nil {
			return fmt.Errorf("insert glossary: %w", err)
		}
		if _, err := tx.Exec(ctx, `
			INSERT INTO glossary_members (glossary_id, user_id, role, created_by)
			VALUES ($1::uuid, $2::uuid, 'owner', $2::uuid)`, id, ownerID); err != nil {
			return fmt.Errorf("insert owner row: %w", err)
		}
		return nil
	})
	if err != nil {
		return "", fmt.Errorf("Create glossary: %w", err)
	}
	return id, nil
}

// Update replaces the content of a glossary: name, description, category and
// entries, all as given (an empty description or category clears it). It bumps
// updated_at, which decides which of two glossaries is the newer one in a
// request. Visibility is not touched here.
func (s *PGStore) Update(ctx context.Context, id string, in GlossaryInput) error {
	tag, err := s.pool.Exec(ctx, `
		UPDATE glossaries
		SET name = $2,
		    description = $3,
		    category = $4,
		    entries = $5,
		    updated_at = now()
		WHERE id = $1::uuid`, id, in.Name, in.Description, in.Category, in.Entries)
	if err != nil {
		return fmt.Errorf("Update glossary: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return pgx.ErrNoRows
	}
	return nil
}

// SetVisibility changes who sees a glossary. It does not bump updated_at:
// sharing is not a change of content and must not reorder which glossary is
// the newer one.
func (s *PGStore) SetVisibility(ctx context.Context, id, visibility string) error {
	tag, err := s.pool.Exec(ctx,
		`UPDATE glossaries SET visibility = $2 WHERE id = $1::uuid`, id, visibility)
	if err != nil {
		return fmt.Errorf("SetVisibility: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return pgx.ErrNoRows
	}
	return nil
}

// Delete removes a glossary; memberships, pending invites and links follow.
func (s *PGStore) Delete(ctx context.Context, id string) error {
	tag, err := s.pool.Exec(ctx, `DELETE FROM glossaries WHERE id = $1::uuid`, id)
	if err != nil {
		return fmt.Errorf("Delete glossary: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return pgx.ErrNoRows
	}
	return nil
}

type entriesRow struct {
	ID      string          `db:"id"`
	Entries []GlossaryEntry `db:"entries"`
}

// ReadableGlossaries returns the entries of the named glossaries the caller
// can open, oldest first (the newer glossary wins for the same term). A name
// that is missing or not readable makes the whole call ErrGlossaryUnavailable.
func (s *PGStore) ReadableGlossaries(ctx context.Context, userID string, ids []string) ([]GlossaryData, error) {
	sql := `WITH ` + glossaryaccess.VisibleGlossariesCTE + `
		SELECT g.id::text AS id, g.entries
		FROM glossaries g
		JOIN visible_glossaries v ON v.id = g.id AND v.role IS NOT NULL
		WHERE g.id = ANY($2::uuid[])
		ORDER BY g.updated_at, g.id`
	rows, err := pgxutil.QueryRows[entriesRow](ctx, s.pool, sql, userID, ids)
	if err != nil {
		return nil, fmt.Errorf("ReadableGlossaries: %w", err)
	}
	if len(rows) != len(ids) {
		return nil, ErrGlossaryUnavailable
	}
	out := make([]GlossaryData, len(rows))
	for i, r := range rows {
		out[i] = GlossaryData(r)
	}
	return out, nil
}

// errNotFound is what the handlers map onto 404 for a store call whose row
// vanished between the gate and the write.
var errNotFound = pgx.ErrNoRows

func isNotFound(err error) bool { return errors.Is(err, errNotFound) }

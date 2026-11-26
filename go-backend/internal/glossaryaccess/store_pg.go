package glossaryaccess

import (
	"context"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// PGStore is the Postgres-backed Store.
type PGStore struct{ pool *pgxpool.Pool }

// NewStore creates a PGStore over the main pool.
func NewStore(pool *pgxpool.Pool) *PGStore { return &PGStore{pool: pool} }

var _ Store = (*PGStore)(nil)

// GetGlossary returns the glossary, or nil when it does not exist.
func (s *PGStore) GetGlossary(ctx context.Context, id string) (*Glossary, error) {
	g := &Glossary{}
	err := s.pool.QueryRow(ctx,
		`SELECT id::text, visibility FROM glossaries WHERE id = $1::uuid`, id).Scan(&g.ID, &g.Visibility)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("GetGlossary: %w", err)
	}
	return g, nil
}

// GetMemberRole returns the glossary_members role of userID, or "" for none.
func (s *PGStore) GetMemberRole(ctx context.Context, glossaryID, userID string) (string, error) {
	var role string
	err := s.pool.QueryRow(ctx,
		`SELECT role FROM glossary_members WHERE glossary_id = $1::uuid AND user_id = $2::uuid`,
		glossaryID, userID).Scan(&role)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", nil
	}
	if err != nil {
		return "", fmt.Errorf("GetMemberRole: %w", err)
	}
	return role, nil
}

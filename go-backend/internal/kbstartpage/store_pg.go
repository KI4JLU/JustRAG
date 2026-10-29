package kbstartpage

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5"

	"github.com/justrag/go-backend/internal/logctx"
	"github.com/justrag/go-backend/internal/pgxutil"
	"github.com/justrag/go-backend/internal/store"
)

// Decode parses a stored start_page column (nil for SQL NULL or JSON null).
func Decode(raw []byte) (*StartPage, error) {
	if len(raw) == 0 || string(raw) == "null" {
		return nil, nil
	}
	var p StartPage
	if err := json.Unmarshal(raw, &p); err != nil {
		return nil, fmt.Errorf("kbstartpage: decode start page: %w", err)
	}
	return &p, nil
}

// Store reads and writes knowledge_bases.start_page.
type Store struct {
	q pgxutil.Querier
}

// NewStore creates a Store over q (the main pool).
func NewStore(q pgxutil.Querier) *Store { return &Store{q: q} }

// Load returns the stored start page, nil when the KB never configured one;
// store.ErrNotFound when the KB does not exist. A value that does not parse
// is logged and read as nil, so a damaged row shows the default start page.
func (s *Store) Load(ctx context.Context, kbID string) (*StartPage, error) {
	var raw []byte
	err := s.q.QueryRow(ctx, `SELECT start_page FROM knowledge_bases WHERE id = $1`, kbID).Scan(&raw)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, fmt.Errorf("kbstartpage load kb=%s: %w", kbID, store.ErrNotFound)
	}
	if err != nil {
		return nil, fmt.Errorf("kbstartpage load: %w", err)
	}
	p, err := Decode(raw)
	if err != nil {
		logctx.From(ctx).Error("kbstartpage: unreadable start page; showing the default",
			"kb_id", kbID, "error", err)
		return nil, nil
	}
	return p, nil
}

// Save writes a validated, normalized StartPage. updated_at is left alone, as
// PATCH /api/kb/{id} leaves it.
func (s *Store) Save(ctx context.Context, kbID string, p StartPage) error {
	raw, err := json.Marshal(p)
	if err != nil {
		return fmt.Errorf("kbstartpage save: encode: %w", err)
	}
	tag, err := s.q.Exec(ctx, `UPDATE knowledge_bases SET start_page = $2 WHERE id = $1`, kbID, raw)
	if err != nil {
		return fmt.Errorf("kbstartpage save: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return fmt.Errorf("kbstartpage save kb=%s: %w", kbID, store.ErrNotFound)
	}
	return nil
}

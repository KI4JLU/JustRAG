package chat

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/justrag/go-backend/internal/auth"
	"github.com/justrag/go-backend/internal/httputil"
	"github.com/justrag/go-backend/internal/logctx"
	"github.com/justrag/go-backend/internal/pgxutil"
	"github.com/justrag/go-backend/internal/store"
)

// A user's own sections of the chat history (migration 0105): named groups
// they file chats in, beside the built-in "Angepinnt". A chat is filed with
// PUT /api/chats/{id}/pin and its sectionId; this file is the sections
// themselves.

const (
	// maxSectionNameLen caps a section's name, in characters (runes).
	maxSectionNameLen = 60
	// MaxSectionsPerUser caps how many sections one user can have: the
	// history lists them all, each with its heading.
	MaxSectionsPerUser = 50
)

// ErrTooManySections is returned by SectionStore.Create at MaxSectionsPerUser.
var ErrTooManySections = errors.New("too many chat sections")

// Section is one of a user's sections of the chat history.
type Section struct {
	ID        string    `json:"id" db:"id"`
	Name      string    `json:"name" db:"name"`
	CreatedAt time.Time `json:"createdAt" db:"created_at"`
}

// SectionStore is the database side of the sections routes.
type SectionStore interface {
	// List returns the user's sections in their order: the ordered ones by
	// place, then those added since, oldest first.
	List(ctx context.Context, userID string) ([]Section, error)
	// Create adds a section; ErrTooManySections at MaxSectionsPerUser.
	Create(ctx context.Context, userID, name string) (*Section, error)
	// Rename renames the user's section; store.ErrNotFound when it does not
	// exist or is not theirs.
	Rename(ctx context.Context, sectionID, userID, name string) error
	// SetOrder saves the user's order of their sections: sectionIDs front to
	// back. A section left out loses its place; ids that are not the user's
	// sections are ignored.
	SetOrder(ctx context.Context, userID string, sectionIDs []string) error
	// Delete removes the user's section and lets its chats go back to the
	// plain history; store.ErrNotFound as for Rename.
	Delete(ctx context.Context, sectionID, userID string) error
}

// PGSectionStore implements SectionStore on the main database.
type PGSectionStore struct {
	pool *pgxpool.Pool
}

// NewSectionStore returns the sections store on pool.
func NewSectionStore(pool *pgxpool.Pool) *PGSectionStore {
	return &PGSectionStore{pool: pool}
}

// List returns the user's sections in their order: by place, then the ones
// without a place — added since the last SetOrder — oldest first (id breaks
// a tie).
func (s *PGSectionStore) List(ctx context.Context, userID string) ([]Section, error) {
	rows, err := pgxutil.QueryRows[Section](ctx, s.pool, `
		SELECT id::text AS id, name, created_at
		FROM chat_sections WHERE user_id = $1::uuid
		ORDER BY position NULLS LAST, created_at, id`, userID)
	if err != nil {
		return nil, fmt.Errorf("list chat sections: %w", err)
	}
	return rows, nil
}

// Create adds a section for the user, at most MaxSectionsPerUser. The count
// and the insert run under a per-user advisory lock held to the end of the
// transaction: two concurrent creates at the cap would otherwise each count
// the rows before the other's insert and both pass.
func (s *PGSectionStore) Create(ctx context.Context, userID, name string) (*Section, error) {
	var row *Section
	err := pgx.BeginFunc(ctx, s.pool, func(tx pgx.Tx) error {
		if _, err := tx.Exec(ctx,
			`SELECT pg_advisory_xact_lock(hashtextextended('justrag.chat_sections:' || $1::text, 0))`, userID); err != nil {
			return fmt.Errorf("lock: %w", err)
		}
		var err error
		row, err = pgxutil.QueryOne[Section](ctx, tx, `
			INSERT INTO chat_sections (user_id, name)
			SELECT $1::uuid, $2
			WHERE (SELECT count(*) FROM chat_sections WHERE user_id = $1::uuid) < $3
			RETURNING id::text AS id, name, created_at`,
			userID, name, MaxSectionsPerUser)
		return err
	})
	if err != nil {
		return nil, fmt.Errorf("create chat section: %w", err)
	}
	if row == nil {
		return nil, ErrTooManySections
	}
	return row, nil
}

// Rename renames a section for its owner, in one statement.
func (s *PGSectionStore) Rename(ctx context.Context, sectionID, userID, name string) error {
	ct, err := s.pool.Exec(ctx,
		`UPDATE chat_sections SET name = $3 WHERE id = $1::uuid AND user_id = $2::uuid`,
		sectionID, userID, name)
	if err != nil {
		return fmt.Errorf("rename chat section: %w", err)
	}
	if ct.RowsAffected() == 0 {
		return fmt.Errorf("chat section %s: %w", sectionID, store.ErrNotFound)
	}
	return nil
}

// SetOrder writes the user's order of their sections in one statement: each
// of their sections gets its 1-based place in sectionIDs, or NULL when it is
// not listed. Ids that are not the user's sections match no row and are
// ignored; of a repeated id the first place counts.
func (s *PGSectionStore) SetOrder(ctx context.Context, userID string, sectionIDs []string) error {
	_, err := s.pool.Exec(ctx, `
		UPDATE chat_sections cs
		SET position = o.ord
		FROM (
			SELECT own.id, min(l.ord)::int AS ord
			FROM chat_sections own
			LEFT JOIN unnest($2::uuid[]) WITH ORDINALITY AS l(id, ord) ON l.id = own.id
			WHERE own.user_id = $1::uuid
			GROUP BY own.id
		) o
		WHERE cs.id = o.id`,
		userID, sectionIDs)
	if err != nil {
		return fmt.Errorf("order chat sections: %w", err)
	}
	return nil
}

// Delete removes a section for its owner. Its chats are let go first, in the
// same transaction: left to the FK's ON DELETE SET NULL they would keep
// pinned_at and turn up in "Angepinnt". updated_at is left alone, as for
// every pin change.
func (s *PGSectionStore) Delete(ctx context.Context, sectionID, userID string) error {
	err := pgx.BeginFunc(ctx, s.pool, func(tx pgx.Tx) error {
		// Only the caller's chats can be in the caller's section (the pin
		// checks that), and the user_id filter keeps it so for a section id
		// that is someone else's: that touches no row, and the delete below
		// then finds nothing and rolls back.
		if _, err := tx.Exec(ctx, `
			UPDATE chats SET pinned_at = NULL, pin_position = NULL, section_id = NULL
			WHERE section_id = $1::uuid AND user_id = $2::uuid`, sectionID, userID); err != nil {
			return fmt.Errorf("let chats go: %w", err)
		}
		ct, err := tx.Exec(ctx,
			`DELETE FROM chat_sections WHERE id = $1::uuid AND user_id = $2::uuid`, sectionID, userID)
		if err != nil {
			return fmt.Errorf("delete section: %w", err)
		}
		if ct.RowsAffected() == 0 {
			return fmt.Errorf("chat section %s: %w", sectionID, store.ErrNotFound)
		}
		return nil
	})
	if err != nil {
		return fmt.Errorf("delete chat section: %w", err)
	}
	return nil
}

// SectionsHandler serves the chat-section routes.
type SectionsHandler struct {
	store SectionStore
}

// NewSectionsHandler returns the handler on store.
func NewSectionsHandler(store SectionStore) *SectionsHandler {
	return &SectionsHandler{store: store}
}

type sectionRequest struct {
	Name string `json:"name"`
}

// sectionName reads and checks the name of a create or rename: one line (a
// whitespace run becomes one space), no other control character, 1 to
// maxSectionNameLen characters. On a refusal it has written the 400.
func sectionName(w http.ResponseWriter, r *http.Request) (string, bool) {
	var body sectionRequest
	// The name is at most maxSectionNameLen runes; 1 KiB leaves ample room.
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<10)).Decode(&body); err != nil {
		httputil.WriteErrorCtx(r.Context(), w, http.StatusBadRequest, "invalid JSON body")
		return "", false
	}
	name := strings.Join(strings.Fields(body.Name), " ")
	switch {
	case strings.IndexFunc(name, isLineBreakOrControl) >= 0:
		httputil.WriteErrorCtx(r.Context(), w, http.StatusBadRequest, "name must not contain control characters")
	case name == "":
		httputil.WriteErrorCtx(r.Context(), w, http.StatusBadRequest, "name is required")
	case utf8.RuneCountInString(name) > maxSectionNameLen:
		httputil.WriteErrorCtx(r.Context(), w, http.StatusBadRequest,
			fmt.Sprintf("name too long (max %d characters)", maxSectionNameLen))
	default:
		return name, true
	}
	return "", false
}

// List handles GET /api/chat-sections: the caller's sections in their order.
func (h *SectionsHandler) List(w http.ResponseWriter, r *http.Request) {
	user := auth.UserFromContext(r.Context())
	if user == nil {
		httputil.WriteErrorCtx(r.Context(), w, http.StatusUnauthorized, "authentication required")
		return
	}
	sections, err := h.store.List(r.Context(), user.ID)
	if err != nil {
		logctx.From(r.Context()).Error("chat.sections: list", "error", err, "user_id", user.ID)
		httputil.WriteErrorCtx(r.Context(), w, http.StatusInternalServerError, "failed to fetch sections")
		return
	}
	if sections == nil {
		sections = []Section{}
	}
	w.Header().Set("Cache-Control", "no-cache")
	httputil.WriteJSONCtx(r.Context(), w, http.StatusOK, sections)
}

// Create handles POST /api/chat-sections with {"name"}: 201 with the new
// section. 400 for a bad name, 409 at MaxSectionsPerUser.
func (h *SectionsHandler) Create(w http.ResponseWriter, r *http.Request) {
	user := auth.UserFromContext(r.Context())
	if user == nil {
		httputil.WriteErrorCtx(r.Context(), w, http.StatusUnauthorized, "authentication required")
		return
	}
	name, ok := sectionName(w, r)
	if !ok {
		return
	}
	section, err := h.store.Create(r.Context(), user.ID, name)
	if errors.Is(err, ErrTooManySections) {
		httputil.WriteErrorCtx(r.Context(), w, http.StatusConflict,
			fmt.Sprintf("too many sections (max %d)", MaxSectionsPerUser))
		return
	}
	if err != nil {
		logctx.From(r.Context()).Error("chat.sections: create", "error", err, "user_id", user.ID)
		httputil.WriteErrorCtx(r.Context(), w, http.StatusInternalServerError, "failed to create section")
		return
	}
	httputil.WriteJSONCtx(r.Context(), w, http.StatusCreated, section)
}

type sectionOrderRequest struct {
	SectionIDs []string `json:"sectionIds"`
}

// SetOrder handles PUT /api/chat-sections/order with {"sectionIds"}: the
// caller's order of their sections, front to back. 204; 400 for more than
// MaxSectionsPerUser ids or a malformed one.
func (h *SectionsHandler) SetOrder(w http.ResponseWriter, r *http.Request) {
	user := auth.UserFromContext(r.Context())
	if user == nil {
		httputil.WriteErrorCtx(r.Context(), w, http.StatusUnauthorized, "authentication required")
		return
	}
	var body sectionOrderRequest
	// MaxSectionsPerUser ids of 36 characters with quotes and commas fit in 4 KiB.
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 4<<10)).Decode(&body); err != nil {
		httputil.WriteErrorCtx(r.Context(), w, http.StatusBadRequest, "invalid JSON body")
		return
	}
	if len(body.SectionIDs) > MaxSectionsPerUser {
		httputil.WriteErrorCtx(r.Context(), w, http.StatusBadRequest,
			fmt.Sprintf("too many sections (max %d)", MaxSectionsPerUser))
		return
	}
	ids := make([]string, len(body.SectionIDs))
	for i, raw := range body.SectionIDs {
		parsed, err := uuid.Parse(raw)
		if err != nil {
			httputil.WriteErrorCtx(r.Context(), w, http.StatusBadRequest, "sectionIds must be section ids")
			return
		}
		ids[i] = parsed.String()
	}
	if err := h.store.SetOrder(r.Context(), user.ID, ids); err != nil {
		logctx.From(r.Context()).Error("chat.sections: set order", "error", err, "user_id", user.ID)
		httputil.WriteErrorCtx(r.Context(), w, http.StatusInternalServerError, "failed to save the order")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// Rename handles PATCH /api/chat-sections/{id} with {"name"}: 204. 404 for a
// section that is not the caller's, an unknown id or a malformed one.
func (h *SectionsHandler) Rename(w http.ResponseWriter, r *http.Request) {
	h.change(w, r, "rename", func(ctx context.Context, sectionID, userID string) (bool, error) {
		name, ok := sectionName(w, r)
		if !ok {
			return false, nil
		}
		return true, h.store.Rename(ctx, sectionID, userID, name)
	})
}

// Delete handles DELETE /api/chat-sections/{id}: 204; the section's chats go
// back to the plain history. 404 as for Rename.
func (h *SectionsHandler) Delete(w http.ResponseWriter, r *http.Request) {
	h.change(w, r, "delete", func(ctx context.Context, sectionID, userID string) (bool, error) {
		return true, h.store.Delete(ctx, sectionID, userID)
	})
}

// change runs one write on the caller's section named by the path. do
// returns false when it has already answered (a refused body).
func (h *SectionsHandler) change(w http.ResponseWriter, r *http.Request, op string,
	do func(ctx context.Context, sectionID, userID string) (bool, error)) {
	user := auth.UserFromContext(r.Context())
	if user == nil {
		httputil.WriteErrorCtx(r.Context(), w, http.StatusUnauthorized, "authentication required")
		return
	}
	parsed, err := uuid.Parse(r.PathValue("id"))
	if err != nil {
		httputil.WriteErrorCtx(r.Context(), w, http.StatusNotFound, "section not found")
		return
	}
	sectionID := parsed.String()

	done, err := do(r.Context(), sectionID, user.ID)
	if errors.Is(err, store.ErrNotFound) {
		httputil.WriteErrorCtx(r.Context(), w, http.StatusNotFound, "section not found")
		return
	}
	if err != nil {
		logctx.From(r.Context()).Error("chat.sections: "+op, "error", err, "section_id", sectionID, "user_id", user.ID)
		httputil.WriteErrorCtx(r.Context(), w, http.StatusInternalServerError, "failed to "+op+" section")
		return
	}
	if done {
		w.WriteHeader(http.StatusNoContent)
	}
}

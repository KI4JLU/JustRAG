// Package kbassistant saves a KB's assistant settings — „Startseite" (title,
// description, category, start page) and „Verhalten" (roles and rules) — in
// one transaction, and keeps their version history (kb_settings_versions,
// migration 0094): every save and every restore writes a new version with
// the full state and its changes, nothing is overwritten.
//
// The parts keep their own owners and readers: knowledge_bases.name /
// description, kb_category_links (internal/kbcategories), the behavior
// (internal/kbbehavior) and the start page (internal/kbstartpage). This
// package only writes them together.
package kbassistant

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/justrag/go-backend/internal/kbbehavior"
	"github.com/justrag/go-backend/internal/kbstartpage"
	"github.com/justrag/go-backend/internal/pgxutil"
	"github.com/justrag/go-backend/internal/store"
)

const (
	// MaxVersions is how many versions are kept per KB; older ones are
	// pruned on save. One version is a few KB of JSON.
	MaxVersions = 200
	// MaxTitleRunes / MaxDescriptionRunes mirror PATCH /api/kb/{id}.
	MaxTitleRunes       = 255
	MaxDescriptionRunes = 2000
)

// Version kinds.
const (
	KindBaseline = "baseline"
	KindSave     = "save"
	KindRestore  = "restore"
)

var (
	// ErrConflict: the settings were saved since the caller loaded them.
	ErrConflict = errors.New("kbassistant: the settings changed since they were loaded")
	// ErrRenameForbidden: the title changed but the caller may not rename.
	ErrRenameForbidden = errors.New("kbassistant: only the owner may rename a knowledge base")
	// ErrInvalid wraps a refused input; the message is safe to return.
	ErrInvalid = errors.New("kbassistant: invalid settings")
	// ErrNotRestorable: the version references something that no longer
	// exists in the catalog (a removed template role or rule).
	ErrNotRestorable = errors.New("kbassistant: this version can no longer be restored")
)

// Snapshot is the full saved state of a version: the stored forms, as the
// columns hold them.
type Snapshot struct {
	Title       string  `json:"title"`
	Description *string `json:"description"`
	CategoryID  *string `json:"categoryId"`
	// Behavior is the stored behavior (legacy role reduced to its id); nil =
	// never customized. SystemPrompt is the legacy role's prompt.
	Behavior     *kbbehavior.Behavior   `json:"behavior"`
	SystemPrompt *string                `json:"systemPrompt"`
	StartPage    *kbstartpage.StartPage `json:"startPage"`
}

// Settings is the body of GET (and of a successful PUT / restore).
type Settings struct {
	Title       string  `json:"title"`
	Description *string `json:"description"`
	CategoryID  *string `json:"categoryId"`
	// Behavior is what GET /api/kb/{id}/behavior returns.
	Behavior kbbehavior.Settings `json:"behavior"`
	// StartPage is the effective start page; StartPageConfigured false while
	// the KB shows the default.
	StartPage           kbstartpage.StartPage `json:"startPage"`
	StartPageConfigured bool                  `json:"startPageConfigured"`
	// Version is the newest version number, 0 before the first save. Send it
	// back as baseVersion.
	Version   int  `json:"version"`
	CanRename bool `json:"canRename"`
}

// Input is the body of PUT: the whole settings.
type Input struct {
	Title       string                `json:"title"`
	Description *string               `json:"description"`
	CategoryID  *string               `json:"categoryId"`
	Behavior    kbbehavior.Behavior   `json:"behavior"`
	StartPage   kbstartpage.StartPage `json:"startPage"`
	BaseVersion int                   `json:"baseVersion"`
}

// Version is one entry of the history.
type Version struct {
	Number       int       `json:"number"`
	Kind         string    `json:"kind"`
	CreatedAt    time.Time `json:"createdAt"`
	AuthorID     *string   `json:"authorId"`
	AuthorName   string    `json:"authorName"`
	Note         *string   `json:"note"`
	RestoredFrom *int      `json:"restoredFrom,omitempty"`
	Changes      []Change  `json:"changes"`
}

// Store is the Postgres-backed store.
type Store struct {
	pool *pgxpool.Pool
}

// NewStore creates a Store over the main pool.
func NewStore(pool *pgxpool.Pool) *Store { return &Store{pool: pool} }

// state is a KB's current settings as loaded in a transaction.
type state struct {
	snap     Snapshot
	language string
	latest   int
}

func loadState(ctx context.Context, q pgxutil.Querier, kbID string, lock bool) (state, error) {
	if lock {
		// The row lock first, in a statement of its own: under READ COMMITTED
		// the read below then takes a snapshot that already sees a save that
		// held the lock before us, its new version included. Locking in the
		// same statement would re-read the KB row but not the version
		// subquery, and a racing save would pass the base-version check.
		var one int
		err := q.QueryRow(ctx, `SELECT 1 FROM knowledge_bases WHERE id = $1 FOR UPDATE`, kbID).Scan(&one)
		if errors.Is(err, pgx.ErrNoRows) {
			return state{}, fmt.Errorf("kbassistant load kb=%s: %w", kbID, store.ErrNotFound)
		}
		if err != nil {
			return state{}, fmt.Errorf("kbassistant lock: %w", err)
		}
	}
	sql := `
		SELECT kb.name, kb.description, kb.language, kb.system_prompt, kb.behavior, kb.start_page,
		       (SELECT l.category_id::text FROM kb_category_links l
		          JOIN kb_categories c ON c.id = l.category_id
		         WHERE l.kb_id = kb.id ORDER BY c.sort_order, c.name LIMIT 1),
		       COALESCE((SELECT max(v.number) FROM kb_settings_versions v WHERE v.kb_id = kb.id), 0)
		FROM knowledge_bases kb WHERE kb.id = $1`
	var (
		st                 state
		behaviorRaw, start []byte
	)
	err := q.QueryRow(ctx, sql, kbID).Scan(&st.snap.Title, &st.snap.Description, &st.language,
		&st.snap.SystemPrompt, &behaviorRaw, &start, &st.snap.CategoryID, &st.latest)
	if errors.Is(err, pgx.ErrNoRows) {
		return state{}, fmt.Errorf("kbassistant load kb=%s: %w", kbID, store.ErrNotFound)
	}
	if err != nil {
		return state{}, fmt.Errorf("kbassistant load: %w", err)
	}
	if st.snap.Behavior, err = kbbehavior.Decode(behaviorRaw); err != nil {
		return state{}, err
	}
	if st.snap.StartPage, err = kbstartpage.Decode(start); err != nil {
		return state{}, err
	}
	return st, nil
}

func settingsOf(st state, canRename bool) Settings {
	lang := kbbehavior.Lang(st.language)
	eff := kbbehavior.Effective(st.snap.Behavior, st.snap.SystemPrompt, st.snap.Title, lang)
	return Settings{
		Title:               st.snap.Title,
		Description:         st.snap.Description,
		CategoryID:          st.snap.CategoryID,
		Behavior:            kbbehavior.Settings{Behavior: eff, Customized: st.snap.Behavior != nil, Language: lang},
		StartPage:           kbstartpage.Effective(st.snap.StartPage, eff.ActiveRoleID, eff.HasRole),
		StartPageConfigured: st.snap.StartPage != nil,
		Version:             st.latest,
		CanRename:           canRename,
	}
}

// Get returns the KB's settings; store.ErrNotFound when it does not exist.
func (s *Store) Get(ctx context.Context, kbID string, canRename bool) (Settings, error) {
	st, err := loadState(ctx, s.pool, kbID, false)
	if err != nil {
		return Settings{}, err
	}
	return settingsOf(st, canRename), nil
}

func invalid(format string, args ...any) error {
	return fmt.Errorf("%w: %s", ErrInvalid, fmt.Sprintf(format, args...))
}

// snapshotOf validates in and turns it into the stored form.
func snapshotOf(in Input) (Snapshot, error) {
	title := strings.TrimSpace(in.Title)
	if title == "" {
		return Snapshot{}, invalid("title must not be empty")
	}
	if utf8.RuneCountInString(title) > MaxTitleRunes {
		return Snapshot{}, invalid("title must not exceed %d characters", MaxTitleRunes)
	}
	var desc *string
	if in.Description != nil {
		d := strings.TrimSpace(*in.Description)
		if utf8.RuneCountInString(d) > MaxDescriptionRunes {
			return Snapshot{}, invalid("description must not exceed %d characters", MaxDescriptionRunes)
		}
		if d != "" {
			desc = &d
		}
	}
	if err := kbbehavior.Validate(in.Behavior); err != nil {
		return Snapshot{}, fmt.Errorf("%w: %s", ErrInvalid, strings.TrimPrefix(err.Error(), kbbehavior.ErrInvalid.Error()+": "))
	}
	// The start page's role cards are checked against the behavior being saved
	// with it, so a role deleted and its cards removed in one save pass.
	if err := kbstartpage.Validate(in.StartPage, in.Behavior.ActiveRoleID, in.Behavior.HasRole); err != nil {
		return Snapshot{}, fmt.Errorf("%w: %s", ErrInvalid, strings.TrimPrefix(err.Error(), kbstartpage.ErrInvalid.Error()+": "))
	}
	stored, legacy := kbbehavior.ForStorage(in.Behavior)
	page := kbstartpage.Normalize(in.StartPage)
	return Snapshot{
		Title: title, Description: desc, CategoryID: in.CategoryID,
		Behavior: &stored, SystemPrompt: legacy, StartPage: &page,
	}, nil
}

// Author identifies who saves.
type Author struct {
	ID        string
	CanRename bool
}

// Save validates in and writes it with a new version. A title change needs
// CanRename (ErrRenameForbidden); a stale BaseVersion is ErrConflict. A save
// that changes nothing writes no version.
func (s *Store) Save(ctx context.Context, kbID string, in Input, author Author) (Settings, error) {
	next, err := snapshotOf(in)
	if err != nil {
		return Settings{}, err
	}
	var out state
	err = pgxutil.WithTx(ctx, s.pool, func(tx pgx.Tx) error {
		cur, err := loadState(ctx, tx, kbID, true)
		if err != nil {
			return err
		}
		if in.BaseVersion != cur.latest {
			return ErrConflict
		}
		if next.Title != cur.snap.Title && !author.CanRename {
			return ErrRenameForbidden
		}
		// The legacy role named after the KB keeps following its name.
		kbbehavior.DropLegacyDefaults(next.Behavior, cur.snap.Title, next.Title)
		out, err = commit(ctx, tx, kbID, cur, next, author.ID, KindSave, nil)
		return err
	})
	if err != nil {
		return Settings{}, err
	}
	return settingsOf(out, author.CanRename), nil
}

// Restore writes version n's state as a new version (kind restore). The title
// is restored only when the caller may rename; a category that no longer
// exists is dropped.
func (s *Store) Restore(ctx context.Context, kbID string, n, baseVersion int, author Author) (Settings, error) {
	var out state
	err := pgxutil.WithTx(ctx, s.pool, func(tx pgx.Tx) error {
		cur, err := loadState(ctx, tx, kbID, true)
		if err != nil {
			return err
		}
		if baseVersion != cur.latest {
			return ErrConflict
		}
		var raw []byte
		err = tx.QueryRow(ctx, `SELECT snapshot FROM kb_settings_versions WHERE kb_id = $1 AND number = $2`, kbID, n).Scan(&raw)
		if errors.Is(err, pgx.ErrNoRows) {
			return fmt.Errorf("kbassistant restore v%d: %w", n, store.ErrNotFound)
		}
		if err != nil {
			return fmt.Errorf("kbassistant restore: %w", err)
		}
		var snap Snapshot
		if err := json.Unmarshal(raw, &snap); err != nil {
			return fmt.Errorf("kbassistant restore: decode: %w", err)
		}
		lang := kbbehavior.Lang(cur.language)
		if snap.Behavior != nil {
			if err := kbbehavior.Validate(kbbehavior.Effective(snap.Behavior, snap.SystemPrompt, "", lang)); err != nil {
				return ErrNotRestorable
			}
		}
		if !author.CanRename {
			snap.Title = cur.snap.Title
		}
		if snap.CategoryID != nil {
			var ok bool
			if err := tx.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM kb_categories WHERE id = $1::uuid)`, *snap.CategoryID).Scan(&ok); err != nil {
				return fmt.Errorf("kbassistant restore: category: %w", err)
			}
			if !ok {
				snap.CategoryID = nil
			}
		}
		out, err = commit(ctx, tx, kbID, cur, snap, author.ID, KindRestore, &n)
		return err
	})
	if err != nil {
		return Settings{}, err
	}
	return settingsOf(out, author.CanRename), nil
}

// commit writes next over cur and records the version(s). The first version
// of a KB is its state before this write (baseline), so it can be restored.
func commit(ctx context.Context, tx pgx.Tx, kbID string, cur state, next Snapshot, authorID, kind string, restoredFrom *int) (state, error) {
	lang := kbbehavior.Lang(cur.language)
	names, err := categoryNames(ctx, tx, cur.snap.CategoryID, next.CategoryID)
	if err != nil {
		return state{}, err
	}
	changes := diff(cur.snap, next, lang, func(id *string) string {
		if id == nil {
			return ""
		}
		return names[*id]
	})
	// Nothing differs in what the settings show: no version. Compared on the
	// snapshots themselves, not on the change list — the list names what a
	// reader needs, and an edit it has no words for (a role's icon) must
	// still be saved.
	if kind == KindSave && sameSnapshot(cur.snap, next, lang) {
		return cur, nil
	}
	// A save that leaves the behavior as it reads keeps it as stored: a KB
	// that never customized it (behavior NULL) keeps answering with its old
	// system prompt byte for byte when only, say, the title changed.
	if sameBehavior(cur.snap, next, lang) {
		next.Behavior, next.SystemPrompt = cur.snap.Behavior, cur.snap.SystemPrompt
	}
	if err := writeSettings(ctx, tx, kbID, next); err != nil {
		return state{}, err
	}
	number := cur.latest
	if number == 0 {
		number = 1
		if err := insertVersion(ctx, tx, kbID, number, KindBaseline, "", cur.snap, []Change{}, nil); err != nil {
			return state{}, err
		}
	}
	number++
	if err := insertVersion(ctx, tx, kbID, number, kind, authorID, next, changes, restoredFrom); err != nil {
		return state{}, err
	}
	if _, err := tx.Exec(ctx, `DELETE FROM kb_settings_versions WHERE kb_id = $1 AND number <= $2`, kbID, number-MaxVersions); err != nil {
		return state{}, fmt.Errorf("kbassistant: prune versions: %w", err)
	}
	return state{snap: next, language: cur.language, latest: number}, nil
}

// sameSnapshot reports whether a and b show the same settings: title,
// description, category, and the behavior and start page in their effective
// (displayed) form.
func sameSnapshot(a, b Snapshot, lang string) bool {
	va, vb := viewOf(a, "", lang), viewOf(b, "", lang)
	ja, errA := json.Marshal([]any{a.Title, a.Description, a.CategoryID, va.behavior, va.start})
	jb, errB := json.Marshal([]any{b.Title, b.Description, b.CategoryID, vb.behavior, vb.start})
	return errA == nil && errB == nil && string(ja) == string(jb)
}

func sameBehavior(a, b Snapshot, lang string) bool {
	// Without the KB name: a rename alone is no behavior change.
	ja, errA := json.Marshal(kbbehavior.Effective(a.Behavior, a.SystemPrompt, "", lang))
	jb, errB := json.Marshal(kbbehavior.Effective(b.Behavior, b.SystemPrompt, "", lang))
	return errA == nil && errB == nil && string(ja) == string(jb)
}

func categoryNames(ctx context.Context, tx pgx.Tx, ids ...*string) (map[string]string, error) {
	var list []string
	for _, id := range ids {
		if id != nil {
			list = append(list, *id)
		}
	}
	names := map[string]string{}
	if len(list) == 0 {
		return names, nil
	}
	rows, err := tx.Query(ctx, `SELECT id::text, name FROM kb_categories WHERE id = ANY($1::uuid[])`, list)
	if err != nil {
		return nil, fmt.Errorf("kbassistant: category names: %w", err)
	}
	defer rows.Close()
	for rows.Next() {
		var id, name string
		if err := rows.Scan(&id, &name); err != nil {
			return nil, fmt.Errorf("kbassistant: category names: %w", err)
		}
		names[id] = name
	}
	return names, rows.Err()
}

func writeSettings(ctx context.Context, tx pgx.Tx, kbID string, s Snapshot) error {
	// A nil part (a baseline restored before the KB was customized) is SQL
	// NULL, not JSON null: the readers' legacy paths test IS NULL.
	var behavior, page []byte
	var err error
	if s.Behavior != nil {
		if behavior, err = json.Marshal(s.Behavior); err != nil {
			return fmt.Errorf("kbassistant: encode behavior: %w", err)
		}
	}
	if s.StartPage != nil {
		if page, err = json.Marshal(s.StartPage); err != nil {
			return fmt.Errorf("kbassistant: encode start page: %w", err)
		}
	}
	// updated_at is left alone, as PATCH /api/kb/{id} leaves it.
	if _, err := tx.Exec(ctx, `
		UPDATE knowledge_bases SET name = $2, description = $3, behavior = $4, system_prompt = $5, start_page = $6
		WHERE id = $1`, kbID, s.Title, s.Description, behavior, s.SystemPrompt, page); err != nil {
		return fmt.Errorf("kbassistant: write settings: %w", err)
	}
	if _, err := tx.Exec(ctx, `DELETE FROM kb_category_links WHERE kb_id = $1`, kbID); err != nil {
		return fmt.Errorf("kbassistant: clear category: %w", err)
	}
	if s.CategoryID != nil {
		tag, err := tx.Exec(ctx, `
			INSERT INTO kb_category_links (kb_id, category_id)
			SELECT $1, id FROM kb_categories WHERE id = $2::uuid`, kbID, *s.CategoryID)
		if err != nil {
			return fmt.Errorf("kbassistant: set category: %w", err)
		}
		if tag.RowsAffected() == 0 {
			return invalid("unknown category")
		}
	}
	return nil
}

func insertVersion(ctx context.Context, tx pgx.Tx, kbID string, number int, kind, authorID string, snap Snapshot, changes []Change, restoredFrom *int) error {
	rawSnap, err := json.Marshal(snap)
	if err != nil {
		return fmt.Errorf("kbassistant: encode snapshot: %w", err)
	}
	rawChanges, err := json.Marshal(changes)
	if err != nil {
		return fmt.Errorf("kbassistant: encode changes: %w", err)
	}
	var author *string
	if authorID != "" {
		author = &authorID
	}
	// author_name is the display name now, so the row reads right after the
	// user is renamed or deleted.
	if _, err := tx.Exec(ctx, `
		INSERT INTO kb_settings_versions (kb_id, number, kind, author_id, author_name, restored_from, snapshot, changes)
		VALUES ($1, $2, $3, $4::uuid,
		        COALESCE((SELECT COALESCE(NULLIF(TRIM(CONCAT_WS(' ', first_name, last_name)), ''), username)
		                    FROM users WHERE id = $4::uuid), ''),
		        $5, $6, $7)`,
		kbID, number, kind, author, restoredFrom, rawSnap, rawChanges); err != nil {
		return fmt.Errorf("kbassistant: insert version: %w", err)
	}
	return nil
}

// Versions lists the KB's versions, newest first.
func (s *Store) Versions(ctx context.Context, kbID string) ([]Version, error) {
	rows, err := s.pool.Query(ctx, `
		SELECT number, kind, created_at, author_id::text, author_name, note, restored_from, changes
		FROM kb_settings_versions WHERE kb_id = $1 ORDER BY number DESC`, kbID)
	if err != nil {
		return nil, fmt.Errorf("kbassistant versions: %w", err)
	}
	defer rows.Close()
	out := []Version{}
	for rows.Next() {
		var (
			v   Version
			raw []byte
		)
		if err := rows.Scan(&v.Number, &v.Kind, &v.CreatedAt, &v.AuthorID, &v.AuthorName, &v.Note, &v.RestoredFrom, &raw); err != nil {
			return nil, fmt.Errorf("kbassistant versions: scan: %w", err)
		}
		if err := json.Unmarshal(raw, &v.Changes); err != nil {
			return nil, fmt.Errorf("kbassistant versions: decode changes: %w", err)
		}
		out = append(out, v)
	}
	return out, rows.Err()
}

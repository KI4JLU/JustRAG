package kbbehavior

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"fmt"
	"log/slog"
	"regexp"
	"strings"
	"sync"
	"time"
	"unicode/utf8"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/justrag/go-backend/internal/pgxutil"
	"github.com/justrag/go-backend/internal/safego"
	"github.com/justrag/go-backend/internal/store"
)

// Texts is one template text in the two prompt languages.
type Texts struct {
	DE string `json:"de"`
	EN string `json:"en"`
}

// TemplateInput is a role template as „Vorlagen" writes it.
type TemplateInput struct {
	Icon        string `json:"icon"`
	IsDefault   bool   `json:"isDefault"`
	Enabled     bool   `json:"enabled"`
	Name        Texts  `json:"name"`
	Description Texts  `json:"description"`
	Prompt      Texts  `json:"prompt"`
	Cover       Cover  `json:"cover"`
}

// AdminTemplate is a role template as „Vorlagen" reads it: both languages,
// plus how many KBs use it (as their active role or on a start page card).
type AdminTemplate struct {
	ID string `json:"id"`
	TemplateInput
	UsedBy int `json:"usedBy"`
}

// ErrTemplateInUse refuses deleting a template KBs still use; disabling it
// stops new picks without breaking them.
var ErrTemplateInUse = errors.New("kbbehavior: role template in use")

var hexColor = regexp.MustCompile(`^#[0-9A-Fa-f]{6}$`)

// ValidateTemplate checks a template sent by „Vorlagen". Lengths count runes.
func ValidateTemplate(in TemplateInput) error {
	if !knownIcons[in.Icon] {
		return invalid("unknown icon %q", in.Icon)
	}
	if strings.TrimSpace(in.Name.DE) == "" {
		return invalid("a role template needs a German name")
	}
	for _, n := range []string{in.Name.DE, in.Name.EN} {
		if utf8.RuneCountInString(strings.TrimSpace(n)) > MaxRoleNameRunes {
			return invalid("a role name must not exceed %d characters", MaxRoleNameRunes)
		}
	}
	for _, d := range []string{in.Description.DE, in.Description.EN} {
		if utf8.RuneCountInString(strings.TrimSpace(d)) > MaxRoleDescRunes {
			return invalid("a role description must not exceed %d characters", MaxRoleDescRunes)
		}
	}
	if strings.TrimSpace(in.Prompt.DE) == "" {
		return invalid("a role template needs a German prompt")
	}
	for _, p := range []string{in.Prompt.DE, in.Prompt.EN} {
		if utf8.RuneCountInString(p) > MaxPromptRunes {
			return invalid("a role prompt must not exceed %d characters", MaxPromptRunes)
		}
	}
	if !hexColor.MatchString(in.Cover.From) || !hexColor.MatchString(in.Cover.To) {
		return invalid("cover colours must be #RRGGBB")
	}
	if in.IsDefault && !in.Enabled {
		return invalid("the default role cannot be disabled")
	}
	return nil
}

// TemplateStore reads and writes role_templates and keeps this process's
// catalog (templates.go) in step with it.
type TemplateStore struct {
	pool *pgxpool.Pool
}

// NewTemplateStore creates a TemplateStore over the main pool.
func NewTemplateStore(pool *pgxpool.Pool) *TemplateStore { return &TemplateStore{pool: pool} }

const templateColumns = `id, icon, is_default, disabled, name_de, name_en, description_de, description_en,
	prompt_de, prompt_en, cover_from, cover_to`

// Seed fills an empty role_templates with builtinRoles, once per deployment:
// the table lock makes a server and a worker starting together seed it once.
func (s *TemplateStore) Seed(ctx context.Context) error {
	return pgxutil.WithTx(ctx, s.pool, func(tx pgx.Tx) error {
		if _, err := tx.Exec(ctx, `LOCK TABLE role_templates IN EXCLUSIVE MODE`); err != nil {
			return fmt.Errorf("kbbehavior seed templates: lock: %w", err)
		}
		var seeded bool
		if err := tx.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM role_templates)`).Scan(&seeded); err != nil {
			return fmt.Errorf("kbbehavior seed templates: %w", err)
		}
		if seeded {
			return nil
		}
		for i, r := range builtinRoles {
			if _, err := tx.Exec(ctx, `INSERT INTO role_templates (`+templateColumns+`, position)
				VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
				r.id, r.icon, r.isDefault, r.disabled, r.name.de, r.name.en, r.description.de, r.description.en,
				r.prompt.de, r.prompt.en, r.coverFrom, r.coverTo, i); err != nil {
				return fmt.Errorf("kbbehavior seed templates %s: %w", r.id, err)
			}
		}
		return nil
	})
}

// Refresh loads role_templates into this process's catalog. An empty table
// (not seeded yet) leaves the catalog as it is.
func (s *TemplateStore) Refresh(ctx context.Context) error {
	rows, err := s.pool.Query(ctx, `SELECT `+templateColumns+` FROM role_templates ORDER BY position, id`)
	if err != nil {
		return fmt.Errorf("kbbehavior load templates: %w", err)
	}
	roles, err := pgx.CollectRows(rows, func(row pgx.CollectableRow) (templateRole, error) {
		var r templateRole
		err := row.Scan(&r.id, &r.icon, &r.isDefault, &r.disabled, &r.name.de, &r.name.en,
			&r.description.de, &r.description.en, &r.prompt.de, &r.prompt.en, &r.coverFrom, &r.coverTo)
		return r, err
	})
	if err != nil {
		return fmt.Errorf("kbbehavior load templates: %w", err)
	}
	if len(roles) > 0 {
		setTemplates(roles)
	}
	return nil
}

// StartTemplateRefresher seeds and loads the templates, then reloads them
// every interval, so a change made in „Vorlagen" on another instance
// reaches this one within interval (the instance that saved reloads at
// once). A failed load keeps the catalog it has. stop ends the loop and waits
// for it — call it before the pool closes.
func StartTemplateRefresher(ctx context.Context, s *TemplateStore, interval time.Duration) (stop func()) {
	startCtx, cancelStart := context.WithTimeout(ctx, 10*time.Second)
	if err := s.Seed(startCtx); err != nil {
		slog.Error("kbbehavior: seeding role templates failed; serving the built-in ones", "error", err)
	} else if err := s.Refresh(startCtx); err != nil {
		slog.Error("kbbehavior: loading role templates failed; serving the built-in ones", "error", err)
	}
	cancelStart()

	loopCtx, cancel := context.WithCancel(ctx)
	var wg sync.WaitGroup
	wg.Add(1)
	safego.Go(func() {
		defer wg.Done()
		t := time.NewTicker(interval)
		defer t.Stop()
		for {
			select {
			case <-loopCtx.Done():
				return
			case <-t.C:
				if err := s.Refresh(loopCtx); err != nil && loopCtx.Err() == nil {
					slog.Warn("kbbehavior: reloading role templates failed; keeping the current ones", "error", err)
				}
			}
		}
	})
	return func() {
		cancel()
		wg.Wait()
	}
}

// usedByCount counts the KBs that use a template: as the active role or on a
// start page role card. (A chat started in it is no use: it falls back to the
// KB's active role, see Compile.)
const usedByCount = `(SELECT count(*) FROM knowledge_bases kb
	WHERE kb.behavior->>'activeRoleId' = t.id
	   OR EXISTS (SELECT 1 FROM jsonb_array_elements(
	        CASE WHEN jsonb_typeof(kb.start_page->'roleEntries') = 'array' THEN kb.start_page->'roleEntries' ELSE '[]'::jsonb END) e
	      WHERE e->>'roleId' = t.id))`

// List returns every template in display order, with its use count.
func (s *TemplateStore) List(ctx context.Context) ([]AdminTemplate, error) {
	rows, err := s.pool.Query(ctx, `SELECT `+templateColumns+`, `+usedByCount+`::int
		FROM role_templates t ORDER BY position, id`)
	if err != nil {
		return nil, fmt.Errorf("kbbehavior list templates: %w", err)
	}
	out, err := pgx.CollectRows(rows, func(row pgx.CollectableRow) (AdminTemplate, error) {
		var (
			t        AdminTemplate
			disabled bool
		)
		err := row.Scan(&t.ID, &t.Icon, &t.IsDefault, &disabled, &t.Name.DE, &t.Name.EN,
			&t.Description.DE, &t.Description.EN, &t.Prompt.DE, &t.Prompt.EN, &t.Cover.From, &t.Cover.To, &t.UsedBy)
		t.Enabled = !disabled
		return t, err
	})
	if err != nil {
		return nil, fmt.Errorf("kbbehavior list templates: %w", err)
	}
	return out, nil
}

func newTemplateID() (string, error) {
	b := make([]byte, 4)
	if _, err := rand.Read(b); err != nil {
		return "", fmt.Errorf("kbbehavior template id: %w", err)
	}
	return "t-" + hex.EncodeToString(b), nil
}

func trimmed(in TemplateInput) TemplateInput {
	in.Name = Texts{strings.TrimSpace(in.Name.DE), strings.TrimSpace(in.Name.EN)}
	in.Description = Texts{strings.TrimSpace(in.Description.DE), strings.TrimSpace(in.Description.EN)}
	in.Cover = Cover{strings.ToUpper(in.Cover.From), strings.ToUpper(in.Cover.To)}
	return in
}

// Create adds a validated template at the end and returns its id.
func (s *TemplateStore) Create(ctx context.Context, in TemplateInput) (string, error) {
	in = trimmed(in)
	id, err := newTemplateID()
	if err != nil {
		return "", err
	}
	err = pgxutil.WithTx(ctx, s.pool, func(tx pgx.Tx) error {
		if in.IsDefault {
			if _, err := tx.Exec(ctx, `UPDATE role_templates SET is_default = false, updated_at = now() WHERE is_default`); err != nil {
				return err
			}
		}
		_, err := tx.Exec(ctx, `INSERT INTO role_templates (`+templateColumns+`, position)
			VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12,
			        (SELECT COALESCE(max(position), -1) + 1 FROM role_templates))`,
			id, in.Icon, in.IsDefault, !in.Enabled, in.Name.DE, in.Name.EN, in.Description.DE, in.Description.EN,
			in.Prompt.DE, in.Prompt.EN, in.Cover.From, in.Cover.To)
		return err
	})
	if err != nil {
		return "", fmt.Errorf("kbbehavior create template: %w", err)
	}
	return id, s.Refresh(ctx)
}

// Update replaces a validated template's texts and settings. Making it the
// default takes that from the previous one; the default cannot give it up
// here (another template takes it) — ErrInvalid.
func (s *TemplateStore) Update(ctx context.Context, id string, in TemplateInput) error {
	in = trimmed(in)
	err := pgxutil.WithTx(ctx, s.pool, func(tx pgx.Tx) error {
		var wasDefault bool
		err := tx.QueryRow(ctx, `SELECT is_default FROM role_templates WHERE id = $1 FOR UPDATE`, id).Scan(&wasDefault)
		if errors.Is(err, pgx.ErrNoRows) {
			return store.ErrNotFound
		}
		if err != nil {
			return err
		}
		if wasDefault && !in.IsDefault {
			return invalid("make another template the default instead")
		}
		if in.IsDefault && !wasDefault {
			if _, err := tx.Exec(ctx, `UPDATE role_templates SET is_default = false, updated_at = now() WHERE is_default`); err != nil {
				return err
			}
		}
		_, err = tx.Exec(ctx, `UPDATE role_templates SET icon = $2, is_default = $3, disabled = $4,
			name_de = $5, name_en = $6, description_de = $7, description_en = $8, prompt_de = $9, prompt_en = $10,
			cover_from = $11, cover_to = $12, updated_at = now() WHERE id = $1`,
			id, in.Icon, in.IsDefault, !in.Enabled, in.Name.DE, in.Name.EN, in.Description.DE, in.Description.EN,
			in.Prompt.DE, in.Prompt.EN, in.Cover.From, in.Cover.To)
		return err
	})
	if err != nil {
		if errors.Is(err, ErrInvalid) || errors.Is(err, store.ErrNotFound) {
			return err
		}
		return fmt.Errorf("kbbehavior update template %s: %w", id, err)
	}
	return s.Refresh(ctx)
}

// Delete removes a template no KB uses; the default cannot go (ErrInvalid),
// one in use neither (ErrTemplateInUse).
func (s *TemplateStore) Delete(ctx context.Context, id string) error {
	err := pgxutil.WithTx(ctx, s.pool, func(tx pgx.Tx) error {
		var (
			isDefault bool
			usedBy    int
		)
		err := tx.QueryRow(ctx, `SELECT is_default, `+usedByCount+`::int FROM role_templates t WHERE id = $1 FOR UPDATE`, id).
			Scan(&isDefault, &usedBy)
		if errors.Is(err, pgx.ErrNoRows) {
			return store.ErrNotFound
		}
		if err != nil {
			return err
		}
		if isDefault {
			return invalid("the default role cannot be deleted")
		}
		if usedBy > 0 {
			return ErrTemplateInUse
		}
		_, err = tx.Exec(ctx, `DELETE FROM role_templates WHERE id = $1`, id)
		return err
	})
	if err != nil {
		if errors.Is(err, ErrInvalid) || errors.Is(err, store.ErrNotFound) || errors.Is(err, ErrTemplateInUse) {
			return err
		}
		return fmt.Errorf("kbbehavior delete template %s: %w", id, err)
	}
	return s.Refresh(ctx)
}

// Reorder sets the display order: ids must name every template exactly once.
func (s *TemplateStore) Reorder(ctx context.Context, ids []string) error {
	err := pgxutil.WithTx(ctx, s.pool, func(tx pgx.Tx) error {
		var n int
		if err := tx.QueryRow(ctx, `SELECT count(*) FROM role_templates`).Scan(&n); err != nil {
			return err
		}
		seen := map[string]bool{}
		for _, id := range ids {
			seen[id] = true
		}
		if len(ids) != n || len(seen) != n {
			return invalid("the order must name every role template once")
		}
		for i, id := range ids {
			tag, err := tx.Exec(ctx, `UPDATE role_templates SET position = $2 WHERE id = $1`, id, i)
			if err != nil {
				return err
			}
			if tag.RowsAffected() == 0 {
				return invalid("unknown role template %q", id)
			}
		}
		return nil
	})
	if err != nil {
		if errors.Is(err, ErrInvalid) {
			return err
		}
		return fmt.Errorf("kbbehavior reorder templates: %w", err)
	}
	return s.Refresh(ctx)
}

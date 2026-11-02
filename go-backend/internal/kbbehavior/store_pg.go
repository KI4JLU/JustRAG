package kbbehavior

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

// Settings is a KB's behavior as the settings read it.
type Settings struct {
	Behavior Behavior `json:"behavior"`
	// Customized is false while the KB still answers from its pre-roles
	// system prompt (behavior IS NULL).
	Customized bool `json:"customized"`
	// Language is the prompt language the KB's prompt is compiled in, and so
	// the language to read the catalog in for a faithful preview.
	Language string `json:"language"`
}

// Store reads and writes knowledge_bases.behavior.
type Store struct {
	q pgxutil.Querier
}

// NewStore creates a Store over q (the main pool).
func NewStore(q pgxutil.Querier) *Store { return &Store{q: q} }

// Decode parses a stored behavior column (nil for SQL NULL or JSON null).
func Decode(raw []byte) (*Behavior, error) {
	if len(raw) == 0 || string(raw) == "null" {
		return nil, nil
	}
	var b Behavior
	if err := json.Unmarshal(raw, &b); err != nil {
		return nil, fmt.Errorf("kbbehavior: decode behavior: %w", err)
	}
	return &b, nil
}

// decode parses a behavior column; nil for SQL NULL. A value that does not
// parse is logged and read as NULL, so a damaged row answers like an
// uncustomized KB instead of failing every turn.
func decode(ctx context.Context, kbID string, raw []byte) *Behavior {
	b, err := Decode(raw)
	if err != nil {
		logctx.From(ctx).Error("kbbehavior: unreadable behavior; using the legacy prompt",
			"kb_id", kbID, "error", err)
		return nil
	}
	return b
}

// Load returns the KB's settings; store.ErrNotFound when the KB does not exist.
func (s *Store) Load(ctx context.Context, kbID string) (Settings, error) {
	var (
		sp       *string
		raw      []byte
		language string
		name     string
	)
	err := s.q.QueryRow(ctx,
		`SELECT system_prompt, behavior, language, name FROM knowledge_bases WHERE id = $1`, kbID,
	).Scan(&sp, &raw, &language, &name)
	if errors.Is(err, pgx.ErrNoRows) {
		return Settings{}, fmt.Errorf("kbbehavior load kb=%s: %w", kbID, store.ErrNotFound)
	}
	if err != nil {
		return Settings{}, fmt.Errorf("kbbehavior load: %w", err)
	}
	lang := Lang(language)
	stored := decode(ctx, kbID, raw)
	return Settings{Behavior: Effective(stored, sp, name, lang), Customized: stored != nil, Language: lang}, nil
}

// Save writes a validated Behavior: the behavior column plus system_prompt as
// the storage of the legacy role's prompt (ForStorage). updated_at is left
// alone, as PATCH /api/kb/{id} leaves it.
func (s *Store) Save(ctx context.Context, kbID string, b Behavior) error {
	stored, legacyPrompt := ForStorage(b)
	raw, err := json.Marshal(stored)
	if err != nil {
		return fmt.Errorf("kbbehavior save: encode: %w", err)
	}
	tag, err := s.q.Exec(ctx,
		`UPDATE knowledge_bases SET behavior = $2, system_prompt = $3 WHERE id = $1`,
		kbID, raw, legacyPrompt)
	if err != nil {
		return fmt.Errorf("kbbehavior save: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return fmt.Errorf("kbbehavior save kb=%s: %w", kbID, store.ErrNotFound)
	}
	return nil
}

// SystemPrompt is the KB part of the answer prompt — the one reader every
// answer surface goes through (chat.Store, kb.PGStore and through it the
// public API, OpenAI-compat, /owui, MCP, the agent chat and eval). chatID
// names the chat whose role applies ("" = the KB's active role); a chat of
// another KB, a chat without a role and a role the KB no longer has all fall
// back to the active role. Returns nil when the KB does not exist or the
// compiled prompt is empty — callers treat both as "no KB prompt", as they
// treated a NULL system_prompt.
func SystemPrompt(ctx context.Context, q pgxutil.Querier, kbID, chatID string) (*string, error) {
	var (
		sp       *string
		raw      []byte
		language string
		roleID   *string
	)
	err := q.QueryRow(ctx, `
		SELECT kb.system_prompt, kb.behavior, kb.language,
		       (SELECT c.role_id FROM chats c WHERE c.id = NULLIF($2, '')::uuid AND c.kb_id = kb.id)
		FROM knowledge_bases kb WHERE kb.id = $1`, kbID, chatID,
	).Scan(&sp, &raw, &language, &roleID)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("kbbehavior system prompt: %w", err)
	}
	stored := decode(ctx, kbID, raw)
	rid := ""
	if roleID != nil {
		rid = *roleID
	}
	if stored == nil && (rid == "" || rid == LegacyRoleID) {
		// Never customized and no other role asked for: the pre-roles
		// prompt, untouched. A chat started in a template role compiles
		// that role from the default behavior below.
		return sp, nil
	}
	lang := Lang(language)
	prompt, found := Compile(Effective(stored, sp, "", lang), rid, lang)
	if !found {
		logctx.From(ctx).Info("kbbehavior: chat role no longer exists; using the active role",
			"kb_id", kbID, "chat_id", chatID, "role_id", rid)
	}
	if prompt == "" {
		return nil, nil
	}
	return &prompt, nil
}

// HasRole reports whether the KB can answer in roleID (a catalog template or
// one of its own roles). False for a KB that does not exist.
func HasRole(ctx context.Context, q pgxutil.Querier, kbID, roleID string) (bool, error) {
	if _, ok := findTemplateRole(roleID); ok {
		var exists bool
		if err := q.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM knowledge_bases WHERE id = $1)`, kbID).Scan(&exists); err != nil {
			return false, fmt.Errorf("kbbehavior has role: %w", err)
		}
		return exists, nil
	}
	var (
		sp  *string
		raw []byte
	)
	err := q.QueryRow(ctx, `SELECT system_prompt, behavior FROM knowledge_bases WHERE id = $1`, kbID).Scan(&sp, &raw)
	if errors.Is(err, pgx.ErrNoRows) {
		return false, nil
	}
	if err != nil {
		return false, fmt.Errorf("kbbehavior has role: %w", err)
	}
	return Effective(decode(ctx, kbID, raw), sp, "", "de").HasRole(roleID), nil
}

// RoleBrief is what a role says about itself: its name, description and
// role prompt (without the rules).
type RoleBrief struct {
	Name        string
	Description string
	Prompt      string
}

// Brief returns roleID's brief in eff; "" or a role eff does not have is the
// active role.
func Brief(eff Behavior, roleID, lang string) RoleBrief {
	if roleID == "" || !eff.HasRole(roleID) {
		roleID = eff.ActiveRoleID
	}
	if t, ok := findTemplateRole(roleID); ok {
		return RoleBrief{Name: t.name.in(lang), Description: t.description.in(lang), Prompt: t.prompt.in(lang)}
	}
	for _, r := range eff.CustomRoles {
		if r.ID == roleID {
			return RoleBrief{Name: r.Name, Description: r.Description, Prompt: r.Prompt}
		}
	}
	return RoleBrief{}
}

// StarterRole reads the brief of the role a new chat in kbID starts in —
// roleID, or the active role for "" or a role the KB no longer has — for the
// starter questions. Zero for a KB that does not exist.
func StarterRole(ctx context.Context, q pgxutil.Querier, kbID, roleID string) (RoleBrief, error) {
	var (
		sp       *string
		raw      []byte
		language string
		name     string
	)
	err := q.QueryRow(ctx, `SELECT system_prompt, behavior, language, name FROM knowledge_bases WHERE id = $1`, kbID).
		Scan(&sp, &raw, &language, &name)
	if errors.Is(err, pgx.ErrNoRows) {
		return RoleBrief{}, nil
	}
	if err != nil {
		return RoleBrief{}, fmt.Errorf("kbbehavior starter role: %w", err)
	}
	lang := Lang(language)
	return Brief(Effective(decode(ctx, kbID, raw), sp, name, lang), roleID, lang), nil
}

// DefaultJSON is the behavior column of a new KB created without a system
// prompt of its own (Default).
func DefaultJSON() ([]byte, error) {
	raw, err := json.Marshal(Default())
	if err != nil {
		return nil, fmt.Errorf("kbbehavior: encode default: %w", err)
	}
	return raw, nil
}

// legacyRolesSQL is the stored customRoles array with the legacy role in it
// (added as its bare id, the stored form, when missing).
const legacyRolesSQL = `CASE
		WHEN jsonb_typeof(behavior->'customRoles') <> 'array' OR behavior->'customRoles' IS NULL
			THEN '[{"id":"legacy"}]'::jsonb
		WHEN behavior->'customRoles' @> '[{"id":"legacy"}]'::jsonb
			THEN behavior->'customRoles'
		ELSE behavior->'customRoles' || '[{"id":"legacy"}]'::jsonb
	END`

// ActivateLegacyOnPromptChangeSQL is a SET fragment for an UPDATE of
// knowledge_bases that also writes system_prompt (PATCH /api/kb/{id}, the
// global-KB editor): when the prompt changes on a customized KB, the legacy
// role, whose prompt system_prompt stores, becomes the active role, so the
// prompt just written is the one the KB answers with. An unchanged prompt —
// the global-KB editor sends it with every save — leaves the behavior alone,
// and a KB never customized needs nothing. Its one %d verb takes the new
// prompt's placeholder (pgxutil.ClauseBuilder.Add).
const ActivateLegacyOnPromptChangeSQL = `behavior = CASE
	WHEN behavior IS NULL OR system_prompt IS NOT DISTINCT FROM $%d::text THEN behavior
	ELSE jsonb_set(jsonb_set(behavior, '{customRoles}', ` + legacyRolesSQL + `), '{activeRoleId}', '"legacy"')
END`

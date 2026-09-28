package search

import (
	"context"
	"fmt"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/justrag/go-backend/internal/auth"
	"github.com/justrag/go-backend/internal/kbaccess"
	"github.com/justrag/go-backend/internal/pgxutil"
)

// descriptionSnippetLen is the length, in characters, of TopicHit.Description.
const descriptionSnippetLen = 160

// visibleKBsCTE is the one SQL answer to "which topics can this caller open,
// and with which role". It mirrors kbaccess.EffectiveRole rule for rule and
// in the same order — the order is load-bearing, exactly as it is there (an
// explicit membership beats the implicit roles a public KB grants, otherwise
// an editor on a public KB would be demoted to view):
//
//  1. system role superadmin            -> owner
//  2. a kb_members row with a valid role -> that role
//  3. public and system role admin       -> admin
//  4. public and published               -> view
//  5. otherwise                          -> NULL (invisible)
//
// Parameters: $1 caller user id, $2 caller system role (from the auth claims,
// as RequireKBRole passes it), $3 scoping kb id or NULL for all KBs.
//
// Details that keep the mirror exact:
//   - "public" is visibility = 'public', the same expression
//     kbaccess.PGStore.GetKBByID aliases to IsGlobal.
//   - Rule 2 tests the role against the four KB roles rather than IS NOT
//     NULL, because EffectiveRole tests kbaccess.Valid(memberRole). The
//     kb_members CHECK constraint makes the two equivalent today; the IN list
//     keeps them equivalent if the constraint ever widens.
//   - kb_members' primary key (kb_id, user_id) guarantees the LEFT JOIN adds
//     at most one row per KB, so the CTE never duplicates a topic.
//   - Every role and system-role literal is spliced in from the Go
//     constants, so a renamed role is a compile-time change here too, not a
//     silent drift.
//
// The CTE deliberately does NOT filter on role: consumers add
// `WHERE v.role IS NOT NULL`. That way a scoped lookup can distinguish "no
// such KB" from "KB exists but is invisible" internally, even though both end
// in the same 404.
//
// Superadmins and system admins see a lot through this predicate (every KB,
// and every public KB, respectively). That is correct — it is what
// EffectiveRole grants them on every other route — and must not be "fixed"
// here in isolation.
const visibleKBsCTE = `
	visible_kbs AS (
		SELECT kb.id, kb.name, kb.description, kb.header_text, kb.visibility,
		       CASE
		         WHEN $2 = '` + auth.RoleSuperAdmin + `' THEN '` + kbaccess.RoleOwner + `'
		         WHEN m.role IN ('` + kbaccess.RoleView + `', '` + kbaccess.RoleEdit + `', '` +
	kbaccess.RoleAdmin + `', '` + kbaccess.RoleOwner + `') THEN m.role
		         WHEN kb.visibility = 'public' AND $2 = '` + auth.RoleAdmin + `' THEN '` + kbaccess.RoleAdmin + `'
		         WHEN kb.visibility = 'public' AND kb.is_published THEN '` + kbaccess.RoleView + `'
		       END AS role
		FROM knowledge_bases kb
		LEFT JOIN kb_members m ON m.kb_id = kb.id AND m.user_id = $1::uuid
		WHERE ($3::uuid IS NULL OR kb.id = $3::uuid)
	)`

// scopeSQL resolves the caller's role on the scoping KB. No row: the KB does
// not exist. A row with a NULL role: it exists but is invisible.
const scopeSQL = `WITH ` + visibleKBsCTE + `
	SELECT v.role FROM visible_kbs v`

// topicsSQL matches name, description and header_text — the same three
// columns GET /api/kb/catalog searches, for the same reason: description has
// no editor in the UI, so a search that skipped header_text would look
// broken. Parameters $4 (substring pattern) and $5 (prefix pattern) are
// already LIKE-escaped by pgxutil.EscapeLike.
//
// Order: name starts with q, then name contains q, then description-only
// hits; ties by case-folded name, then id so paging and tests are stable.
const topicsSQL = `WITH ` + visibleKBsCTE + `
	SELECT v.id::text AS id, v.name, v.visibility, v.role,
	       CASE
	         WHEN d.snip IS NULL THEN NULL
	         WHEN char_length(d.snip) > $7 THEN left(d.snip, $7 - 1) || '…'
	         ELSE d.snip
	       END AS description
	FROM visible_kbs v
	CROSS JOIN LATERAL (
		SELECT NULLIF(btrim(regexp_replace(
		         COALESCE(NULLIF(btrim(v.description), ''), NULLIF(btrim(v.header_text), ''), ''),
		         '\s+', ' ', 'g')), '') AS snip
	) d
	WHERE v.role IS NOT NULL
	  AND (v.name ILIKE $4 ESCAPE '\'
	       OR COALESCE(v.description, '') ILIKE $4 ESCAPE '\'
	       OR COALESCE(v.header_text, '') ILIKE $4 ESCAPE '\')
	ORDER BY (v.name ILIKE $5 ESCAPE '\') DESC,
	         (v.name ILIKE $4 ESCAPE '\') DESC,
	         lower(v.name), v.id
	LIMIT $6`

// sourcesSQL matches files by name in every visible KB.
//
// TODO: measure on a realistic files table. files has only a btree index on
// kb_id, so name ILIKE '%q%' is a filtered scan over every file of every
// visible KB — for a superadmin that is the whole table. A pg_trgm GIN index
// is the standard fix, but pg_trgm is not used anywhere yet and CREATE
// EXTENSION needs a privilege we have not confirmed. Deliberately not added
// on KI-835.
const sourcesSQL = `WITH ` + visibleKBsCTE + `
	SELECT f.id::text AS id, f.name, f.type, v.id::text AS kb_id, v.name AS kb_name
	FROM files f
	JOIN visible_kbs v ON v.id = f.kb_id
	WHERE v.role IS NOT NULL
	  AND f.name ILIKE $4 ESCAPE '\'
	ORDER BY (f.name ILIKE $5 ESCAPE '\') DESC, lower(f.name), f.id
	LIMIT $6`

// PGStore is the Postgres-backed Store.
type PGStore struct {
	pool *pgxpool.Pool
}

// NewStore creates a PGStore over the main database pool.
func NewStore(pool *pgxpool.Pool) *PGStore {
	return &PGStore{pool: pool}
}

// Compile-time interface assertion.
var _ Store = (*PGStore)(nil)

type scopeRow struct {
	Role *string `db:"role"`
}

// Search implements Store. The store trusts q to be validated (see Query);
// it only guards Limit against a non-positive value, because LIMIT 0 would
// silently return nothing.
func (s *PGStore) Search(ctx context.Context, caller Caller, q Query) (*Response, error) {
	limit := q.Limit
	if limit <= 0 {
		limit = DefaultLimit
	}

	// nil, not "", so $3::uuid IS NULL selects every KB.
	var kbID any
	if q.KBID != "" {
		kbID = q.KBID
		scope, err := pgxutil.QueryOne[scopeRow](ctx, s.pool, scopeSQL, caller.UserID, caller.SysRole, kbID)
		if err != nil {
			return nil, fmt.Errorf("search scope: %w", err)
		}
		if scope == nil || scope.Role == nil {
			return nil, ErrNotFound
		}
	}

	escaped := pgxutil.EscapeLike(q.Text)
	contains := "%" + escaped + "%"
	prefix := escaped + "%"

	topics, err := pgxutil.QueryRows[TopicHit](ctx, s.pool, topicsSQL,
		caller.UserID, caller.SysRole, kbID, contains, prefix, limit, descriptionSnippetLen)
	if err != nil {
		return nil, fmt.Errorf("search topics: %w", err)
	}
	sources, err := pgxutil.QueryRows[SourceHit](ctx, s.pool, sourcesSQL,
		caller.UserID, caller.SysRole, kbID, contains, prefix, limit)
	if err != nil {
		return nil, fmt.Errorf("search sources: %w", err)
	}

	resp := &Response{Query: q.Text, Topics: topics, Sources: sources}
	if q.KBID != "" {
		id := q.KBID
		resp.KBID = &id
	}
	return resp, nil
}

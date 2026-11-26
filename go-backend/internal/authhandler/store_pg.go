package authhandler

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/justrag/go-backend/internal/adminproviders"
	"github.com/justrag/go-backend/internal/pgxutil"
	"github.com/justrag/go-backend/internal/users"
)

// PGStore is a PostgreSQL-backed implementation of authhandler.Store.
type PGStore struct {
	pool *pgxpool.Pool
}

// NewStore creates a new PGStore backed by pool.
func NewStore(pool *pgxpool.Pool) *PGStore {
	return &PGStore{pool: pool}
}

// Compile-time interface assertions. Asserting OIDCStore too means a future
// signature drift on any OIDC method fails the build here, rather than silently
// flipping the runtime h.store.(OIDCStore) assertion to ok=false and disabling
// all OIDC login.
var (
	_ Store     = (*PGStore)(nil)
	_ OIDCStore = (*PGStore)(nil)
)

// ---------------------------------------------------------------------------
// User operations
// ---------------------------------------------------------------------------

const userSelectSQL = `SELECT id, username, password_hash, auth_method, first_name, last_name, email, role, external_id, created_at FROM users`

// userDBRow is an internal struct with db tags for scanning user rows.
type userDBRow struct {
	ID           string    `db:"id"`
	Username     string    `db:"username"`
	PasswordHash string    `db:"password_hash"`
	AuthMethod   string    `db:"auth_method"`
	FirstName    *string   `db:"first_name"`
	LastName     *string   `db:"last_name"`
	Email        *string   `db:"email"`
	Role         string    `db:"role"`
	ExternalID   *string   `db:"external_id"`
	CreatedAt    time.Time `db:"created_at"`
}

func toUserRow(r userDBRow) *users.UserRow {
	return &users.UserRow{
		ID:           r.ID,
		Username:     r.Username,
		PasswordHash: r.PasswordHash,
		AuthMethod:   r.AuthMethod,
		FirstName:    r.FirstName,
		LastName:     r.LastName,
		Email:        r.Email,
		Role:         r.Role,
		ExternalID:   r.ExternalID,
		CreatedAt:    r.CreatedAt,
	}
}

// GetUserByUsername returns the user with the given username, or nil if not found.
func (s *PGStore) GetUserByUsername(ctx context.Context, username string) (*users.UserRow, error) {
	row, err := pgxutil.QueryOne[userDBRow](ctx, s.pool, userSelectSQL+` WHERE username = $1`, username)
	if err != nil {
		return nil, err
	}
	if row == nil {
		return nil, nil
	}
	return toUserRow(*row), nil
}

// CreateUser inserts a new user and returns the stored row.
func (s *PGStore) CreateUser(ctx context.Context, data users.UserCreate) (*users.UserRow, error) {
	const sql = `
		INSERT INTO users (username, password_hash, auth_method, first_name, last_name, email, role, external_id)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
		RETURNING id, username, password_hash, auth_method, first_name, last_name, email, role, external_id, created_at`

	row, err := pgxutil.QueryOne[userDBRow](ctx, s.pool, sql,
		data.Username, data.PasswordHash, data.AuthMethod,
		data.FirstName, data.LastName, data.Email, data.Role, data.ExternalID)
	if err != nil {
		return nil, err
	}
	if row == nil {
		return nil, fmt.Errorf("CreateUser: no row returned")
	}
	return toUserRow(*row), nil
}

// ---------------------------------------------------------------------------
// OIDC-specific lookups
// ---------------------------------------------------------------------------

// GetActiveOIDCProvider returns the single active OIDC auth_providers row, or
// nil if no active OIDC provider is configured. The single-active invariant is
// enforced by the adminproviders handler at write time.
func (s *PGStore) GetActiveOIDCProvider(ctx context.Context) (*adminproviders.AuthProviderRow, error) {
	const sql = `SELECT ` + authProviderSelectCols + ` FROM auth_providers
	             WHERE is_active = true AND type = $1
	             ORDER BY created_at DESC LIMIT 1`
	rows, err := pgxutil.QueryRows[authProviderDBRow](ctx, s.pool, sql, OIDCProviderType)
	if err != nil {
		return nil, err
	}
	if len(rows) == 0 {
		return nil, nil
	}
	r := toAuthProviderRow(rows[0])
	return &r, nil
}

// GetUserByExternalID returns the user whose external_id matches the given
// OIDC `sub`. Used as the first lookup on every OIDC login after the user
// has been linked or auto-provisioned.
func (s *PGStore) GetUserByExternalID(ctx context.Context, externalID string) (*users.UserRow, error) {
	row, err := pgxutil.QueryOne[userDBRow](ctx, s.pool, userSelectSQL+` WHERE external_id = $1`, externalID)
	if err != nil {
		return nil, err
	}
	if row == nil {
		return nil, nil
	}
	return toUserRow(*row), nil
}

// GetUsersByUsername returns every user row whose username matches
// case-insensitively. Used by the OIDC LDAP→OIDC link branch: usernames are
// stable across an employee's lifecycle (emails are not), so the IdP admin
// asked us to key the link on `preferred_username` instead of email.
//
// users.username carries a unique constraint, but it is case-sensitive in
// Postgres, so legacy mixed-case dupes ("JDoe" vs "jdoe") are possible —
// the caller fails closed if >1 rows come back.
func (s *PGStore) GetUsersByUsername(ctx context.Context, username string) ([]*users.UserRow, error) {
	rows, err := pgxutil.QueryRows[userDBRow](ctx, s.pool, userSelectSQL+` WHERE LOWER(username) = LOWER($1)`, username)
	if err != nil {
		return nil, err
	}
	out := make([]*users.UserRow, len(rows))
	for i := range rows {
		out[i] = toUserRow(rows[i])
	}
	return out, nil
}

// LinkUserExternalID stamps an existing user row with an OIDC `sub` and flips
// its auth_method to 'oidc'. Used for the LDAP→OIDC migration link step.
// Returns the updated row, or (nil, nil) when the row does not exist or is
// not linkable (already linked, local account, admin/superadmin role).
func (s *PGStore) LinkUserExternalID(ctx context.Context, userID, externalID string) (*users.UserRow, error) {
	// The WHERE clause is the gate (oidcLinkRefusal only names the reason):
	// an unlinked ldap/oidc row with a non-privileged role, checked in the
	// same statement that writes, so a row changed since the lookup is not
	// linked either.
	const sql = `UPDATE users SET external_id = $2, auth_method = 'oidc'
	             WHERE id = $1
	               AND external_id IS NULL
	               AND auth_method IN ('ldap', 'oidc')
	               AND role IN ('user', 'api-user')
	             RETURNING id, username, password_hash, auth_method, first_name, last_name, email, role, external_id, created_at`
	row, err := pgxutil.QueryOne[userDBRow](ctx, s.pool, sql, userID, externalID)
	if err != nil {
		return nil, err
	}
	if row == nil {
		return nil, nil
	}
	return toUserRow(*row), nil
}

// ---------------------------------------------------------------------------
// Auth providers
// ---------------------------------------------------------------------------

// authProviderDBRow is an internal struct with db tags for scanning auth_providers rows.
type authProviderDBRow struct {
	ID        string          `db:"id"`
	Type      string          `db:"type"`
	Name      string          `db:"name"`
	Config    json.RawMessage `db:"config"`
	IsActive  bool            `db:"is_active"`
	CreatedAt time.Time       `db:"created_at"`
}

func toAuthProviderRow(r authProviderDBRow) adminproviders.AuthProviderRow {
	return adminproviders.AuthProviderRow{
		ID:        r.ID,
		Type:      r.Type,
		Name:      r.Name,
		Config:    r.Config,
		IsActive:  r.IsActive,
		CreatedAt: r.CreatedAt,
	}
}

const authProviderSelectCols = `id, type, name, config, is_active, created_at`

// ApplyPendingInvites promotes any pending_kb_invites matching this username
// into real kb_members rows for userID and any glossary_pending_invites into
// glossary_members rows (migration 0109), deleting the promoted invites. Each
// kind is ONE statement (a data-modifying CTE), so it fires exactly once per
// invite; the two kinds are two statements, not one transaction. Best-effort:
// the glossary statement is attempted even when the KB statement failed, and a
// failure of either is returned, both joined when both failed (the caller logs
// it and lets the login go on). Idempotent: a re-run finds nothing to move.
// Called on every successful login, whatever the method — local password,
// LDAP (authhandler.respondWithToken) and OIDC (oidc.go) — since the username
// lookup is indexed and empty in the common case.
// The owner row wins: DO UPDATE skips rows that already carry ownership, so a
// pending invite (view/edit/admin only — kbaccess.Assignable) can never
// demote an owner.
func (s *PGStore) ApplyPendingInvites(ctx context.Context, userID, username string) error {
	return applyPendingInvites(ctx, s.pool, userID, username)
}

// pendingInviteExec is the one pool method the invite statements use.
type pendingInviteExec interface {
	Exec(ctx context.Context, sql string, args ...any) (pgconn.CommandTag, error)
}

func applyPendingInvites(ctx context.Context, db pendingInviteExec, userID, username string) error {
	_, kbErr := db.Exec(ctx, `
		WITH moved AS (
			DELETE FROM pending_kb_invites
			WHERE LOWER(username) = LOWER($2)
			RETURNING kb_id, role
		)
		INSERT INTO kb_members (kb_id, user_id, role)
		SELECT kb_id, $1, role FROM moved
		ON CONFLICT (kb_id, user_id) DO UPDATE
		    SET role = EXCLUDED.role
		    WHERE kb_members.role <> 'owner'`,
		userID, username)
	if kbErr != nil {
		kbErr = fmt.Errorf("apply pending kb invites: %w", kbErr)
	}
	// The same for glossary invites: the username was stored lower-cased, a
	// role is never owner (the table's CHECK). Attempted whatever became of
	// the KB statement.
	_, glossaryErr := db.Exec(ctx, `
		WITH moved AS (
			DELETE FROM glossary_pending_invites
			WHERE username = LOWER($2)
			RETURNING glossary_id, role
		)
		INSERT INTO glossary_members (glossary_id, user_id, role)
		SELECT glossary_id, $1, role FROM moved
		ON CONFLICT (glossary_id, user_id) DO UPDATE
		    SET role = EXCLUDED.role
		    WHERE glossary_members.role <> 'owner'`,
		userID, username)
	if glossaryErr != nil {
		glossaryErr = fmt.Errorf("apply pending glossary invites: %w", glossaryErr)
	}
	return errors.Join(kbErr, glossaryErr)
}

// GetActiveAuthProviders returns all active auth provider rows ordered by created_at DESC.
func (s *PGStore) GetActiveAuthProviders(ctx context.Context) ([]adminproviders.AuthProviderRow, error) {
	const sql = `SELECT ` + authProviderSelectCols + ` FROM auth_providers WHERE is_active = true ORDER BY created_at DESC`

	rows, err := pgxutil.QueryRows[authProviderDBRow](ctx, s.pool, sql)
	if err != nil {
		return nil, err
	}

	result := make([]adminproviders.AuthProviderRow, len(rows))
	for i, r := range rows {
		result[i] = toAuthProviderRow(r)
	}
	return result, nil
}

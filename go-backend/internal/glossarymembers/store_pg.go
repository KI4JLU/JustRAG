// Package glossarymembers is the sharing layer of translator glossaries:
// members with the four glossary roles, adding people by username (known
// accounts at once, unknown ones as pending invites applied at their first
// login), invite links, ownership transfer and leaving. It is the glossary
// counterpart of internal/kbmembers and internal/kbinvites and follows them
// route for route.
//
// The owner invariants (an owner row is never assigned, demoted or removed
// outside the explicit transfer) are enforced in SQL, not only in Go, so a
// second caller cannot bypass them by calling the store directly.
package glossarymembers

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/justrag/go-backend/internal/glossaryaccess"
	"github.com/justrag/go-backend/internal/pgxutil"
)

// Sentinel errors, mapped to HTTP status codes by the handlers.
var (
	// ErrNotFound: the target row (member, pending invite, link) does not exist.
	ErrNotFound = errors.New("glossarymembers: not found")
	// ErrOwnerImmutable: the change would assign, demote or remove an owner
	// outside the explicit transfer.
	ErrOwnerImmutable = errors.New("glossarymembers: owner role is immutable outside transfer")
	// ErrNotOwner: the user acting on the glossary's ownership no longer holds
	// the owner row (a concurrent transfer moved it first).
	ErrNotOwner = errors.New("glossarymembers: acting user is not the owner")
	// ErrRevoked: the invite link was revoked.
	ErrRevoked = errors.New("glossarymembers: invite link revoked")
)

// Member is one row of a glossary's member list, joined with display identity.
type Member struct {
	UserID    string    `json:"userId"    db:"user_id"`
	Username  string    `json:"username"  db:"username"`
	FirstName *string   `json:"firstName" db:"first_name"`
	LastName  *string   `json:"lastName"  db:"last_name"`
	Role      string    `json:"role"      db:"role"`
	CreatedAt time.Time `json:"createdAt" db:"created_at"`
}

// PendingInvite is an invite for a username that has no account yet.
type PendingInvite struct {
	Username  string    `json:"username"  db:"username"`
	Role      string    `json:"role"      db:"role"`
	CreatedAt time.Time `json:"createdAt" db:"created_at"`
}

// Link is an invite link as the admin list shows it.
type Link struct {
	ID              string     `json:"id"              db:"id"`
	GlossaryID      string     `json:"glossaryId"      db:"glossary_id"`
	Token           string     `json:"token"           db:"token"`
	Role            string     `json:"role"            db:"role"`
	Label           *string    `json:"label"           db:"label"`
	CreatedByName   *string    `json:"createdByName"   db:"created_by_name"`
	CreatedAt       time.Time  `json:"createdAt"       db:"created_at"`
	RedemptionCount int        `json:"redemptionCount" db:"redemption_count"`
	LastUsedAt      *time.Time `json:"lastUsedAt"      db:"last_used_at"`
}

// LinkTarget is what a token resolves to for one caller, revoked or not: the
// link, its glossary and the caller's own standing on it.
type LinkTarget struct {
	LinkID       string
	GlossaryID   string
	GlossaryName string
	Description  string
	Visibility   string
	LinkRole     string
	Revoked      bool
	// MemberRole is the caller's glossary_members role, "" for none.
	MemberRole string
}

// RedeemResult describes the outcome of redeeming a token. Role is the
// caller's role after redeeming: the link's role for a new member, the
// unchanged existing role for someone who already was one.
type RedeemResult struct {
	LinkID        string `json:"linkId"`
	GlossaryID    string `json:"glossaryId"`
	GlossaryName  string `json:"glossaryName"`
	Role          string `json:"role"`
	AlreadyMember bool   `json:"alreadyMember"`
}

// Store is the sharing data layer. PGStore is its only implementation.
type Store interface {
	ListMembers(ctx context.Context, glossaryID string) ([]Member, error)
	GetRole(ctx context.Context, glossaryID, userID string) (string, error)
	SetRole(ctx context.Context, glossaryID, userID, role, grantedBy string) error
	AddMember(ctx context.Context, glossaryID, userID, role, grantedBy string) (added bool, err error)
	RemoveMember(ctx context.Context, glossaryID, userID string) error
	TransferOwner(ctx context.Context, glossaryID, actingUserID, newOwnerID string) error
	Leave(ctx context.Context, glossaryID, userID string) error

	UserIDByUsername(ctx context.Context, username string) (userID string, found bool, err error)
	UpsertPendingInvite(ctx context.Context, glossaryID, username, role, invitedBy string) error
	ListPendingInvites(ctx context.Context, glossaryID string) ([]PendingInvite, error)
	RemovePendingInvite(ctx context.Context, glossaryID, username string) error

	CreateLink(ctx context.Context, glossaryID, token, role string, label *string, createdBy string) (Link, error)
	ListLinks(ctx context.Context, glossaryID string) ([]Link, error)
	RevokeLink(ctx context.Context, glossaryID, linkID string) error
	ResolveLink(ctx context.Context, token, userID string) (LinkTarget, error)
	RedeemLink(ctx context.Context, token, userID string) (RedeemResult, error)
}

// PGStore is the Postgres-backed Store.
type PGStore struct{ pool *pgxpool.Pool }

// NewStore creates a PGStore over the main pool.
func NewStore(pool *pgxpool.Pool) *PGStore { return &PGStore{pool: pool} }

var _ Store = (*PGStore)(nil)

// ListMembers returns every member with display names, strongest role first.
func (s *PGStore) ListMembers(ctx context.Context, glossaryID string) ([]Member, error) {
	const sql = `
		SELECT m.user_id::text AS user_id, u.username, u.first_name, u.last_name, m.role, m.created_at
		FROM glossary_members m
		JOIN users u ON u.id = m.user_id
		WHERE m.glossary_id = $1::uuid
		ORDER BY CASE m.role
		             WHEN 'owner' THEN 0 WHEN 'admin' THEN 1
		             WHEN 'editor' THEN 2 ELSE 3 END,
		         u.username`
	return pgxutil.QueryRows[Member](ctx, s.pool, sql, glossaryID)
}

// GetRole returns the glossary_members role of userID, or ErrNotFound.
func (s *PGStore) GetRole(ctx context.Context, glossaryID, userID string) (string, error) {
	var role string
	err := s.pool.QueryRow(ctx,
		`SELECT role FROM glossary_members WHERE glossary_id = $1::uuid AND user_id = $2::uuid`,
		glossaryID, userID).Scan(&role)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", ErrNotFound
	}
	if err != nil {
		return "", fmt.Errorf("GetRole: %w", err)
	}
	return role, nil
}

// SetRole grants or changes a non-owner role. The WHERE clause carries both
// invariants: the role must be assignable and an existing owner row is never
// touched.
func (s *PGStore) SetRole(ctx context.Context, glossaryID, userID, role, grantedBy string) error {
	if !glossaryaccess.Assignable(role) {
		return ErrOwnerImmutable
	}
	tag, err := s.pool.Exec(ctx, `
		INSERT INTO glossary_members (glossary_id, user_id, role, created_by)
		VALUES ($1::uuid, $2::uuid, $3, NULLIF($4, '')::uuid)
		ON CONFLICT (glossary_id, user_id) DO UPDATE
		    SET role = EXCLUDED.role
		    WHERE glossary_members.role <> 'owner'`,
		glossaryID, userID, role, grantedBy)
	if err != nil {
		return fmt.Errorf("SetRole: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return ErrOwnerImmutable
	}
	return nil
}

// AddMember adds userID with role unless they already are a member, in which
// case nothing changes and added is false. Bulk add uses it: an existing
// member is reported, never re-roled.
func (s *PGStore) AddMember(ctx context.Context, glossaryID, userID, role, grantedBy string) (bool, error) {
	if !glossaryaccess.Assignable(role) {
		return false, ErrOwnerImmutable
	}
	tag, err := s.pool.Exec(ctx, `
		INSERT INTO glossary_members (glossary_id, user_id, role, created_by)
		VALUES ($1::uuid, $2::uuid, $3, NULLIF($4, '')::uuid)
		ON CONFLICT (glossary_id, user_id) DO NOTHING`,
		glossaryID, userID, role, grantedBy)
	if err != nil {
		return false, fmt.Errorf("AddMember: %w", err)
	}
	return tag.RowsAffected() == 1, nil
}

// RemoveMember revokes someone's role. The owner row is never removed here.
func (s *PGStore) RemoveMember(ctx context.Context, glossaryID, userID string) error {
	return s.deleteMember(ctx, glossaryID, userID, "RemoveMember")
}

// Leave removes the caller's own membership. The owner cannot leave: they
// transfer ownership or delete the glossary.
func (s *PGStore) Leave(ctx context.Context, glossaryID, userID string) error {
	return s.deleteMember(ctx, glossaryID, userID, "Leave")
}

func (s *PGStore) deleteMember(ctx context.Context, glossaryID, userID, op string) error {
	tag, err := s.pool.Exec(ctx,
		`DELETE FROM glossary_members
		 WHERE glossary_id = $1::uuid AND user_id = $2::uuid AND role <> 'owner'`,
		glossaryID, userID)
	if err != nil {
		return fmt.Errorf("%s: %w", op, err)
	}
	if tag.RowsAffected() > 0 {
		return nil
	}
	// Either there was no row or it was the owner row; a follow-up read tells
	// the two apart for a usable error.
	var role string
	err = s.pool.QueryRow(ctx,
		`SELECT role FROM glossary_members WHERE glossary_id = $1::uuid AND user_id = $2::uuid`,
		glossaryID, userID).Scan(&role)
	if errors.Is(err, pgx.ErrNoRows) {
		return ErrNotFound
	}
	if err != nil {
		return fmt.Errorf("%s: classify: %w", op, err)
	}
	return ErrOwnerImmutable
}

// TransferOwner moves ownership from actingUserID to newOwnerID in one
// transaction: the acting owner becomes admin (a transfer never silently
// revokes access) and the target, who must already be a member, becomes owner.
//
// The glossary row is locked first, so two transfers of one glossary run one
// after the other, and the demotion only touches a row that still is the acting
// user's owner row: the second of two concurrent transfers by the same owner
// finds it demoted and gets ErrNotOwner instead of demoting the new owner.
// ErrNotFound: the glossary or the target's membership is gone.
func (s *PGStore) TransferOwner(ctx context.Context, glossaryID, actingUserID, newOwnerID string) error {
	return pgxutil.WithTx(ctx, s.pool, func(tx pgx.Tx) error {
		var locked int
		err := tx.QueryRow(ctx,
			`SELECT 1 FROM glossaries WHERE id = $1::uuid FOR UPDATE`, glossaryID).Scan(&locked)
		if errors.Is(err, pgx.ErrNoRows) {
			return ErrNotFound
		}
		if err != nil {
			return fmt.Errorf("TransferOwner: lock glossary: %w", err)
		}
		// The order is mandatory: demote first, or the promotion violates
		// glossary_members_owner_uniq.
		tag, err := tx.Exec(ctx,
			`UPDATE glossary_members SET role = 'admin'
			 WHERE glossary_id = $1::uuid AND user_id = $2::uuid AND role = 'owner'`,
			glossaryID, actingUserID)
		if err != nil {
			return fmt.Errorf("TransferOwner: demote previous owner: %w", err)
		}
		if tag.RowsAffected() == 0 {
			return ErrNotOwner
		}
		tag, err = tx.Exec(ctx,
			`UPDATE glossary_members SET role = 'owner' WHERE glossary_id = $1::uuid AND user_id = $2::uuid`,
			glossaryID, newOwnerID)
		if err != nil {
			return fmt.Errorf("TransferOwner: promote new owner: %w", err)
		}
		if tag.RowsAffected() == 0 {
			return ErrNotFound
		}
		return nil
	})
}

// UserIDByUsername looks an account up case-insensitively.
func (s *PGStore) UserIDByUsername(ctx context.Context, username string) (string, bool, error) {
	var id string
	err := s.pool.QueryRow(ctx,
		`SELECT id::text FROM users WHERE LOWER(username) = LOWER($1)`, username).Scan(&id)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", false, nil
	}
	if err != nil {
		return "", false, fmt.Errorf("UserIDByUsername: %w", err)
	}
	return id, true, nil
}

// UpsertPendingInvite parks an invite for a username without an account; the
// username is stored lower-cased.
func (s *PGStore) UpsertPendingInvite(ctx context.Context, glossaryID, username, role, invitedBy string) error {
	_, err := s.pool.Exec(ctx, `
		INSERT INTO glossary_pending_invites (glossary_id, username, role, invited_by)
		VALUES ($1::uuid, $2, $3, NULLIF($4, '')::uuid)
		ON CONFLICT (glossary_id, username) DO UPDATE SET role = EXCLUDED.role`,
		glossaryID, strings.ToLower(username), role, invitedBy)
	if err != nil {
		return fmt.Errorf("UpsertPendingInvite: %w", err)
	}
	return nil
}

// ListPendingInvites returns the not-yet-applied invites of a glossary.
func (s *PGStore) ListPendingInvites(ctx context.Context, glossaryID string) ([]PendingInvite, error) {
	return pgxutil.QueryRows[PendingInvite](ctx, s.pool,
		`SELECT username, role, created_at FROM glossary_pending_invites
		 WHERE glossary_id = $1::uuid ORDER BY username`, glossaryID)
}

// RemovePendingInvite withdraws a pending invite, ErrNotFound when none exists.
func (s *PGStore) RemovePendingInvite(ctx context.Context, glossaryID, username string) error {
	tag, err := s.pool.Exec(ctx,
		`DELETE FROM glossary_pending_invites WHERE glossary_id = $1::uuid AND username = $2`,
		glossaryID, strings.ToLower(username))
	if err != nil {
		return fmt.Errorf("RemovePendingInvite: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}

const linkSelect = `
	SELECT l.id::text AS id, l.glossary_id::text AS glossary_id, l.token, l.role, l.label,
	       NULLIF(TRIM(COALESCE(u.first_name, '') || ' ' || COALESCE(u.last_name, '')), '') AS created_by_name,
	       l.created_at,
	       (SELECT COUNT(*) FROM glossary_invite_redemptions r WHERE r.link_id = l.id)::int AS redemption_count,
	       l.last_used_at
	FROM glossary_invite_links l
	LEFT JOIN users u ON u.id = l.created_by`

// CreateLink stores a new link and returns it as the list shows it.
func (s *PGStore) CreateLink(ctx context.Context, glossaryID, token, role string, label *string, createdBy string) (Link, error) {
	var id string
	err := s.pool.QueryRow(ctx, `
		INSERT INTO glossary_invite_links (glossary_id, token, role, label, created_by)
		VALUES ($1::uuid, $2, $3, $4, NULLIF($5, '')::uuid)
		RETURNING id::text`, glossaryID, token, role, label, createdBy).Scan(&id)
	if err != nil {
		return Link{}, fmt.Errorf("CreateLink: %w", err)
	}
	link, err := pgxutil.QueryOne[Link](ctx, s.pool, linkSelect+` WHERE l.id = $1::uuid`, id)
	if err != nil {
		return Link{}, fmt.Errorf("CreateLink: read back: %w", err)
	}
	if link == nil {
		return Link{}, ErrNotFound
	}
	return *link, nil
}

// ListLinks returns a glossary's active links, newest first. Revoked links
// leave the list.
func (s *PGStore) ListLinks(ctx context.Context, glossaryID string) ([]Link, error) {
	return pgxutil.QueryRows[Link](ctx, s.pool,
		linkSelect+` WHERE l.glossary_id = $1::uuid AND l.revoked_at IS NULL ORDER BY l.created_at DESC`, glossaryID)
}

// RevokeLink revokes rather than deletes, so the token keeps resolving.
func (s *PGStore) RevokeLink(ctx context.Context, glossaryID, linkID string) error {
	tag, err := s.pool.Exec(ctx, `
		UPDATE glossary_invite_links SET revoked_at = now()
		WHERE id = $1::uuid AND glossary_id = $2::uuid AND revoked_at IS NULL`, linkID, glossaryID)
	if err != nil {
		return fmt.Errorf("RevokeLink: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}

// ResolveLink looks a token up for one caller without changing anything.
func (s *PGStore) ResolveLink(ctx context.Context, token, userID string) (LinkTarget, error) {
	var t LinkTarget
	err := s.pool.QueryRow(ctx, `
		SELECT l.id::text, g.id::text, g.name, g.description, g.visibility, l.role,
		       l.revoked_at IS NOT NULL, COALESCE(m.role, '')
		FROM glossary_invite_links l
		JOIN glossaries g ON g.id = l.glossary_id
		LEFT JOIN glossary_members m ON m.glossary_id = g.id AND m.user_id = $2::uuid
		WHERE l.token = $1`, token, userID).Scan(
		&t.LinkID, &t.GlossaryID, &t.GlossaryName, &t.Description, &t.Visibility, &t.LinkRole,
		&t.Revoked, &t.MemberRole)
	if errors.Is(err, pgx.ErrNoRows) {
		return LinkTarget{}, ErrNotFound
	}
	if err != nil {
		return LinkTarget{}, fmt.Errorf("ResolveLink: %w", err)
	}
	return t, nil
}

// RedeemLink joins userID with the link's role. A link never changes an
// existing membership: someone who already is a member gets AlreadyMember and
// their unchanged role. The counter is the number of distinct people who
// joined through the link.
func (s *PGStore) RedeemLink(ctx context.Context, token, userID string) (RedeemResult, error) {
	var res RedeemResult
	err := pgxutil.WithTx(ctx, s.pool, func(tx pgx.Tx) error {
		var (
			linkRole string
			revoked  bool
		)
		err := tx.QueryRow(ctx, `
			SELECT l.id::text, g.id::text, g.name, l.role, l.revoked_at IS NOT NULL
			FROM glossary_invite_links l
			JOIN glossaries g ON g.id = l.glossary_id
			WHERE l.token = $1`, token).Scan(&res.LinkID, &res.GlossaryID, &res.GlossaryName, &linkRole, &revoked)
		if errors.Is(err, pgx.ErrNoRows) {
			return ErrNotFound
		}
		if err != nil {
			return fmt.Errorf("RedeemLink: lookup token: %w", err)
		}
		if revoked {
			return ErrRevoked
		}
		tag, err := tx.Exec(ctx, `
			INSERT INTO glossary_members (glossary_id, user_id, role, created_by)
			VALUES ($1::uuid, $2::uuid, $3, NULL)
			ON CONFLICT (glossary_id, user_id) DO NOTHING`, res.GlossaryID, userID, linkRole)
		if err != nil {
			return fmt.Errorf("RedeemLink: grant role: %w", err)
		}
		if tag.RowsAffected() == 0 {
			res.AlreadyMember = true
			if err := tx.QueryRow(ctx,
				`SELECT role FROM glossary_members WHERE glossary_id = $1::uuid AND user_id = $2::uuid`,
				res.GlossaryID, userID).Scan(&res.Role); err != nil {
				return fmt.Errorf("RedeemLink: read existing role: %w", err)
			}
			return nil
		}
		res.Role = linkRole
		if _, err := tx.Exec(ctx, `
			INSERT INTO glossary_invite_redemptions (link_id, user_id)
			VALUES ($1::uuid, $2::uuid)
			ON CONFLICT (link_id, user_id) DO NOTHING`, res.LinkID, userID); err != nil {
			return fmt.Errorf("RedeemLink: record redemption: %w", err)
		}
		tag, err = tx.Exec(ctx, `
			UPDATE glossary_invite_links SET last_used_at = now()
			WHERE id = $1::uuid AND revoked_at IS NULL`, res.LinkID)
		if err != nil {
			return fmt.Errorf("RedeemLink: touch link: %w", err)
		}
		if tag.RowsAffected() == 0 {
			return ErrRevoked // revoked while joining; the transaction rolls back
		}
		return nil
	})
	if err != nil {
		return RedeemResult{}, err
	}
	return res, nil
}

package kbinvites

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/justrag/go-backend/internal/kbbehavior"
	"github.com/justrag/go-backend/internal/kbstartpage"
	"github.com/justrag/go-backend/internal/pgxutil"
)

// ErrNotFound means the addressed link (or, on redeem, the token) does not
// exist. A token that never existed and one whose KB is gone look the same.
var ErrNotFound = errors.New("kbinvites: not found")

// ErrRevoked means the token exists but its link was revoked: it still
// resolves to its KB (Preview), but nobody can join through it any more.
var ErrRevoked = errors.New("kbinvites: revoked")

// Link is one invite link. CreatedByName is the username of whoever minted
// it, NULL once that account is deleted (created_by is ON DELETE SET NULL).
type Link struct {
	ID              string     `json:"id"              db:"id"`
	KBID            string     `json:"kbId"            db:"kb_id"`
	Token           string     `json:"token"           db:"token"`
	Role            string     `json:"role"            db:"role"`
	Label           *string    `json:"label"           db:"label"`
	CreatedByName   *string    `json:"createdByName"   db:"created_by_name"`
	CreatedAt       time.Time  `json:"createdAt"       db:"created_at"`
	RedemptionCount int        `json:"redemptionCount" db:"redemption_count"`
	LastUsedAt      *time.Time `json:"lastUsedAt"      db:"last_used_at"`
}

// RedeemResult describes the outcome of redeeming a token. Role is the
// caller's role on the KB after redeeming: the link's role for a new member,
// the unchanged existing role for someone who already was one. LinkID lets
// the audit trail answer "a link leaked — who joined through it?" instead of
// only "someone joined this KB somehow".
type RedeemResult struct {
	LinkID        string `json:"linkId"`
	KBID          string `json:"kbId"`
	KBName        string `json:"kbName"`
	Role          string `json:"role"`
	AlreadyMember bool   `json:"alreadyMember"`
}

// LinkTarget is what a token resolves to for one caller, revoked or not:
// the link, its KB and the caller's own standing on that KB. It carries the
// raw facts; the handler derives the outcome (see decide) because the
// caller's system role is part of that decision.
type LinkTarget struct {
	LinkID      string  `db:"link_id"`
	LinkRole    string  `db:"link_role"`
	Revoked     bool    `db:"revoked"`
	KBID        string  `db:"kb_id"`
	KBName      string  `db:"kb_name"`
	Description *string `db:"description"`
	IsGlobal    bool    `db:"is_global"`
	IsPublished bool    `db:"is_published"`
	// MemberRole is the caller's kb_members role, "" without a row.
	MemberRole string `db:"member_role"`
	// InOverview: the KB shows in the caller's overview. A private KB does
	// for its members; a public KB mirrors kb.ListGlobalKnowledgeBases — no
	// opted_out row, and a membership, or published with a subscription or
	// auto_subscribe.
	InOverview bool `db:"in_overview"`
	IsFavorite bool `db:"is_favorite"`
}

// TopicDetails is what the join dialog shows about a KB beyond its name and
// description, the way the KB's own start page shows it: its catalog
// category, how many documents it holds, when content last arrived, and the
// role it answers in while it offers only one.
type TopicDetails struct {
	Category       json.RawMessage `json:"category,omitempty"`
	FileCount      int             `json:"fileCount"`
	LastIngestedAt *time.Time      `json:"lastIngestedAt,omitempty"`
	RoleName       string          `json:"roleName,omitempty"`
}

// Store is the invite-link data layer. PGStore is its only implementation.
type Store interface {
	List(ctx context.Context, kbID string) ([]Link, error)
	Create(ctx context.Context, kbID, token, role string, label *string, createdBy string) (Link, error)
	Revoke(ctx context.Context, kbID, linkID string) error
	Resolve(ctx context.Context, token, userID string) (LinkTarget, error)
	Details(ctx context.Context, kbID string) (TopicDetails, error)
	Redeem(ctx context.Context, token, userID string) (RedeemResult, error)
}

// PGStore is the Postgres-backed Store.
type PGStore struct {
	pool *pgxpool.Pool
}

// NewStore creates a PGStore over the main pool.
func NewStore(pool *pgxpool.Pool) *PGStore { return &PGStore{pool: pool} }

var _ Store = (*PGStore)(nil)

const linkCols = `l.id, l.kb_id, l.token, l.role, l.label, u.username AS created_by_name,
                  l.created_at, l.redemption_count, l.last_used_at`

// List returns a KB's active links, newest first. Revoked links are kept
// only so they keep resolving; the admin never sees them again.
func (s *PGStore) List(ctx context.Context, kbID string) ([]Link, error) {
	sql := `SELECT ` + linkCols + `
	        FROM kb_invite_links l
	        LEFT JOIN users u ON u.id = l.created_by
	        WHERE l.kb_id = $1::uuid AND l.revoked_at IS NULL
	        ORDER BY l.created_at DESC`
	return pgxutil.QueryRows[Link](ctx, s.pool, sql, kbID)
}

// Create inserts a link. role must already have passed kbaccess.Assignable
// in the handler; the table's CHECK constraint is the backstop.
func (s *PGStore) Create(ctx context.Context, kbID, token, role string, label *string, createdBy string) (Link, error) {
	sql := `WITH ins AS (
	            INSERT INTO kb_invite_links (kb_id, token, role, label, created_by)
	            VALUES ($1::uuid, $2, $3, $4, NULLIF($5,'')::uuid)
	            RETURNING *
	        )
	        SELECT ` + linkCols + `
	        FROM ins l LEFT JOIN users u ON u.id = l.created_by`
	rows, err := pgxutil.QueryRows[Link](ctx, s.pool, sql, kbID, token, role, label, createdBy)
	if err != nil {
		return Link{}, fmt.Errorf("Create: %w", err)
	}
	if len(rows) == 0 {
		return Link{}, fmt.Errorf("Create: insert returned no row")
	}
	return rows[0], nil
}

// Revoke ends a link: nobody can join through it any more, but the row stays
// so the token keeps resolving to its KB (links live on websites). The kb_id
// predicate is load-bearing: without it a link id from another KB would be
// revocable by any admin of any KB. An already revoked link is ErrNotFound,
// matching what the admin list shows.
func (s *PGStore) Revoke(ctx context.Context, kbID, linkID string) error {
	tag, err := s.pool.Exec(ctx, `
		UPDATE kb_invite_links SET revoked_at = NOW()
		WHERE id = $1::uuid AND kb_id = $2::uuid AND revoked_at IS NULL`, linkID, kbID)
	if err != nil {
		return fmt.Errorf("Revoke: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}

// Resolve looks a token up for userID without changing anything, revoked
// links included. ErrNotFound when no such token exists.
//
// The description falls back to header_text for the same reason the catalog
// does (kbsubs.Catalog): description has no editor in the UI, header_text is
// the blurb an admin actually writes.
func (s *PGStore) Resolve(ctx context.Context, token, userID string) (LinkTarget, error) {
	rows, err := pgxutil.QueryRows[LinkTarget](ctx, s.pool, `
		SELECT l.id::text AS link_id, l.role AS link_role,
		       l.revoked_at IS NOT NULL AS revoked,
		       k.id::text AS kb_id, k.name AS kb_name,
		       COALESCE(NULLIF(k.description, ''), NULLIF(k.header_text, '')) AS description,
		       (k.visibility = 'public') AS is_global, k.is_published,
		       COALESCE(m.role, '') AS member_role,
		       CASE WHEN k.visibility <> 'public' THEN m.role IS NOT NULL
		            ELSE NOT EXISTS (SELECT 1 FROM kb_subscriptions s
		                             WHERE s.kb_id = k.id AND s.user_id = $2::uuid
		                               AND s.state = 'opted_out')
		                 AND (m.role IS NOT NULL
		                      OR (k.is_published AND (k.auto_subscribe OR EXISTS (
		                            SELECT 1 FROM kb_subscriptions s
		                            WHERE s.kb_id = k.id AND s.user_id = $2::uuid
		                              AND s.state = 'subscribed'))))
		       END AS in_overview,
		       EXISTS (SELECT 1 FROM kb_favorites f
		               WHERE f.kb_id = k.id AND f.user_id = $2::uuid) AS is_favorite
		FROM kb_invite_links l
		JOIN knowledge_bases k ON k.id = l.kb_id
		LEFT JOIN kb_members m ON m.kb_id = k.id AND m.user_id = $2::uuid
		WHERE l.token = $1`, token, userID)
	if err != nil {
		return LinkTarget{}, fmt.Errorf("Resolve: %w", err)
	}
	if len(rows) == 0 {
		return LinkTarget{}, ErrNotFound
	}
	return rows[0], nil
}

// Details reads kbID's TopicDetails. The category and the two file figures
// are the ones kb.ListKnowledgeBases computes for the title card (its
// kbStatsCols); the role name follows the start page's rule (web
// soleRoleName): the active role's name unless the page offers further role
// cards.
func (s *PGStore) Details(ctx context.Context, kbID string) (TopicDetails, error) {
	var (
		d        TopicDetails
		category []byte
	)
	err := s.pool.QueryRow(ctx, `
		SELECT (SELECT json_build_object('id', c.id::text, 'name', c.name, 'sortOrder', c.sort_order,
		                                 'colorSlot', c.color_slot, 'color', c.color)
		          FROM kb_category_links l JOIN kb_categories c ON c.id = l.category_id
		         WHERE l.kb_id = k.id ORDER BY c.sort_order, c.name LIMIT 1),
		       (SELECT COUNT(*) FROM files f WHERE f.kb_id = k.id)::int,
		       (SELECT MAX(COALESCE(f.progress_updated_at, f.created_at))
		                 FILTER (WHERE f.status IN ('completed','partial'))
		          FROM files f WHERE f.kb_id = k.id)
		FROM knowledge_bases k WHERE k.id = $1::uuid`, kbID).Scan(&category, &d.FileCount, &d.LastIngestedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return TopicDetails{}, ErrNotFound
	}
	if err != nil {
		return TopicDetails{}, fmt.Errorf("Details: %w", err)
	}
	if category != nil {
		d.Category = json.RawMessage(category)
	}

	settings, err := kbbehavior.NewStore(s.pool).Load(ctx, kbID)
	if err != nil {
		return TopicDetails{}, fmt.Errorf("Details: behavior: %w", err)
	}
	page, err := kbstartpage.NewStore(s.pool).Load(ctx, kbID)
	if err != nil {
		return TopicDetails{}, fmt.Errorf("Details: start page: %w", err)
	}
	active := settings.Behavior.ActiveRoleID
	eff := kbstartpage.Effective(page, active, settings.Language, settings.Behavior.HasRole)
	if kbstartpage.ModeOf(eff, active) != kbstartpage.StartRoles {
		brief, err := kbbehavior.StarterRole(ctx, s.pool, kbID, "")
		if err != nil {
			return TopicDetails{}, fmt.Errorf("Details: role: %w", err)
		}
		d.RoleName = brief.Name
	}
	return d, nil
}

// Redeem makes userID a member through token: it inserts the link's role,
// clears a stale opt-out so the KB actually shows up, and counts the
// redemption — all in one transaction, because a joiner who is granted
// membership but keeps an opted_out row would be a member of a KB they cannot
// see anywhere. kbmembers.LeaveKB is the precedent for one package owning a
// kb_members + kb_subscriptions transaction.
//
// A link never changes an existing membership: someone who already has a
// kb_members row keeps their role, whatever the link grants, and nothing is
// written (AlreadyMember, Role = their role). Role changes go through the
// members panel. ON CONFLICT DO NOTHING is what enforces that, race-free —
// of two concurrent first redemptions by one person, exactly one inserts and
// the other reports AlreadyMember.
//
// A revoked link is ErrRevoked. The lookup does not lock the link (two people
// joining through one link at once would deadlock on its counter update);
// instead that update re-checks revoked_at under its row lock and rolls the
// join back when a Revoke committed in between.
func (s *PGStore) Redeem(ctx context.Context, token, userID string) (RedeemResult, error) {
	var res RedeemResult
	err := pgxutil.WithTx(ctx, s.pool, func(tx pgx.Tx) error {
		var (
			linkRole string
			revoked  bool
		)
		err := tx.QueryRow(ctx, `
			SELECT l.id::text, l.kb_id::text, l.role, l.revoked_at IS NOT NULL, k.name
			FROM kb_invite_links l
			JOIN knowledge_bases k ON k.id = l.kb_id
			WHERE l.token = $1`, token).Scan(&res.LinkID, &res.KBID, &linkRole, &revoked, &res.KBName)
		if errors.Is(err, pgx.ErrNoRows) {
			return ErrNotFound
		}
		if err != nil {
			return fmt.Errorf("Redeem: lookup token: %w", err)
		}
		if revoked {
			return ErrRevoked
		}

		tag, err := tx.Exec(ctx, `
			INSERT INTO kb_members (kb_id, user_id, role, created_by)
			VALUES ($1::uuid, $2::uuid, $3, NULL)
			ON CONFLICT (kb_id, user_id) DO NOTHING`, res.KBID, userID, linkRole)
		if err != nil {
			return fmt.Errorf("Redeem: grant role: %w", err)
		}
		if tag.RowsAffected() == 0 {
			res.AlreadyMember = true
			if err := tx.QueryRow(ctx,
				`SELECT role FROM kb_members WHERE kb_id = $1::uuid AND user_id = $2::uuid`,
				res.KBID, userID).Scan(&res.Role); err != nil {
				return fmt.Errorf("Redeem: read existing role: %w", err)
			}
			return nil
		}
		res.Role = linkRole

		if _, err := tx.Exec(ctx, `
			DELETE FROM kb_subscriptions
			WHERE kb_id = $1::uuid AND user_id = $2::uuid AND state = 'opted_out'`,
			res.KBID, userID); err != nil {
			return fmt.Errorf("Redeem: clear opt-out: %w", err)
		}

		// The counter is the number of distinct people who joined through
		// this link (migration 0087). Only a join reaches this point, so the
		// redemption row is new unless the person joined through this link
		// before, left, and came back — the primary key keeps them counted
		// once. last_used_at moves on every join.
		tag, err = tx.Exec(ctx, `
			INSERT INTO kb_invite_link_redemptions (link_id, user_id)
			VALUES ($1::uuid, $2::uuid)
			ON CONFLICT (link_id, user_id) DO NOTHING`, res.LinkID, userID)
		if err != nil {
			return fmt.Errorf("Redeem: record redemption: %w", err)
		}
		firstByThisPerson := tag.RowsAffected() == 1
		tag, err = tx.Exec(ctx, `
			UPDATE kb_invite_links
			SET redemption_count = redemption_count + CASE WHEN $2 THEN 1 ELSE 0 END,
			    last_used_at = NOW()
			WHERE id = $1::uuid AND revoked_at IS NULL`, res.LinkID, firstByThisPerson)
		if err != nil {
			return fmt.Errorf("Redeem: count redemption: %w", err)
		}
		if tag.RowsAffected() == 0 {
			return ErrRevoked // revoked while we were joining; the tx rolls back
		}
		return nil
	})
	if err != nil {
		return RedeemResult{}, err
	}
	return res, nil
}

package glossaryaccess

import (
	"context"
	"fmt"
	"net/http"

	"github.com/google/uuid"

	"github.com/justrag/go-backend/internal/auth"
	"github.com/justrag/go-backend/internal/httputil"
)

// Glossary is the part of a glossary row the ladder needs.
type Glossary struct {
	ID         string
	Visibility string
}

// Access is the resolved access of a request to one glossary.
type Access struct {
	Glossary *Glossary
	Role     string
	// Member reports a glossary_members row for the caller, whatever its role.
	// Role alone cannot tell: on a global glossary a stranger has the role
	// viewer without a row, and only a row can be left.
	Member bool
}

type accessKey struct{}

// WithAccess returns ctx carrying a.
func WithAccess(ctx context.Context, a *Access) context.Context {
	return context.WithValue(ctx, accessKey{}, a)
}

// AccessFromContext returns the Access RequireGlossaryRole stored, or nil.
func AccessFromContext(ctx context.Context) *Access {
	a, _ := ctx.Value(accessKey{}).(*Access)
	return a
}

// EffectiveRole is the only resolution ladder for a glossary. First match wins:
//
//  1. a glossary_members row with a valid role -> that role
//  2. the glossary is global                   -> viewer
//  3. otherwise                                -> "" (no access)
//
// An explicit row beats the implicit viewer of rule 2, so an editor on a
// global glossary is not demoted. There is no rung for system roles.
//
// KEEP IN SYNC WITH VisibleGlossariesCTE (visible_sql.go), the SQL rendering
// of this ladder. Change both in the same commit; the integration test
// TestVisibleGlossariesAgreesWithEffectiveRole checks that they agree.
func EffectiveRole(g *Glossary, memberRole string) string {
	if Valid(memberRole) {
		return memberRole
	}
	if g != nil && g.Visibility == VisibilityGlobal {
		return RoleViewer
	}
	return ""
}

// Store is the data access the middleware needs.
type Store interface {
	// GetGlossary returns the glossary, or nil when it does not exist.
	GetGlossary(ctx context.Context, id string) (*Glossary, error)
	// GetMemberRole returns the caller's glossary_members role, or "" for none.
	GetMemberRole(ctx context.Context, glossaryID, userID string) (string, error)
}

// Middleware holds the dependencies of the glossary gate.
type Middleware struct{ store Store }

// NewMiddleware creates a Middleware over store.
func NewMiddleware(store Store) *Middleware { return &Middleware{store: store} }

// RequireGlossaryRole returns middleware that resolves the caller's effective
// role on the glossary named by {id} and serves the request only when it
// meets required: 404 for a missing glossary, 403 for one the caller may not
// open or whose role is too low. The result is stored with WithAccess.
// Owner-only and self-service checks sit in the handlers.
func (m *Middleware) RequireGlossaryRole(required string) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			ctx := r.Context()
			user := auth.UserFromContext(ctx)
			if user == nil {
				httputil.WriteErrorCtx(ctx, w, http.StatusUnauthorized, "Authentication required")
				return
			}
			parsed, err := uuid.Parse(r.PathValue("id"))
			if err != nil {
				httputil.WriteErrorCtx(ctx, w, http.StatusNotFound, "Glossary not found")
				return
			}
			id := parsed.String()

			g, err := m.store.GetGlossary(ctx, id)
			if err != nil {
				httputil.WriteInternalErrorCtx(ctx, w, fmt.Errorf("glossaryaccess: load glossary: %w", err))
				return
			}
			if g == nil {
				httputil.WriteErrorCtx(ctx, w, http.StatusNotFound, "Glossary not found")
				return
			}
			memberRole, err := m.store.GetMemberRole(ctx, id, user.ID)
			if err != nil {
				httputil.WriteInternalErrorCtx(ctx, w, fmt.Errorf("glossaryaccess: load member role: %w", err))
				return
			}
			role := EffectiveRole(g, memberRole)
			if !AtLeast(role, required) {
				httputil.WriteErrorCtx(ctx, w, http.StatusForbidden, "Insufficient permissions")
				return
			}
			next.ServeHTTP(w, r.WithContext(WithAccess(ctx, &Access{Glossary: g, Role: role, Member: memberRole != ""})))
		})
	}
}

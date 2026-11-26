package app

import (
	"net/http"
	"time"

	"github.com/redis/go-redis/v9"

	"github.com/justrag/go-backend/internal/auth"
	"github.com/justrag/go-backend/internal/glossaryaccess"
	"github.com/justrag/go-backend/internal/glossarymembers"
	"github.com/justrag/go-backend/internal/middleware"
	"github.com/justrag/go-backend/internal/translator"
)

// translationRoles is the system permission "use translation": the roles that
// may call any translator or glossary route. It is fixed in code, like the
// role chains of the other features, and all four system roles hold it. The
// superadmin passes every chain; making the roles configurable per extension
// comes later. A glossary role is checked on top of it, never instead.
var translationRoles = []string{auth.RoleUser, auth.RoleAdmin, auth.RoleSuperAdmin, auth.RoleAPIUser}

// translatorTextPerMinute is the budget of the text routes per user, the
// budget the Campus translator had.
const translatorTextPerMinute = 60

// translatorDeps are the handlers the translator routes need. Split out of
// setupRoutes so a test can drive the real wiring with fakes.
type translatorDeps struct {
	text     *translator.Handler
	glossary *translator.GlossaryHandler
	members  *glossarymembers.Handler
	access   *glossaryaccess.Middleware
	textRL   *middleware.RedisRateLimiter
	inviteRL *middleware.RedisRateLimiter
}

// newTranslatorTextLimiter is the per-user limiter of the text routes. It sits
// inside Authenticate, so it counts the user, not the campus NAT address.
func newTranslatorTextLimiter(rdb redis.Cmdable) *middleware.RedisRateLimiter {
	return middleware.NewRedisRateLimiter(rdb, middleware.RedisRateLimitConfig{
		Max: translatorTextPerMinute, Window: time.Minute, Category: "translator", Key: userRateKey,
	})
}

// wireTranslatorRoutes builds the translator's stores and handlers over the
// shared infrastructure and registers its routes.
func wireTranslatorRoutes(rc *routeCtx, inviteRL *middleware.RedisRateLimiter) {
	db := rc.infra.db.Main
	glossaries := translator.NewStore(db)
	completer := translator.NewAICompleter(rc.aiResolver, rc.chatStore)
	registerTranslatorRoutes(rc, translatorDeps{
		text:     translator.NewHandler(translator.NewService(completer, glossaries), completer, rc.chatStore),
		glossary: translator.NewGlossaryHandler(glossaries),
		members:  glossarymembers.NewHandler(glossarymembers.NewStore(db)),
		access:   glossaryaccess.NewMiddleware(glossaryaccess.NewStore(db)),
		textRL:   newTranslatorTextLimiter(rc.infra.rdb.Client),
		inviteRL: inviteRL,
	})
}

// registerTranslatorRoutes wires the translation extension.
//
// Chain order, outermost first:
//
//	Authenticate → translation permission (system role) → enabled switch
//	  → [rate limit] → [glossary role gate] → handler
//
// The configuration route skips the switch: the UI reads it to learn that the
// extension is off. The two invite token routes skip the glossary gate, as
// the caller has no role on the glossary yet; they keep the switch and a
// rate limit keyed on the client address, like the KB invite links.
func registerTranslatorRoutes(rc *routeCtx, d translatorDeps) {
	permitted := func(next http.Handler) http.Handler {
		return rc.authMw.Authenticate(rc.authMw.RequireRole(translationRoles...)(next))
	}
	enabled := func(next http.Handler) http.Handler { return permitted(d.text.RequireEnabled(next)) }
	limited := func(h http.HandlerFunc) http.Handler {
		return enabled(d.textRL.Middleware(http.HandlerFunc(h)))
	}
	gate := func(min string, h http.HandlerFunc) http.Handler {
		return enabled(d.access.RequireGlossaryRole(min)(http.HandlerFunc(h)))
	}

	rc.mux.Handle("GET /api/translator/config", permitted(http.HandlerFunc(d.text.Config)))
	rc.mux.Handle("POST /api/translator/translate", limited(d.text.Translate))
	rc.mux.Handle("POST /api/translator/rephrase", limited(d.text.Rephrase))
	rc.mux.Handle("POST /api/translator/detect", limited(d.text.Detect))
	rc.mux.Handle("POST /api/translator/suggest", limited(d.text.Suggest))

	// Glossaries. Creating and listing have no glossary in the path; every
	// {id} route resolves the caller's role through the one gate.
	rc.mux.Handle("GET /api/glossaries", enabled(http.HandlerFunc(d.glossary.List)))
	rc.mux.Handle("POST /api/glossaries", enabled(http.HandlerFunc(d.glossary.Create)))
	rc.mux.Handle("POST /api/glossaries/import", enabled(http.HandlerFunc(d.glossary.Import)))
	rc.mux.Handle("GET /api/glossaries/{id}", gate(glossaryaccess.RoleViewer, d.glossary.Get))
	rc.mux.Handle("PUT /api/glossaries/{id}", gate(glossaryaccess.RoleEditor, d.glossary.Update))
	rc.mux.Handle("PATCH /api/glossaries/{id}", gate(glossaryaccess.RoleAdmin, d.glossary.SetVisibility))
	rc.mux.Handle("DELETE /api/glossaries/{id}", gate(glossaryaccess.RoleOwner, d.glossary.Delete))

	// Members, adding people and invite links: admin. The member list sits
	// behind admin, not viewer: on a global glossary every user resolves to
	// viewer, and the roster is not theirs to read.
	rc.mux.Handle("GET /api/glossaries/{id}/members", gate(glossaryaccess.RoleAdmin, d.members.ListMembers))
	rc.mux.Handle("PUT /api/glossaries/{id}/members/{userId}", gate(glossaryaccess.RoleAdmin, d.members.SetMemberRole))
	rc.mux.Handle("DELETE /api/glossaries/{id}/members/{userId}", gate(glossaryaccess.RoleAdmin, d.members.RemoveMember))
	rc.mux.Handle("POST /api/glossaries/{id}/members/bulk", gate(glossaryaccess.RoleAdmin, d.members.BulkAdd))
	rc.mux.Handle("DELETE /api/glossaries/{id}/members/pending/{username}", gate(glossaryaccess.RoleAdmin, d.members.RevokePendingInvite))
	rc.mux.Handle("GET /api/glossaries/{id}/invite-links", gate(glossaryaccess.RoleAdmin, d.members.ListLinks))
	rc.mux.Handle("POST /api/glossaries/{id}/invite-links", gate(glossaryaccess.RoleAdmin, d.members.CreateLink))
	rc.mux.Handle("DELETE /api/glossaries/{id}/invite-links/{linkId}", gate(glossaryaccess.RoleAdmin, d.members.RevokeLink))

	// Resolving and redeeming a link are not glossary-gated: the caller has
	// no role yet, so the viewer gate would refuse them before they could join.
	rc.mux.Handle("GET /api/glossary-invites/{token}",
		d.inviteRL.Middleware(enabled(http.HandlerFunc(d.members.Preview))))
	rc.mux.Handle("POST /api/glossary-invites/{token}/redeem",
		d.inviteRL.Middleware(enabled(http.HandlerFunc(d.members.Redeem))))

	// Transfer and leaving sit on the viewer gate: the owner check (a real
	// owner row, not a system role) and the self check happen in the handler.
	rc.mux.Handle("POST /api/glossaries/{id}/transfer-owner", gate(glossaryaccess.RoleViewer, d.members.TransferOwner))
	rc.mux.Handle("DELETE /api/glossaries/{id}/membership", gate(glossaryaccess.RoleViewer, d.members.Leave))
}

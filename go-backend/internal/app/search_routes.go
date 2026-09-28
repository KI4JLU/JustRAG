package app

import (
	"net/http"
	"time"

	"github.com/redis/go-redis/v9"

	"github.com/justrag/go-backend/internal/middleware"
	"github.com/justrag/go-backend/internal/search"
)

// searchRateLimitPerMinute is GET /api/search's budget per client key (see
// registerSearchRoutes for what the key is).
//
// TODO: 60/min not yet confirmed by the developer. Reasoning (board card
// KI-840): the header field debounces at 250 ms, so fast typing sends
// roughly 1-3 requests per search; 60/min only bites on a script or a stuck
// client.
const searchRateLimitPerMinute = 60

// newSearchRateLimiter builds the search limiter from the shared Redis
// limiter, unchanged: fixed window, and fail OPEN on a Redis outage (the
// limiter's default) — search is not a security boundary the way login is,
// so a Redis blip should not take the header search down. A fail-open is
// still counted in the rate-limit fallback metric and logged at warn.
func newSearchRateLimiter(rdb redis.Cmdable) *middleware.RedisRateLimiter {
	return middleware.NewRedisRateLimiter(rdb, middleware.RedisRateLimitConfig{
		Max: searchRateLimitPerMinute, Window: time.Minute, Category: "search",
	})
}

// registerSearchRoutes wires the shell header's global search. Split out of
// registerKBRoutes so its test can drive the real wiring with a fake store.
//
// Chain order: Authenticate OUTSIDE, the rate limiter INSIDE.
//
//	Authenticate → searchRL → search handler
//
// The shared limiter keys on client IP only (rl:search:<ip>), not on the
// user. With the limiter outside, every unauthenticated request would
// increment the same per-IP counter as the real users behind that IP (a
// campus NAT, a VPN egress), so anyone could burn their budget without a
// token. Inside, a request without a valid token is answered 401 before it
// can touch the counter. The price is that unauthenticated requests are not
// counted by this limiter at all; they cost only a JWT check and a Redis
// blacklist lookup, never a search query.
//
// Authentication only, like GET /api/kb and GET /api/kb/catalog: there is no
// KB in the path. Visibility is a per-row SQL predicate in internal/search
// that mirrors kbaccess.EffectiveRole; a kb_id the caller cannot see is 404.
func registerSearchRoutes(rc *routeCtx, searchRL *middleware.RedisRateLimiter, store search.Store) {
	searchHandler := search.NewHandler(store)
	rc.mux.Handle("GET /api/search",
		rc.authMw.Authenticate(searchRL.Middleware(http.HandlerFunc(searchHandler.Search))))
}

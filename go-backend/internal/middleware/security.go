package middleware

import "net/http"

// DefaultCSP is the built-in Content-Security-Policy. Its script-src hashes
// cover the inline scripts of the production frontend build. If an inline
// script changes and its hash is not regenerated, CSP-enforcing browsers
// silently refuse to execute it — there is no server-side signal of the
// mismatch, and the Vite dev server sends no CSP at all, so a broken hash is
// invisible everywhere except production. Override via the csp argument to
// SecurityHeaders (wired through the CSP_HEADER env var in internal/config)
// so a hash drift can be fixed at deploy time without a rebuild.
//
// Two hashes are listed:
//
//   - 'sha256-ghIKC6K2…' is the theme/language boot script in web/index.html
//     (resolves data-theme before first paint, so dark-mode users get no white
//     flash). TestDefaultCSPCoversIndexHTMLInlineScript recomputes it from that
//     file on every `go test ./...`, so editing the script without regenerating
//     the hash is a red test rather than a production-only bug.
//   - 'sha256-ieoeWczD…' predates this fork's visible git history (it arrives
//     in the squashed initial commit) and matches NO inline script in the
//     current production build — `npm run build --prefix web` emits exactly one
//     inline script, the theme boot script above. It is kept because a hash
//     entry only ever permits a script whose exact bytes hash to that value, so
//     it grants nothing, while dropping it is a deploy-visible change to a
//     directive whose original purpose is no longer recoverable from the repo.
//     TODO: remove once someone confirms no deployed frontend still ships an
//     inline script matching it — not yet confirmed.
//
// To regenerate a hash after a frontend build, extract the inline script body
// from web/dist/index.html — the BUILT file, because the browser hashes what it
// receives — and sha256/base64 it, e.g.:
//
//	# grab the text between the inline <script>…</script> tags, no tags, no
//	# surrounding whitespace trimming beyond what the browser hashes:
//	openssl dgst -sha256 -binary inline-script.js | openssl base64
//
// then splice the result into the 'sha256-…' token below. The browser
// console logs the expected hash on a CSP violation, which is the quickest
// source of truth when the two disagree.
// img-src permits data: and blob: so the mind-map PNG export works: the
// html-to-image library rasterizes the graph by loading an SVG as a data: URL
// image and drawing it to a canvas. Without this, img-src inherits
// default-src 'self' and browsers block that image load, failing the export.
const DefaultCSP = "default-src 'self'; script-src 'self' 'sha256-ghIKC6K2dzQnJQeXKhXi7iyrCfVnmWtdxiPWmgOzUW0=' 'sha256-ieoeWczDHkReVBsRBqaal5AFMlBtNjMzgwKvLqi/tSU='; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; frame-src 'self' blob:; media-src 'self' blob:"

// SecurityHeaders sets the standard security response headers. emitHSTS
// gates Strict-Transport-Security: HSTS has no effect over plain HTTP, and
// emitting it from a dev server reachable over both HTTP and HTTPS (e.g. a
// port-forward into a cluster) can poison the browser's HSTS cache for the
// hostname. Pass true in production where TLS termination is guaranteed
// upstream; false for local development.
//
// csp is the Content-Security-Policy header value. Empty falls back to
// DefaultCSP.
func SecurityHeaders(emitHSTS bool, csp string) func(http.Handler) http.Handler {
	if csp == "" {
		csp = DefaultCSP
	}
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			w.Header().Set("X-Content-Type-Options", "nosniff")
			w.Header().Set("X-Frame-Options", "DENY")
			// X-XSS-Protection: 0 disables the legacy IE/old-Chrome reflective
			// XSS auditor, which had its own bypass vulnerabilities and could be
			// abused to create xs-leaks. Modern browsers either ignore the header
			// or treat 0 as the safe default; explicitly opting out is the
			// current OWASP recommendation. Not an accidental zero — keep as-is.
			w.Header().Set("X-XSS-Protection", "0")
			w.Header().Set("Referrer-Policy", "strict-origin-when-cross-origin")
			// Permissions-Policy denies access to browser APIs the app has
			// no business using. The RAG chat UI never needs camera, mic,
			// geolocation, payment, or USB — denying them up front means a
			// compromised script or a malicious iframe can't trigger the
			// browser permission prompt that a curious user might accept.
			w.Header().Set("Permissions-Policy", "camera=(), microphone=(), geolocation=(), payment=(), usb=()")
			w.Header().Set("Content-Security-Policy", csp)
			if emitHSTS {
				w.Header().Set("Strict-Transport-Security", "max-age=31536000; includeSubDomains")
			}

			next.ServeHTTP(w, r)
		})
	}
}

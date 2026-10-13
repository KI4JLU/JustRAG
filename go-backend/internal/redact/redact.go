// Package redact strips credentials out of free text before it leaves the
// process: error messages sent to clients (httputil.SanitizeError) and log
// lines (ReplaceAttr, installed on the server's and worker's slog handler).
//
// It exists because a *url.Error quotes its full request URL. The Google
// Custom Search key travelled as ?key=… and reached a client toast on a
// timeout; SanitizeError's word list ("api key", "password", …) never
// matches a query parameter. Redaction here is by shape — a credential-named
// query parameter, URL userinfo, a Bearer token — so a new integration that
// makes the same mistake is covered without anyone extending a word list.
//
// It is a backstop, not the fix: credentials belong in headers.
package redact

import (
	"log/slog"
	"regexp"
	"strings"
)

// Mask replaces every redacted value.
const Mask = "REDACTED"

var (
	// A query parameter whose name says it carries a credential. `[?&;]`
	// anchors on a parameter boundary, so "monkey=" is not "key=". The `%3D`
	// arm catches a URL that was itself URL-encoded into another URL or a
	// form body. Names are case-insensitive (X-Amz-Signature, ApiKey).
	queryParam = regexp.MustCompile(`(?i)([?&;](?:key|api[_-]?key|access[_-]?token|refresh[_-]?token|id[_-]?token|token|auth|client[_-]?secret|secret|password|passwd|pwd|sig|signature|code|x-amz-signature|x-amz-security-token|x-goog-signature)(?:=|%3D))[^&#\s"'\\]*`)

	// URL userinfo: scheme://user:pass@host or scheme://token@host. The
	// scheme is required, so a plain e-mail address is left alone.
	userinfo = regexp.MustCompile(`([a-zA-Z][a-zA-Z0-9+.-]*://)[^/\s@"'\\]+@`)

	// An Authorization header value. The word "bearer" alone ("the bearer of
	// bad news") is untouched: the token must be at least 8 characters of
	// token alphabet.
	bearer = regexp.MustCompile(`(?i)(\bbearer\s+)[A-Za-z0-9._~+/=-]{8,}`)
)

// Secrets returns s with every credential-shaped substring replaced by Mask.
func Secrets(s string) string {
	// Fast path: every pattern needs one of these; most log values carry
	// none, so the regexes do not run on them.
	if !strings.ContainsAny(s, "=@") && !strings.Contains(strings.ToLower(s), "bearer") && !strings.Contains(s, "%3D") && !strings.Contains(s, "%3d") {
		return s
	}
	s = queryParam.ReplaceAllString(s, "${1}"+Mask)
	s = userinfo.ReplaceAllString(s, "${1}"+Mask+"@")
	s = bearer.ReplaceAllString(s, "${1}"+Mask)
	return s
}

// ReplaceAttr is a slog.HandlerOptions.ReplaceAttr that redacts string and
// error values, the message included. Other kinds pass through untouched.
func ReplaceAttr(_ []string, a slog.Attr) slog.Attr {
	switch a.Value.Kind() {
	case slog.KindString:
		if s := a.Value.String(); s != "" {
			if r := Secrets(s); r != s {
				a.Value = slog.StringValue(r)
			}
		}
	case slog.KindAny:
		if err, ok := a.Value.Any().(error); ok && err != nil {
			s := err.Error()
			if r := Secrets(s); r != s {
				a.Value = slog.StringValue(r)
			}
		}
	}
	return a
}

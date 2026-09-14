package middleware

import (
	"crypto/sha256"
	"encoding/base64"
	"net/http"
	"net/http/httptest"
	"os"
	"regexp"
	"strings"
	"testing"
)

// TestDefaultCSPAllowsDataImages guards the fix for the mind-map PNG export.
// html-to-image rasterizes the graph by loading an SVG as a data: URL <img>
// and drawing it to a canvas; if img-src does not permit data: (here it would
// otherwise inherit default-src 'self'), CSP-enforcing browsers block the
// image load and the export rejects with "Export failed".
func TestDefaultCSPAllowsDataImages(t *testing.T) {
	var imgSrc string
	for d := range strings.SplitSeq(DefaultCSP, ";") {
		d = strings.TrimSpace(d)
		if strings.HasPrefix(d, "img-src") {
			imgSrc = d
			break
		}
	}
	if imgSrc == "" {
		t.Fatalf("DefaultCSP has no explicit img-src directive; img-src would inherit default-src 'self' and block data: images. CSP=%q", DefaultCSP)
	}
	if !strings.Contains(imgSrc, "data:") {
		t.Errorf("img-src must allow data: for PNG export; got %q", imgSrc)
	}
	if !strings.Contains(imgSrc, "blob:") {
		t.Errorf("img-src should allow blob: for robustness; got %q", imgSrc)
	}
}

// TestSecurityHeadersEmitsCSP confirms the directive actually reaches the wire.
func TestSecurityHeadersEmitsCSP(t *testing.T) {
	h := SecurityHeaders(false, "")(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/", nil))
	got := rec.Header().Get("Content-Security-Policy")
	if !strings.Contains(got, "img-src") || !strings.Contains(got, "data:") {
		t.Errorf("emitted CSP missing img-src data:; got %q", got)
	}
}

// indexHTMLPath is web/index.html relative to this package directory, which is
// where `go test` runs. The frontend build copies that file's inline script
// through byte-for-byte (asserted in web/src/indexHtml.theme.test.ts), so the
// source file is a faithful stand-in for the built one the browser hashes —
// and unlike web/dist it is committed, so this test needs no frontend build.
const indexHTMLPath = "../../../web/index.html"

// bareInlineScript matches only <script> with no attributes, i.e. the inline
// script. The build also emits <script type="module" src="…">, which is an
// external script and needs no hash.
var bareInlineScript = regexp.MustCompile(`(?s)<script>(.*?)</script>`)

// TestDefaultCSPCoversIndexHTMLInlineScript is the guard for the failure mode
// DefaultCSP's doc comment describes: an inline script whose sha256 is not in
// script-src is dropped by CSP-enforcing browsers with no server-side signal,
// and the Vite dev server sends no CSP at all — so the mismatch is invisible
// outside production.
//
// Oracle: the hash is recomputed here from the bytes of the real, shipped
// web/index.html. It is independent of DefaultCSP because nothing in the
// computation reads the constant; the constant is only the value being
// checked. Edit either side alone and this goes red.
func TestDefaultCSPCoversIndexHTMLInlineScript(t *testing.T) {
	raw, err := os.ReadFile(indexHTMLPath)
	if err != nil {
		// Deliberately fatal rather than skipped: a skip would restore exactly
		// the silent failure this test exists to remove.
		t.Fatalf("cannot read %s (expected relative to this package dir): %v", indexHTMLPath, err)
	}

	matches := bareInlineScript.FindAllStringSubmatch(string(raw), -1)
	if len(matches) != 1 {
		t.Fatalf("expected exactly 1 inline <script> in %s, found %d; every inline script needs its own script-src hash", indexHTMLPath, len(matches))
	}

	sum := sha256.Sum256([]byte(matches[0][1]))
	want := "'sha256-" + base64.StdEncoding.EncodeToString(sum[:]) + "'"

	var scriptSrc string
	for d := range strings.SplitSeq(DefaultCSP, ";") {
		d = strings.TrimSpace(d)
		if strings.HasPrefix(d, "script-src") {
			scriptSrc = d
			break
		}
	}
	if scriptSrc == "" {
		t.Fatalf("DefaultCSP has no script-src directive; the inline theme script would inherit default-src 'self' and be blocked. CSP=%q", DefaultCSP)
	}
	if !strings.Contains(scriptSrc, want) {
		t.Errorf("script-src does not cover the inline script in %s.\n  want token: %s\n  got script-src: %s\nRegenerate per the comment on DefaultCSP.", indexHTMLPath, want, scriptSrc)
	}
}

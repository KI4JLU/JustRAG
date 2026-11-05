package app

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"reflect"
	"regexp"
	"strings"
	"testing"
)

// webIndexHTML is the committed web/index.html, relative to this package.
// The built shell differs only in its asset URLs, which the rename never touches.
const webIndexHTML = "../../../web/index.html"

var inlineScriptRe = regexp.MustCompile(`(?s)<script>.*?</script>`)

// Oracle: the shipped web/index.html and the frontend contract in
// web/src/utils/appName.ts (meta names app-name-prefix / app-name-product).
func TestRenderAppShell_RealIndexHTML(t *testing.T) {
	t.Parallel()
	shell, err := os.ReadFile(webIndexHTML)
	if err != nil {
		t.Fatalf("read %s: %v", webIndexHTML, err)
	}
	src := string(shell)
	// The rename swaps the default name; if index.html stops carrying it the
	// rename would silently do nothing.
	for _, want := range []string{"<title>JLU RAG</title>", `<meta name="description" content="JLU RAG - `} {
		if !strings.Contains(src, want) {
			t.Fatalf("web/index.html no longer contains %q", want)
		}
	}

	out := string(renderAppShell(shell, "THM", "Docs"))
	for _, want := range []string{
		"<title>THM Docs</title>",
		`<meta name="description" content="THM Docs - Advanced Knowledge Retrieval System"`,
		`<meta name="app-name-prefix" content="THM" />`,
		`<meta name="app-name-product" content="Docs" />`,
	} {
		if !strings.Contains(out, want) {
			t.Errorf("rendered shell lacks %q", want)
		}
	}
	if strings.Contains(out, "JLU RAG") {
		t.Error("rendered shell still names the default app")
	}
	if i, j := strings.Index(out, "app-name-product"), strings.Index(out, "</head>"); i < 0 || i > j {
		t.Error("app name metas are not inside <head>")
	}
	// The theme boot script is hashed into the CSP; the rename must not touch it.
	if got, want := inlineScriptRe.FindString(out), inlineScriptRe.FindString(src); got != want || want == "" {
		t.Error("the inline boot script changed")
	}
}

func TestRenderAppShell_EscapesTheName(t *testing.T) {
	t.Parallel()
	shell := []byte(`<head><meta name="description" content="JLU RAG - x" /><title>JLU RAG</title></head>`)
	out := string(renderAppShell(shell, `A&B`, `<i>"x"`))
	for _, want := range []string{
		"<title>A&amp;B &lt;i&gt;&#34;x&#34;</title>",
		`content="A&amp;B &lt;i&gt;&#34;x&#34; - x"`,
		`<meta name="app-name-prefix" content="A&amp;B" />`,
		`<meta name="app-name-product" content="&lt;i&gt;&#34;x&#34;" />`,
	} {
		if !strings.Contains(out, want) {
			t.Errorf("rendered shell lacks %q:\n%s", want, out)
		}
	}
	if strings.Contains(out, "<i>") {
		t.Error("an unescaped tag from the name reached the shell")
	}
}

func newShellTestDir(t *testing.T) string {
	t.Helper()
	dir := t.TempDir()
	shell := `<!doctype html><html><head><title>JLU RAG</title></head><body></body></html>`
	if err := os.WriteFile(filepath.Join(dir, "index.html"), []byte(shell), 0o644); err != nil {
		t.Fatalf("write index.html: %v", err)
	}
	return dir
}

// Every way to reach the shell — the root, /index.html (the service worker
// precaches that URL) and a client-side route — gets the renamed one.
func TestStaticServing_ShellCarriesTheAppName(t *testing.T) {
	t.Parallel()
	mux := http.NewServeMux()
	setupStaticServing(mux, newShellTestDir(t), "THM", "Docs")

	for _, path := range []string{"/", "/index.html", "/kb/123/chat"} {
		rec := httptest.NewRecorder()
		mux.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, path, nil))
		if rec.Code != http.StatusOK {
			t.Fatalf("GET %s: status %d", path, rec.Code)
		}
		body := rec.Body.String()
		if !strings.Contains(body, "<title>THM Docs</title>") || !strings.Contains(body, `content="Docs"`) {
			t.Errorf("GET %s: shell not renamed:\n%s", path, body)
		}
		if got := rec.Header().Get("Content-Type"); !strings.HasPrefix(got, "text/html") {
			t.Errorf("GET %s: Content-Type = %q", path, got)
		}
		if got := rec.Header().Get("Cache-Control"); got != "no-cache" {
			t.Errorf("GET %s: Cache-Control = %q, want no-cache", path, got)
		}
	}
}

// The ETag follows the rendered bytes: an unchanged shell revalidates to a
// 304, and a restart with another name is a new shell even though index.html
// on disk did not change.
func TestStaticServing_ShellETagFollowsTheName(t *testing.T) {
	t.Parallel()
	dir := newShellTestDir(t)
	etag := func(prefix string, ifNoneMatch string) (string, int) {
		mux := http.NewServeMux()
		setupStaticServing(mux, dir, prefix, "Docs")
		req := httptest.NewRequest(http.MethodGet, "/", nil)
		if ifNoneMatch != "" {
			req.Header.Set("If-None-Match", ifNoneMatch)
		}
		rec := httptest.NewRecorder()
		mux.ServeHTTP(rec, req)
		return rec.Header().Get("ETag"), rec.Code
	}

	first, _ := etag("THM", "")
	if first == "" {
		t.Fatal("shell served without an ETag")
	}
	if _, code := etag("THM", first); code != http.StatusNotModified {
		t.Errorf("revalidating an unchanged shell: status %d, want 304", code)
	}
	if other, code := etag("UNI", first); other == first || code != http.StatusOK {
		t.Errorf("renamed shell: ETag %q (was %q), status %d; want a new ETag and 200", other, first, code)
	}
}

// Oracle: the manifest vite-plugin-pwa writes from web/vite.config.ts —
// name and short_name are the default, every other member must survive.
func TestRenderManifest(t *testing.T) {
	t.Parallel()
	built := []byte(`{"name":"JLU RAG","short_name":"JLU RAG","description":"Advanced Knowledge Retrieval System","start_url":"/","display":"standalone","icons":[{"src":"vite.svg","sizes":"any"}]}`)

	out, err := renderManifest(built, `THM "Docs"`)
	if err != nil {
		t.Fatalf("renderManifest: %v", err)
	}
	var got, want map[string]any
	if err := json.Unmarshal(out, &got); err != nil {
		t.Fatalf("renamed manifest is not JSON: %v\n%s", err, out)
	}
	_ = json.Unmarshal(built, &want)
	want["name"], want["short_name"] = `THM "Docs"`, `THM "Docs"`
	if !reflect.DeepEqual(got, want) {
		t.Errorf("manifest = %v\nwant       %v", got, want)
	}

	if _, err := renderManifest([]byte("not json"), "THM Docs"); err == nil {
		t.Error("a broken manifest must be an error, not a rewrite")
	}
}

func TestStaticServing_ManifestCarriesTheAppName(t *testing.T) {
	t.Parallel()
	dir := t.TempDir()
	write := func(body string) {
		if err := os.WriteFile(filepath.Join(dir, "manifest.webmanifest"), []byte(body), 0o644); err != nil {
			t.Fatalf("write manifest: %v", err)
		}
	}
	get := func() *httptest.ResponseRecorder {
		mux := http.NewServeMux()
		setupStaticServing(mux, dir, "THM", "Docs")
		rec := httptest.NewRecorder()
		mux.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/manifest.webmanifest", nil))
		return rec
	}

	write(`{"name":"JLU RAG","short_name":"JLU RAG","display":"standalone"}`)
	rec := get()
	if rec.Code != http.StatusOK {
		t.Fatalf("status %d", rec.Code)
	}
	if got := rec.Header().Get("Content-Type"); got != "application/manifest+json" {
		t.Errorf("Content-Type = %q", got)
	}
	if got := rec.Header().Get("Cache-Control"); got != "no-cache" {
		t.Errorf("Cache-Control = %q, want no-cache", got)
	}
	var m map[string]string
	if err := json.Unmarshal(rec.Body.Bytes(), &m); err != nil || m["name"] != "THM Docs" || m["short_name"] != "THM Docs" || m["display"] != "standalone" {
		t.Errorf("manifest = %s", rec.Body.String())
	}

	// A manifest the server cannot read as JSON goes out as built.
	write("{broken")
	if rec := get(); rec.Code != http.StatusOK || rec.Body.String() != "{broken" {
		t.Errorf("broken manifest: status %d, body %q", rec.Code, rec.Body.String())
	}
}

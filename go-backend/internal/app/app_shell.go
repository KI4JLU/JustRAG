package app

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"html"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"time"
)

// The app shell (index.html) carries the default app name. The server
// rewrites it for the configured one each time it serves the shell, so the
// name is right from the first frame. The name has two parts, the
// institution_name and system_name settings, else APP_NAME_PREFIX /
// APP_NAME_PRODUCT (kbbehavior.ReadNames), read per request:
//
//   - <title> and the description meta carry the joined name before any
//     script runs (window title, link previews);
//   - two meta tags, app-name-prefix and app-name-product, hand both parts to
//     the frontend at startup (web/src/utils/appName.ts), so the wordmark does
//     not show the default until GET /api/site-config answers.
//
// The Vite dev server does the same through web/src/utils/appNameShell.ts.
// Both are pinned against the real web/index.html by their tests.
//
// The PWA manifest is renamed the same way (renderManifest): it names the
// installed app, and the build writes the default into it.

// shellDefaultName is how the static index.html names the app.
const shellDefaultName = "JLU RAG"

var (
	shellTitleRe       = regexp.MustCompile(`<title>[^<]*</title>`)
	shellDescriptionRe = regexp.MustCompile(`<meta name="description" content="[^"]*"`)
)

// appNameReader reads the app name's two parts for one request.
type appNameReader func(ctx context.Context) (prefix, product string)

// staticAppName is an appNameReader that always answers prefix and product.
func staticAppName(prefix, product string) appNameReader {
	return func(context.Context) (string, string) { return prefix, product }
}

// renderAppShell returns shell with the app named prefix + " " + product.
func renderAppShell(shell []byte, prefix, product string) []byte {
	name := []byte(html.EscapeString(prefix + " " + product))
	rename := func(tag []byte) []byte {
		return bytes.Replace(tag, []byte(shellDefaultName), name, 1)
	}
	out := shellTitleRe.ReplaceAllFunc(shell, rename)
	out = shellDescriptionRe.ReplaceAllFunc(out, rename)

	metas := `  <meta name="app-name-prefix" content="` + html.EscapeString(prefix) + `" />` + "\n" +
		`  <meta name="app-name-product" content="` + html.EscapeString(product) + `" />` + "\n"
	if i := bytes.Index(out, []byte("</head>")); i >= 0 {
		out = append(out[:i:i], append([]byte(metas), out[i:]...)...)
	}
	return out
}

// renderManifest returns the PWA manifest with name and short_name set to
// the app name: what an installed app is called. Every other member is kept.
func renderManifest(manifest []byte, name string) ([]byte, error) {
	var m map[string]json.RawMessage
	if err := json.Unmarshal(manifest, &m); err != nil {
		return nil, err
	}
	quoted, err := json.Marshal(name)
	if err != nil {
		return nil, err
	}
	m["name"], m["short_name"] = quoted, quoted
	return json.Marshal(m)
}

// serveAppShell answers with staticDir/index.html, renamed for the app name.
func serveAppShell(w http.ResponseWriter, r *http.Request, staticDir string, appName appNameReader) {
	prefix, product := appName(r.Context())
	serveRenamed(w, r, filepath.Join(staticDir, "index.html"), "text/html; charset=utf-8",
		func(b []byte) ([]byte, error) { return renderAppShell(b, prefix, product), nil })
}

// serveManifest answers with staticDir/manifest.webmanifest, renamed for the
// app name. A manifest that is not valid JSON goes out as built.
func serveManifest(w http.ResponseWriter, r *http.Request, staticDir string, appName appNameReader) {
	prefix, product := appName(r.Context())
	serveRenamed(w, r, filepath.Join(staticDir, "manifest.webmanifest"), "application/manifest+json",
		func(b []byte) ([]byte, error) { return renderManifest(b, prefix+" "+product) })
}

// serveRenamed serves file through render. It always revalidates: these
// files keep their name across deploys (and the shell names the hashed
// bundles). The ETag covers the rendered bytes, so another name — a restart
// with other APP_NAME_* values, a saved institution_name or system_name — is a
// changed response even though the file on disk is unchanged.
func serveRenamed(w http.ResponseWriter, r *http.Request, file, contentType string, render func([]byte) ([]byte, error)) {
	src, err := os.ReadFile(file)
	if err != nil {
		http.NotFound(w, r)
		return
	}
	out, err := render(src)
	if err != nil {
		out = src
	}
	sum := sha256.Sum256(out)
	w.Header().Set("Content-Type", contentType)
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("ETag", `"`+hex.EncodeToString(sum[:8])+`"`)
	http.ServeContent(w, r, filepath.Base(file), time.Time{}, bytes.NewReader(out))
}

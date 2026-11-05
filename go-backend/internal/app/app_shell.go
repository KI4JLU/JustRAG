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
// rewrites it for the configured names each time it serves the shell, so the
// name is right from the first frame:
//
//   - <title> and the description meta carry the system name (the
//     system_name setting, else the app name) before any script runs
//     (window title, link previews);
//   - three meta tags hand the names to the frontend at startup
//     (web/src/utils/appName.ts): app-name-prefix and app-name-product
//     (APP_NAME_PREFIX / APP_NAME_PRODUCT, the wordmark) and system-name, so
//     nothing shows the default until GET /api/site-config answers.
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

// appShellNames is how the served shell and manifest name the app.
type appShellNames struct {
	// Prefix and Product are the wordmark: APP_NAME_PREFIX / APP_NAME_PRODUCT.
	Prefix, Product string
	// SystemName reads the name in text — window title, description,
	// installed app: the system_name setting, else the app name
	// (kbbehavior.ReadNames). Nil, or a blank answer, means the app name.
	SystemName func(ctx context.Context) string
}

func (n appShellNames) system(ctx context.Context) string {
	if n.SystemName != nil {
		if s := n.SystemName(ctx); s != "" {
			return s
		}
	}
	return n.Prefix + " " + n.Product
}

// renderAppShell returns shell with title and description naming system and
// the three name metas before </head>.
func renderAppShell(shell []byte, prefix, product, system string) []byte {
	name := []byte(html.EscapeString(system))
	rename := func(tag []byte) []byte {
		return bytes.Replace(tag, []byte(shellDefaultName), name, 1)
	}
	out := shellTitleRe.ReplaceAllFunc(shell, rename)
	out = shellDescriptionRe.ReplaceAllFunc(out, rename)

	metas := `  <meta name="app-name-prefix" content="` + html.EscapeString(prefix) + `" />` + "\n" +
		`  <meta name="app-name-product" content="` + html.EscapeString(product) + `" />` + "\n" +
		`  <meta name="system-name" content="` + html.EscapeString(system) + `" />` + "\n"
	if i := bytes.Index(out, []byte("</head>")); i >= 0 {
		out = append(out[:i:i], append([]byte(metas), out[i:]...)...)
	}
	return out
}

// renderManifest returns the PWA manifest with name and short_name set to
// name, the system name: what an installed app is called. Every other member
// is kept.
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

// serveAppShell answers with staticDir/index.html, renamed for names.
func serveAppShell(w http.ResponseWriter, r *http.Request, staticDir string, names appShellNames) {
	system := names.system(r.Context())
	serveRenamed(w, r, filepath.Join(staticDir, "index.html"), "text/html; charset=utf-8",
		func(b []byte) ([]byte, error) { return renderAppShell(b, names.Prefix, names.Product, system), nil })
}

// serveManifest answers with staticDir/manifest.webmanifest, renamed for the
// system name. A manifest that is not valid JSON goes out as built.
func serveManifest(w http.ResponseWriter, r *http.Request, staticDir string, names appShellNames) {
	system := names.system(r.Context())
	serveRenamed(w, r, filepath.Join(staticDir, "manifest.webmanifest"), "application/manifest+json",
		func(b []byte) ([]byte, error) { return renderManifest(b, system) })
}

// serveRenamed serves file through render. It always revalidates: these
// files keep their name across deploys (and the shell names the hashed
// bundles). The ETag covers the rendered bytes, so another name — a restart
// with other APP_NAME_* values, a changed system_name — is a changed response
// even though the file on disk is unchanged.
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

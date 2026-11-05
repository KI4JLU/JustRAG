package apidocs

import (
	"bytes"
	_ "embed"
	"encoding/json"
	"html"
	"net/http"
	"strings"
)

//go:embed openapi.json
var specJSON []byte

// specDefaultName is how the embedded spec and the docs page name the app.
const specDefaultName = "JustRAG"

// Handler serves API documentation.
type Handler struct {
	spec []byte
	docs []byte
}

// NewHandler returns a docs handler that names the app appName (config
// AppName) in the spec's title and descriptions and in the docs page title.
// An empty appName keeps the embedded name.
func NewHandler(appName string) *Handler {
	h := &Handler{spec: specJSON, docs: []byte(scalarHTML)}
	if appName == "" {
		return h
	}
	quoted, _ := json.Marshal(appName) // a string always marshals
	h.spec = bytes.ReplaceAll(specJSON, []byte(specDefaultName), bytes.Trim(quoted, `"`))
	h.docs = []byte(strings.ReplaceAll(scalarHTML, specDefaultName, html.EscapeString(appName)))
	return h
}

// ServeSpec writes the embedded OpenAPI spec as JSON.
func (h *Handler) ServeSpec(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "public, max-age=3600")
	_, _ = w.Write(h.spec)
}

const scalarHTML = `<!DOCTYPE html>
<html>
<head>
  <title>JustRAG API Docs</title>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
</head>
<body>
  <script id="api-reference" data-url="/api/v1/openapi.json"></script>
  <script src="https://cdn.jsdelivr.net/npm/@scalar/api-reference"></script>
</body>
</html>`

// ServeDocs writes the Scalar API reference HTML page.
// CSP is removed so the Scalar CDN script can load.
func (h *Handler) ServeDocs(w http.ResponseWriter, r *http.Request) {
	w.Header().Del("Content-Security-Policy")
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.Header().Set("Cache-Control", "public, max-age=3600")
	_, _ = w.Write(h.docs)
}

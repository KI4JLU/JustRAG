package apidocs_test

import (
	"encoding/json"
	"html"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/justrag/go-backend/internal/apidocs"
)

func TestServeSpec(t *testing.T) {
	h := apidocs.NewHandler("THM Docs")
	req := httptest.NewRequest(http.MethodGet, "/api/v1/openapi.json", nil)
	w := httptest.NewRecorder()

	h.ServeSpec(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", w.Code)
	}
	if ct := w.Header().Get("Content-Type"); ct != "application/json" {
		t.Fatalf("expected application/json, got %s", ct)
	}
	body := w.Body.String()
	if !strings.Contains(body, `"openapi"`) {
		t.Fatal("response does not contain openapi field")
	}
	// The spec names the configured app, never the embedded default.
	if !strings.Contains(body, `"THM Docs Public API"`) {
		t.Fatal("response does not contain the title with the app name")
	}
	if strings.Contains(body, "JustRAG") {
		t.Error("the spec still names JustRAG")
	}
	// Machine identifiers stay: the Open WebUI model id is a contract.
	if !strings.Contains(body, `"justrag"`) {
		t.Error("the model id justrag must not be renamed")
	}
}

func TestServeDocs(t *testing.T) {
	h := apidocs.NewHandler("THM Docs")
	req := httptest.NewRequest(http.MethodGet, "/api/v1/docs", nil)
	w := httptest.NewRecorder()

	h.ServeDocs(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", w.Code)
	}
	if ct := w.Header().Get("Content-Type"); ct != "text/html; charset=utf-8" {
		t.Fatalf("expected text/html; charset=utf-8, got %s", ct)
	}
	body := w.Body.String()
	if !strings.Contains(body, "scalar") {
		t.Fatal("response does not contain scalar reference")
	}
	if !strings.Contains(body, "/api/v1/openapi.json") {
		t.Fatal("response does not contain spec URL")
	}
	if !strings.Contains(body, "<title>THM Docs API Docs</title>") {
		t.Error("the docs page title does not name the app")
	}
}

// A name with JSON and HTML metacharacters still yields a valid spec and an
// escaped page title.
func TestNewHandler_EscapesTheAppName(t *testing.T) {
	// A name ending in a quote must keep its escaped quote in the spec.
	for _, name := range []string{`A "B" <C> & D\`, `Docs "Beta"`} {
		h := apidocs.NewHandler(name)

		w := httptest.NewRecorder()
		h.ServeSpec(w, httptest.NewRequest(http.MethodGet, "/api/v1/openapi.json", nil))
		var spec struct {
			Info struct {
				Title string `json:"title"`
			} `json:"info"`
		}
		if err := json.Unmarshal(w.Body.Bytes(), &spec); err != nil {
			t.Fatalf("%q: renamed spec is not valid JSON: %v", name, err)
		}
		if want := name + " Public API"; spec.Info.Title != want {
			t.Errorf("title = %q, want %q", spec.Info.Title, want)
		}

		w = httptest.NewRecorder()
		h.ServeDocs(w, httptest.NewRequest(http.MethodGet, "/api/v1/docs", nil))
		if want := "<title>" + html.EscapeString(name) + " API Docs</title>"; !strings.Contains(w.Body.String(), want) {
			t.Errorf("docs title not escaped, want %q:\n%s", want, w.Body.String())
		}
	}
}

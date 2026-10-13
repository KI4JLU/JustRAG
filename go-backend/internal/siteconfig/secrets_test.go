package siteconfig_test

import (
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/justrag/go-backend/internal/auth"
	"github.com/justrag/go-backend/internal/siteconfig"
)

// mcp_servers carries remote MCP servers' credentials inside its JSON
// (headers, typically Authorization: Bearer …). ORACLE for every test here:
// the token string never appears in a response body, and a save that sends
// the mask back writes the stored token, not the mask.
const mcpToken = "mcp-TestOnly0123456789abcdef"

const storedMCPServers = `[{"name":"fetch","url":"https://fetch.example/mcp","headers":{"Authorization":"Bearer ` + mcpToken + `","X-Empty":""}},` +
	`{"name":"open","url":"https://open.example/mcp"}]`

func adminGet(t *testing.T, store *mockStore) map[string]string {
	t.Helper()
	h := siteconfig.NewHandler(store)
	req := httptest.NewRequest(http.MethodGet, "/api/site-config", nil)
	req = req.WithContext(auth.WithUser(req.Context(), &auth.Claims{ID: "1", Role: "admin"}))
	rec := httptest.NewRecorder()
	h.GetSiteConfig(rec, req)
	if strings.Contains(rec.Body.String(), mcpToken) {
		t.Fatalf("GET /api/site-config leaks the MCP token: %s", rec.Body.String())
	}
	var body map[string]string
	if err := json.NewDecoder(rec.Body).Decode(&body); err != nil {
		t.Fatalf("decode: %v", err)
	}
	return body
}

func post(t *testing.T, store *mockStore, configs map[string]any) *httptest.ResponseRecorder {
	t.Helper()
	b, _ := json.Marshal(map[string]any{"configs": configs})
	req := httptest.NewRequest(http.MethodPost, "/api/site-config", strings.NewReader(string(b)))
	rec := httptest.NewRecorder()
	siteconfig.NewHandler(store).UpdateSiteConfig(rec, req)
	return rec
}

func written(store *mockStore, key string) (string, bool) {
	for _, kv := range store.lastBatch {
		if kv.Key == key && kv.Value != nil {
			return *kv.Value, true
		}
	}
	return "", false
}

type spec struct {
	Name    string            `json:"name"`
	URL     string            `json:"url"`
	Headers map[string]string `json:"headers"`
}

func parseSpecs(t *testing.T, raw string) []spec {
	t.Helper()
	var s []spec
	if err := json.Unmarshal([]byte(raw), &s); err != nil {
		t.Fatalf("not a server list: %v\n%s", err, raw)
	}
	return s
}

func TestGetSiteConfig_MCPServerHeadersMasked(t *testing.T) {
	body := adminGet(t, &mockStore{rows: []siteconfig.SiteConfigRow{{Key: "mcp_servers", Value: strPtr(storedMCPServers)}}})

	got := parseSpecs(t, body["mcp_servers"])
	if len(got) != 2 || got[0].Name != "fetch" || got[0].URL != "https://fetch.example/mcp" || got[1].Name != "open" {
		t.Fatalf("server list not preserved: %+v", got)
	}
	if got[0].Headers["Authorization"] != "********" {
		t.Errorf("Authorization = %q, want the mask", got[0].Headers["Authorization"])
	}
	if got[0].Headers["X-Empty"] != "" {
		t.Errorf("an empty header must stay empty (nothing to hide), got %q", got[0].Headers["X-Empty"])
	}
}

func TestGetSiteConfig_UnparseableMCPServersMaskedWhole(t *testing.T) {
	raw := `[{"name":"fetch","headers":{"Authorization":"Bearer ` + mcpToken + `"}` // truncated
	body := adminGet(t, &mockStore{rows: []siteconfig.SiteConfigRow{{Key: "mcp_servers", Value: strPtr(raw)}}})
	if body["mcp_servers"] != "********" {
		t.Errorf("mcp_servers = %q, want the mask", body["mcp_servers"])
	}
}

func TestGetSiteConfig_MCPServersWithoutHeadersUnchanged(t *testing.T) {
	raw := `[{"name":"open","url":"https://open.example/mcp"}]`
	body := adminGet(t, &mockStore{rows: []siteconfig.SiteConfigRow{{Key: "mcp_servers", Value: strPtr(raw)}}})
	if body["mcp_servers"] != raw {
		t.Errorf("mcp_servers = %q, want it byte-identical", body["mcp_servers"])
	}
}

func TestUpdateSiteConfig_MaskedMCPHeaderRestored(t *testing.T) {
	store := &mockStore{rows: []siteconfig.SiteConfigRow{{Key: "mcp_servers", Value: strPtr(storedMCPServers)}}}
	// The admin edited the URL of "open" and saved: "fetch" comes back masked.
	in := `[{"name":"fetch","url":"https://fetch.example/mcp","headers":{"Authorization":"********","X-Empty":""}},` +
		`{"name":"open","url":"https://open.example/v2/mcp"}]`

	rec := post(t, store, map[string]any{"mcp_servers": in})
	if rec.Code != http.StatusOK {
		t.Fatalf("status %d: %s", rec.Code, rec.Body.String())
	}
	v, ok := written(store, "mcp_servers")
	if !ok {
		t.Fatal("mcp_servers was not written")
	}
	got := parseSpecs(t, v)
	if got[0].Headers["Authorization"] != "Bearer "+mcpToken {
		t.Errorf("stored Authorization = %q, want the original token", got[0].Headers["Authorization"])
	}
	if got[1].URL != "https://open.example/v2/mcp" {
		t.Errorf("the edit was lost: %+v", got[1])
	}
}

func TestUpdateSiteConfig_RenamedMCPServerRestoredByURL(t *testing.T) {
	store := &mockStore{rows: []siteconfig.SiteConfigRow{{Key: "mcp_servers", Value: strPtr(storedMCPServers)}}}
	in := `[{"name":"fetcher","url":"https://fetch.example/mcp","headers":{"Authorization":"********"}}]`

	if rec := post(t, store, map[string]any{"mcp_servers": in}); rec.Code != http.StatusOK {
		t.Fatalf("status %d: %s", rec.Code, rec.Body.String())
	}
	v, _ := written(store, "mcp_servers")
	if got := parseSpecs(t, v); got[0].Headers["Authorization"] != "Bearer "+mcpToken {
		t.Errorf("stored Authorization = %q, want the original token", got[0].Headers["Authorization"])
	}
}

// A masked token must never follow a server to a new destination: the mask
// hides the token from the admin, so restoring it under a changed host would
// let a save send it somewhere the admin chose without ever having seen it.
func TestUpdateSiteConfig_MaskNotRestoredToNewHost(t *testing.T) {
	for name, url := range map[string]string{
		"other host":   "https://attacker.example/mcp",
		"other scheme": "http://fetch.example/mcp",
		"other port":   "https://fetch.example:8443/mcp",
		"unparseable":  "://fetch.example/mcp",
	} {
		t.Run(name, func(t *testing.T) {
			store := &mockStore{rows: []siteconfig.SiteConfigRow{{Key: "mcp_servers", Value: strPtr(storedMCPServers)}}}
			in := `[{"name":"fetch","url":"` + url + `","headers":{"Authorization":"********"}}]`

			rec := post(t, store, map[string]any{"mcp_servers": in})
			if rec.Code != http.StatusBadRequest {
				t.Fatalf("status %d, want 400: %s", rec.Code, rec.Body.String())
			}
			if store.lastBatch != nil {
				t.Errorf("nothing may be written, got %+v", store.lastBatch)
			}
		})
	}
}

// A path change on the same origin (an API version bump) keeps the token.
func TestUpdateSiteConfig_MaskRestoredOnSameOriginPathChange(t *testing.T) {
	store := &mockStore{rows: []siteconfig.SiteConfigRow{{Key: "mcp_servers", Value: strPtr(storedMCPServers)}}}
	in := `[{"name":"fetch","url":"https://FETCH.example/v2/mcp","headers":{"Authorization":"********"}}]`

	if rec := post(t, store, map[string]any{"mcp_servers": in}); rec.Code != http.StatusOK {
		t.Fatalf("status %d: %s", rec.Code, rec.Body.String())
	}
	v, _ := written(store, "mcp_servers")
	if got := parseSpecs(t, v); got[0].Headers["Authorization"] != "Bearer "+mcpToken {
		t.Errorf("stored Authorization = %q, want the original token", got[0].Headers["Authorization"])
	}
}

func TestUpdateSiteConfig_NewMCPHeaderValueWritten(t *testing.T) {
	store := &mockStore{rows: []siteconfig.SiteConfigRow{{Key: "mcp_servers", Value: strPtr(storedMCPServers)}}}
	in := `[{"name":"fetch","url":"https://fetch.example/mcp","headers":{"Authorization":"Bearer rotated"}}]`

	if rec := post(t, store, map[string]any{"mcp_servers": in}); rec.Code != http.StatusOK {
		t.Fatalf("status %d: %s", rec.Code, rec.Body.String())
	}
	if v, _ := written(store, "mcp_servers"); v != in {
		t.Errorf("a save without masks must be written as sent, got %s", v)
	}
}

func TestUpdateSiteConfig_UnresolvableMCPMaskRejected(t *testing.T) {
	store := &mockStore{rows: []siteconfig.SiteConfigRow{{Key: "mcp_servers", Value: strPtr(storedMCPServers)}}}
	// A new server whose header is the mask: there is no stored value to keep.
	in := `[{"name":"other","url":"https://other.example/mcp","headers":{"Authorization":"********"}}]`

	rec := post(t, store, map[string]any{"mcp_servers": in})
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status %d, want 400: %s", rec.Code, rec.Body.String())
	}
	if store.lastBatch != nil {
		t.Errorf("nothing may be written on a rejected save, got %+v", store.lastBatch)
	}
}

func TestUpdateSiteConfig_MCPMaskWithoutStoreRead500(t *testing.T) {
	store := &mockStore{err: errors.New("db down")}
	in := `[{"name":"fetch","url":"https://fetch.example/mcp","headers":{"Authorization":"********"}}]`

	rec := post(t, store, map[string]any{"mcp_servers": in})
	if rec.Code != http.StatusInternalServerError {
		t.Fatalf("status %d, want 500: %s", rec.Code, rec.Body.String())
	}
	if store.lastBatch != nil {
		t.Errorf("the mask must never be written, got %+v", store.lastBatch)
	}
}

func TestUpdateSiteConfig_WholeMCPMaskIsUnchanged(t *testing.T) {
	store := &mockStore{}
	if rec := post(t, store, map[string]any{"mcp_servers": "********", "kb_header": "x"}); rec.Code != http.StatusOK {
		t.Fatalf("status %d: %s", rec.Code, rec.Body.String())
	}
	if _, ok := written(store, "mcp_servers"); ok {
		t.Error("a fully masked mcp_servers means unchanged and must not be written")
	}
}

// The update response echoes the saved rows; it must mask them like GET does.
func TestUpdateSiteConfig_ResponseMasksSecrets(t *testing.T) {
	store := &mockStore{batchRows: []siteconfig.SiteConfigRow{
		{Key: "google_search_api_key", Value: strPtr("AIzaSyTestOnly0123456789")},
		{Key: "mcp_servers", Value: strPtr(storedMCPServers)},
	}}
	rec := post(t, store, map[string]any{"google_search_api_key": "AIzaSyTestOnly0123456789"})
	if rec.Code != http.StatusOK {
		t.Fatalf("status %d: %s", rec.Code, rec.Body.String())
	}
	if strings.Contains(rec.Body.String(), "AIzaSyTestOnly0123456789") || strings.Contains(rec.Body.String(), mcpToken) {
		t.Errorf("update response echoes a secret: %s", rec.Body.String())
	}
}

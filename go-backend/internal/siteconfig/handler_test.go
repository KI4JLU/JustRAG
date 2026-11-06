package siteconfig_test

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/justrag/go-backend/internal/auth"
	"github.com/justrag/go-backend/internal/siteconfig"
)

var _ siteconfig.Store = (*mockStore)(nil)

type mockStore struct {
	rows      []siteconfig.SiteConfigRow
	err       error
	batchRows []siteconfig.SiteConfigRow
	batchErr  error

	lastBatch []siteconfig.KeyValue // captures what UpdateSiteConfigsBatch received
}

func (m *mockStore) GetAllSiteConfigs(ctx context.Context) ([]siteconfig.SiteConfigRow, error) {
	return m.rows, m.err
}

func (m *mockStore) UpdateSiteConfigsBatch(ctx context.Context, configs []siteconfig.KeyValue) ([]siteconfig.SiteConfigRow, error) {
	m.lastBatch = configs
	return m.batchRows, m.batchErr
}

func strPtr(s string) *string {
	return &s
}

func makeRows() []siteconfig.SiteConfigRow {
	return []siteconfig.SiteConfigRow{
		// Leftovers of removed settings: an uploaded logo, the imprint text.
		{Key: "logo_path", Value: strPtr("/uploads/logo/logo_1.png")},
		{Key: "imprint", Value: strPtr("Some imprint text")},
		{Key: "confluence_enabled", Value: strPtr("true")},
		{Key: "web_search_enabled", Value: strPtr("true")},
		{Key: "chat_web_search_enabled", Value: strPtr("false")},
		{Key: "academic_search_enabled", Value: strPtr("false")},
		{Key: "academic_search_name", Value: strPtr("Scholar")},
		{Key: "google_search_api_key", Value: strPtr("secret-api-key")},
		{Key: "openai_api_key", Value: strPtr("sk-secret")},
		{Key: "null_value_key", Value: nil},
	}
}

func TestGetSiteConfig_Unauthenticated(t *testing.T) {
	store := &mockStore{rows: makeRows()}
	h := siteconfig.NewHandler(store)

	req := httptest.NewRequest(http.MethodGet, "/api/site-config", nil)
	rec := httptest.NewRecorder()
	h.GetSiteConfig(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", rec.Code)
	}

	var body map[string]string
	if err := json.NewDecoder(rec.Body).Decode(&body); err != nil {
		t.Fatalf("failed to decode response: %v", err)
	}

	// Public keys should be present. chat_web_search_enabled is public so the
	// UI can hide the per-turn web-search toggle when the admin gate is off.
	publicKeys := []string{
		"confluence_enabled", "web_search_enabled",
		"chat_web_search_enabled",
		"academic_search_enabled", "academic_search_name",
	}
	for _, k := range publicKeys {
		if _, ok := body[k]; !ok {
			t.Errorf("expected public key %q to be present", k)
		}
	}

	// Secret keys must be absent, and so must the leftovers of removed
	// settings: nothing renders them any more.
	secretKeys := []string{"google_search_api_key", "openai_api_key", "logo_path", "imprint"}
	for _, k := range secretKeys {
		if _, ok := body[k]; ok {
			t.Errorf("expected secret key %q to be filtered out for unauthenticated user", k)
		}
	}

	// NULL value key must be absent
	if _, ok := body["null_value_key"]; ok {
		t.Error("expected null_value_key to be absent")
	}
}

func TestGetSiteConfig_Admin(t *testing.T) {
	store := &mockStore{rows: makeRows()}
	h := siteconfig.NewHandler(store)

	req := httptest.NewRequest(http.MethodGet, "/api/site-config", nil)
	ctx := auth.WithUser(req.Context(), &auth.Claims{
		ID:   "1",
		Role: "admin",
	})
	req = req.WithContext(ctx)

	rec := httptest.NewRecorder()
	h.GetSiteConfig(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", rec.Code)
	}

	var body map[string]string
	if err := json.NewDecoder(rec.Body).Decode(&body); err != nil {
		t.Fatalf("failed to decode response: %v", err)
	}

	// All non-null keys should be present
	expectedKeys := []string{
		"imprint", "confluence_enabled", "web_search_enabled",
		"academic_search_enabled", "academic_search_name",
		"google_search_api_key", "openai_api_key",
	}
	for _, k := range expectedKeys {
		if _, ok := body[k]; !ok {
			t.Errorf("expected admin to see key %q", k)
		}
	}

	// NULL value key must still be absent
	if _, ok := body["null_value_key"]; ok {
		t.Error("expected null_value_key to be absent even for admin")
	}
}

func TestGetSiteConfig_Superadmin(t *testing.T) {
	store := &mockStore{rows: makeRows()}
	h := siteconfig.NewHandler(store)

	req := httptest.NewRequest(http.MethodGet, "/api/site-config", nil)
	ctx := auth.WithUser(req.Context(), &auth.Claims{
		ID:   "2",
		Role: "superadmin",
	})
	req = req.WithContext(ctx)

	rec := httptest.NewRecorder()
	h.GetSiteConfig(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", rec.Code)
	}

	var body map[string]string
	if err := json.NewDecoder(rec.Body).Decode(&body); err != nil {
		t.Fatalf("failed to decode response: %v", err)
	}

	// Superadmin should see all non-null keys including secrets
	if _, ok := body["google_search_api_key"]; !ok {
		t.Error("expected superadmin to see google_search_api_key")
	}
	if _, ok := body["openai_api_key"]; !ok {
		t.Error("expected superadmin to see openai_api_key")
	}
}

func TestGetSiteConfig_RegularUser(t *testing.T) {
	store := &mockStore{rows: makeRows()}
	h := siteconfig.NewHandler(store)

	req := httptest.NewRequest(http.MethodGet, "/api/site-config", nil)
	ctx := auth.WithUser(req.Context(), &auth.Claims{
		ID:   "3",
		Role: "user",
	})
	req = req.WithContext(ctx)

	rec := httptest.NewRecorder()
	h.GetSiteConfig(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", rec.Code)
	}

	var body map[string]string
	if err := json.NewDecoder(rec.Body).Decode(&body); err != nil {
		t.Fatalf("failed to decode response: %v", err)
	}

	// Regular user should not see secret keys
	if _, ok := body["google_search_api_key"]; ok {
		t.Error("expected regular user to not see google_search_api_key")
	}
	if _, ok := body["openai_api_key"]; ok {
		t.Error("expected regular user to not see openai_api_key")
	}

	// But should see public keys
	if _, ok := body["confluence_enabled"]; !ok {
		t.Error("expected regular user to see confluence_enabled")
	}
}

func TestGetSiteConfig_AdminSecretIsMasked(t *testing.T) {
	store := &mockStore{rows: makeRows()}
	h := siteconfig.NewHandler(store)

	req := httptest.NewRequest(http.MethodGet, "/api/site-config", nil)
	req = req.WithContext(auth.WithUser(req.Context(), &auth.Claims{ID: "1", Role: "admin"}))
	rec := httptest.NewRecorder()
	h.GetSiteConfig(rec, req)

	var body map[string]string
	if err := json.NewDecoder(rec.Body).Decode(&body); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if body["google_search_api_key"] == "secret-api-key" {
		t.Error("admin response leaked the raw google_search_api_key")
	}
	if body["google_search_api_key"] != "********" {
		t.Errorf("expected masked google_search_api_key, got %q", body["google_search_api_key"])
	}
}

func TestUpdateSiteConfig_MaskedSecretIsPreserved(t *testing.T) {
	store := &mockStore{batchRows: []siteconfig.SiteConfigRow{}}
	h := siteconfig.NewHandler(store)

	// The admin saves the form without changing the masked key.
	body := strings.NewReader(`{"configs":{"google_search_api_key":"********","academic_search_name":"new"}}`)
	req := httptest.NewRequest(http.MethodPost, "/api/site-config", body)
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	h.UpdateSiteConfig(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rec.Code, rec.Body.String())
	}
	for _, kv := range store.lastBatch {
		if kv.Key == "google_search_api_key" {
			t.Errorf("masked secret should not have been written, got value %v", kv.Value)
		}
	}
	// The non-secret edit must still go through.
	var sawName bool
	for _, kv := range store.lastBatch {
		if kv.Key == "academic_search_name" {
			sawName = true
		}
	}
	if !sawName {
		t.Error("expected non-secret academic_search_name update to be persisted")
	}
}

// ---------------------------------------------------------------------------
// UpdateSiteConfig tests
// ---------------------------------------------------------------------------

func TestUpdateSiteConfig_ValidBody(t *testing.T) {
	val := "updated"
	store := &mockStore{
		batchRows: []siteconfig.SiteConfigRow{
			{Key: "academic_search_name", Value: &val},
		},
	}
	h := siteconfig.NewHandler(store)

	body := strings.NewReader(`{"configs":{"academic_search_name":"updated"}}`)
	req := httptest.NewRequest(http.MethodPost, "/api/site-config", body)
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()

	h.UpdateSiteConfig(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rec.Code, rec.Body.String())
	}

	var result map[string]string
	if err := json.NewDecoder(rec.Body).Decode(&result); err != nil {
		t.Fatalf("failed to decode response: %v", err)
	}
	if result["academic_search_name"] != "updated" {
		t.Errorf("expected academic_search_name=updated, got %q", result["academic_search_name"])
	}
}

func TestUpdateSiteConfig_MissingConfigs(t *testing.T) {
	store := &mockStore{}
	h := siteconfig.NewHandler(store)

	body := strings.NewReader(`{}`)
	req := httptest.NewRequest(http.MethodPost, "/api/site-config", body)
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()

	h.UpdateSiteConfig(rec, req)

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d", rec.Code)
	}
}

func TestUpdateSiteConfig_InvalidJSON(t *testing.T) {
	store := &mockStore{}
	h := siteconfig.NewHandler(store)

	body := strings.NewReader(`not-json`)
	req := httptest.NewRequest(http.MethodPost, "/api/site-config", body)
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()

	h.UpdateSiteConfig(rec, req)

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d", rec.Code)
	}
}

// ---------------------------------------------------------------------------
// App name (APP_NAME_PREFIX / APP_NAME_PRODUCT)
// ---------------------------------------------------------------------------

// Oracle: the web app reads app_name_prefix / app_name_product from this
// answer for every viewer, logged in or not (web/src/utils/appName.ts).
func TestGetSiteConfig_AppNameForEveryViewer(t *testing.T) {
	roles := []string{"", "user", "admin", "superadmin"}
	for _, role := range roles {
		t.Run("role="+role, func(t *testing.T) {
			h := siteconfig.NewHandler(&mockStore{rows: makeRows()}, siteconfig.WithAppName("THM", "Docs"))
			req := httptest.NewRequest(http.MethodGet, "/api/site-config", nil)
			if role != "" {
				req = req.WithContext(auth.WithUser(req.Context(), &auth.Claims{ID: "1", Role: role}))
			}
			rec := httptest.NewRecorder()
			h.GetSiteConfig(rec, req)

			var body map[string]string
			if err := json.NewDecoder(rec.Body).Decode(&body); err != nil {
				t.Fatalf("decode: %v", err)
			}
			if body["app_name_prefix"] != "THM" || body["app_name_product"] != "Docs" {
				t.Errorf("got %q/%q, want THM/Docs", body["app_name_prefix"], body["app_name_product"])
			}
		})
	}
}

func TestGetSiteConfig_AppNameBeatsAStoredRow(t *testing.T) {
	rows := append(makeRows(),
		siteconfig.SiteConfigRow{Key: "app_name_prefix", Value: strPtr("stale")},
		siteconfig.SiteConfigRow{Key: "app_name_product", Value: strPtr("stale")},
	)
	h := siteconfig.NewHandler(&mockStore{rows: rows}, siteconfig.WithAppName("JLU", "RAG"))
	req := httptest.NewRequest(http.MethodGet, "/api/site-config", nil)
	req = req.WithContext(auth.WithUser(req.Context(), &auth.Claims{ID: "1", Role: "superadmin"}))
	rec := httptest.NewRecorder()
	h.GetSiteConfig(rec, req)

	var body map[string]string
	if err := json.NewDecoder(rec.Body).Decode(&body); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if body["app_name_prefix"] != "JLU" || body["app_name_product"] != "RAG" {
		t.Errorf("got %q/%q, want the environment's JLU/RAG", body["app_name_prefix"], body["app_name_product"])
	}
}

func TestGetSiteConfig_NoAppNameWithoutOption(t *testing.T) {
	h := siteconfig.NewHandler(&mockStore{rows: makeRows()})
	req := httptest.NewRequest(http.MethodGet, "/api/site-config", nil)
	rec := httptest.NewRecorder()
	h.GetSiteConfig(rec, req)

	var body map[string]string
	if err := json.NewDecoder(rec.Body).Decode(&body); err != nil {
		t.Fatalf("decode: %v", err)
	}
	for _, k := range []string{"app_name_prefix", "app_name_product"} {
		if _, ok := body[k]; ok {
			t.Errorf("expected %q to be absent without WithAppName", k)
		}
	}
}

// The admin dialog posts back the whole map it fetched, app name included.
func TestUpdateSiteConfig_AppNameIsNotStored(t *testing.T) {
	store := &mockStore{batchRows: []siteconfig.SiteConfigRow{}}
	h := siteconfig.NewHandler(store, siteconfig.WithAppName("JLU", "RAG"))

	body := strings.NewReader(`{"configs":{"app_name_prefix":"JLU","app_name_product":"RAG","academic_search_name":"new"}}`)
	req := httptest.NewRequest(http.MethodPost, "/api/site-config", body)
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	h.UpdateSiteConfig(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rec.Code, rec.Body.String())
	}
	if len(store.lastBatch) != 1 || store.lastBatch[0].Key != "academic_search_name" {
		t.Errorf("expected only academic_search_name to be written, got %+v", store.lastBatch)
	}
}

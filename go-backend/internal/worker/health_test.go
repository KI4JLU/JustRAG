package worker

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestHealthServer_Liveness(t *testing.T) {
	hs := NewHealthServer(0) // port 0 = ephemeral, won't actually listen in this test

	// Directly test the handler via the internal mux.
	req := httptest.NewRequest("GET", "/healthz", nil)
	rec := httptest.NewRecorder()
	hs.srv.Handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Errorf("expected 200, got %d", rec.Code)
	}
	if rec.Body.String() != "ok" {
		t.Errorf("expected body 'ok', got %q", rec.Body.String())
	}
}

func TestHealthServer_Metrics(t *testing.T) {
	hs := NewHealthServer(0)

	req := httptest.NewRequest("GET", "/metrics", nil)
	rec := httptest.NewRecorder()
	hs.srv.Handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", rec.Code)
	}
	// promhttp always emits the Go runtime collectors on the default registry.
	body := rec.Body.String()
	if !strings.Contains(body, "go_goroutines") {
		t.Errorf("expected prometheus text exposition (go_goroutines), got %d bytes", len(body))
	}
}

func TestHealthServer_Readiness_NotReady(t *testing.T) {
	hs := NewHealthServer(0)
	// Default is not ready.

	req := httptest.NewRequest("GET", "/readyz", nil)
	rec := httptest.NewRecorder()
	hs.srv.Handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusServiceUnavailable {
		t.Errorf("expected 503, got %d", rec.Code)
	}
}

func TestHealthServer_Readiness_Ready(t *testing.T) {
	hs := NewHealthServer(0)
	hs.SetReady(true)

	req := httptest.NewRequest("GET", "/readyz", nil)
	rec := httptest.NewRecorder()
	hs.srv.Handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Errorf("expected 200, got %d", rec.Code)
	}
}

func TestHealthServer_ReadinessToggle(t *testing.T) {
	hs := NewHealthServer(0)
	hs.SetReady(true)
	hs.SetReady(false)

	req := httptest.NewRequest("GET", "/readyz", nil)
	rec := httptest.NewRecorder()
	hs.srv.Handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusServiceUnavailable {
		t.Errorf("expected 503 after SetReady(false), got %d", rec.Code)
	}
}

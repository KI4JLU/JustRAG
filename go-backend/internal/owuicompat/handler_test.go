package owuicompat

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestGateOffAnswers404Detail(t *testing.T) {
	h := NewHandler(Deps{Store: newFakeStore(), Config: fakeConfig{enabled: false}})
	rec := do(h.Gate(http.HandlerFunc(h.Models)), httptest.NewRequest("GET", "/owui/api/models", nil))
	if rec.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want 404", rec.Code)
	}
	var body map[string]string
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil || body["detail"] == "" {
		t.Fatalf("body = %s, want {\"detail\":…}", rec.Body.String())
	}
}

func TestModelsListsOneModel(t *testing.T) {
	h := NewHandler(Deps{Store: newFakeStore(), Config: fakeConfig{enabled: true}})
	rec := do(h.Gate(http.HandlerFunc(h.Models)), httptest.NewRequest("GET", "/owui/api/models", nil))
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d", rec.Code)
	}
	var body struct {
		Data []struct{ ID, Object string } `json:"data"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil || len(body.Data) != 1 || body.Data[0].ID != ModelID {
		t.Fatalf("body = %s", rec.Body.String())
	}
}

func TestNoUserIs401Detail(t *testing.T) {
	h := NewHandler(Deps{Store: newFakeStore(), Config: fakeConfig{enabled: true}})
	rec := httptest.NewRecorder()
	h.Gate(http.HandlerFunc(h.Models)).ServeHTTP(rec, httptest.NewRequest("GET", "/owui/api/models", nil))
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d, want 401", rec.Code)
	}
}

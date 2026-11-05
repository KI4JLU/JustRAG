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

// The plugin shows the model's name; it is the app's name, the id stays.
// Oracle: docs/api-contracts/owui-compat.md (GET /owui/api/models).
func TestModelsNamedAfterTheApp(t *testing.T) {
	for _, tc := range []struct{ appName, want string }{{"THM Docs", "THM Docs"}, {"", ModelID}} {
		h := NewHandler(Deps{Store: newFakeStore(), Config: fakeConfig{enabled: true}, AppName: tc.appName})
		rec := do(h.Gate(http.HandlerFunc(h.Models)), httptest.NewRequest("GET", "/owui/api/models", nil))
		var body struct {
			Data []struct{ ID, Name string } `json:"data"`
		}
		if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil || len(body.Data) != 1 {
			t.Fatalf("body = %s", rec.Body.String())
		}
		if body.Data[0].Name != tc.want || body.Data[0].ID != ModelID {
			t.Errorf("AppName %q: model = %+v, want name %q and id %q", tc.appName, body.Data[0], tc.want, ModelID)
		}
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

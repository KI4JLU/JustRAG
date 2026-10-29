package kbbehavior

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

// Oracle: API.md "Role writer" — bad input is refused before any model call.
func TestRoleWriter_RefusesBadInput(t *testing.T) {
	h := NewRoleWriterHandler(nil, nil)
	long := strings.Repeat("x", MaxRoleWriterInputRunes+1)
	cases := []struct {
		name string
		fn   http.HandlerFunc
		body string
	}{
		{"empty description", h.Generate, `{"description":" ","language":"de"}`},
		{"long description", h.Generate, `{"description":"` + long + `","language":"de"}`},
		{"unknown field", h.Generate, `{"description":"x","extra":1}`},
		{"empty prompt", h.Revise, `{"prompt":"","instruction":"kürzer","language":"de"}`},
		{"empty instruction", h.Revise, `{"prompt":"P","instruction":" ","language":"de"}`},
		{"describe without a prompt", h.Describe, `{"name":"Tutor","prompt":" ","language":"de"}`},
	}
	for _, c := range cases {
		rec := httptest.NewRecorder()
		c.fn(rec, httptest.NewRequest(http.MethodPost, "/api/kb/kb-1/behavior/role-writer", strings.NewReader(c.body)))
		if rec.Code != http.StatusBadRequest {
			t.Errorf("%s: status %d, want 400", c.name, rec.Code)
		}
	}
}

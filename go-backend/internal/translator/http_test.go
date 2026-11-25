package translator

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/justrag/go-backend/internal/ai"
	"github.com/justrag/go-backend/internal/auth"
	"github.com/justrag/go-backend/internal/logctx"
)

type mapReader map[string]string

func (m mapReader) GetSiteConfigValue(_ context.Context, key string) (*string, error) {
	if v, ok := m[key]; ok {
		return &v, nil
	}
	return nil, nil
}

func newTestHandler(cfg mapReader, c Completer) *Handler {
	return NewHandler(NewService(c, nil), c, cfg)
}

func post(h http.HandlerFunc, body string, authed bool) *httptest.ResponseRecorder {
	req := httptest.NewRequest(http.MethodPost, "/x", strings.NewReader(body))
	if authed {
		req = req.WithContext(auth.WithUser(req.Context(), &auth.Claims{ID: "u1", Role: "user"}))
	}
	rec := httptest.NewRecorder()
	h(rec, req)
	return rec
}

func TestEnabledGateAndConfig(t *testing.T) {
	off := newTestHandler(mapReader{}, &fakeCompleter{})
	next := http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(http.StatusNoContent) })
	rec := httptest.NewRecorder()
	off.RequireEnabled(next).ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/x", nil))
	if rec.Code != http.StatusForbidden || !strings.Contains(rec.Body.String(), "translator_disabled") {
		t.Errorf("off by default: %d %s", rec.Code, rec.Body.String())
	}

	on := newTestHandler(mapReader{KeyEnabled: "true", KeyDefaultTarget: "de"}, &fakeCompleter{})
	rec = httptest.NewRecorder()
	on.RequireEnabled(next).ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/x", nil))
	if rec.Code != http.StatusNoContent {
		t.Errorf("on: %d", rec.Code)
	}

	for _, tc := range []struct {
		cfg     mapReader
		enabled bool
		target  string
	}{
		{mapReader{}, false, "en-gb"},
		{mapReader{KeyEnabled: "true", KeyDefaultTarget: "fr"}, true, "fr"},
		{mapReader{KeyEnabled: "true", KeyDefaultTarget: "klingon"}, true, "en-gb"},
	} {
		rec = httptest.NewRecorder()
		newTestHandler(tc.cfg, &fakeCompleter{}).Config(rec, httptest.NewRequest(http.MethodGet, "/x", nil))
		var cfg configResponse
		if err := json.Unmarshal(rec.Body.Bytes(), &cfg); err != nil {
			t.Fatal(err)
		}
		if rec.Code != http.StatusOK || cfg.Enabled != tc.enabled || cfg.DefaultTargetLanguage != tc.target || cfg.Model != "fast-model" || cfg.ModelSource != ModelSourceFastTier ||
			cfg.Limits.TextMax != TextMax || len(cfg.Languages) == 0 {
			t.Errorf("config(%v) = %+v", tc.cfg, cfg)
		}
	}
}

// With no Fast Tier model set, the provider's default chat model answers, and
// the config says so, so that the admin does not read it as the Fast Tier.
func TestConfigReportsWhereTheModelComesFrom(t *testing.T) {
	rec := httptest.NewRecorder()
	newTestHandler(mapReader{KeyEnabled: "true"}, &fakeCompleter{source: ModelSourceDefault}).
		Config(rec, httptest.NewRequest(http.MethodGet, "/x", nil))
	var cfg configResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &cfg); err != nil {
		t.Fatal(err)
	}
	if cfg.Model != "fast-model" || cfg.ModelSource != "default" {
		t.Errorf("model = %q from %q, want fast-model from default", cfg.Model, cfg.ModelSource)
	}
}

func TestTextRoutes(t *testing.T) {
	c := &fakeCompleter{answer: `{"text":["Hello"],"detected_source_language":"de"}`}
	h := newTestHandler(mapReader{KeyEnabled: "true"}, c)

	rec := post(h.Translate, `{"text":["Hallo"],"source":null,"target":"en-gb"}`, true)
	if rec.Code != http.StatusOK || !strings.Contains(rec.Body.String(), `"detectedSource":"de"`) {
		t.Errorf("translate: %d %s", rec.Code, rec.Body.String())
	}
	if rec := post(h.Translate, `{"text":["Hallo"],"target":"xx"}`, true); rec.Code != http.StatusBadRequest ||
		strings.Contains(rec.Body.String(), "translator: invalid request") {
		t.Errorf("invalid request: %d %s (the sentinel prefix must not leak)", rec.Code, rec.Body.String())
	}
	if rec := post(h.Translate, `nope`, true); rec.Code != http.StatusBadRequest {
		t.Errorf("not json: %d", rec.Code)
	}
	if rec := post(h.Translate, `{"text":["Hallo"],"target":"de"}`, false); rec.Code != http.StatusUnauthorized {
		t.Errorf("anonymous: %d", rec.Code)
	}

	c.answer = `{"language":"fr"}`
	if rec := post(h.Detect, `{"text":"Bonjour"}`, true); rec.Code != http.StatusOK || !strings.Contains(rec.Body.String(), `"language":"fr"`) {
		t.Errorf("detect: %d %s", rec.Code, rec.Body.String())
	}
	c.answer = `{"suggestions":["x"]}`
	if rec := post(h.Suggest, `{"kind":"alternatives","text":"Satz."}`, true); rec.Code != http.StatusOK || !strings.Contains(rec.Body.String(), `"suggestions":["x"]`) {
		t.Errorf("suggest: %d %s", rec.Code, rec.Body.String())
	}
	c.answer = `{"text":["Besser"]}`
	if rec := post(h.Rephrase, `{"text":["Gut"]}`, true); rec.Code != http.StatusOK {
		t.Errorf("rephrase: %d %s", rec.Code, rec.Body.String())
	}

	c.err = ErrModel
	if rec := post(h.Translate, `{"text":["Hallo"],"target":"de"}`, true); rec.Code != http.StatusBadGateway || !strings.Contains(rec.Body.String(), "translator_model_failed") {
		t.Errorf("model failure: %d %s", rec.Code, rec.Body.String())
	}
}

// The cause of a failed model call reaches the client as a status and a code it
// can word for the user: a timeout, a provider that cannot be used, anything else.
func TestModelFailureCauses(t *testing.T) {
	tests := []struct {
		name string
		err  error
		code int
		want string
	}{
		{"timeout", classifyModelError(context.DeadlineExceeded), http.StatusGatewayTimeout, "translator_model_timeout"},
		{"no usable provider", classifyModelError(ai.ErrNoActiveProvider), http.StatusServiceUnavailable, "translator_model_unavailable"},
		{"rejected key", classifyModelError(&ai.APIError{StatusCode: http.StatusUnauthorized}), http.StatusServiceUnavailable, "translator_model_unavailable"},
		{"anything else", classifyModelError(errors.New("boom")), http.StatusBadGateway, "translator_model_failed"},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			h := newTestHandler(mapReader{KeyEnabled: "true"}, &fakeCompleter{err: tc.err})
			rec := post(h.Translate, `{"text":["Hallo"],"target":"de"}`, true)
			if rec.Code != tc.code || !strings.Contains(rec.Body.String(), tc.want) {
				t.Errorf("%d %s, want %d %s", rec.Code, rec.Body.String(), tc.code, tc.want)
			}
		})
	}
}

// A client that left is no model failure: nothing is logged as one and the
// status says so.
func TestClientThatLeftGetsNoModelError(t *testing.T) {
	h := newTestHandler(mapReader{KeyEnabled: "true"}, &fakeCompleter{err: classifyModelError(context.Canceled)})
	req := httptest.NewRequest(http.MethodPost, "/x", strings.NewReader(`{"text":["Hallo"],"target":"de"}`))
	ctx, cancel := context.WithCancel(auth.WithUser(req.Context(), &auth.Claims{ID: "u1", Role: "user"}))
	cancel()
	rec := httptest.NewRecorder()
	h.Translate(rec, req.WithContext(ctx))
	if rec.Code != statusClientClosedRequest || rec.Body.Len() != 0 {
		t.Errorf("a client that left: %d %q", rec.Code, rec.Body.String())
	}
}

// The text limit that counts is the decoded one, in characters. A JSON body may
// escape every character outside the Basic Multilingual Plane as two \uXXXX
// escapes (12 bytes), so the body cap must be wide enough for a text at the
// limit written that way.
func TestTextBodyCapAllowsEscapedSupplementaryCharacters(t *testing.T) {
	// One supplementary character as the JSON escape of its surrogate pair: twelve bytes.
	const backslash = "\x5c"
	pair := backslash + "ud83d" + backslash + "ude00"
	escaped := func(n int) string { return strings.Repeat(pair, n) }
	body := func(n int) string { return `{"text":["` + escaped(n) + `"],"target":"de"}` }
	h := newTestHandler(mapReader{KeyEnabled: "true"}, &fakeCompleter{answer: `{"text":["x"]}`})

	if rec := post(h.Translate, body(25_000), true); rec.Code != http.StatusOK {
		t.Errorf("25,000 escaped supplementary characters: %d %s, want 200", rec.Code, rec.Body.String())
	}
	if rec := post(h.Translate, body(TextMax), true); rec.Code != http.StatusOK {
		t.Errorf("exactly %d characters, escaped: %d %s, want 200", TextMax, rec.Code, rec.Body.String())
	}
	// One character over the real limit is the request's own 400, not a body-size error.
	if rec := post(h.Translate, body(TextMax+1), true); rec.Code != http.StatusBadRequest || !strings.Contains(rec.Body.String(), "50000") {
		t.Errorf("%d characters: %d %s, want the 400 of the character limit", TextMax+1, rec.Code, rec.Body.String())
	}
	// A body past the wire cap is refused as too large.
	if rec := post(h.Translate, body(TextMax*2), true); rec.Code != http.StatusRequestEntityTooLarge {
		t.Errorf("a body over the cap: %d, want 413", rec.Code)
	}
	if textBodyMaxBytes >= 1<<20 {
		t.Errorf("the text body cap %d must stay under the server's global 1 MiB cap", textBodyMaxBytes)
	}
}

// A provider's error body may echo the submitted text and the glossary terms. A
// failed call is logged by class and status only, and the client never sees it.
func TestModelFailureLogsNeverCarryTheProviderBody(t *testing.T) {
	const canary = "CANARY-SUBMITTED-TEXT-0815"
	cause := &ai.APIError{StatusCode: http.StatusBadRequest, Body: `{"error":"cannot process ` + canary + `"}`}
	h := newTestHandler(mapReader{KeyEnabled: "true"}, &fakeCompleter{err: classifyModelError(fmt.Errorf("ai: completion failed: %w", cause))})

	var logs bytes.Buffer
	logctx.SetBase(slog.New(slog.NewTextHandler(&logs, &slog.HandlerOptions{Level: slog.LevelDebug})))
	t.Cleanup(func() { logctx.SetBase(nil) })

	rec := post(h.Translate, `{"text":["Hallo"],"target":"de"}`, true)
	if rec.Code != http.StatusBadGateway {
		t.Fatalf("status = %d, want 502", rec.Code)
	}
	if strings.Contains(rec.Body.String(), canary) {
		t.Errorf("the provider body reached the client: %s", rec.Body.String())
	}
	logged := logs.String()
	if !strings.Contains(logged, "translator model call failed") {
		t.Fatalf("no warning logged: %q", logged)
	}
	if strings.Contains(logged, canary) {
		t.Errorf("the provider body reached the log: %s", logged)
	}
	if !strings.Contains(logged, "failure=upstream_status") || !strings.Contains(logged, "upstream_status=400") {
		t.Errorf("the warning should carry the failure class and status: %s", logged)
	}
}

func TestModelFailureClassOfAnEmptyAnswer(t *testing.T) {
	if class, status := modelFailureClass(ErrEmptyAnswer); class != failureEmptyAnswer || status != 0 {
		t.Errorf("modelFailureClass(ErrEmptyAnswer) = %q, %d", class, status)
	}
	h := newTestHandler(mapReader{KeyEnabled: "true"}, &fakeCompleter{answer: `{"text":null}`})
	if rec := post(h.Translate, `{"text":["Hallo"],"target":"de"}`, true); rec.Code != http.StatusBadGateway || !strings.Contains(rec.Body.String(), "translator_model_failed") {
		t.Errorf("an empty model answer: %d %s, want 502 translator_model_failed", rec.Code, rec.Body.String())
	}
}

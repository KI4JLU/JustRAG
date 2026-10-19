package ai

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

// Oracle: vLLM's listing shape — max_model_len becomes ContextWindow, a
// server without it reports 0.
func TestModelInfos(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v1/models" {
			t.Errorf("path %q, want /v1/models", r.URL.Path)
		}
		_, _ = w.Write([]byte(`{"data":[{"id":"gemma","max_model_len":262144},{"id":"plain"}]}`))
	}))
	defer srv.Close()
	got, err := NewClient(srv.URL+"/v1/", "k").ModelInfos(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if len(got) != 2 || got[0] != (ModelInfo{ID: "gemma", ContextWindow: 262144}) || got[1] != (ModelInfo{ID: "plain"}) {
		t.Fatalf("got %+v", got)
	}
}

// Oracle: a LiteLLM proxy reports no max_model_len in /models; the windows
// come from /model/info at the server root, max_input_tokens first.
func TestModelInfos_LiteLLM(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/v1/models":
			_, _ = w.Write([]byte(`{"data":[{"id":"jlu/gemma"},{"id":"jlu/qwen"},{"id":"jlu/none"}]}`))
		case "/model/info":
			_, _ = w.Write([]byte(`{"data":[
				{"model_name":"jlu/gemma","model_info":{"max_input_tokens":196608,"max_tokens":256000}},
				{"model_name":"jlu/qwen","model_info":{"max_tokens":131072}},
				{"model_name":"jlu/none","model_info":null}]}`))
		default:
			t.Errorf("unexpected path %q", r.URL.Path)
		}
	}))
	defer srv.Close()
	got, err := NewClient(srv.URL+"/v1/", "k").ModelInfos(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	want := []ModelInfo{{ID: "jlu/gemma", ContextWindow: 196608}, {ID: "jlu/qwen", ContextWindow: 131072}, {ID: "jlu/none"}}
	if len(got) != 3 || got[0] != want[0] || got[1] != want[1] || got[2] != want[2] {
		t.Fatalf("got %+v, want %+v", got, want)
	}
}

// Oracle: /tokenize lives at the server root next to /v1 (vLLM), and counts
// the text without special tokens.
func TestCountTokens(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/tokenize" {
			t.Errorf("path %q, want /tokenize", r.URL.Path)
		}
		var req tokenizeRequest
		_ = json.NewDecoder(r.Body).Decode(&req)
		if req.Model != "gemma" || req.Prompt != "hello" || req.AddSpecialTokens {
			t.Errorf("request %+v", req)
		}
		_, _ = w.Write([]byte(`{"count":7,"max_model_len":262144,"tokens":[1,2,3,4,5,6,7]}`))
	}))
	defer srv.Close()
	n, err := NewClient(srv.URL+"/v1/", "").CountTokens(context.Background(), "gemma", "hello")
	if err != nil || n != 7 {
		t.Fatalf("got %d, %v; want 7", n, err)
	}
}

func TestServerRootURL(t *testing.T) {
	for in, want := range map[string]string{
		"http://h:8000/v1/": "http://h:8000/",
		"http://h:8000/":    "http://h:8000/",
		"https://x/api/v1/": "https://x/api/",
		"https://x/openai/": "https://x/openai/",
	} {
		if got := NewClient(in, "").serverRootURL(); got != want {
			t.Errorf("%q → %q, want %q", in, got, want)
		}
	}
}

// Oracle: the resolver exposes the admin-set window per chat model; unset
// models report 0.
func TestResolvedConfigContextWindow(t *testing.T) {
	c := &ResolvedConfig{ChatContextWindows: map[string]int{"big": 1_000_000}}
	if c.ContextWindow("big") != 1_000_000 || c.ContextWindow("other") != 0 || (*ResolvedConfig)(nil).ContextWindow("big") != 0 {
		t.Fatal("ContextWindow lookup wrong")
	}
}

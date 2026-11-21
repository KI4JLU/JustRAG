package fetcher

import (
	"net/http"
	"net/url"
	"strings"
	"testing"
)

// testRedirect builds a checkRedirect closure with the default 10-hop limit.
func testRedirect() func(*http.Request, []*http.Request) error {
	return newCheckRedirect(DefaultConfig())
}

func TestCheckRedirectRejectsSchemeDowngrade(t *testing.T) {
	t.Parallel()
	check := testRedirect()
	via := []*http.Request{{URL: mustURL("https://safe.example/")}}
	next := &http.Request{URL: mustURL("http://safe.example/")}
	if err := check(next, via); err == nil {
		t.Fatal("expected scheme downgrade to be rejected")
	}
}

func TestCheckRedirectLimit(t *testing.T) {
	t.Parallel()
	check := testRedirect()
	via := make([]*http.Request, 11)
	for i := range via {
		via[i] = &http.Request{URL: mustURL("https://example.com/")}
	}
	next := &http.Request{URL: mustURL("https://example.com/next")}
	err := check(next, via)
	if err == nil || !strings.Contains(err.Error(), "too many redirects") {
		t.Errorf("expected too many redirects, got %v", err)
	}
}

func TestCheckRedirectHonoursConfigMaxRedirects(t *testing.T) {
	t.Parallel()
	cfg := DefaultConfig()
	cfg.MaxRedirects = 3
	check := newCheckRedirect(cfg)
	via := make([]*http.Request, 3)
	for i := range via {
		via[i] = &http.Request{URL: mustURL("https://example.com/")}
	}
	next := &http.Request{URL: mustURL("https://example.com/next")}
	if err := check(next, via); err == nil {
		t.Fatal("expected too many redirects with cfg.MaxRedirects=3 and via length 3")
	}
}

func mustURL(s string) *url.URL {
	u, err := url.Parse(s)
	if err != nil {
		panic("mustURL: failed to parse " + s + ": " + err.Error())
	}
	return u
}

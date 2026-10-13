package redact

import (
	"context"
	"errors"
	"log/slog"
	"net/url"
	"strings"
	"testing"
)

// ORACLE: the secret string itself — it must be absent from the output, and
// the surrounding text (the cause of the error) must survive.
func TestSecrets(t *testing.T) {
	const secret = "AIzaSyTestOnly0123456789abcdef"
	cases := []struct {
		name, in, keep string
	}{
		{"google key query", `Get "https://www.googleapis.com/customsearch/v1?cx=c&key=` + secret + `&q=x": context deadline exceeded`, "context deadline exceeded"},
		{"key first param", `Get "https://h/p?key=` + secret + `": EOF`, "EOF"},
		{"api_key", `https://h/p?api_key=` + secret, "https://h/p?api_key="},
		{"apikey upper", `https://h/p?ApiKey=` + secret, "https://h/p?ApiKey="},
		{"access_token", `https://h/p?a=1&access_token=` + secret + `#frag`, "#frag"},
		{"token", `https://h/p?token=` + secret, "token="},
		{"client_secret", `https://h/p?client_secret=` + secret, "client_secret="},
		{"password param", `https://h/p?password=` + secret, "password="},
		{"aws signature", `https://b.s3.amazonaws.com/o?X-Amz-Signature=` + secret, "X-Amz-Signature="},
		{"aws session token", `https://b/o?X-Amz-Security-Token=` + secret, "X-Amz-Security-Token="},
		{"sig", `https://h/p?sv=1&sig=` + secret, "sv=1"},
		{"oauth code", `https://h/cb?code=` + secret + `&state=s`, "state=s"},
		{"userinfo user:pass", `dial "postgres://app:` + secret + `@db:5432/x": refused`, "@db:5432/x"},
		{"userinfo token only", `clone https://` + secret + `@github.com/o/r failed`, "@github.com/o/r failed"},
		{"bearer header", `{"Authorization":"Bearer ` + secret + `"}`, `{"Authorization":"Bearer `},
		{"bearer escaped json", `{\"Authorization\": \"Bearer ` + secret + `\"}`, `\"}`},
		{"url-encoded inside json", `"input":"https://h/p?key%3D` + secret + `"`, `"input":"https://h/p?key`},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			got := Secrets(c.in)
			if strings.Contains(got, secret) {
				t.Errorf("secret survived: %s", got)
			}
			if !strings.Contains(got, c.keep) {
				t.Errorf("lost context %q: %s", c.keep, got)
			}
		})
	}
}

func TestSecrets_LeavesHarmlessTextAlone(t *testing.T) {
	for _, in := range []string{
		"context deadline exceeded",
		"token limit exceeded for model X",
		"https://h/p?monkey=banana&q=keyboard",
		"https://h/p?cx=abc&num=10",
		"user@example.com wrote",
		"Google API returned status 403: quota exceeded",
		"the bearer of bad news",
	} {
		if got := Secrets(in); got != in {
			t.Errorf("Secrets(%q) = %q, want unchanged", in, got)
		}
	}
}

// A *url.Error is how the Google key leaked; the redacted error must not
// carry it, and must keep the cause.
func TestSecrets_URLError(t *testing.T) {
	const secret = "AIzaSyTestOnly0123456789abcdef"
	err := &url.Error{Op: "Get", URL: "https://h/p?key=" + secret, Err: errors.New("i/o timeout")}
	got := Secrets(err.Error())
	if strings.Contains(got, secret) || !strings.Contains(got, "i/o timeout") {
		t.Errorf("got %q", got)
	}
}

func TestReplaceAttr(t *testing.T) {
	const secret = "AIzaSyTestOnly0123456789abcdef"
	var buf strings.Builder
	log := slog.New(slog.NewJSONHandler(&buf, &slog.HandlerOptions{ReplaceAttr: ReplaceAttr}))

	leaky := &url.Error{Op: "Get", URL: "https://h/p?key=" + secret, Err: errors.New("i/o timeout")}
	log.LogAttrs(context.Background(), slog.LevelWarn, "search failed",
		slog.Any("error", leaky),
		slog.String("detail", "Bearer "+secret),
		slog.String("url", "https://u:"+secret+"@h/"),
		slog.Group("g", slog.String("err", "https://h/?token="+secret)),
		slog.Int("n", 3),
	)
	out := buf.String()
	if strings.Contains(out, secret) {
		t.Errorf("log line leaks the secret: %s", out)
	}
	for _, want := range []string{"i/o timeout", `"n":3`, `"msg":"search failed"`} {
		if !strings.Contains(out, want) {
			t.Errorf("log line lost %q: %s", want, out)
		}
	}
}

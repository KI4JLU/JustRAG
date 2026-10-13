package siteconfig

import (
	"encoding/json"
	"errors"
	"fmt"
	"net/url"
	"strings"
)

// mcpServersKey is a JSON array of remote MCP servers, {name, url, headers};
// the headers carry each server's credentials (typically Authorization:
// Bearer …). Unlike a sensitiveConfigKeys entry the value cannot be masked
// whole — the admin UI edits the list as raw JSON — so every non-empty
// header value is masked instead, and a save that sends the mask back gets
// the stored value restored (restoreMaskedMCPHeaders).
const mcpServersKey = "mcp_servers"

// maskForClient returns the value a client may see for key.
func maskForClient(key, value string) string {
	switch {
	case sensitiveConfigKeys[key] && value != "":
		return siteConfigSecretMask
	case key == mcpServersKey:
		return maskMCPHeaders(value)
	}
	return value
}

// maskMCPHeaders masks every non-empty header value of an mcp_servers
// document. A value that does not parse is masked whole: it may still hold
// a token, and a broken document is not worth leaking for. A document with
// nothing to mask is returned byte-identical.
func maskMCPHeaders(raw string) string {
	if strings.TrimSpace(raw) == "" {
		return raw
	}
	var servers []map[string]any
	if err := json.Unmarshal([]byte(raw), &servers); err != nil {
		return siteConfigSecretMask
	}
	masked := false
	for _, s := range servers {
		headers, _ := s["headers"].(map[string]any)
		for k, v := range headers {
			if v == nil || v == "" {
				continue
			}
			headers[k] = siteConfigSecretMask
			masked = true
		}
	}
	if !masked {
		return raw
	}
	out, err := json.MarshalIndent(servers, "", "  ")
	if err != nil {
		return siteConfigSecretMask
	}
	return string(out)
}

// restoreMaskedMCPHeaders replaces every masked header value in incoming
// with the stored value of the same header on the same server — matched by
// name, then by URL, so a rename or a path edit alone does not force the
// admin to re-enter the token. A changed scheme, host or port does: the
// token never follows a server to a new origin (storedHeader). Every error
// is the client's (a 400), worded
// for the admin. A document without masks is returned unchanged.
func restoreMaskedMCPHeaders(incoming, stored string) (string, error) {
	var in []map[string]any
	if err := json.Unmarshal([]byte(incoming), &in); err != nil {
		return "", errors.New("mcp_servers is not a valid JSON array")
	}
	var st []map[string]any
	_ = json.Unmarshal([]byte(stored), &st) // empty or broken: nothing to restore from

	restored := false
	for _, s := range in {
		headers, _ := s["headers"].(map[string]any)
		for k, v := range headers {
			if v != siteConfigSecretMask {
				continue
			}
			prev, ok := storedHeader(st, s, k)
			if !ok {
				return "", fmt.Errorf("header %q of MCP server %q still holds the masked placeholder; "+
					"enter its value again (required for a new server or a changed host)", k, s["name"])
			}
			headers[k] = prev
			restored = true
		}
	}
	if !restored {
		return incoming, nil
	}
	out, err := json.MarshalIndent(in, "", "  ")
	if err != nil {
		return "", fmt.Errorf("mcp_servers: %w", err)
	}
	return string(out), nil
}

// storedHeader finds header k on the stored server matching s by name, else
// by URL — and only on one with the same origin as s's URL. The admin never
// sees a masked token, so it must never follow a server to a new host:
// restoring it there would send the credential wherever the save points.
func storedHeader(stored []map[string]any, s map[string]any, k string) (any, bool) {
	dest, ok := origin(s["url"])
	if !ok {
		return nil, false
	}
	for _, field := range []string{"name", "url"} {
		want, _ := s[field].(string)
		if want == "" {
			continue
		}
		for _, st := range stored {
			if st[field] != want {
				continue
			}
			if o, ok := origin(st["url"]); !ok || o != dest {
				continue
			}
			headers, _ := st["headers"].(map[string]any)
			if v, ok := headers[k]; ok && v != nil && v != "" && v != siteConfigSecretMask {
				return v, true
			}
		}
	}
	return nil, false
}

// origin returns scheme://host:port of a server URL, lower-cased, with the
// scheme's default port made explicit so "https://h" and "https://h:443"
// compare equal.
func origin(v any) (string, bool) {
	raw, _ := v.(string)
	u, err := url.Parse(raw)
	if err != nil || u.Scheme == "" || u.Hostname() == "" {
		return "", false
	}
	scheme := strings.ToLower(u.Scheme)
	port := u.Port()
	if port == "" {
		switch scheme {
		case "https":
			port = "443"
		case "http":
			port = "80"
		}
	}
	return scheme + "://" + strings.ToLower(u.Hostname()) + ":" + port, true
}

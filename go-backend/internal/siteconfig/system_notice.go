package siteconfig

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/mail"
	"net/url"
	"strconv"
	"strings"
	"unicode"
	"unicode/utf8"

	"github.com/justrag/go-backend/internal/httputil"
)

// The system notice is one admin-set message that every user sees on every
// view (maintenance, a feature in test operation). Its keys are global-only
// and public: the web app reads them from GET /api/site-config for every
// user and renders the notice itself, so nothing on the server reads them
// beyond these save-time checks.
//
// The title, the text and the link label are rendered as plain text, never as HTML or
// Markdown; the link URL is the one value that reaches an attribute, which is
// why it is restricted to http(s) and root-relative paths.
const (
	systemNoticeTextMaxRunes  = 1000
	systemNoticeLabelMaxRunes = 80
	systemNoticeTitleMaxRunes = 80
	systemNoticeURLMaxBytes   = 2048
)

// systemNoticeTones mirrors the tones the admin UI offers (the design
// system's Alert tones minus "success", which a standing message never is).
var systemNoticeTones = map[string]bool{
	"neutral": true,
	"info":    true,
	"warning": true,
	"error":   true,
}

// systemNoticePlacements mirrors where the web app can put the notice: a
// full-width banner above the app, a small message at the top of the content
// area, or a toast bottom right that stays until closed. Empty is the default
// and lets the tone decide (error → banner, every other tone → inline), so a
// deployment that never sets the key keeps the placement it had.
var systemNoticePlacements = map[string]bool{
	"":       true,
	"banner": true,
	"inline": true,
	"toast":  true,
}

// validateBool, validateSystemNoticeTone and validateSystemNoticePlacement
// want the exact stored form: the readers (here and in the web app) compare
// the raw value, so " true " would be accepted and then read as false.
func validateBool(v string) error {
	switch v {
	case "true", "false":
		return nil
	}
	return fmt.Errorf("must be true or false")
}

func validateMaxRunes(max int) func(string) error {
	return func(v string) error {
		if n := utf8.RuneCountInString(v); n > max {
			return fmt.Errorf("must be at most %d characters, got %d", max, n)
		}
		return nil
	}
}

func validateSystemNoticeTone(v string) error {
	if !systemNoticeTones[v] {
		return fmt.Errorf("must be one of neutral, info, warning, error")
	}
	return nil
}

func validateSystemNoticePlacement(v string) error {
	if !systemNoticePlacements[v] {
		return fmt.Errorf("must be empty (placement by tone) or one of banner, inline, toast")
	}
	return nil
}

// validateSystemNoticeURL accepts an absolute http(s) URL with a host, a
// mailto: link to one address ("mailto://" tolerated, the web app writes it
// as "mailto:"), or a root-relative path inside this app ("/kb/…").
// Everything else — another scheme (javascript:, data:), a protocol-relative
// "//host", a bare word — is refused, because the value ends up in an href
// shown to every user.
func validateSystemNoticeURL(v string) error {
	if len(v) > systemNoticeURLMaxBytes {
		return fmt.Errorf("must be at most %d bytes", systemNoticeURLMaxBytes)
	}
	if strings.IndexFunc(v, func(r rune) bool { return unicode.IsSpace(r) || unicode.IsControl(r) }) >= 0 {
		return fmt.Errorf("must not contain spaces or control characters")
	}
	if strings.HasPrefix(v, "/") && !strings.HasPrefix(v, "//") && !strings.HasPrefix(v, `/\`) {
		return nil
	}
	if rest, ok := cutPrefixFold(v, "mailto:"); ok {
		addr, _, _ := strings.Cut(strings.TrimPrefix(rest, "//"), "?")
		if parsed, err := mail.ParseAddress(addr); err != nil || parsed.Address != addr {
			return fmt.Errorf("mailto: must name one email address")
		}
		return nil
	}
	u, err := url.Parse(v)
	if err != nil || (u.Scheme != "https" && u.Scheme != "http") || u.Host == "" {
		return fmt.Errorf("must be an http(s) URL, a mailto: address or a path starting with /")
	}
	return nil
}

// cutPrefixFold is strings.CutPrefix, case-insensitive (URL schemes are).
func cutPrefixFold(s, prefix string) (string, bool) {
	if len(s) < len(prefix) || !strings.EqualFold(s[:len(prefix)], prefix) {
		return s, false
	}
	return s[len(prefix):], true
}

// Saved notice templates (system_notice_templates): a JSON array the admin
// section offers to fill the form from. Admin-only — not on the public
// allowlist, because no user's banner reads it. Unset, the web app offers
// its built-in examples; "[]" means the admin deleted them all.
const (
	systemNoticeTemplatesMax       = 20
	systemNoticeTemplateNameMaxLen = 60
)

// systemNoticeTemplate is one saved template. Placement is optional:
// templates saved before it existed carry no such field and must still
// decode, and empty means "by tone", as for the notice itself.
type systemNoticeTemplate struct {
	Name        string `json:"name"`
	Title       string `json:"title,omitempty"`
	Text        string `json:"text"`
	Tone        string `json:"tone"`
	Placement   string `json:"placement,omitempty"`
	Dismissible bool   `json:"dismissible"`
	LinkURL     string `json:"linkUrl"`
	LinkLabel   string `json:"linkLabel"`
}

// validateSystemNoticeTemplates holds each template to the rules of the
// notice it fills in, so applying one can never produce a value the save
// would refuse.
func validateSystemNoticeTemplates(v string) error {
	dec := json.NewDecoder(strings.NewReader(v))
	dec.DisallowUnknownFields()
	var templates []systemNoticeTemplate
	if err := dec.Decode(&templates); err != nil {
		return fmt.Errorf("must be a JSON array of templates: %w", err)
	}
	// One value only: "[] garbage" decodes, but the web app could not parse it.
	if _, err := dec.Token(); !errors.Is(err, io.EOF) {
		return fmt.Errorf("must be a single JSON array of templates")
	}
	if len(templates) > systemNoticeTemplatesMax {
		return fmt.Errorf("at most %d templates, got %d", systemNoticeTemplatesMax, len(templates))
	}
	for i, tpl := range templates {
		name := strings.TrimSpace(tpl.Name)
		if name == "" {
			return fmt.Errorf("template %d: name is required", i+1)
		}
		if utf8.RuneCountInString(name) > systemNoticeTemplateNameMaxLen {
			return fmt.Errorf("template %d: name must be at most %d characters", i+1, systemNoticeTemplateNameMaxLen)
		}
		if err := validateMaxRunes(systemNoticeTitleMaxRunes)(tpl.Title); err != nil {
			return fmt.Errorf("template %d: title %w", i+1, err)
		}
		if strings.TrimSpace(tpl.Text) == "" {
			return fmt.Errorf("template %d: text is required", i+1)
		}
		if err := validateMaxRunes(systemNoticeTextMaxRunes)(tpl.Text); err != nil {
			return fmt.Errorf("template %d: text %w", i+1, err)
		}
		if err := validateSystemNoticeTone(tpl.Tone); err != nil {
			return fmt.Errorf("template %d: tone %w", i+1, err)
		}
		if err := validateSystemNoticePlacement(tpl.Placement); err != nil {
			return fmt.Errorf("template %d: placement %w", i+1, err)
		}
		if tpl.LinkURL != "" {
			if err := validateSystemNoticeURL(tpl.LinkURL); err != nil {
				return fmt.Errorf("template %d: link %w", i+1, err)
			}
		}
		if err := validateMaxRunes(systemNoticeLabelMaxRunes)(tpl.LinkLabel); err != nil {
			return fmt.Errorf("template %d: link label %w", i+1, err)
		}
	}
	return nil
}

// systemNoticeKeys are the only keys UpdateSystemNotice writes.
var systemNoticeKeys = map[string]bool{
	"system_notice_templates":   true,
	"system_notice_enabled":     true,
	"system_notice_title":       true,
	"system_notice_text":        true,
	"system_notice_tone":        true,
	"system_notice_placement":   true,
	"system_notice_dismissible": true,
	"system_notice_link_url":    true,
	"system_notice_link_label":  true,
}

// UpdateSystemNotice handles PUT /api/admin/system-notice.
// Body: {"configs": {"system_notice_text": "…", "system_notice_enabled": true, …}}
//
// The system notice is the one piece of site config a plain admin may edit;
// everything else stays on the superadmin-only POST /api/site-config. So
// this route writes the system_notice_* keys and nothing else: any other key
// in the body is refused, not ignored, so a client cannot learn by a silent
// 200 that a write went nowhere. Requires admin (enforced by adminChain).
func (h *Handler) UpdateSystemNotice(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()

	var body struct {
		Configs map[string]any `json:"configs"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		httputil.WriteErrorCtx(ctx, w, http.StatusBadRequest, "Invalid JSON body")
		return
	}
	if len(body.Configs) == 0 {
		httputil.WriteErrorCtx(ctx, w, http.StatusBadRequest, "configs is required")
		return
	}

	kvs := make([]KeyValue, 0, len(body.Configs))
	for k, v := range body.Configs {
		if !systemNoticeKeys[k] {
			httputil.WriteErrorCtx(ctx, w, http.StatusBadRequest, fmt.Sprintf("key %q is not a system notice setting", k))
			return
		}
		switch val := v.(type) {
		case nil:
			kvs = append(kvs, KeyValue{Key: k})
		case string:
			kvs = append(kvs, KeyValue{Key: k, Value: &val})
		case bool:
			s := strconv.FormatBool(val)
			kvs = append(kvs, KeyValue{Key: k, Value: &s})
		default:
			httputil.WriteErrorCtx(ctx, w, http.StatusBadRequest, fmt.Sprintf("config value for key %q must be a string, boolean, or null", k))
			return
		}
	}

	if err := ValidateGlobalValues(kvs); err != nil {
		httputil.WriteErrorCtx(ctx, w, http.StatusBadRequest, httputil.SanitizeError(err))
		return
	}

	rows, err := h.store.UpdateSiteConfigsBatch(ctx, kvs)
	if err != nil {
		httputil.WriteErrorCtx(ctx, w, http.StatusInternalServerError, "Failed to update system notice")
		return
	}

	result := make(map[string]string, len(rows))
	for _, row := range rows {
		if row.Value != nil {
			result[row.Key] = *row.Value
		}
	}
	httputil.WriteJSONCtx(ctx, w, http.StatusOK, result)
}

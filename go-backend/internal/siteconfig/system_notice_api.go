package siteconfig

import (
	"encoding/json"
	"net/http"
	"strconv"
	"strings"

	"github.com/justrag/go-backend/internal/httputil"
)

// SystemNoticeState is the system notice as the public API reads and writes
// it (GET/PUT /api/v1/system-notice): typed fields instead of the flat
// site_config strings, so a monitoring job can switch the banner with one
// small JSON body.
//
// Placement is the stored choice, not the resolved one: "" means the web app
// places the notice by its tone, and reading it back as "" keeps a caller
// that sends the state back unchanged from pinning the placement.
type SystemNoticeState struct {
	Enabled     bool   `json:"enabled"`
	Title       string `json:"title"`
	Text        string `json:"text"`
	Tone        string `json:"tone"`
	Placement   string `json:"placement"`
	Dismissible bool   `json:"dismissible"`
	LinkURL     string `json:"linkUrl"`
	LinkLabel   string `json:"linkLabel"`
}

// systemNoticePatch is a PUT body: every field optional, an omitted field
// keeps its stored value — `{"enabled": false}` takes the banner down and
// leaves the text for next time.
type systemNoticePatch struct {
	Enabled     *bool   `json:"enabled"`
	Title       *string `json:"title"`
	Text        *string `json:"text"`
	Tone        *string `json:"tone"`
	Placement   *string `json:"placement"`
	Dismissible *bool   `json:"dismissible"`
	LinkURL     *string `json:"linkUrl"`
	LinkLabel   *string `json:"linkLabel"`
}

func (h *Handler) readSystemNotice(r *http.Request) (SystemNoticeState, error) {
	rows, err := h.store.GetAllSiteConfigs(r.Context())
	if err != nil {
		return SystemNoticeState{}, err
	}
	values := make(map[string]string, len(systemNoticeKeys))
	for _, row := range rows {
		if row.Value != nil && systemNoticeKeys[row.Key] {
			values[row.Key] = *row.Value
		}
	}
	tone := values["system_notice_tone"]
	if !systemNoticeTones[tone] {
		tone = "info" // the web app's fallback for an unset tone
	}
	placement := values["system_notice_placement"]
	if !systemNoticePlacements[placement] {
		// A blank value skips the save-time check (ValidateGlobalValues);
		// it reads as unset, so the answer stays inside the documented enum.
		placement = ""
	}
	return SystemNoticeState{
		Enabled:     values["system_notice_enabled"] == "true",
		Title:       values["system_notice_title"],
		Text:        values["system_notice_text"],
		Tone:        tone,
		Placement:   placement,
		Dismissible: values["system_notice_dismissible"] == "true",
		LinkURL:     values["system_notice_link_url"],
		LinkLabel:   values["system_notice_link_label"],
	}, nil
}

// GetSystemNoticeAPI handles GET /api/v1/system-notice (API key of an admin).
func (h *Handler) GetSystemNoticeAPI(w http.ResponseWriter, r *http.Request) {
	state, err := h.readSystemNotice(r)
	if err != nil {
		httputil.WriteErrorCtx(r.Context(), w, http.StatusInternalServerError, "Failed to read system notice")
		return
	}
	httputil.WriteJSONCtx(r.Context(), w, http.StatusOK, state)
}

// UpdateSystemNoticeAPI handles PUT /api/v1/system-notice (API key of an
// admin): a partial update with the same save-time validation as the admin
// UI, answering with the whole notice as stored afterwards.
func (h *Handler) UpdateSystemNoticeAPI(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()

	dec := json.NewDecoder(r.Body)
	dec.DisallowUnknownFields()
	var patch systemNoticePatch
	if err := dec.Decode(&patch); err != nil {
		httputil.WriteErrorCtx(ctx, w, http.StatusBadRequest, "Invalid JSON body: "+httputil.SanitizeError(err))
		return
	}

	var kvs []KeyValue
	str := func(key string, v *string) {
		if v != nil {
			kvs = append(kvs, KeyValue{Key: key, Value: v})
		}
	}
	boolean := func(key string, v *bool) {
		if v != nil {
			s := strconv.FormatBool(*v)
			kvs = append(kvs, KeyValue{Key: key, Value: &s})
		}
	}
	boolean("system_notice_enabled", patch.Enabled)
	str("system_notice_title", patch.Title)
	str("system_notice_text", patch.Text)
	str("system_notice_tone", patch.Tone)
	str("system_notice_placement", patch.Placement)
	boolean("system_notice_dismissible", patch.Dismissible)
	str("system_notice_link_url", patch.LinkURL)
	str("system_notice_link_label", patch.LinkLabel)
	if len(kvs) == 0 {
		httputil.WriteErrorCtx(ctx, w, http.StatusBadRequest, "no field to update")
		return
	}

	if err := ValidateGlobalValues(kvs); err != nil {
		httputil.WriteErrorCtx(ctx, w, http.StatusBadRequest, httputil.SanitizeError(err))
		return
	}

	// An enabled notice needs a text: without one it renders nothing, and
	// the caller would read the 200 as "the banner is up". Checked on the
	// state after the patch, so clearing the text of an enabled notice
	// ({"text": ""}) is refused as well as enabling one without text.
	if patch.Enabled != nil || patch.Text != nil {
		current, err := h.readSystemNotice(r)
		if err != nil {
			httputil.WriteErrorCtx(ctx, w, http.StatusInternalServerError, "Failed to read system notice")
			return
		}
		enabled, text := current.Enabled, current.Text
		if patch.Enabled != nil {
			enabled = *patch.Enabled
		}
		if patch.Text != nil {
			text = *patch.Text
		}
		if enabled && strings.TrimSpace(text) == "" {
			httputil.WriteErrorCtx(ctx, w, http.StatusBadRequest, "an enabled system notice needs a text")
			return
		}
	}

	if _, err := h.store.UpdateSiteConfigsBatch(ctx, kvs); err != nil {
		httputil.WriteErrorCtx(ctx, w, http.StatusInternalServerError, "Failed to update system notice")
		return
	}
	state, err := h.readSystemNotice(r)
	if err != nil {
		httputil.WriteErrorCtx(ctx, w, http.StatusInternalServerError, "Failed to read system notice")
		return
	}
	httputil.WriteJSONCtx(ctx, w, http.StatusOK, state)
}

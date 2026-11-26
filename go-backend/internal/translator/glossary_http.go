package translator

import (
	"bytes"
	"context"
	"encoding/csv"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"
	"unicode/utf8"

	"github.com/justrag/go-backend/internal/auth"
	"github.com/justrag/go-backend/internal/glossaryaccess"
	"github.com/justrag/go-backend/internal/httputil"
	"github.com/justrag/go-backend/internal/translatorlang"
)

// Limits of a glossary. A name and a category take up to 255 characters, a
// description up to 65,535 bytes of UTF-8, a term GlossaryTermMaxRunes
// characters, a glossary GlossaryEntriesMax entries, a CSV file 5 MiB. The
// JSON body of a create or update is bounded like every JSON route (1 MiB, the
// server's global cap), which is also what the entry cap is sized to.
const (
	GlossaryNameMax         = 255
	GlossaryCategoryMax     = 255
	GlossaryTextMaxBytes    = 65_535
	GlossaryEntriesMax      = 5_000
	GlossaryImportMaxBytes  = 5 << 20
	glossaryBodyMaxBytes    = 1 << 20
	defaultGlossaryCategory = "general"
)

// The 400 error codes of glossary input a client can word for the user
// (docs/user-error-messages.md).
const (
	CodeGlossaryTooManyEntries = "glossary_too_many_entries"
	CodeGlossaryTermInvalid    = "glossary_term_invalid"
)

// inputError is a refused glossary input that carries one of the codes above.
type inputError struct{ code, msg string }

func (e *inputError) Error() string { return e.msg }

// writeInputError answers a refused glossary input with 400, carrying its code
// when it has one.
func writeInputError(ctx context.Context, w http.ResponseWriter, err error) {
	var ie *inputError
	if errors.As(err, &ie) {
		httputil.WriteCodedErrorCtx(ctx, w, http.StatusBadRequest, ie.code, ie.msg)
		return
	}
	httputil.WriteErrorCtx(ctx, w, http.StatusBadRequest, err.Error())
}

// GlossaryHandler serves the glossary routes. The routes sit behind the
// translation permission and the role gate of internal/glossaryaccess; this
// type never resolves a role itself, it reads the gate's result.
type GlossaryHandler struct{ store GlossaryStore }

// NewGlossaryHandler creates a GlossaryHandler over store.
func NewGlossaryHandler(store GlossaryStore) *GlossaryHandler { return &GlossaryHandler{store: store} }

type glossaryListResponse struct {
	Glossaries []GlossarySummary `json:"glossaries"`
	Languages  []string          `json:"languages"`
}

// List handles GET /api/glossaries: every glossary the caller can open, by name.
func (h *GlossaryHandler) List(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	user := auth.UserFromContext(ctx)
	if user == nil {
		httputil.WriteErrorCtx(ctx, w, http.StatusUnauthorized, "authentication required")
		return
	}
	list, err := h.store.List(ctx, user.ID)
	if err != nil {
		httputil.WriteInternalErrorCtx(ctx, w, err)
		return
	}
	if list == nil {
		list = []GlossarySummary{}
	}
	httputil.WriteJSONCtx(ctx, w, http.StatusOK, glossaryListResponse{Glossaries: list, Languages: translatorlang.GlossaryLanguages()})
}

// Get handles GET /api/glossaries/{id}.
func (h *GlossaryHandler) Get(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	access := glossaryaccess.AccessFromContext(ctx)
	if access == nil {
		httputil.WriteInternalErrorCtx(ctx, w, errors.New("glossary route reached without the access gate"))
		return
	}
	d, err := h.store.Get(ctx, access.Glossary.ID)
	if err != nil {
		httputil.WriteInternalErrorCtx(ctx, w, err)
		return
	}
	if d == nil {
		httputil.WriteErrorCtx(ctx, w, http.StatusNotFound, "glossary not found")
		return
	}
	d.Role = access.Role
	d.IsMember = access.Member
	d.flags()
	httputil.WriteJSONCtx(ctx, w, http.StatusOK, d)
}

// Create handles POST /api/glossaries. The creator becomes its owner.
func (h *GlossaryHandler) Create(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	user := auth.UserFromContext(ctx)
	if user == nil {
		httputil.WriteErrorCtx(ctx, w, http.StatusUnauthorized, "authentication required")
		return
	}
	var in GlossaryInput
	if !decodeJSONBody(w, r, glossaryBodyMaxBytes, &in) {
		return
	}
	if in.Visibility == "" {
		in.Visibility = glossaryaccess.VisibilityPrivate
	}
	if err := in.validate(true); err != nil {
		writeInputError(ctx, w, err)
		return
	}
	h.create(w, r, user.ID, in)
}

func (h *GlossaryHandler) create(w http.ResponseWriter, r *http.Request, ownerID string, in GlossaryInput) {
	ctx := r.Context()
	id, err := h.store.Create(ctx, ownerID, in)
	if err != nil {
		httputil.WriteInternalErrorCtx(ctx, w, err)
		return
	}
	d, err := h.store.Get(ctx, id)
	if err != nil || d == nil {
		httputil.WriteInternalErrorCtx(ctx, w, fmt.Errorf("read back glossary: %v", err))
		return
	}
	d.Role = glossaryaccess.RoleOwner
	d.IsMember = true
	d.flags()
	httputil.WriteJSONCtx(ctx, w, http.StatusCreated, d)
}

// Update handles PUT /api/glossaries/{id}: a full replacement of name,
// description, category and all entries. An empty description or category
// clears it (the default category belongs to creating only). Visibility is
// changed through PATCH.
func (h *GlossaryHandler) Update(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	access := glossaryaccess.AccessFromContext(ctx)
	if access == nil {
		httputil.WriteInternalErrorCtx(ctx, w, errors.New("glossary route reached without the access gate"))
		return
	}
	var in GlossaryInput
	if !decodeJSONBody(w, r, glossaryBodyMaxBytes, &in) {
		return
	}
	if err := in.validate(false); err != nil {
		writeInputError(ctx, w, err)
		return
	}
	switch err := h.store.Update(ctx, access.Glossary.ID, in); {
	case isNotFound(err):
		httputil.WriteErrorCtx(ctx, w, http.StatusNotFound, "glossary not found")
	case err != nil:
		httputil.WriteInternalErrorCtx(ctx, w, err)
	default:
		h.Get(w, r)
	}
}

type visibilityRequest struct {
	Visibility string `json:"visibility"`
}

// SetVisibility handles PATCH /api/glossaries/{id}: who sees the glossary.
// It needs admin: sharing is a decision of the people who manage it, not of
// everyone who may edit its entries.
func (h *GlossaryHandler) SetVisibility(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	access := glossaryaccess.AccessFromContext(ctx)
	if access == nil {
		httputil.WriteInternalErrorCtx(ctx, w, errors.New("glossary route reached without the access gate"))
		return
	}
	var body visibilityRequest
	if !decodeJSONBody(w, r, glossaryBodyMaxBytes, &body) {
		return
	}
	if !glossaryaccess.ValidVisibility(body.Visibility) {
		httputil.WriteErrorCtx(ctx, w, http.StatusBadRequest, `visibility must be "private" or "global"`)
		return
	}
	switch err := h.store.SetVisibility(ctx, access.Glossary.ID, body.Visibility); {
	case isNotFound(err):
		httputil.WriteErrorCtx(ctx, w, http.StatusNotFound, "glossary not found")
	case err != nil:
		httputil.WriteInternalErrorCtx(ctx, w, err)
	default:
		w.WriteHeader(http.StatusNoContent)
	}
}

// Delete handles DELETE /api/glossaries/{id}, owner only (the gate).
func (h *GlossaryHandler) Delete(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	access := glossaryaccess.AccessFromContext(ctx)
	if access == nil {
		httputil.WriteInternalErrorCtx(ctx, w, errors.New("glossary route reached without the access gate"))
		return
	}
	switch err := h.store.Delete(ctx, access.Glossary.ID); {
	case isNotFound(err):
		httputil.WriteErrorCtx(ctx, w, http.StatusNotFound, "glossary not found")
	case err != nil:
		httputil.WriteInternalErrorCtx(ctx, w, err)
	default:
		w.WriteHeader(http.StatusNoContent)
	}
}

// Import handles POST /api/glossaries/import: a multipart form with the CSV
// `file` (two columns, source term and target term, one pair per line) and
// the fields name, description, sourceLanguage and targetLanguage. It creates
// a private glossary owned by the caller.
func (h *GlossaryHandler) Import(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	user := auth.UserFromContext(ctx)
	if user == nil {
		httputil.WriteErrorCtx(ctx, w, http.StatusUnauthorized, "authentication required")
		return
	}
	// Refuse an oversized body before parsing it; the form fields and the
	// multipart framing take a little more than the file itself.
	r.Body = http.MaxBytesReader(w, r.Body, GlossaryImportMaxBytes+(256<<10))
	if err := r.ParseMultipartForm(1 << 20); err != nil {
		var tooBig *http.MaxBytesError
		if errors.As(err, &tooBig) {
			httputil.WriteErrorCtx(ctx, w, http.StatusRequestEntityTooLarge, "The file must not exceed 5MB.")
			return
		}
		httputil.WriteErrorCtx(ctx, w, http.StatusBadRequest, "invalid form")
		return
	}
	defer func() { _ = r.MultipartForm.RemoveAll() }()
	file, header, err := r.FormFile("file")
	if err != nil {
		httputil.WriteErrorCtx(ctx, w, http.StatusBadRequest, "a CSV file is required")
		return
	}
	defer file.Close()
	if header.Size > GlossaryImportMaxBytes {
		httputil.WriteErrorCtx(ctx, w, http.StatusRequestEntityTooLarge, "The file must not exceed 5MB.")
		return
	}
	raw, err := io.ReadAll(io.LimitReader(file, GlossaryImportMaxBytes+1))
	if err != nil {
		httputil.WriteErrorCtx(ctx, w, http.StatusBadRequest, "the file could not be read")
		return
	}
	if len(raw) > GlossaryImportMaxBytes {
		httputil.WriteErrorCtx(ctx, w, http.StatusRequestEntityTooLarge, "The file must not exceed 5MB.")
		return
	}
	srcLang, tgtLang := r.FormValue("sourceLanguage"), r.FormValue("targetLanguage")
	if !translatorlang.ValidGlossaryLanguage(srcLang) || !translatorlang.ValidGlossaryLanguage(tgtLang) {
		httputil.WriteErrorCtx(ctx, w, http.StatusBadRequest, "sourceLanguage and targetLanguage must be glossary languages")
		return
	}
	pairs, err := ParseGlossaryCSV(raw)
	if err != nil {
		httputil.WriteErrorCtx(ctx, w, http.StatusBadRequest, err.Error())
		return
	}
	in := GlossaryInput{
		Name:        r.FormValue("name"),
		Description: r.FormValue("description"),
		Visibility:  glossaryaccess.VisibilityPrivate,
		Entries:     make([]GlossaryEntry, len(pairs)),
	}
	for i, p := range pairs {
		in.Entries[i] = GlossaryEntry{SourceLanguage: srcLang, SourceTerm: p[0], TargetLanguage: tgtLang, TargetTerm: p[1]}
	}
	if err := in.validate(true); err != nil {
		writeInputError(ctx, w, err)
		return
	}
	h.create(w, r, user.ID, in)
}

// validate trims the input and checks it. isNew selects the defaults of a new
// glossary (its category); an edited glossary is replaced as it is given.
func (in *GlossaryInput) validate(isNew bool) error {
	in.Name = strings.TrimSpace(in.Name)
	in.Description = strings.TrimSpace(in.Description)
	in.Category = strings.TrimSpace(in.Category)
	if n := utf8.RuneCountInString(in.Name); n < 1 || n > GlossaryNameMax {
		return fmt.Errorf("name must have between 1 and %d characters", GlossaryNameMax)
	}
	if utf8.RuneCountInString(in.Category) > GlossaryCategoryMax {
		return fmt.Errorf("category must have at most %d characters", GlossaryCategoryMax)
	}
	if len(in.Description) > GlossaryTextMaxBytes {
		return errors.New("description is too long")
	}
	if isNew {
		if in.Category == "" {
			in.Category = defaultGlossaryCategory
		}
		if !glossaryaccess.ValidVisibility(in.Visibility) {
			return errors.New(`visibility must be "private" or "global"`)
		}
	}
	if len(in.Entries) == 0 {
		return errors.New("a glossary needs at least one term")
	}
	if len(in.Entries) > GlossaryEntriesMax {
		return &inputError{CodeGlossaryTooManyEntries, fmt.Sprintf("a glossary has at most %d entries", GlossaryEntriesMax)}
	}
	for i := range in.Entries {
		e := &in.Entries[i]
		e.SourceTerm, e.TargetTerm = strings.TrimSpace(e.SourceTerm), strings.TrimSpace(e.TargetTerm)
		if !translatorlang.ValidGlossaryLanguage(e.SourceLanguage) || !translatorlang.ValidGlossaryLanguage(e.TargetLanguage) {
			return fmt.Errorf("entry %d: language must be one of %s", i+1, strings.Join(translatorlang.GlossaryLanguages(), ", "))
		}
		if e.SourceTerm == "" || e.TargetTerm == "" {
			return fmt.Errorf("entry %d: both terms are required", i+1)
		}
		if !validTerm(e.SourceTerm) || !validTerm(e.TargetTerm) {
			return &inputError{CodeGlossaryTermInvalid, fmt.Sprintf(
				"entry %d: a term has at most %d characters and no control characters or line breaks", i+1, GlossaryTermMaxRunes)}
		}
	}
	return nil
}

// csvHeaderWords are the cell texts of a header row (lower case): a first row
// whose two cells are both of them is a header, not a term pair.
var csvHeaderWords = map[string]struct{}{
	"source": {}, "target": {}, "term": {}, "translation": {},
	"quelle": {}, "ziel": {}, "begriff": {}, "übersetzung": {}, "uebersetzung": {},
}

func isCSVHeader(a, b string) bool {
	_, okA := csvHeaderWords[strings.ToLower(strings.TrimSpace(a))]
	_, okB := csvHeaderWords[strings.ToLower(strings.TrimSpace(b))]
	return okA && okB
}

// detectCSVDelimiter decides the delimiter from the first record: the one of
// comma, semicolon and tab that occurs most often outside quotes, in the first
// line that is not blank (a quoted field may span lines). A tie goes to tab,
// then semicolon, then comma; a record with none is comma-separated. As in the
// CSV reader with lazy quotes, a quote opens a quoted field only at the start
// of a field.
func detectCSVDelimiter(raw []byte) rune {
	rest := raw
	for {
		line, after, found := bytes.Cut(rest, []byte("\n"))
		if len(bytes.TrimSpace(line)) != 0 || !found {
			break
		}
		rest = after
	}
	counts := map[byte]int{}
	atFieldStart, inQuotes := true, false
scan:
	for i := 0; i < len(rest); i++ {
		c := rest[i]
		switch {
		case inQuotes:
			if c == '"' {
				if i+1 < len(rest) && rest[i+1] == '"' {
					i++
				} else {
					inQuotes = false
				}
			}
		case c == '\n':
			break scan
		case c == '"' && atFieldStart:
			inQuotes, atFieldStart = true, false
		case c == ',' || c == ';' || c == '\t':
			counts[c]++
			atFieldStart = true
		case c == ' ' || c == '\r':
		default:
			atFieldStart = false
		}
	}
	best, bestCount := byte(','), 0
	for _, c := range []byte{'\t', ';', ','} {
		if counts[c] > bestCount {
			best, bestCount = c, counts[c]
		}
	}
	return rune(best)
}

// ParseGlossaryCSV reads the term pairs of a CSV glossary: two columns, comma,
// semicolon or tab separated (decided from the first record, see
// detectCSVDelimiter), quotes as in RFC 4180. Leading blank lines and blank
// lines between records are skipped; a first row whose two cells are both
// header words (source, target, term, translation, quelle, ziel, begriff,
// übersetzung) is a header and is skipped. A line with fewer than two terms
// makes the file invalid, and so does a file without any pair.
func ParseGlossaryCSV(raw []byte) ([][2]string, error) {
	raw = bytes.TrimPrefix(raw, []byte("\xef\xbb\xbf"))
	if !utf8.Valid(raw) {
		return nil, errors.New("the file must be UTF-8")
	}
	comma := detectCSVDelimiter(raw)
	rd := csv.NewReader(bytes.NewReader(raw))
	rd.Comma = comma
	rd.FieldsPerRecord = -1
	rd.LazyQuotes = true
	// The reader would swallow an empty tab-separated field with the leading
	// whitespace it trims; the cells are trimmed below anyway.
	rd.TrimLeadingSpace = comma != '\t'
	var pairs [][2]string
	first := true
	for {
		rec, err := rd.Read()
		if errors.Is(err, io.EOF) {
			break
		}
		if err != nil {
			return nil, errors.New("the file is not a valid CSV")
		}
		blank := true
		for i := range rec {
			rec[i] = strings.TrimSpace(rec[i])
			if rec[i] != "" {
				blank = false
			}
		}
		if blank {
			continue
		}
		wasFirst := first
		first = false
		if wasFirst && len(rec) >= 2 && isCSVHeader(rec[0], rec[1]) {
			continue
		}
		if len(rec) < 2 || rec[0] == "" || rec[1] == "" {
			return nil, errors.New("every line needs a source term and a target term")
		}
		pairs = append(pairs, [2]string{rec[0], rec[1]})
	}
	if len(pairs) == 0 {
		return nil, errors.New("the file has no term pairs")
	}
	return pairs, nil
}

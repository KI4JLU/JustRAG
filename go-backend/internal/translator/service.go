// Package translator is the translation extension: translating text,
// revising it (rephrase), detecting a language and suggesting wordings on the
// JLU RAG AI provider and its Fast Tier model, plus the glossaries those
// calls can keep to.
//
// Texts only pass through the server and are never stored. Glossaries and
// their sharing are persisted; who may do what with a glossary is decided by
// internal/glossaryaccess, and the people of a glossary are managed by
// internal/glossarymembers.
package translator

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"slices"
	"strings"
	"unicode"
	"unicode/utf8"

	"github.com/google/uuid"

	"github.com/justrag/go-backend/internal/ai"
	"github.com/justrag/go-backend/internal/chat"
	"github.com/justrag/go-backend/internal/prompts"
	"github.com/justrag/go-backend/internal/translatorlang"
)

// The site_config keys of the extension are defined in translatorlang (global-only,
// save-time validators in internal/siteconfig).
const (
	KeyEnabled       = translatorlang.KeyEnabled
	KeyDefaultTarget = translatorlang.KeyDefaultTarget
)

// Limits of a request, counted in runes.
const (
	TextMax                 = 50_000
	SegmentsMax             = 5_000
	DetectSampleMax         = 500
	SuggestTextMax          = 2_000
	GlossariesPerRequestMax = 20
	SuggestExclusionsMax    = 50
)

// The glossary terms a request puts into the model call. Only terms that occur
// in the text go in, longest first (the most specific one wins), and the
// selection stops at these bounds, so a big or hostile glossary can neither
// inflate the prompt nor push the text out of the model's context. The budget
// is counted over the source and target text of the terms, in bytes of UTF-8.
const (
	PromptTermsMax      = 200
	PromptTermsMaxBytes = 16 << 10
)

// Errors the handlers map onto status codes.
var (
	// ErrInvalid wraps a request refused before any model call: 400.
	ErrInvalid = errors.New("translator: invalid request")
	// ErrModel reports a model call that failed or answered with something
	// that is no JSON object: 502. ErrModelTimeout and ErrModelUnavailable
	// are the causes told apart.
	ErrModel = errors.New("translator: model call failed")
	// ErrEmptyAnswer is the model answering a text request without any text
	// (no "text" field, null or blank), again after one more try: 502.
	ErrEmptyAnswer = fmt.Errorf("%w: the answer has no text", ErrModel)
)

func invalid(format string, args ...any) error {
	return fmt.Errorf("%w: %s", ErrInvalid, fmt.Sprintf(format, args...))
}

// Completer runs one structured model call. The production implementation
// resolves the Fast Tier model; tests fake it.
type Completer interface {
	Complete(ctx context.Context, system, user string, spec *ai.StructuredSpec, out any) error
	// Model names the model a call would use right now and where it comes
	// from: ModelSourceFastTier, ModelSourceDefault, or "" when none can be
	// resolved.
	Model(ctx context.Context) (name, source string)
}

// Where the model of a call comes from, as the config route reports it.
const (
	// ModelSourceFastTier: the deployment-wide Fast Tier model (model_tier_fast).
	ModelSourceFastTier = "fastTier"
	// ModelSourceDefault: model_tier_fast is empty and the provider's default
	// chat model answers.
	ModelSourceDefault = "default"
)

// AICompleter is the Completer over the JLU RAG AI provider. The model is the
// deployment-wide Fast Tier model (model_tier_fast); when that is unset, the
// provider's default chat model answers.
type AICompleter struct {
	resolver *ai.ConfigResolver
	reader   chat.SiteConfigReader
}

// NewAICompleter creates the production Completer.
func NewAICompleter(resolver *ai.ConfigResolver, reader chat.SiteConfigReader) *AICompleter {
	return &AICompleter{resolver: resolver, reader: reader}
}

// Complete runs the call on the Fast Tier model with a global provider scope
// (no KB) and decodes the JSON object answer into out.
func (c *AICompleter) Complete(ctx context.Context, system, user string, spec *ai.StructuredSpec, out any) error {
	ctx, cancel := context.WithTimeout(ai.WithoutThinking(ctx), completionTimeoutFor(user))
	defer cancel()
	model := chat.ResolveFastTierModel(ctx, c.reader, "")
	if err := ai.CompleteStructuredJSON(ctx, c.resolver, user, system, "", model, spec, out); err != nil {
		return classifyModelError(err)
	}
	return nil
}

// Model reports the model a call would be served by right now and where it
// comes from. The provider is resolved first, because that is what Complete
// does: the Fast Tier model counts only when a provider is active and offers
// it; otherwise the provider's default chat model answers (source "default"),
// and with no provider, or no model on it, both results are empty.
func (c *AICompleter) Model(ctx context.Context) (name, source string) {
	cfg, err := c.resolver.Resolve(ctx, "")
	if err != nil || cfg == nil {
		return "", ""
	}
	if m := chat.ResolveFastTierModel(ctx, c.reader, ""); m != "" && cfg.EffectiveChatModel(m) == m {
		return m, ModelSourceFastTier
	}
	if cfg.ChatModel == "" {
		return "", ""
	}
	return cfg.ChatModel, ModelSourceDefault
}

// GlossaryEntry is one term and how it is translated.
type GlossaryEntry struct {
	SourceLanguage string `json:"sourceLanguage"`
	SourceTerm     string `json:"sourceTerm"`
	TargetLanguage string `json:"targetLanguage"`
	TargetTerm     string `json:"targetTerm"`
}

// GlossaryData is a glossary's entries as the prompts use them. Order matters:
// older glossaries come first, so a newer one wins for the same term.
type GlossaryData struct {
	ID      string
	Entries []GlossaryEntry
}

// ErrGlossaryUnavailable means a requested glossary does not exist or is not
// readable for the caller.
var ErrGlossaryUnavailable = errors.New("translator: glossary not available")

// GlossaryReader loads the glossaries a request names, only those the user
// may read, oldest first. It returns ErrGlossaryUnavailable when one is not
// readable, so a request never silently drops a glossary it asked for.
type GlossaryReader interface {
	ReadableGlossaries(ctx context.Context, userID string, ids []string) ([]GlossaryData, error)
}

// Service runs the text routes' logic.
type Service struct {
	completer Completer
	glossary  GlossaryReader
}

// NewService creates a Service.
func NewService(c Completer, g GlossaryReader) *Service {
	return &Service{completer: c, glossary: g}
}

// Adjustments are the style panel's options.
type Adjustments struct {
	Formality string  `json:"formality"`
	Style     *string `json:"style"`
	Tone      *string `json:"tone"`
}

func (a Adjustments) prompt() prompts.Adjustments {
	p := prompts.Adjustments{Formality: a.Formality}
	if a.Style != nil {
		p.Style = *a.Style
	}
	if a.Tone != nil {
		p.Tone = *a.Tone
	}
	return p
}

func (a *Adjustments) validate() error {
	if a.Formality == "" {
		a.Formality = "default"
	}
	if !prompts.IsTranslatorFormality(a.Formality) {
		return invalid("formality must be default, formal or informal")
	}
	if a.Style != nil && !prompts.IsTranslatorStyle(*a.Style) {
		return invalid("unknown style")
	}
	if a.Tone != nil && !prompts.IsTranslatorTone(*a.Tone) {
		return invalid("unknown tone")
	}
	return nil
}

// TranslateRequest is the body of POST /api/translator/translate.
type TranslateRequest struct {
	Text []string `json:"text"`
	// Source is nil to let the model detect the language.
	Source *string `json:"source"`
	Target string  `json:"target"`
	Adjustments
	GlossaryIDs []string `json:"glossaryIds"`
}

// TranslateResponse is one translation per sentence, in the request's order.
type TranslateResponse struct {
	Text           []string `json:"text"`
	DetectedSource *string  `json:"detectedSource"`
}

// RephraseRequest is the body of POST /api/translator/rephrase.
type RephraseRequest struct {
	Text []string `json:"text"`
	// Language is the text's language, nil when unknown.
	Language *string `json:"language"`
	Adjustments
	GlossaryIDs []string `json:"glossaryIds"`
}

// RephraseResponse is one sentence per sentence, in the request's order.
type RephraseResponse struct {
	Text             []string `json:"text"`
	DetectedLanguage *string  `json:"detectedLanguage"`
}

// DetectRequest is the body of POST /api/translator/detect.
type DetectRequest struct {
	Text string `json:"text"`
}

// DetectResponse names the language, nil when it is not one the translator
// offers or not recognisable.
type DetectResponse struct {
	Language *string `json:"language"`
}

// SuggestRequest is the body of POST /api/translator/suggest.
type SuggestRequest struct {
	Kind    string  `json:"kind"`
	Text    string  `json:"text"`
	Context *string `json:"context"`
	// Language is the language of Text, nil when unknown.
	Language *string `json:"language"`
	Adjustments
	Exclusions []string `json:"exclusions"`
}

// SuggestResponse holds the suggestions, without blanks and repeats.
type SuggestResponse struct {
	Suggestions []string `json:"suggestions"`
}

func validateSegments(text []string) error {
	if len(text) == 0 || len(text) > SegmentsMax {
		return invalid("text must have between 1 and %d sentences", SegmentsMax)
	}
	total, anyText := 0, false
	for _, s := range text {
		n := utf8.RuneCountInString(s)
		if n > TextMax {
			return invalid("a sentence has more than %d characters", TextMax)
		}
		total += n
		if strings.TrimSpace(s) != "" {
			anyText = true
		}
	}
	if !anyText {
		return invalid("enter a text")
	}
	if total > TextMax {
		return invalid("at most %d characters", TextMax)
	}
	return nil
}

func validateGlossaryIDs(ids []string) ([]string, error) {
	if len(ids) > GlossariesPerRequestMax {
		return nil, invalid("at most %d glossaries per request", GlossariesPerRequestMax)
	}
	out := make([]string, 0, len(ids))
	seen := make(map[string]struct{}, len(ids))
	for _, raw := range ids {
		parsed, err := uuid.Parse(raw)
		if err != nil {
			return nil, invalid("glossaryIds must be UUIDs")
		}
		id := parsed.String()
		if _, dup := seen[id]; dup {
			continue
		}
		seen[id] = struct{}{}
		out = append(out, id)
	}
	return out, nil
}

func validLanguagePtr(p *string, name string) (string, error) {
	if p == nil {
		return "", nil
	}
	if !translatorlang.Valid(*p) {
		return "", invalid("%s is not a language the translator offers", name)
	}
	return *p, nil
}

func (s *Service) glossaries(ctx context.Context, userID string, ids []string) ([]GlossaryData, error) {
	if len(ids) == 0 || s.glossary == nil {
		return nil, nil
	}
	data, err := s.glossary.ReadableGlossaries(ctx, userID, ids)
	if errors.Is(err, ErrGlossaryUnavailable) {
		return nil, invalid("a glossary is not available")
	}
	if err != nil {
		return nil, fmt.Errorf("load glossaries: %w", err)
	}
	return data, nil
}

// termBudget enforces PromptTermsMax and PromptTermsMaxBytes while terms are
// added in priority order.
type termBudget struct{ count, bytes int }

// take reports whether a term of n bytes still fits, and counts it if so. A
// term that does not fit is skipped; a smaller one after it may still fit.
func (b *termBudget) take(n int) bool {
	if b.count >= PromptTermsMax || b.bytes+n > PromptTermsMaxBytes {
		return false
	}
	b.count++
	b.bytes += n
	return true
}

// textFold lower-cases text for the occurrence test: terms are matched
// case-insensitively, Unicode-aware (Ä and ä, Ж and ж).
func textFold(sentences []string) string { return strings.ToLower(strings.Join(sentences, "")) }

// occursIn reports whether term appears in the folded text.
func occursIn(folded, term string) bool { return strings.Contains(folded, strings.ToLower(term)) }

// byLength orders terms longest first, the most specific before the general
// one it contains, ties broken by the lower-cased term so the order, and with
// it the prompt, is the same on every call.
func byLength(a, b string) int {
	if d := utf8.RuneCountInString(b) - utf8.RuneCountInString(a); d != 0 {
		return d
	}
	return strings.Compare(strings.ToLower(a), strings.ToLower(b))
}

// selectTerms picks the term pairs a translation of sentences from source (""
// unknown) to target keeps to. An entry applies in both directions. With an
// unknown source language every entry into the target language counts, and so
// does every entry written in it, turned round. Glossaries come oldest first
// and a later one overrides an earlier one for the same source term. Only a
// term whose source occurs in the text is kept, longest first, within
// PromptTermsMax and PromptTermsMaxBytes.
func selectTerms(data []GlossaryData, source, target string, sentences []string) []prompts.GlossaryTerm {
	tgt := translatorlang.GlossaryBase(target)
	if tgt == "" {
		return nil
	}
	src := translatorlang.GlossaryBase(source)
	if source != "" && src == "" {
		return nil
	}
	folded := textFold(sentences)
	index := map[string]int{}
	var terms []prompts.GlossaryTerm
	add := func(from, to string) {
		if !validTerm(from) || !validTerm(to) || !occursIn(folded, from) {
			return
		}
		key := strings.ToLower(from)
		if i, ok := index[key]; ok {
			terms[i].Target = to
			return
		}
		index[key] = len(terms)
		terms = append(terms, prompts.GlossaryTerm{Source: from, Target: to})
	}
	for _, g := range data {
		for _, e := range g.Entries {
			switch {
			case source == "":
				if e.TargetLanguage == tgt {
					add(e.SourceTerm, e.TargetTerm)
				} else if e.SourceLanguage == tgt {
					add(e.TargetTerm, e.SourceTerm)
				}
			case e.SourceLanguage == src && e.TargetLanguage == tgt:
				add(e.SourceTerm, e.TargetTerm)
			case e.SourceLanguage == tgt && e.TargetLanguage == src:
				add(e.TargetTerm, e.SourceTerm)
			}
		}
	}
	slices.SortStableFunc(terms, func(a, b prompts.GlossaryTerm) int { return byLength(a.Source, b.Source) })
	var budget termBudget
	kept := terms[:0]
	for _, t := range terms {
		if budget.take(len(t.Source) + len(t.Target)) {
			kept = append(kept, t)
		}
	}
	return kept
}

// termsInLanguage returns the glossary terms written in language that occur in
// sentences, each tagged with its glossary language, without repeats, longest
// first, within the same budget as selectTerms: a revision keeps them as given.
// With language "" (unknown, the model detects it) the terms of every glossary
// language that occur go in, so the model applies the ones of the language it
// finds; a language that is not a glossary language selects nothing.
func termsInLanguage(data []GlossaryData, language string, sentences []string) []prompts.LanguageTerm {
	base := translatorlang.GlossaryBase(language)
	if language != "" && base == "" {
		return nil
	}
	folded := textFold(sentences)
	type key struct{ term, lang string }
	seen := map[key]struct{}{}
	var out []prompts.LanguageTerm
	add := func(term, lang string) {
		if (base != "" && lang != base) || !validTerm(term) || !occursIn(folded, term) {
			return
		}
		k := key{strings.ToLower(term), lang}
		if _, dup := seen[k]; dup {
			return
		}
		seen[k] = struct{}{}
		out = append(out, prompts.LanguageTerm{Term: term, Language: lang})
	}
	for _, g := range data {
		for _, e := range g.Entries {
			add(e.SourceTerm, e.SourceLanguage)
			add(e.TargetTerm, e.TargetLanguage)
		}
	}
	slices.SortStableFunc(out, func(a, b prompts.LanguageTerm) int {
		if d := byLength(a.Term, b.Term); d != 0 {
			return d
		}
		return strings.Compare(a.Language, b.Language)
	})
	var budget termBudget
	kept := out[:0]
	for _, t := range out {
		if budget.take(len(t.Term)) {
			kept = append(kept, t)
		}
	}
	return kept
}

// GlossaryTermMaxRunes is the longest a glossary term may be, in characters.
const GlossaryTermMaxRunes = 200

// validTerm reports whether s is a term the prompts may carry: not empty, at
// most GlossaryTermMaxRunes characters, no control characters, line or
// paragraph separators (a term is one line of text, not a place to hide a
// paragraph of instructions). Terms are checked on write; the selection checks
// again, so an entry stored under looser rules never reaches a prompt.
func validTerm(s string) bool {
	n := utf8.RuneCountInString(s)
	if n == 0 || n > GlossaryTermMaxRunes || strings.TrimSpace(s) != s || !utf8.ValidString(s) {
		return false
	}
	return !strings.ContainsFunc(s, func(r rune) bool {
		return unicode.IsControl(r) || unicode.In(r, unicode.Zl, unicode.Zp)
	})
}

// segmentsAnswer is the model's answer to translate and rephrase. Both shapes
// are read tolerantly (a model may name the detection field of the other one).
type segmentsAnswer struct {
	Text             json.RawMessage `json:"text"`
	DetectedSource   any             `json:"detected_source_language"`
	DetectedLanguage any             `json:"detected_language"`
}

// The strict structured-output schemas, one per shape: translate answers with
// the text and the language it detected, rephrase with the text and the
// language it found. In strict mode every property is required and nothing
// else is allowed. A backend without grammar support gets the looser
// json_object contract (ai.GenerateCompletionStructured downgrades), and the
// answers are parsed tolerantly either way.
var (
	translateSchema = &ai.StructuredSpec{
		Name: "translator_translate",
		Schema: json.RawMessage(`{"type":"object","properties":{"text":{"type":"array","items":{"type":"string"}},` +
			`"detected_source_language":{"type":"string"}},"required":["text","detected_source_language"],"additionalProperties":false}`),
	}
	rephraseSchema = &ai.StructuredSpec{
		Name: "translator_rephrase",
		Schema: json.RawMessage(`{"type":"object","properties":{"text":{"type":"array","items":{"type":"string"}},` +
			`"detected_language":{"type":"string"}},"required":["text","detected_language"],"additionalProperties":false}`),
	}
)

var detectSchema = &ai.StructuredSpec{
	Name:   "translator_detect",
	Schema: json.RawMessage(`{"type":"object","properties":{"language":{"type":"string"}},"required":["language"],"additionalProperties":false}`),
}

var suggestSchema = &ai.StructuredSpec{
	Name:   "translator_suggest",
	Schema: json.RawMessage(`{"type":"object","properties":{"suggestions":{"type":"array","items":{"type":"string"}}},"required":["suggestions"],"additionalProperties":false}`),
}

func codeOf(v any) *string {
	s, ok := v.(string)
	if !ok {
		return nil
	}
	if code := translatorlang.Normalize(s); code != "" {
		return &code
	}
	return nil
}

// parseSegments reads a model's list of sentences. An answer with one string
// per sentence keeps them; any other answer that says something becomes the
// first sentence with the rest left empty, so nothing the model said is lost.
// ok is false for an answer that says nothing at all (no "text", null, an
// empty or blank string or list): for a text with something in it that is a
// malformed answer, not a translation.
func parseSegments(raw json.RawMessage, count int) (out []string, ok bool) {
	var list []string
	if err := json.Unmarshal(raw, &list); err == nil && len(list) == count {
		return list, slices.ContainsFunc(list, notBlank)
	}
	joined := ""
	if list != nil {
		joined = strings.Join(list, " ")
	} else {
		var one string
		if err := json.Unmarshal(raw, &one); err == nil {
			joined = one
		}
	}
	out = make([]string, count)
	out[0] = joined
	return out, strings.TrimSpace(joined) != ""
}

func notBlank(s string) bool { return strings.TrimSpace(s) != "" }

// segmentsRetryNote is added to the system prompt of the one repeated attempt
// after an answer without text. It changes the input, so a deterministic model
// does not answer the same empty text again.
const segmentsRetryNote = ` Your previous answer had no usable "text" array. Answer with the JSON object only, with one non-empty string per sentence.`

// completeSegments runs the model call of translate or rephrase and returns the
// answer with one string per sentence. An answer without text is the malformed
// path: the call is repeated once, then it is ErrEmptyAnswer (502), never a 200
// with empty strings.
func (s *Service) completeSegments(ctx context.Context, system, user string, spec *ai.StructuredSpec, count int) (segmentsAnswer, []string, error) {
	const attempts = 2
	for attempt := 1; ; attempt++ {
		prompt := system
		if attempt > 1 {
			prompt += segmentsRetryNote
		}
		var ans segmentsAnswer
		if err := s.completer.Complete(ctx, prompt, user, spec, &ans); err != nil {
			return ans, nil, err
		}
		if text, ok := parseSegments(ans.Text, count); ok {
			return ans, text, nil
		}
		if attempt >= attempts {
			return ans, nil, ErrEmptyAnswer
		}
	}
}

// Translate translates the sentences of req.
func (s *Service) Translate(ctx context.Context, userID string, req TranslateRequest) (TranslateResponse, error) {
	if err := validateSegments(req.Text); err != nil {
		return TranslateResponse{}, err
	}
	source, err := validLanguagePtr(req.Source, "source")
	if err != nil {
		return TranslateResponse{}, err
	}
	if !translatorlang.Valid(req.Target) {
		return TranslateResponse{}, invalid("target is not a language the translator offers")
	}
	if err := req.Adjustments.validate(); err != nil {
		return TranslateResponse{}, err
	}
	ids, err := validateGlossaryIDs(req.GlossaryIDs)
	if err != nil {
		return TranslateResponse{}, err
	}
	data, err := s.glossaries(ctx, userID, ids)
	if err != nil {
		return TranslateResponse{}, err
	}
	terms := selectTerms(data, source, req.Target, req.Text)
	system := prompts.TranslatorTranslateSystem(source, req.Target, req.Adjustments.prompt(), len(terms) > 0)
	ans, text, err := s.completeSegments(ctx, system, prompts.TranslatorTranslateUser(req.Text, terms), translateSchema, len(req.Text))
	if err != nil {
		return TranslateResponse{}, err
	}
	return TranslateResponse{Text: text, DetectedSource: codeOf(ans.DetectedSource)}, nil
}

// Rephrase revises the sentences of req in their own language.
func (s *Service) Rephrase(ctx context.Context, userID string, req RephraseRequest) (RephraseResponse, error) {
	if err := validateSegments(req.Text); err != nil {
		return RephraseResponse{}, err
	}
	language, err := validLanguagePtr(req.Language, "language")
	if err != nil {
		return RephraseResponse{}, err
	}
	if err := req.Adjustments.validate(); err != nil {
		return RephraseResponse{}, err
	}
	ids, err := validateGlossaryIDs(req.GlossaryIDs)
	if err != nil {
		return RephraseResponse{}, err
	}
	data, err := s.glossaries(ctx, userID, ids)
	if err != nil {
		return RephraseResponse{}, err
	}
	terms := termsInLanguage(data, language, req.Text)
	system := prompts.TranslatorRephraseSystem(language, req.Adjustments.prompt(), len(terms) > 0)
	ans, text, err := s.completeSegments(ctx, system, prompts.TranslatorRephraseUser(req.Text, terms), rephraseSchema, len(req.Text))
	if err != nil {
		return RephraseResponse{}, err
	}
	detected := codeOf(ans.DetectedLanguage)
	if detected == nil {
		detected = codeOf(ans.DetectedSource)
	}
	return RephraseResponse{Text: text, DetectedLanguage: detected}, nil
}

// Detect names the language of a short sample.
func (s *Service) Detect(ctx context.Context, req DetectRequest) (DetectResponse, error) {
	text := strings.TrimSpace(req.Text)
	if text == "" || utf8.RuneCountInString(text) > DetectSampleMax {
		return DetectResponse{}, invalid("text must have between 1 and %d characters", DetectSampleMax)
	}
	var ans struct {
		Language any `json:"language"`
	}
	if err := s.completer.Complete(ctx, prompts.TranslatorDetectSystem(), text, detectSchema, &ans); err != nil {
		return DetectResponse{}, err
	}
	return DetectResponse{Language: codeOf(ans.Language)}, nil
}

// Suggest offers other wordings, synonyms or a corrected sentence.
func (s *Service) Suggest(ctx context.Context, req SuggestRequest) (SuggestResponse, error) {
	switch req.Kind {
	case prompts.SuggestAlternatives, prompts.SuggestSynonyms, prompts.SuggestCorrection:
	default:
		return SuggestResponse{}, invalid("kind must be alternatives, synonyms or correction")
	}
	text := strings.TrimSpace(req.Text)
	if text == "" || utf8.RuneCountInString(text) > SuggestTextMax {
		return SuggestResponse{}, invalid("text must have between 1 and %d characters", SuggestTextMax)
	}
	around := ""
	if req.Context != nil {
		around = *req.Context
	}
	if utf8.RuneCountInString(around) > 2*SuggestTextMax {
		return SuggestResponse{}, invalid("context is too long")
	}
	if around == "" && req.Kind != prompts.SuggestAlternatives {
		around = text
	}
	language, err := validLanguagePtr(req.Language, "language")
	if err != nil {
		return SuggestResponse{}, err
	}
	if err := req.Adjustments.validate(); err != nil {
		return SuggestResponse{}, err
	}
	if len(req.Exclusions) > SuggestExclusionsMax {
		return SuggestResponse{}, invalid("at most %d exclusions", SuggestExclusionsMax)
	}
	for _, e := range req.Exclusions {
		if utf8.RuneCountInString(e) > SuggestTextMax {
			return SuggestResponse{}, invalid("an exclusion is too long")
		}
	}
	system := prompts.TranslatorSuggestSystem(req.Kind, language, around, req.Adjustments.prompt(), req.Exclusions)
	var ans struct {
		Suggestions any `json:"suggestions"`
	}
	if err := s.completer.Complete(ctx, system, text, suggestSchema, &ans); err != nil {
		return SuggestResponse{}, err
	}
	return SuggestResponse{Suggestions: cleanSuggestions(ans.Suggestions)}, nil
}

// cleanSuggestions keeps the strings of a model's list, trimmed, without
// blanks and repeats.
func cleanSuggestions(v any) []string {
	var raw []any
	switch x := v.(type) {
	case []any:
		raw = x
	case string:
		raw = []any{x}
	}
	out := []string{}
	seen := map[string]struct{}{}
	for _, item := range raw {
		s, ok := item.(string)
		if !ok {
			continue
		}
		s = strings.TrimSpace(s)
		if s == "" {
			continue
		}
		if _, dup := seen[s]; dup {
			continue
		}
		seen[s] = struct{}{}
		out = append(out, s)
	}
	return out
}

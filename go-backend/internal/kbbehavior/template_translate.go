package kbbehavior

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"slices"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/jackc/pgx/v5"

	"github.com/justrag/go-backend/internal/ai"
	"github.com/justrag/go-backend/internal/pgxutil"
	"github.com/justrag/go-backend/internal/safego"
)

// TranslateFunc translates a template's texts into to ("de" or "en").
type TranslateFunc func(ctx context.Context, texts ai.RoleTexts, to string) (ai.RoleTexts, error)

// translateTimeout bounds one background translation (one LLM call).
const translateTimeout = 2 * time.Minute

// SetTranslator makes every save that changes a template's texts translate
// them into the other language in the background: the admin writes in one
// language, members of KBs in either see the role in theirs. validateStart
// checks a translated start (kbstartpage.ValidateTemplateStart); one that
// breaks its limits keeps the written texts. Call it before serving.
func (s *TemplateStore) SetTranslator(translate TranslateFunc, validateStart func(TemplateStart) error) {
	s.translate = translate
	s.validateStart = validateStart
}

func sourceLang(in TemplateInput) string {
	if in.Lang == "en" {
		return "en"
	}
	return "de"
}

func otherLang(lang string) string {
	if lang == "en" {
		return "de"
	}
	return "en"
}

func textIn(t Texts, lang string) string {
	if lang == "en" {
		return t.EN
	}
	return t.DE
}

func setText(t *Texts, lang, v string) {
	if lang == "en" {
		t.EN = v
	} else {
		t.DE = v
	}
}

func orText(v, fallback string) string {
	if v != "" {
		return v
	}
	return fallback
}

// sourceTexts are a template's texts in lang, as the translation takes them.
func sourceTexts(in TemplateInput, lang string) ai.RoleTexts {
	out := ai.RoleTexts{Name: textIn(in.Name, lang), Description: textIn(in.Description, lang), Prompt: textIn(in.Prompt, lang)}
	if in.Start != nil {
		out.StartText = textIn(in.Start.Text, lang)
		out.StartInstruction = textIn(in.Start.Instruction, lang)
		out.Questions = in.Start.Suggestions.FixedQuestions.DE
		if lang == "en" {
			out.Questions = in.Start.Suggestions.FixedQuestions.EN
		}
	}
	return out
}

func sameTexts(a, b ai.RoleTexts) bool {
	return a.Name == b.Name && a.Description == b.Description && a.Prompt == b.Prompt &&
		a.StartText == b.StartText && a.StartInstruction == b.StartInstruction && slices.Equal(a.Questions, b.Questions)
}

func clipText(s string, max int) string {
	s = strings.TrimSpace(s)
	if utf8.RuneCountInString(s) <= max {
		return s
	}
	return string([]rune(s)[:max])
}

// withTexts is in with its lang texts replaced by t (clipped to the limits).
func withTexts(in TemplateInput, lang string, t ai.RoleTexts) TemplateInput {
	setText(&in.Name, lang, clipText(t.Name, MaxRoleNameRunes))
	setText(&in.Description, lang, clipText(t.Description, MaxRoleDescRunes))
	setText(&in.Prompt, lang, clipText(t.Prompt, MaxPromptRunes))
	if in.Start != nil {
		start := *in.Start
		setText(&start.Text, lang, strings.TrimSpace(t.StartText))
		setText(&start.Instruction, lang, strings.TrimSpace(t.StartInstruction))
		qs := append([]string{}, t.Questions...)
		if lang == "en" {
			start.Suggestions.FixedQuestions.EN = qs
		} else {
			start.Suggestions.FixedQuestions.DE = qs
		}
		in.Start = &start
	}
	return in
}

// keepTranslation is the update in over the stored prev, and whether it
// changes the texts written in its language. A settings-only save keeps the
// stored other language: the client may hold the texts from before a
// background translation landed.
func keepTranslation(prev, in TemplateInput) (TemplateInput, bool) {
	if !sameTexts(sourceTexts(prev, in.Lang), sourceTexts(in, in.Lang)) {
		return in, true
	}
	other := otherLang(in.Lang)
	return withTexts(in, other, sourceTexts(prev, other)), false
}

// scanTemplate reads one row of templateColumns.
func scanTemplate(row pgx.Row) (AdminTemplate, error) {
	var (
		t        AdminTemplate
		disabled bool
	)
	err := row.Scan(&t.ID, &t.Icon, &t.IsDefault, &disabled, &t.Name.DE, &t.Name.EN,
		&t.Description.DE, &t.Description.EN, &t.Prompt.DE, &t.Prompt.EN, &t.Cover.From, &t.Cover.To, &t.Start)
	t.Enabled = !disabled
	return t, err
}

// translateLater translates the texts in of the saved template id into its
// other language in the background, when a translator is set.
func (s *TemplateStore) translateLater(id string, in TemplateInput) {
	if s.translate == nil {
		return
	}
	lang := sourceLang(in)
	src, dst := sourceTexts(in, lang), sourceTexts(in, otherLang(lang))
	bg := s.bg
	if bg == nil {
		bg = context.Background()
	}
	s.wg.Add(1)
	safego.Go(func() {
		defer s.wg.Done()
		ctx, cancel := context.WithTimeout(bg, translateTimeout)
		defer cancel()
		out, err := s.translate(ctx, src, otherLang(lang))
		if err == nil {
			err = s.applyTranslation(ctx, id, lang, src, dst, out)
		}
		if err != nil && ctx.Err() == nil {
			slog.Warn("kbbehavior: translating a role template failed; its other language keeps the old texts",
				"template", id, "error", err)
		}
	})
}

// errStale ends a translation whose template was edited meanwhile, in either
// language: the newer save translates its texts itself.
var errStale = errors.New("stale")

// applyTranslation stores out as the other language of template id — only
// while its lang texts are still src and its other language's still dst, the
// texts saved with them.
func (s *TemplateStore) applyTranslation(ctx context.Context, id, lang string, src, dst, out ai.RoleTexts) error {
	err := pgxutil.WithTx(ctx, s.pool, func(tx pgx.Tx) error {
		cur, err := scanTemplate(tx.QueryRow(ctx, `SELECT `+templateColumns+` FROM role_templates WHERE id = $1 FOR UPDATE`, id))
		if err != nil {
			return err
		}
		if !sameTexts(sourceTexts(cur.TemplateInput, lang), src) || !sameTexts(sourceTexts(cur.TemplateInput, otherLang(lang)), dst) {
			return errStale
		}
		next := withTexts(cur.TemplateInput, otherLang(lang), out)
		if next.Start != nil && s.validateStart != nil && s.validateStart(*next.Start) != nil {
			// A translated start over its limits: the written start texts
			// stand in for it, they fit.
			out.StartText, out.StartInstruction, out.Questions = src.StartText, src.StartInstruction, src.Questions
			next = withTexts(cur.TemplateInput, otherLang(lang), out)
		}
		// Not updated_at: the translation is not an admin's edit.
		_, err = tx.Exec(ctx, `UPDATE role_templates SET name_de = $2, name_en = $3, description_de = $4,
			description_en = $5, prompt_de = $6, prompt_en = $7, start = $8 WHERE id = $1`,
			id, next.Name.DE, next.Name.EN, next.Description.DE, next.Description.EN, next.Prompt.DE, next.Prompt.EN, next.Start)
		return err
	})
	if errors.Is(err, errStale) || errors.Is(err, pgx.ErrNoRows) {
		return nil
	}
	if err != nil {
		return fmt.Errorf("kbbehavior store template translation %s: %w", id, err)
	}
	return s.Refresh(ctx)
}

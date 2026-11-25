// Package translatorlang holds the languages the translator offers and the
// languages glossary terms are written in. It is a leaf package so that the
// translator, its site_config validators and its prompts share one list.
package translatorlang

import (
	"fmt"
	"strings"
)

// Language is one language of the translator's menus.
type Language struct {
	Code string `json:"code"`
	Name string `json:"name"`
}

// languages in the order the menus list them: English in its British and
// American variants first, then German and the rest. Codes are ISO 639-1,
// English with its region.
var languages = []Language{
	{"en-gb", "British English"},
	{"en-us", "American English"},
	{"de", "German"},
	{"uk", "Ukrainian"},
	{"fr", "French"},
	{"es", "Spanish"},
	{"it", "Italian"},
	{"nl", "Dutch"},
	{"pl", "Polish"},
	{"pt", "Portuguese"},
	{"ru", "Russian"},
	{"zh", "Chinese"},
	{"ja", "Japanese"},
}

// glossaryLanguages are the languages glossary terms are in.
var glossaryLanguages = []string{"de", "en", "uk", "fr", "es", "it"}

// DefaultTarget is the target language users start with.
const DefaultTarget = "en-gb"

// All returns the translator languages in menu order.
func All() []Language { return append([]Language(nil), languages...) }

// GlossaryLanguages returns the codes glossary terms may use.
func GlossaryLanguages() []string { return append([]string(nil), glossaryLanguages...) }

// Valid reports whether code is a language the translator offers.
func Valid(code string) bool { return Name(code) != "" }

// Name returns the English name of a translator language, "" when unknown.
func Name(code string) string {
	for _, l := range languages {
		if l.Code == code {
			return l.Name
		}
	}
	return ""
}

// ValidGlossaryLanguage reports whether code is a glossary term language.
func ValidGlossaryLanguage(code string) bool {
	for _, c := range glossaryLanguages {
		if c == code {
			return true
		}
	}
	return false
}

// Normalize maps a code as a model or an older release gave it onto one the
// translator offers: case and region are normalised, plain English is British
// English. It returns "" for anything else.
func Normalize(value string) string {
	code := strings.ReplaceAll(strings.ToLower(strings.TrimSpace(value)), "_", "-")
	if code == "en" {
		return "en-gb"
	}
	if Valid(code) {
		return code
	}
	base, _, _ := strings.Cut(code, "-")
	if base == "en" {
		return "en-gb"
	}
	if Valid(base) {
		return base
	}
	return ""
}

// GlossaryBase maps a translator language onto the glossary language its
// terms are written in: both English variants are "en". It returns "" when no
// glossary covers the language.
func GlossaryBase(code string) string {
	base, _, _ := strings.Cut(code, "-")
	if ValidGlossaryLanguage(base) {
		return base
	}
	return ""
}

// ValidateCode is the save-time validator of the default target language.
func ValidateCode(v string) error {
	if !Valid(strings.TrimSpace(v)) {
		return fmt.Errorf("must be one of the translator language codes")
	}
	return nil
}

// The site_config keys of the extension. They live in this leaf package so the
// save-time validators in internal/siteconfig can name them without importing
// the translator (which imports the chat package, which imports siteconfig).
const (
	// KeyEnabled switches the extension on. Off by default.
	KeyEnabled = "translator_enabled"
	// KeyDefaultTarget is the target language users start with.
	KeyDefaultTarget = "translator_default_target_lang"
)

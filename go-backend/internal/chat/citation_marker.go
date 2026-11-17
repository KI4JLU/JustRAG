package chat

import (
	"regexp"
	"strconv"
	"strings"
	"unicode/utf8"
)

// The citation marker format.
//
// The answer prompt asks for "[3]" and "[1, 2, 5]". Models that are also told
// to name the page write it into the marker instead of beside it:
// "[5, S. 584]", "[5, S. 584; 8, S. 583]", "[3, p. 12-14]". Such a marker
// cites the same sources, so it is read as one — its page text is the
// model's own claim and is ignored (a source's pages come from its chunk).
//
// citationMarkerRe finds candidates, parseMarkerBody decides: every reader
// (validator, span extraction, the seeCitations strip) goes through both, so
// they cannot disagree on what a citation is.

// maxAnnotatedMarkerBody bounds the body of a marker carrying page text, in
// characters. citationHoldRe holds a streamed tail back up to the same
// length, so the two must change together.
const maxAnnotatedMarkerBody = 160

// citationMarkerRe matches a marker candidate; group 1 is its body. The
// first alternative is the plain number list (any length), the second a
// bounded body that parseMarkerBody still has to accept. Both brackets may
// be markdown-escaped ("\[1\]"), which some models emit.
var citationMarkerRe = regexp.MustCompile(
	`\\?\[(\d+(?:\s*,\s*\d+)*|\d[^\[\]\n\\]{0,` + strconv.Itoa(maxAnnotatedMarkerBody-1) + `})\\?\]`)

var plainMarkerBodyRe = regexp.MustCompile(`^\d+(?:\s*,\s*\d+)*$`)

// The grammar of a marker with page text. The web app parses the same
// markers (web/src/utils/citationMarkerBody.ts) and must agree with this
// strip, so the sources below avoid everything RE2 and JavaScript read
// differently: no \s (its set differs), no (?i) (its case folding differs).
const (
	// The blanks a marker may hold: space, tab, no-break space, narrow
	// no-break space, thin space.
	markerBlanks = " \t\u00a0\u202f\u2009"
	markerWSSrc  = `[ \t\x{00a0}\x{202f}\x{2009}]`
	// A page or section reference, without the commas that separate marker
	// parts: "S. 584", "Seite 12-14", "pp. 3 und 5", "Abschnitt 3.2",
	// "S. 12 ff.".
	pageKeywordSrc = `(?:[Ss]\.?|[Ss]eiten?|[Pp]{1,2}\.?|[Pp]ages?|[Aa]bschn(?:itt|\.)|[Aa]bs\.|[Kk]ap(?:itel|\.)|[Ss]ections?|[Ss]ec\.|§§?)`
	pageUnitSrc    = `\d+(?:\.\d+)*[a-zA-Z]?`
	pageSpecSrc    = pageUnitSrc + `(?:` + markerWSSrc + `*(?:[-–—/&]|bis|to|u\.|und|and)` + markerWSSrc + `*` + pageUnitSrc + `)*(?:` + markerWSSrc + `*[fF]{1,2}\.?)?`
)

var (
	// "S. 584" — the page of the source named in the part before it.
	markerPagePartRe = regexp.MustCompile(`^` + pageKeywordSrc + markerWSSrc + `*` + pageSpecSrc + `$`)
	// "5 S. 584", "5: S. 584" — source and page in one part.
	markerSourcePagePartRe = regexp.MustCompile(`^(\d{1,4})` + markerWSSrc + `*:?` + markerWSSrc + `*` + pageKeywordSrc + markerWSSrc + `*` + pageSpecSrc + `$`)
	// "586", "586-588" — a further page after a page part.
	markerPageSpecRe = regexp.MustCompile(`^` + pageSpecSrc + `$`)
	// A source number.
	markerNumberRe = regexp.MustCompile(`^\d{1,4}$`)
)

// parseMarkerBody returns the 1-based source numbers a marker body cites, or
// nil when the body is no citation ("2024 war ein gutes Jahr") or cites only
// non-positive numbers. A body is a citation when it is the plain number
// list or names at least one page.
//
// Parts are separated by "," and sources by ";". A bare number is a source,
// except after a page part, where it is a further page ("5, S. 584, 586") —
// unless a page part follows it, which makes it the next source
// ("5, S. 584, 8, S. 583").
func parseMarkerBody(body string) []int {
	if plainMarkerBodyRe.MatchString(body) {
		return parseCitationNumbers(body)
	}
	if utf8.RuneCountInString(body) > maxAnnotatedMarkerBody {
		return nil
	}
	var out []int
	add := func(digits string) {
		if n, err := strconv.Atoi(digits); err == nil && n > 0 {
			out = append(out, n)
		}
	}
	hasPage := false
	for _, group := range strings.Split(body, ";") {
		parts := strings.Split(group, ",")
		for i := range parts {
			parts[i] = strings.Trim(parts[i], markerBlanks)
		}
		hasSource, inPages := false, false
		for i, part := range parts {
			switch {
			case markerNumberRe.MatchString(part):
				nextIsPage := i+1 < len(parts) && markerPagePartRe.MatchString(parts[i+1])
				if inPages && !nextIsPage {
					continue // a further page
				}
				add(part)
				hasSource, inPages = true, false
			case markerPagePartRe.MatchString(part):
				if !hasSource {
					return nil
				}
				inPages, hasPage = true, true
			case inPages && markerPageSpecRe.MatchString(part):
				// a further page range
			default:
				m := markerSourcePagePartRe.FindStringSubmatch(part)
				if m == nil {
					return nil
				}
				add(m[1])
				hasSource, inPages, hasPage = true, true, true
			}
		}
		if !hasSource {
			return nil
		}
	}
	if !hasPage {
		return nil // numbers and separators only: "[1, 2; 3, 4]" is a matrix
	}
	return out
}

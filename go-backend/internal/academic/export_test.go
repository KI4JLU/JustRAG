package academic

import "context"

// AllowAllURLsForTest disables the SSRF check so a loopback httptest server
// can serve a PDF. Test-only; returns a restore func.
func AllowAllURLsForTest() (restore func()) {
	old := validateURL
	validateURL = func(context.Context, string) error { return nil }
	return func() { validateURL = old }
}

// ParseResultsHTMLForTest parses a JustFind result page without the fetch,
// so tests need no loopback server past the SSRF guard.
func ParseResultsHTMLForTest(html, baseURL string) ([]AcademicPaper, error) {
	return parseResultsHTML(html, baseURL)
}

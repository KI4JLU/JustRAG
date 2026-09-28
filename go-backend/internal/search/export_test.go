package search

// Exported for the EXPLAIN test in store_pg_integration_test.go, which must
// plan the exact production SQL rather than a copy that could drift from it.
var (
	TopicsSQL         = topicsSQL
	SourcesSQL        = sourcesSQL
	SetFuzzyThreshold = setFuzzyThreshold
)

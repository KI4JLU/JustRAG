package glossaryaccess

// VisibleGlossariesCTE is the SQL mirror of EffectiveRole: one CTE, named
// visible_glossaries, that answers "which glossaries can this caller open, and
// with which role" for every glossary at once, so a list query can filter rows
// per glossary without calling EffectiveRole once per row.
//
// KEEP IN SYNC WITH EffectiveRole (access.go). It mirrors the ladder rule for
// rule and in the same order, because an explicit membership beats the
// implicit viewer of a global glossary:
//
//  1. a glossary_members row with a valid role -> that role
//  2. the glossary is global                   -> viewer
//  3. otherwise                                -> NULL (invisible)
//
// The parity test is TestVisibleGlossariesAgreesWithEffectiveRole in
// store_pg_integration_test.go: it runs this CTE and the real EffectiveRole,
// fed by PGStore.GetGlossary and GetMemberRole exactly as RequireGlossaryRole
// feeds it, over a fixture matrix covering every rung.
//
// Columns: id, visibility, role. Parameter: $1 caller user id; a consumer's
// own parameters start at $2. The CTE does not filter on role: consumers add
// `WHERE v.role IS NOT NULL`, so a scoped lookup can tell "no such glossary"
// (no row) from "exists but invisible" (a row with a NULL role).
//
// glossary_members' primary key (glossary_id, user_id) guarantees the LEFT
// JOIN adds at most one row per glossary. Role and visibility literals are
// spliced in from the Go constants, so a renamed role is a compile-time
// change here too.
const VisibleGlossariesCTE = `
	visible_glossaries AS (
		SELECT g.id, g.visibility,
		       CASE
		         WHEN m.role IN ('` + RoleViewer + `', '` + RoleEditor + `', '` +
	RoleAdmin + `', '` + RoleOwner + `') THEN m.role
		         WHEN g.visibility = '` + VisibilityGlobal + `' THEN '` + RoleViewer + `'
		       END AS role
		FROM glossaries g
		LEFT JOIN glossary_members m ON m.glossary_id = g.id AND m.user_id = $1::uuid
	)`

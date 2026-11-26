package glossaryaccess

import "testing"

func TestRankAndAtLeast(t *testing.T) {
	roles := []string{RoleViewer, RoleEditor, RoleAdmin, RoleOwner}
	for i, g := range roles {
		for j, r := range roles {
			if got, want := AtLeast(g, r), i >= j; got != want {
				t.Errorf("AtLeast(%q, %q) = %v, want %v", g, r, got, want)
			}
		}
	}
	for _, bad := range []string{"", "view", "edit", "superadmin", "OWNER"} {
		if AtLeast(bad, RoleViewer) || AtLeast(RoleOwner, bad) {
			t.Errorf("unknown role %q must never satisfy or demand a gate", bad)
		}
		if Valid(bad) || Assignable(bad) {
			t.Errorf("%q must be neither valid nor assignable", bad)
		}
	}
}

func TestAssignableExcludesOwner(t *testing.T) {
	cases := map[string]bool{RoleViewer: true, RoleEditor: true, RoleAdmin: true, RoleOwner: false, "": false}
	for role, want := range cases {
		if got := Assignable(role); got != want {
			t.Errorf("Assignable(%q) = %v, want %v", role, got, want)
		}
	}
}

func TestValidVisibility(t *testing.T) {
	for v, want := range map[string]bool{VisibilityPrivate: true, VisibilityGlobal: true, "organization": false, "": false, "public": false} {
		if got := ValidVisibility(v); got != want {
			t.Errorf("ValidVisibility(%q) = %v, want %v", v, got, want)
		}
	}
}

package adminconfigs

import "testing"

// Oracle: the documented bounds of contextWindow (0..10 000 000), checked in
// the chat and the legacy reasoning lists alike.
func TestValidateContextWindows(t *testing.T) {
	ok := []AIModelInput{{Name: "a", ContextWindow: 0}, {Name: "b", ContextWindow: 1_000_000}}
	if msg := validateContextWindows(ok, nil); msg != "" {
		t.Fatalf("valid windows refused: %s", msg)
	}
	for _, bad := range []int{-1, 10_000_001} {
		if validateContextWindows(nil, []AIModelInput{{Name: "r", ContextWindow: bad}}) == "" {
			t.Errorf("window %d accepted", bad)
		}
	}
}

package chat

import (
	"encoding/json"
	"strings"
	"testing"
)

// TestRowsCarryNoAgentSelection pins that neither a chat nor a message
// carries a team or agent on the wire any more: the user-created agents and
// teams were removed, and their columns are no longer read. Oracle: the
// marshalled JSON.
func TestRowsCarryNoAgentSelection(t *testing.T) {
	for name, v := range map[string]any{
		"ChatRow":    ChatRow{ID: "c1"},
		"MessageRow": MessageRow{ID: "m1", Role: "ai"},
	} {
		b, err := json.Marshal(v)
		if err != nil {
			t.Fatal(err)
		}
		for _, key := range []string{"teamId", "agentId"} {
			if strings.Contains(string(b), key) {
				t.Errorf("%s JSON carries %s: %s", name, key, b)
			}
		}
	}
}

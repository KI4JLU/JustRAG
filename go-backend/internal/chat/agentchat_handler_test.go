package chat

import (
	"encoding/json"
	"testing"

	"github.com/ag-ui-protocol/ag-ui/sdks/community/go/pkg/core/types"
)

func TestAgentChatPropsOf(t *testing.T) {
	cases := []struct {
		body            string
		reasoning, lang string
	}{
		{`{"forwardedProps":{"reasoning":"high","language":"en"}}`, "high", "en"},
		{`{"forwarded_props":{"reasoning":"low"}}`, "low", "de"},
		{`{"forwardedProps":{"reasoning":"max","language":"fr"}}`, "", "de"},
		{`{"forwardedProps":{"reasoning":true}}`, "", "de"},
		{`{"forwardedProps":"medium"}`, "", "de"},
		{`{}`, "", "de"},
	}
	for _, c := range cases {
		var in types.RunAgentInput
		if err := json.Unmarshal([]byte(c.body), &in); err != nil {
			t.Fatalf("%s: %v", c.body, err)
		}
		got := agentChatPropsOf(&in)
		if got.reasoning != c.reasoning || got.language != c.lang {
			t.Errorf("%s: got %+v, want reasoning %q language %q", c.body, got, c.reasoning, c.lang)
		}
	}
}

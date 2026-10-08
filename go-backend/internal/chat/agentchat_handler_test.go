package chat

import "testing"

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
		{`not json`, "", "de"},
	}
	for _, c := range cases {
		got := agentChatPropsOf([]byte(c.body))
		if got.reasoning != c.reasoning || got.language != c.lang {
			t.Errorf("%s: got %+v, want reasoning %q language %q", c.body, got, c.reasoning, c.lang)
		}
	}
}

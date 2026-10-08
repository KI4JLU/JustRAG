package cascade

import "testing"

func TestUserDeleteSteps_ADKSessionsBeforeUser(t *testing.T) {
	for _, kbs := range [][]string{nil, {"kb1"}} {
		steps := userDeleteSteps("u1", kbs)
		idx := map[string]int{}
		for i, s := range steps {
			idx[s.sql] = i
		}
		sess, ok1 := idx[`DELETE FROM adk_sessions WHERE user_id = $1`]
		ust, ok2 := idx[`DELETE FROM adk_user_states WHERE user_id = $1`]
		usr, ok3 := idx[`DELETE FROM users WHERE id = $1`]
		if !ok1 || !ok2 || !ok3 {
			t.Fatalf("missing step(s): sessions=%v user_states=%v users=%v", ok1, ok2, ok3)
		}
		if !(sess < ust && ust < usr) {
			t.Fatalf("order wrong: sessions=%d user_states=%d users=%d", sess, ust, usr)
		}
		if steps[sess].args[0] != "u1" || steps[ust].args[0] != "u1" {
			t.Fatalf("args not the text user id: %v %v", steps[sess].args, steps[ust].args)
		}
		for _, s := range steps {
			if s.sql == `DELETE FROM adk_app_states` {
				t.Fatal("adk_app_states must be untouched")
			}
		}
	}
}

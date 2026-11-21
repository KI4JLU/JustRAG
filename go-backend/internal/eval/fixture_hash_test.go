package eval

import "testing"

func TestHashFixtureContent(t *testing.T) {
	got := HashFixtureContent([]byte("hello\n"))
	want := "5891b5b522d5df086d0ff0b110fbd9d21bb4fc7163af34d08286a2e846f6be03"
	if got != want {
		t.Errorf("HashFixtureContent = %q, want %q", got, want)
	}
}

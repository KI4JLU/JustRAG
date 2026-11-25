package translatorlang

import "testing"

func TestNormalize(t *testing.T) {
	tests := []struct{ in, want string }{
		{"en", "en-gb"}, {"EN", "en-gb"}, {"en-GB", "en-gb"}, {"en_US", "en-us"}, {"en-AU", "en-gb"},
		{"de", "de"}, {"DE-at", "de"}, {"pt-BR", "pt"}, {" fr ", "fr"},
		{"xx", ""}, {"", ""}, {"klingon", ""},
	}
	for _, tc := range tests {
		if got := Normalize(tc.in); got != tc.want {
			t.Errorf("Normalize(%q) = %q, want %q", tc.in, got, tc.want)
		}
	}
}

func TestGlossaryBase(t *testing.T) {
	tests := map[string]string{"en-gb": "en", "en-us": "en", "de": "de", "uk": "uk", "ja": "", "nl": "", "": ""}
	for in, want := range tests {
		if got := GlossaryBase(in); got != want {
			t.Errorf("GlossaryBase(%q) = %q, want %q", in, got, want)
		}
	}
}

func TestValidateCode(t *testing.T) {
	for v, bad := range map[string]bool{"en-gb": false, "de": false, "en": true, "": true, "xx": true} {
		if err := ValidateCode(v); (err != nil) != bad {
			t.Errorf("ValidateCode(%q) error = %v, want error %v", v, err, bad)
		}
	}
}

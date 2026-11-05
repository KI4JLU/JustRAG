package app

import (
	"strings"
	"testing"

	"github.com/justrag/go-backend/internal/config"
	"github.com/justrag/go-backend/internal/kbbehavior"
)

// The app name's two parts are names role prompts resolve to, so config
// accepts exactly the values kbbehavior.ValidateName does: otherwise the site
// config would hand out a name the prompts replace with the default.
// Oracle: kbbehavior.ValidateName. Not parallel: it sets the environment.
func TestAppNameFromEnvMatchesPromptNameRule(t *testing.T) {
	t.Setenv("JWT_SECRET", "test-secret-that-is-at-least-32-characters-long")
	t.Setenv("NODE_ENV", "")
	t.Setenv("GO_ENV", "")
	for _, v := range []string{
		"TUM", "Uni Gießen", strings.Repeat("ä", kbbehavior.MaxNameRunes),
		strings.Repeat("ä", kbbehavior.MaxNameRunes+1), "a\nb", "a\rb",
	} {
		t.Setenv("APP_NAME_PREFIX", v)
		cfg, err := config.Load()
		if err != nil {
			t.Fatalf("config.Load: %v", err)
		}
		accepted := cfg.AppNamePrefix == v
		if valid := kbbehavior.ValidateName(v) == nil; accepted != valid {
			t.Errorf("APP_NAME_PREFIX=%q: config accepts it %v, kbbehavior.ValidateName %v", v, accepted, valid)
		}
	}
}

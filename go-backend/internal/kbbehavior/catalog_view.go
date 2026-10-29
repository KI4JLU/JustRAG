package kbbehavior

// CatalogRole is a template role as GET /api/kb-behavior/catalog serves it.
type CatalogRole struct {
	ID          string `json:"id"`
	Name        string `json:"name"`
	Description string `json:"description"`
	Prompt      string `json:"prompt"`
	Icon        string `json:"icon"`
	IsDefault   bool   `json:"isDefault"`
	// Enabled false: no longer offered for new picks; still listed, since KBs
	// that use it show and answer with it.
	Enabled bool  `json:"enabled"`
	Cover   Cover `json:"cover"`
}

// Cover is a role card's gradient on a start page, #RRGGBB each.
type Cover struct {
	From string `json:"from"`
	To   string `json:"to"`
}

// CatalogRule is a template rule; Text is what Compile puts into the prompt.
type CatalogRule struct {
	ID          string `json:"id"`
	Label       string `json:"label"`
	Description string `json:"description"`
	Text        string `json:"text"`
	DefaultOn   bool   `json:"defaultOn"`
}

// CatalogRuleGroup is one group of template rules.
type CatalogRuleGroup struct {
	ID    string        `json:"id"`
	Title string        `json:"title"`
	Rules []CatalogRule `json:"rules"`
}

// CatalogLimits are the limits Validate applies, so the client counts the same.
type CatalogLimits struct {
	PromptMax      int `json:"promptMax"`
	RoleNameMax    int `json:"roleNameMax"`
	RuleMax        int `json:"ruleMax"`
	CustomRolesMax int `json:"customRolesMax"`
	CustomRulesMax int `json:"customRulesMax"`
}

// Catalog is the body of GET /api/kb-behavior/catalog.
type Catalog struct {
	Language     string             `json:"language"`
	Roles        []CatalogRole      `json:"roles"`
	RuleGroups   []CatalogRuleGroup `json:"ruleGroups"`
	RulesHeading string             `json:"rulesHeading"`
	Limits       CatalogLimits      `json:"limits"`
}

// CatalogFor renders the catalog in lang ("de" or "en").
func CatalogFor(lang string) Catalog {
	roles := templateRoles()
	c := Catalog{
		Language:     lang,
		Roles:        make([]CatalogRole, 0, len(roles)),
		RuleGroups:   make([]CatalogRuleGroup, 0, len(ruleGroups)),
		RulesHeading: rulesHeading.in(lang),
		Limits: CatalogLimits{
			PromptMax:      MaxPromptRunes,
			RoleNameMax:    MaxRoleNameRunes,
			RuleMax:        MaxRuleRunes,
			CustomRolesMax: MaxCustomRoles,
			CustomRulesMax: MaxCustomRules,
		},
	}
	defaultID := DefaultRoleID()
	for _, r := range roles {
		c.Roles = append(c.Roles, CatalogRole{
			ID: r.id, Name: r.name.in(lang), Description: r.description.in(lang),
			Prompt: r.prompt.in(lang), Icon: r.icon, IsDefault: r.id == defaultID,
			Enabled: !r.disabled, Cover: Cover{From: r.coverFrom, To: r.coverTo},
		})
	}
	for _, g := range ruleGroups {
		cg := CatalogRuleGroup{ID: g.id, Title: g.title.in(lang), Rules: make([]CatalogRule, 0, len(g.rules))}
		for _, r := range g.rules {
			cg.Rules = append(cg.Rules, CatalogRule{
				ID: r.id, Label: r.label.in(lang), Description: r.description.in(lang),
				Text: r.text.in(lang), DefaultOn: r.defaultOn,
			})
		}
		c.RuleGroups = append(c.RuleGroups, cg)
	}
	return c
}

// RoleName is the display name of roleID for a KB with behavior eff: a
// template's name in lang, or the KB's own role's name; "" when unknown.
func RoleName(eff Behavior, roleID, lang string) string {
	if t, ok := findTemplateRole(roleID); ok {
		return t.name.in(lang)
	}
	for _, r := range eff.CustomRoles {
		if r.ID == roleID {
			return r.Name
		}
	}
	return ""
}

// RuleLabel is the display label of a catalog rule in lang; "" when unknown.
func RuleLabel(ruleID, lang string) string {
	for _, g := range ruleGroups {
		for _, r := range g.rules {
			if r.id == ruleID {
				return r.label.in(lang)
			}
		}
	}
	return ""
}

// RuleIDs lists the catalog's rule ids in catalog order.
func RuleIDs() []string {
	var ids []string
	for _, g := range ruleGroups {
		for _, r := range g.rules {
			ids = append(ids, r.id)
		}
	}
	return ids
}

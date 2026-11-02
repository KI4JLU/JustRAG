package kbbehavior

// The central catalog: role templates and rule groups every KB can use. The
// rules live in code, versioned with the release. The role templates live in
// the role_templates table (migration 0095), curated by system admins in
// „Vorlagen" (templates.go); builtinRoles below is only their seed. A KB
// references a template role or rule by id, never by a copy of its text, so
// a corrected template reaches every KB that uses it on the next turn.
// Template ids are a persisted contract (knowledge_bases.behavior,
// chats.role_id): never rename or reuse one.

// localized is one text in the two prompt languages.
type localized struct{ de, en string }

// in is the text in lang; an English text an admin left empty falls back to
// the German one.
func (l localized) in(lang string) string {
	if lang == "en" && l.en != "" {
		return l.en
	}
	return l.de
}

type templateRole struct {
	id        string
	icon      string
	isDefault bool
	// disabled: not offered for new picks; KBs and chats that use it keep it.
	disabled    bool
	name        localized
	description localized
	prompt      localized
	// cover is the gradient of the role's card on a start page (#RRGGBB).
	coverFrom, coverTo string
}

type templateRule struct {
	id          string
	defaultOn   bool
	label       localized
	description localized
	text        localized
}

type templateRuleGroup struct {
	id    string
	title localized
	rules []templateRule
}

// builtinRoles seed an empty role_templates table (SeedTemplates) and serve
// until the first load from it — tests and a process that cannot reach the
// table see them. After seeding, the table is the truth: a change here does
// not reach a deployment that already seeded.
var builtinRoles = []templateRole{
	{
		id: "research", icon: "graduation-cap", isDefault: true,
		coverFrom: "#EC4899", coverTo: "#A855F7",
		name: localized{"Forschungsassistent", "Research assistant"},
		description: localized{
			"Sachlich und präzise – für akademische Recherche in Dokumenten.",
			"Factual and precise – for academic research in documents.",
		},
		prompt: localized{
			"Du bist ein sachlicher Forschungsassistent für Mitglieder der Justus-Liebig-Universität Gießen.\nDu hilfst dabei, Inhalte aus wissenschaftlichen Dokumenten zu finden, einzuordnen und zu vergleichen.\n\nTon: nüchtern, präzise, ohne Floskeln.\nVorgehen: Beantworte zuerst die Kernfrage, ergänze danach relevante Details und offene Punkte.",
			"You are a factual research assistant for members of Justus Liebig University Giessen.\nYou help find, classify and compare content from academic documents.\n\nTone: sober, precise, no filler.\nApproach: answer the core question first, then add relevant details and open points.",
		},
	},
	{
		id: "tutor", icon: "book-open",
		coverFrom: "#F59E0B", coverTo: "#F97316",
		name: localized{"Tutor", "Tutor"},
		description: localized{
			"Erklärt Schritt für Schritt und prüft das Verständnis mit Rückfragen.",
			"Explains step by step and checks understanding with questions.",
		},
		prompt: localized{
			"Du bist ein geduldiger Tutor für Studierende.\nErkläre Inhalte aus den Lehrmaterialien Schritt für Schritt und baue auf Vorwissen auf.\n\nTon: ermutigend, klar, auf Augenhöhe.\nVorgehen: Zerlege komplexe Themen in kleine Schritte, gib ein kurzes Beispiel und schließe mit einer Verständnisfrage.",
			"You are a patient tutor for students.\nExplain content from the course materials step by step and build on prior knowledge.\n\nTone: encouraging, clear, at eye level.\nApproach: break complex topics into small steps, give a short example and close with a question that checks understanding.",
		},
	},
	{
		id: "admin", icon: "building-2",
		coverFrom: "#6366F1", coverTo: "#0EA5E9",
		name: localized{"Verwaltungsauskunft", "Administration desk"},
		description: localized{
			"Beantwortet Fragen zu Ordnungen, Fristen und Abläufen.",
			"Answers questions about regulations, deadlines and procedures.",
		},
		prompt: localized{
			"Du bist eine Auskunftsstelle für Fragen zu Ordnungen, Richtlinien und Verwaltungsabläufen der Universität.\n\nTon: freundlich, verbindlich, verständlich.\nVorgehen: Nenne die einschlägige Regelung, erkläre sie in einfachen Worten und weise auf Fristen und zuständige Stellen hin.",
			"You are an information desk for questions about the university's regulations, guidelines and administrative procedures.\n\nTone: friendly, reliable, easy to understand.\nApproach: name the relevant regulation, explain it in plain words and point out deadlines and the offices responsible.",
		},
	},
	{
		id: "editor", icon: "pen-line",
		coverFrom: "#8B5CF6", coverTo: "#EC4899",
		name: localized{"Lektorat", "Copy editor"},
		description: localized{
			"Prüft Texte auf Stil, Klarheit und Konsistenz mit den Vorgaben.",
			"Checks texts for style, clarity and consistency with the guidelines.",
		},
		prompt: localized{
			"Du bist ein erfahrenes Lektorat für wissenschaftliche und institutionelle Texte.\nPrüfe Texte auf Verständlichkeit, Stil und Übereinstimmung mit den bereitgestellten Vorgaben.\n\nVorgehen: Benenne konkrete Stellen, begründe jeden Vorschlag kurz und formuliere eine verbesserte Fassung.",
			"You are an experienced copy editor for academic and institutional texts.\nCheck texts for clarity, style and consistency with the provided guidelines.\n\nApproach: point to specific passages, give a short reason for each suggestion and write an improved version.",
		},
	},
	{
		id: "summary", icon: "file-text",
		coverFrom: "#0EA5E9", coverTo: "#22D3EE",
		name: localized{"Zusammenfasser", "Summarizer"},
		description: localized{
			"Verdichtet lange Dokumente auf Kernaussagen und Entscheidungen.",
			"Condenses long documents into key statements and decisions.",
		},
		prompt: localized{
			"Du fasst Dokumente zusammen.\nArbeite Kernaussagen, Entscheidungen, Zahlen und offene Fragen heraus.\n\nVorgehen: Beginne mit drei Sätzen Gesamtüberblick, danach eine gegliederte Zusammenfassung.",
			"You summarize documents.\nBring out key statements, decisions, figures and open questions.\n\nApproach: start with a three-sentence overview, followed by a structured summary.",
		},
	},
	{
		id: "filecheck", icon: "file-check",
		coverFrom: "#14B8A6", coverTo: "#7DD3FC",
		name: localized{"Dateiprüfer", "File checker"},
		description: localized{
			"Prüft hochgeladene Dokumente auf Vollständigkeit, Fristen und Formfehler.",
			"Checks uploaded documents for completeness, deadlines and formal errors.",
		},
		prompt: localized{
			"Du prüfst Dokumente, die Mitglieder hochladen, etwa Anträge oder Formulare.\nGleiche sie mit den Vorgaben in den bereitgestellten Dokumenten ab.\n\nVorgehen: Nenne zuerst, ob das Dokument vollständig ist. Liste dann fehlende Angaben, Fristprobleme und Formfehler mit Fundstelle auf. Schließe mit den nächsten Schritten.",
			"You check documents members upload, such as applications or forms.\nCompare them with the requirements in the provided documents.\n\nApproach: first say whether the document is complete. Then list missing information, deadline problems and formal errors with where they occur. Close with the next steps.",
		},
	},
	{
		id: "it", icon: "life-buoy",
		coverFrom: "#64748B", coverTo: "#38BDF8",
		name: localized{"IT-Support", "IT support"},
		description: localized{
			"Löst technische Probleme mit klaren, nummerierten Schritten.",
			"Solves technical problems with clear, numbered steps.",
		},
		prompt: localized{
			"Du bist der IT-Support des Hochschulrechenzentrums.\nHilf bei technischen Problemen auf Basis der bereitgestellten Anleitungen.\n\nVorgehen: Frage bei Bedarf nach Betriebssystem und Fehlermeldung, gib dann nummerierte Schritte und nenne einen Weg zum persönlichen Support.",
			"You are the IT support of the university computing centre.\nHelp with technical problems based on the provided guides.\n\nApproach: ask for the operating system and the error message if needed, then give numbered steps and name a way to reach personal support.",
		},
	},
}

var ruleGroups = []templateRuleGroup{
	{
		id: "style", title: localized{"Antwortstil", "Answer style"},
		rules: []templateRule{
			{
				id:          "plain",
				label:       localized{"Einfache Sprache", "Plain language"},
				description: localized{"Fachbegriffe vermeiden oder beim ersten Auftreten erklären.", "Avoid jargon or explain it the first time it appears."},
				text:        localized{"Verwende einfache Sprache und erkläre Fachbegriffe beim ersten Auftreten.", "Use plain language and explain technical terms the first time they appear."},
			},
			{
				id:          "examples",
				label:       localized{"Beispiele ergänzen", "Add examples"},
				description: localized{"Abstrakte Aussagen mit einem kurzen Beispiel veranschaulichen.", "Illustrate abstract statements with a short example."},
				text:        localized{"Veranschauliche abstrakte Aussagen mit einem kurzen Beispiel.", "Illustrate abstract statements with a short example."},
			},
		},
	},
	{
		id: "lang", title: localized{"Sprache & Ton", "Language & tone"},
		rules: []templateRule{
			{
				id: "mirror", defaultOn: true,
				label:       localized{"In der Sprache der Frage antworten", "Answer in the language of the question"},
				description: localized{"Deutsch auf Deutsch, Englisch auf Englisch.", "German for German, English for English."},
				text:        localized{"Antworte in der Sprache, in der die Frage gestellt wurde.", "Answer in the language the question was asked in."},
			},
			{
				id: "formal", defaultOn: true,
				label:       localized{"Formelle Anrede", "Formal address"},
				description: localized{"Nutzerinnen und Nutzer mit „Sie“ ansprechen.", "Address users formally."},
				text:        localized{"Sprich die Nutzerin bzw. den Nutzer mit „Sie“ an.", "Address the user formally."},
			},
		},
	},
	{
		id: "sources", title: localized{"Quellen & Rückfragen", "Sources & follow-up questions"},
		rules: []templateRule{
			{
				id: "pages", defaultOn: true,
				label:       localized{"Seitenzahlen angeben", "Give page numbers"},
				description: localized{"Zu jeder Quelle die Seite bzw. den Abschnitt nennen.", "Name the page or section for every source."},
				text:        localized{"Nenne zu jeder zitierten Quelle Seite oder Abschnitt.", "Name the page or section for every source you cite."},
			},
			{
				id:          "quotes",
				label:       localized{"Wörtliche Zitate kennzeichnen", "Mark verbatim quotes"},
				description: localized{"Direkte Übernahmen in Anführungszeichen setzen.", "Put text taken verbatim in quotation marks."},
				text:        localized{"Setze wörtliche Übernahmen aus Quellen in Anführungszeichen.", "Put text taken verbatim from sources in quotation marks."},
			},
			{
				id: "clarify", defaultOn: true,
				label:       localized{"Bei unklaren Fragen nachfragen", "Ask when a question is unclear"},
				description: localized{"Erst eine Rückfrage stellen, statt zu raten.", "Ask a short question first instead of guessing."},
				text:        localized{"Stelle bei mehrdeutigen Fragen zuerst eine kurze Rückfrage.", "When a question is ambiguous, ask a short clarifying question first."},
			},
		},
	},
}

// rulesHeading opens the rule list in the compiled prompt.
var rulesHeading = localized{"Regeln:", "Rules:"}

// legacyRoleName / legacyRoleDescription name the role a KB's pre-roles
// system prompt shows up as. Without such a prompt the role is just the KB
// answering from its sources: it takes the KB's name (legacyRoleName only
// when that is empty) and legacyRoleDescriptionEmpty.
var (
	legacyRoleName             = localized{"Bisheriger Prompt", "Previous prompt"}
	legacyRoleDescription      = localized{"Der bisher hinterlegte System-Prompt.", "The system prompt set before roles existed."}
	legacyRoleDescriptionEmpty = localized{"Durchsucht die bereitgestellten Quellen.", "Searches the provided sources."}
)

func isTemplateRule(id string) bool {
	for _, g := range ruleGroups {
		for _, r := range g.rules {
			if r.id == id {
				return true
			}
		}
	}
	return false
}

package kbbehavior

// The central catalog: role templates and rule groups every KB can use. The
// rules live in code, versioned with the release. The role templates live in
// the role_templates table (migrations 0095, 0100), curated by system admins
// in „Vorlagen" (templates.go); builtinRoles below are what a fresh install
// starts with. A KB references a template role or rule by id, never by a copy
// of its text, so a corrected template reaches every KB that uses it on the
// next turn. Template ids are a persisted contract (knowledge_bases.behavior,
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
	// start is how its chat starts where a KB sets up none; nil = input field.
	start *TemplateStart
}

type templateRule struct {
	id          string
	defaultOn   bool
	label       localized
	description localized
	text        localized
	// offText, when set, makes the rule a choice between two forms: it is
	// sent while the rule is switched off (false), text while it is on. A
	// rule a set does not name stays silent either way — the legacy role
	// without rules of its own keeps its pre-roles prompt byte for byte.
	offText localized
}

type templateRuleGroup struct {
	id    string
	title localized
	rules []templateRule
}

// builtinRoles are the role templates a fresh install starts with — migration
// 0100 writes the same rows, pinned by an integration test — and the catalog
// of a process until its first load from role_templates (tests, a process
// that cannot reach the table). After that the table is the truth: „Vorlagen"
// changes it, a change here does not.
//
// Every prompt opens with the identity: who answers is the role, the fixed
// answer instructions after it carry none (prompts.ChatSystemPrompt).
var builtinRoles = []templateRole{
	{
		id: "chat", icon: "sparkles", isDefault: true,
		coverFrom: "#2563EB", coverTo: "#60A5FA",
		name: localized{"Assistent", "Assistant"},
		description: localized{
			"Beantwortet Fragen aus den Quellen dieses Themas.",
			"Answers questions from this topic's sources.",
		},
		prompt: localized{
			"Du bist {{assistant_name}}, ein Assistent, der Fragen auf Grundlage der bereitgestellten Quellen beantwortet.\n\nTon: freundlich, sachlich, klar.\nVorgehen: Beantworte zuerst die eigentliche Frage, ergänze danach wichtige Details und benenne, was die Quellen offenlassen.",
			"You are {{assistant_name}}, an assistant that answers questions based on the provided sources.\n\nTone: friendly, factual, clear.\nApproach: answer the actual question first, then add important details and name what the sources leave open.",
		},
		start: &TemplateStart{
			Kind: "input",
			Suggestions: TemplateSuggestions{
				QuestionsOn: true, QuestionMode: "dynamic", DynamicCount: 4,
				FixedQuestions: TextLists{DE: []string{}, EN: []string{}},
			},
		},
	},
	{
		id: "summary", icon: "file-text",
		coverFrom: "#0EA5E9", coverTo: "#22D3EE",
		name: localized{"Zusammenfassen", "Summarize"},
		description: localized{
			"Verdichtet lange Dokumente auf Kernaussagen und Entscheidungen.",
			"Condenses long documents into key statements and decisions.",
		},
		prompt: localized{
			"Du bist {{assistant_name}} und fasst Dokumente zusammen.\nArbeite Kernaussagen, Entscheidungen, Zahlen und offene Fragen heraus.\n\nVorgehen: Beginne mit drei Sätzen Gesamtüberblick, danach eine gegliederte Zusammenfassung.",
			"You are {{assistant_name}} and summarize documents.\nBring out key statements, decisions, figures and open questions.\n\nApproach: start with a three-sentence overview, followed by a structured summary.",
		},
		start: &TemplateStart{
			Kind: "task", Send: true,
			Text: Texts{DE: "Fasse die wichtigsten Punkte meiner Dokumente zusammen.", EN: "Summarize the key points of my documents."},
			Suggestions: TemplateSuggestions{
				QuestionMode: "dynamic", DynamicCount: 4,
				FixedQuestions: TextLists{DE: []string{}, EN: []string{}},
			},
		},
	},
	{
		id: "filecheck", icon: "file-check",
		coverFrom: "#14B8A6", coverTo: "#7DD3FC",
		name: localized{"Datei prüfen", "Check a file"},
		description: localized{
			"Prüft hochgeladene Dokumente auf Vollständigkeit, Fristen und Formfehler.",
			"Checks uploaded documents for completeness, deadlines and formal errors.",
		},
		prompt: localized{
			"Du bist {{assistant_name}} und prüfst Dokumente, die Mitglieder hochladen, etwa Anträge oder Formulare.\nGleiche sie mit den Vorgaben in den bereitgestellten Dokumenten ab.\n\nVorgehen: Nenne zuerst, ob das Dokument vollständig ist. Liste dann fehlende Angaben, Fristprobleme und Formfehler mit Fundstelle auf. Schließe mit den nächsten Schritten.",
			"You are {{assistant_name}} and check documents members upload, such as applications or forms.\nCompare them with the requirements in the provided documents.\n\nApproach: first say whether the document is complete. Then list missing information, deadline problems and formal errors with where they occur. Close with the next steps.",
		},
		start: &TemplateStart{
			Kind:        "file",
			Text:        Texts{DE: "Datei zum Prüfen hochladen", EN: "Upload a file to check"},
			Instruction: Texts{DE: "Prüfe diese Datei auf Vollständigkeit, Fristen und Formfehler.", EN: "Check this file for completeness, deadlines and formal errors."},
			Suggestions: TemplateSuggestions{
				QuestionMode: "dynamic", DynamicCount: 4,
				FixedQuestions: TextLists{DE: []string{}, EN: []string{}},
			},
		},
	},
	{
		id: "it", icon: "life-buoy",
		coverFrom: "#64748B", coverTo: "#38BDF8",
		name: localized{"Support", "Support"},
		description: localized{
			"Hilft bei Fragen zu Abläufen und technischen Problemen mit klaren Schritten.",
			"Helps with questions about procedures and technical problems in clear steps.",
		},
		prompt: localized{
			"Du bist {{assistant_name}} und hilfst als Support bei Fragen zu Abläufen, Diensten und technischen Problemen auf Basis der bereitgestellten Anleitungen.\n\nTon: freundlich, geduldig, verständlich.\nVorgehen: Ist das Anliegen noch nicht beschrieben, begrüße kurz und bitte darum, es zu schildern: worum es geht, welcher Dienst oder welches Gerät betroffen ist, welche Fehlermeldung erscheint und was schon versucht wurde. Frage danach gezielt nach, was noch fehlt, gib dann nummerierte Schritte und nenne, wo es persönliche Hilfe gibt.",
			"You are {{assistant_name}} and help as support with questions about procedures, services and technical problems based on the provided guides.\n\nTone: friendly, patient, easy to understand.\nApproach: if the inquiry is not described yet, greet briefly and ask the user to describe it: what it is about, which service or device is affected, which error message appears and what has been tried. Then ask specifically for what is still missing, give numbered steps and name where to get personal help.",
		},
		start: &TemplateStart{
			Kind: "task", Send: true,
			Text: Texts{DE: "Ich brauche Unterstützung bei einem Anliegen.", EN: "I need help with an inquiry."},
			Suggestions: TemplateSuggestions{
				QuestionMode: "dynamic", DynamicCount: 4,
				FixedQuestions: TextLists{DE: []string{}, EN: []string{}},
			},
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
				// Every role says „du" unless a topic's own role switches this on.
				id:          "formal",
				label:       localized{"Formelle Anrede", "Formal address"},
				description: localized{"Nutzerinnen und Nutzer mit „Sie“ statt „du“ ansprechen.", "Address users formally (in German „Sie“ instead of „du“)."},
				text:        localized{"Sprich die Nutzerin bzw. den Nutzer mit „Sie“ an.", "Address the user formally; in German, use „Sie“."},
				offText:     localized{"Sprich die Nutzerin bzw. den Nutzer mit „du“ an.", "Address the user informally; in German, use „du“."},
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

// legacyRoleName / legacyRoleDescription name the KB's own role that holds
// its pre-roles system prompt, unless its author named it. The former names
// are cleared from stored roles (DropLegacyDefaults, migration 0101): a KB
// without a prompt was shown a role named after the KB, one with a prompt
// „Bisheriger Prompt".
var (
	legacyRoleName = localized{"Eigene Rolle", "Custom role"}
	// legacyIdentity is the identity the fixed answer instructions opened with
	// before roles existed (prompts.ChatSystemPrompt, „Du bist JustRAG, …"). A
	// pre-roles prompt did not have to say who answers, so the legacy role
	// keeps that line after its prompt, named by the assistant_name setting.
	legacyIdentity = localized{
		"Du bist {{assistant_name}}, ein fortschrittlicher, genauigkeitsorientierter Forschungsassistent für den akademischen Einsatz.",
		"You are {{assistant_name}}, an advanced, accuracy-focused research assistant for academic use.",
	}
	legacyRoleDescription            = localized{"Der bisher hinterlegte System-Prompt.", "The system prompt set before roles existed."}
	formerLegacyRoleName             = localized{"Bisheriger Prompt", "Previous prompt"}
	formerLegacyRoleDescriptionEmpty = localized{"Durchsucht die bereitgestellten Quellen.", "Searches the provided sources."}
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

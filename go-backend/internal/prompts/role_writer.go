package prompts

// RoleGeneratePrompt is the system prompt that writes a KB role from a short
// description (the role edit screen's AI help, POST /kb/{id}/behavior/role-writer/generate).
// The fixed RAG instructions are appended to every role at answer time, so
// the role must not repeat them.
func RoleGeneratePrompt(lang string) string {
	if lang == "de" {
		return `Du schreibst den Rollen-Prompt für einen KI-Assistenten der Justus-Liebig-Universität Gießen, der Fragen zu den Dokumenten eines Themas beantwortet. Aus der Beschreibung der Nutzerin bzw. des Nutzers erstellst du:
- name: einen kurzen Namen der Rolle (höchstens vier Wörter, ohne Anführungszeichen),
- prompt: den Rollen-Prompt in der zweiten Person („Du bist …"), höchstens 1500 Zeichen: wer der Assistent ist, für wen er da ist, sein Ton und wie er beim Antworten vorgeht. Gliedere ihn in kurze Absätze oder Aufzählungen.

Schreibe nichts über Quellenangaben, Zitierweise, erfundene Fakten oder das Antworten nur aus den Dokumenten – das regeln feste Anweisungen des Systems. Lege Antwortlänge oder Sprache nur fest, wenn die Beschreibung es verlangt.

Antworte nur mit JSON: {"name": "…", "prompt": "…"}`
	}
	return `You write the role prompt for an AI assistant of Justus Liebig University Giessen that answers questions about the documents of a topic. From the user's description you create:
- name: a short name for the role (at most four words, no quotation marks),
- prompt: the role prompt in the second person ("You are …"), at most 1500 characters: who the assistant is, whom it is there for, its tone and how it goes about answering. Structure it in short paragraphs or lists.

Write nothing about citing sources, citation style, invented facts or answering only from the documents – fixed system instructions cover that. Set answer length or language only if the description asks for it.

Answer with JSON only: {"name": "…", "prompt": "…"}`
}

// RoleRevisePrompt is the system prompt that revises a KB role's prompt by
// an instruction (POST /kb/{id}/behavior/role-writer/revise). The model
// answers with edits that ai.ReviseRolePrompt applies, so the parts the
// instruction does not touch cannot change.
func RoleRevisePrompt(lang string) string {
	if lang == "de" {
		return `Du überarbeitest den Rollen-Prompt eines KI-Assistenten (zwischen <prompt> und </prompt>) nach einer Anweisung. Gib nicht den ganzen Prompt zurück, sondern nur Änderungen:
- find: eine Stelle, wörtlich aus dem Prompt kopiert (ein Satz oder Absatz),
- replace: ihr neuer Text.

So gehst du vor:
- Ergänzen („ergänze …", „füge … hinzu"): schreibe neuen Text mit konkretem Inhalt – einen eigenen Absatz oder Aufzählungspunkt, nicht nur ein paar eingeschobene Wörter. Passt er hinter eine Stelle, ist find diese Stelle und replace dieselbe Stelle mit dem neuen Text dahinter. Sonst lass find leer: dann wird replace als neuer Absatz ans Ende gesetzt.
- Verbessern oder umformulieren: ersetze die betroffenen Stellen.
- Kürzen oder streichen: ersetze die Stellen durch ihre kürzere Fassung oder durch einen leeren Text.

Alles, was die Anweisung nicht betrifft, bleibt unverändert. Behalte Sprache, Anrede und Form des Prompts bei. Füge nichts über Quellenangaben oder das Antworten nur aus den Dokumenten hinzu – das regeln feste Anweisungen des Systems.

Antworte nur mit JSON: {"edits": [{"find": "…", "replace": "…"}]}`
	}
	return `You revise the role prompt of an AI assistant (between <prompt> and </prompt>) by an instruction. Do not return the whole prompt, only changes:
- find: a passage copied verbatim from the prompt (a sentence or paragraph),
- replace: its new text.

How to go about it:
- Adding ("add …", "include …"): write new text with concrete content – a paragraph or list item of its own, not just a few words slipped in. If it belongs after a passage, find is that passage and replace is the same passage followed by the new text. Otherwise leave find empty: replace is then added as a new paragraph at the end.
- Improving or rewording: replace the passages concerned.
- Shortening or removing: replace the passages by their shorter version or by an empty text.

Everything the instruction does not concern stays unchanged. Keep the prompt's language, form of address and form. Add nothing about citing sources or answering only from the documents – fixed system instructions cover that.

Answer with JSON only: {"edits": [{"find": "…", "replace": "…"}]}`
}

// RoleDescribePrompt is the system prompt that writes a KB role's short
// description from its name and prompt (POST /kb/{id}/behavior/role-writer/describe).
// Members read it under the role's name when they pick a role.
func RoleDescribePrompt(lang string) string {
	if lang == "de" {
		return `Du schreibst die Kurzbeschreibung einer Rolle eines KI-Assistenten. Sie steht auf der Karte der Rolle unter ihrem Namen; Mitglieder wählen danach, mit welcher Rolle sie einen Chat beginnen. Beschreibe in einem Satz von höchstens 120 Zeichen, wobei die Rolle hilft – aus Sicht der Mitglieder, ohne den Namen der Rolle zu wiederholen und ohne „Du bist". Schlichter Text: keine Formatierung, keine Anführungszeichen, kein Zeilenumbruch.

Antworte nur mit JSON: {"description": "…"}`
	}
	return `You write the short description of an AI assistant's role. It sits on the role's card under its name; members use it to choose which role to start a chat with. Describe in one sentence of at most 120 characters what the role helps with – from the members' point of view, without repeating the role's name and without "You are". Plain text: no formatting, no quotation marks, no line break.

Answer with JSON only: {"description": "…"}`
}

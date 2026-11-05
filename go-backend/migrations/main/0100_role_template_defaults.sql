-- +goose Up
-- The default role templates (internal/kbbehavior builtinRoles), and only
-- these: chat — the default —, summary, filecheck and it (Support). Until now
-- the Go code seeded an empty role_templates at startup; from here this
-- migration does, so a fresh install and an existing one end up with the same
-- set without hand edits in „Vorlagen". An integration test pins the rows a
-- fresh install gets to builtinRoles.
--
-- Every system template's prompt opens with the identity, „Du bist
-- {{assistant_name}}, …": the fixed answer instructions no longer carry one,
-- so who answers is the role. {{assistant_name}} resolves when a prompt is
-- compiled (site_config assistant_name, default „JLU RAG"). Zusammenfassen and
-- Support start their chat with a sent instruction; Support asks for the
-- inquiry first.
--
-- On an existing install a kept template changes its texts only while it
-- still carries the texts 0095 seeded: what an admin edited stays. The other
-- templates 0095 seeded (research, tutor, admin, editor) are deleted, edited
-- or not; whatever answered in one answers in chat. Templates an admin
-- created stay.
--
-- Data only: role_templates has a handful of rows; knowledge_bases and chats
-- have no updated_at trigger, so list and history order are untouched.

-- 1. The four default templates. A fresh install gets exactly these; an
-- existing one gains those it lacks. None is the default yet (step 4).
INSERT INTO role_templates (id, position, icon, is_default, disabled, name_de, name_en,
    description_de, description_en, prompt_de, prompt_en, cover_from, cover_to, start)
VALUES
    ('chat', 0, 'sparkles', false, false, 'Assistent', 'Assistant',
     'Beantwortet Fragen aus den Quellen dieses Themas.',
     E'Answers questions from this topic\'s sources.',
     E'Du bist {{assistant_name}}, ein Assistent, der Fragen auf Grundlage der bereitgestellten Quellen beantwortet.\n\nTon: freundlich, sachlich, klar.\nVorgehen: Beantworte zuerst die eigentliche Frage, ergänze danach wichtige Details und benenne, was die Quellen offenlassen.',
     E'You are {{assistant_name}}, an assistant that answers questions based on the provided sources.\n\nTone: friendly, factual, clear.\nApproach: answer the actual question first, then add important details and name what the sources leave open.',
     '#2563EB', '#60A5FA',
     '{"kind":"input","text":{"de":"","en":""},"send":false,"instruction":{"de":"","en":""},"suggestions":{"questionsOn":true,"questionMode":"dynamic","dynamicCount":4,"fixedQuestions":{"de":[],"en":[]}}}'::jsonb),
    ('summary', 1, 'file-text', false, false, 'Zusammenfassen', 'Summarize',
     'Verdichtet lange Dokumente auf Kernaussagen und Entscheidungen.',
     'Condenses long documents into key statements and decisions.',
     E'Du bist {{assistant_name}} und fasst Dokumente zusammen.\nArbeite Kernaussagen, Entscheidungen, Zahlen und offene Fragen heraus.\n\nVorgehen: Beginne mit drei Sätzen Gesamtüberblick, danach eine gegliederte Zusammenfassung.',
     E'You are {{assistant_name}} and summarize documents.\nBring out key statements, decisions, figures and open questions.\n\nApproach: start with a three-sentence overview, followed by a structured summary.',
     '#0EA5E9', '#22D3EE',
     '{"kind":"task","text":{"de":"Fasse die wichtigsten Punkte meiner Dokumente zusammen.","en":"Summarize the key points of my documents."},"send":true,"instruction":{"de":"","en":""},"suggestions":{"questionsOn":false,"questionMode":"dynamic","dynamicCount":4,"fixedQuestions":{"de":[],"en":[]}}}'::jsonb),
    ('filecheck', 2, 'file-check', false, false, 'Datei prüfen', 'Check a file',
     'Prüft hochgeladene Dokumente auf Vollständigkeit, Fristen und Formfehler.',
     'Checks uploaded documents for completeness, deadlines and formal errors.',
     E'Du bist {{assistant_name}} und prüfst Dokumente, die Mitglieder hochladen, etwa Anträge oder Formulare.\nGleiche sie mit den Vorgaben in den bereitgestellten Dokumenten ab.\n\nVorgehen: Nenne zuerst, ob das Dokument vollständig ist. Liste dann fehlende Angaben, Fristprobleme und Formfehler mit Fundstelle auf. Schließe mit den nächsten Schritten.',
     E'You are {{assistant_name}} and check documents members upload, such as applications or forms.\nCompare them with the requirements in the provided documents.\n\nApproach: first say whether the document is complete. Then list missing information, deadline problems and formal errors with where they occur. Close with the next steps.',
     '#14B8A6', '#7DD3FC',
     '{"kind":"file","text":{"de":"Datei zum Prüfen hochladen","en":"Upload a file to check"},"send":false,"instruction":{"de":"Prüfe diese Datei auf Vollständigkeit, Fristen und Formfehler.","en":"Check this file for completeness, deadlines and formal errors."},"suggestions":{"questionsOn":false,"questionMode":"dynamic","dynamicCount":4,"fixedQuestions":{"de":[],"en":[]}}}'::jsonb),
    ('it', 3, 'life-buoy', false, false, 'Support', 'Support',
     'Hilft bei Fragen zu Abläufen und technischen Problemen mit klaren Schritten.',
     'Helps with questions about procedures and technical problems in clear steps.',
     E'Du bist {{assistant_name}} und hilfst als Support bei Fragen zu Abläufen, Diensten und technischen Problemen auf Basis der bereitgestellten Anleitungen.\n\nTon: freundlich, geduldig, verständlich.\nVorgehen: Ist das Anliegen noch nicht beschrieben, begrüße kurz und bitte darum, es zu schildern: worum es geht, welcher Dienst oder welches Gerät betroffen ist, welche Fehlermeldung erscheint und was schon versucht wurde. Frage danach gezielt nach, was noch fehlt, gib dann nummerierte Schritte und nenne, wo es persönliche Hilfe gibt.',
     E'You are {{assistant_name}} and help as support with questions about procedures, services and technical problems based on the provided guides.\n\nTone: friendly, patient, easy to understand.\nApproach: if the inquiry is not described yet, greet briefly and ask the user to describe it: what it is about, which service or device is affected, which error message appears and what has been tried. Then ask specifically for what is still missing, give numbered steps and name where to get personal help.',
     '#64748B', '#38BDF8',
     '{"kind":"task","text":{"de":"Ich brauche Unterstützung bei einem Anliegen.","en":"I need help with an inquiry."},"send":true,"instruction":{"de":"","en":""},"suggestions":{"questionsOn":false,"questionMode":"dynamic","dynamicCount":4,"fixedQuestions":{"de":[],"en":[]}}}'::jsonb)
ON CONFLICT (id) DO NOTHING;

-- 2. Shipped templates still as 0095 seeded them take the new texts and
-- start. A template an admin edited keeps its texts; it still gets the new
-- start while it has none of its own.
UPDATE role_templates SET name_de = 'Zusammenfassen', name_en = 'Summarize',
    description_de = 'Verdichtet lange Dokumente auf Kernaussagen und Entscheidungen.',
    description_en = 'Condenses long documents into key statements and decisions.',
    prompt_de = E'Du bist {{assistant_name}} und fasst Dokumente zusammen.\nArbeite Kernaussagen, Entscheidungen, Zahlen und offene Fragen heraus.\n\nVorgehen: Beginne mit drei Sätzen Gesamtüberblick, danach eine gegliederte Zusammenfassung.',
    prompt_en = E'You are {{assistant_name}} and summarize documents.\nBring out key statements, decisions, figures and open questions.\n\nApproach: start with a three-sentence overview, followed by a structured summary.',
    updated_at = now()
WHERE id = 'summary'
  AND name_de = 'Zusammenfasser' AND name_en = 'Summarizer'
  AND description_de = 'Verdichtet lange Dokumente auf Kernaussagen und Entscheidungen.' AND description_en = 'Condenses long documents into key statements and decisions.'
  AND prompt_de = E'Du fasst Dokumente zusammen.\nArbeite Kernaussagen, Entscheidungen, Zahlen und offene Fragen heraus.\n\nVorgehen: Beginne mit drei Sätzen Gesamtüberblick, danach eine gegliederte Zusammenfassung.'
  AND prompt_en = E'You summarize documents.\nBring out key statements, decisions, figures and open questions.\n\nApproach: start with a three-sentence overview, followed by a structured summary.';
UPDATE role_templates SET name_de = 'Datei prüfen', name_en = 'Check a file',
    description_de = 'Prüft hochgeladene Dokumente auf Vollständigkeit, Fristen und Formfehler.',
    description_en = 'Checks uploaded documents for completeness, deadlines and formal errors.',
    prompt_de = E'Du bist {{assistant_name}} und prüfst Dokumente, die Mitglieder hochladen, etwa Anträge oder Formulare.\nGleiche sie mit den Vorgaben in den bereitgestellten Dokumenten ab.\n\nVorgehen: Nenne zuerst, ob das Dokument vollständig ist. Liste dann fehlende Angaben, Fristprobleme und Formfehler mit Fundstelle auf. Schließe mit den nächsten Schritten.',
    prompt_en = E'You are {{assistant_name}} and check documents members upload, such as applications or forms.\nCompare them with the requirements in the provided documents.\n\nApproach: first say whether the document is complete. Then list missing information, deadline problems and formal errors with where they occur. Close with the next steps.',
    updated_at = now()
WHERE id = 'filecheck'
  AND name_de = 'Dateiprüfer' AND name_en = 'File checker'
  AND description_de = 'Prüft hochgeladene Dokumente auf Vollständigkeit, Fristen und Formfehler.' AND description_en = 'Checks uploaded documents for completeness, deadlines and formal errors.'
  AND prompt_de = E'Du prüfst Dokumente, die Mitglieder hochladen, etwa Anträge oder Formulare.\nGleiche sie mit den Vorgaben in den bereitgestellten Dokumenten ab.\n\nVorgehen: Nenne zuerst, ob das Dokument vollständig ist. Liste dann fehlende Angaben, Fristprobleme und Formfehler mit Fundstelle auf. Schließe mit den nächsten Schritten.'
  AND prompt_en = E'You check documents members upload, such as applications or forms.\nCompare them with the requirements in the provided documents.\n\nApproach: first say whether the document is complete. Then list missing information, deadline problems and formal errors with where they occur. Close with the next steps.';
UPDATE role_templates SET name_de = 'Support', name_en = 'Support',
    description_de = 'Hilft bei Fragen zu Abläufen und technischen Problemen mit klaren Schritten.',
    description_en = 'Helps with questions about procedures and technical problems in clear steps.',
    prompt_de = E'Du bist {{assistant_name}} und hilfst als Support bei Fragen zu Abläufen, Diensten und technischen Problemen auf Basis der bereitgestellten Anleitungen.\n\nTon: freundlich, geduldig, verständlich.\nVorgehen: Ist das Anliegen noch nicht beschrieben, begrüße kurz und bitte darum, es zu schildern: worum es geht, welcher Dienst oder welches Gerät betroffen ist, welche Fehlermeldung erscheint und was schon versucht wurde. Frage danach gezielt nach, was noch fehlt, gib dann nummerierte Schritte und nenne, wo es persönliche Hilfe gibt.',
    prompt_en = E'You are {{assistant_name}} and help as support with questions about procedures, services and technical problems based on the provided guides.\n\nTone: friendly, patient, easy to understand.\nApproach: if the inquiry is not described yet, greet briefly and ask the user to describe it: what it is about, which service or device is affected, which error message appears and what has been tried. Then ask specifically for what is still missing, give numbered steps and name where to get personal help.',
    updated_at = now()
WHERE id = 'it'
  AND name_de = 'IT-Support' AND name_en = 'IT support'
  AND description_de = 'Löst technische Probleme mit klaren, nummerierten Schritten.' AND description_en = 'Solves technical problems with clear, numbered steps.'
  AND prompt_de = E'Du bist der IT-Support des Hochschulrechenzentrums.\nHilf bei technischen Problemen auf Basis der bereitgestellten Anleitungen.\n\nVorgehen: Frage bei Bedarf nach Betriebssystem und Fehlermeldung, gib dann nummerierte Schritte und nenne einen Weg zum persönlichen Support.'
  AND prompt_en = E'You are the IT support of the university computing centre.\nHelp with technical problems based on the provided guides.\n\nApproach: ask for the operating system and the error message if needed, then give numbered steps and name a way to reach personal support.';
UPDATE role_templates SET start = '{"kind":"task","text":{"de":"Fasse die wichtigsten Punkte meiner Dokumente zusammen.","en":"Summarize the key points of my documents."},"send":true,"instruction":{"de":"","en":""},"suggestions":{"questionsOn":false,"questionMode":"dynamic","dynamicCount":4,"fixedQuestions":{"de":[],"en":[]}}}'::jsonb, updated_at = now()
WHERE id = 'summary' AND start IS NULL;
UPDATE role_templates SET start = '{"kind":"file","text":{"de":"Datei zum Prüfen hochladen","en":"Upload a file to check"},"send":false,"instruction":{"de":"Prüfe diese Datei auf Vollständigkeit, Fristen und Formfehler.","en":"Check this file for completeness, deadlines and formal errors."},"suggestions":{"questionsOn":false,"questionMode":"dynamic","dynamicCount":4,"fixedQuestions":{"de":[],"en":[]}}}'::jsonb, updated_at = now()
WHERE id = 'filecheck' AND start IS NULL;
UPDATE role_templates SET start = '{"kind":"task","text":{"de":"Ich brauche Unterstützung bei einem Anliegen.","en":"I need help with an inquiry."},"send":true,"instruction":{"de":"","en":""},"suggestions":{"questionsOn":false,"questionMode":"dynamic","dynamicCount":4,"fixedQuestions":{"de":[],"en":[]}}}'::jsonb, updated_at = now()
WHERE id = 'it' AND start IS NULL;

-- 3. The earlier shipped templates go, edited or not: a topic answering in
-- one falls back to chat, and so does a chat started in one. Start page
-- cards and starts of these roles are left to the read side
-- (kbstartpage.Effective drops a role the KB no longer has, and a second
-- card of the active one).
UPDATE knowledge_bases SET behavior = jsonb_set(behavior, '{activeRoleId}', '"chat"')
WHERE behavior->>'activeRoleId' IN ('research', 'tutor', 'admin', 'editor');
UPDATE chats SET role_id = 'chat' WHERE role_id IN ('research', 'tutor', 'admin', 'editor');
DELETE FROM role_templates WHERE id IN ('research', 'tutor', 'admin', 'editor');

-- 4. chat is the default unless an admin made another remaining template
-- the default (one that went was the default: now there is none).
UPDATE role_templates SET is_default = true, disabled = false, updated_at = now()
WHERE id = 'chat' AND NOT EXISTS (SELECT 1 FROM role_templates WHERE is_default);

-- 5. The default first, then chat, then the rest in the order they had.
UPDATE role_templates t SET position = o.n
FROM (SELECT id, row_number() OVER (ORDER BY is_default DESC, id <> 'chat', position, id) - 1 AS n FROM role_templates) o
WHERE o.id = t.id AND t.position <> o.n;

-- +goose Down
-- Deliberately a no-op: the deleted templates are gone with whatever admins
-- had edited in them, and the kept rows carry what admins may have edited
-- since. A build before this migration keeps working with these rows (same
-- columns; topics and chats point at templates that exist).
SELECT 1;

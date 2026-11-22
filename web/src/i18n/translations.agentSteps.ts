/**
 * Strings of the agent step timeline above an answer (components/agentSteps):
 * one row per step the assistant took, the model's thinking included. Every
 * stage, decision and outcome code the backend emits gets a label here, so no
 * internal id reaches the reader. Spread into `translations`; placeholders in
 * braces are replaced at the call site.
 */
export const agentStepsTranslations = {
    // Header: one phrase per kind of step, lower-case (the first is capitalised
    // when the line is put together), joined like "a, b und c".
    stepsSumPlan: { de: 'Plan erstellt', en: 'made a plan' },
    stepsSumSearch: { de: '{n} Suchen durchgeführt', en: 'ran {n} searches' },
    stepsSumSearchOne: { de: '1 Suche durchgeführt', en: 'ran 1 search' },
    stepsSumThinking: { de: 'nachgedacht', en: 'thought it over' },
    stepsSumDecision: { de: '{n} Entscheidungen getroffen', en: 'made {n} decisions' },
    stepsSumDecisionOne: { de: '1 Entscheidung getroffen', en: 'made 1 decision' },
    stepsSumAnswer: { de: 'Recherche abgeschlossen', en: 'finished the research' },
    stepsSumRefine: { de: 'Faktencheck durchgeführt', en: 'ran a fact check' },
    stepsSumTeam: { de: 'Fachagenten befragt', en: 'asked specialists' },
    stepsSumTool: { de: '{n} Werkzeuge genutzt', en: 'used {n} tools' },
    stepsSumToolOne: { de: '1 Werkzeug genutzt', en: 'used 1 tool' },
    stepsSumGraph: { de: 'Wissensgraph durchsucht', en: 'searched the knowledge graph' },
    stepsSumCheck: { de: 'Quellen geprüft', en: 'checked the sources' },
    stepsSumRead: { de: '{n} Abschnitte gelesen', en: 'read {n} parts' },
    stepsSumReadOne: { de: '1 Abschnitt gelesen', en: 'read 1 part' },
    stepsSumListing: { de: 'neueste Dokumente aufgelistet', en: 'listed the newest documents' },
    stepsSumAttachment: { de: 'Anhänge berücksichtigt', en: 'handled the attachments' },
    stepsSumOther: { de: '{n} Zwischenschritte', en: '{n} intermediate steps' },
    stepsSumOtherOne: { de: '1 Zwischenschritt', en: '1 intermediate step' },
    stepsSumMore: { de: '{n} weitere Schritte', en: '{n} more steps' },
    stepsSumMoreOne: { de: '1 weiterer Schritt', en: '1 more step' },
    stepsSumAnd: { de: 'und', en: 'and' },

    // Thinking
    stepThinking: { de: 'Nachgedacht', en: 'Thought' },
    stepThinkingLive: { de: 'Denkt nach …', en: 'Thinking …' },

    // Plan / research
    stepPlan: { de: 'Plan', en: 'Plan' },
    stepPlanStarting: { de: 'Plan wird erstellt', en: 'Making a plan' },
    stepPlanQueries: { de: '{n} Teilfragen', en: '{n} sub-questions' },
    stepPlanQueriesOne: { de: '1 Teilfrage', en: '1 sub-question' },
    stepPlanDispatch: { de: 'Aufgabe an Fachagenten verteilt', en: 'Task handed to specialists' },
    stepRound: { de: 'Recherche-Runde {n}', en: 'Research round {n}' },
    stepSearch: { de: 'Suche', en: 'Search' },
    stepSearchN: { de: 'Suche {n}', en: 'Search {n}' },
    stepNewFindings: { de: '+{n} neue Treffer', en: '+{n} new results' },
    stepNewFindingsOne: { de: '+1 neuer Treffer', en: '+1 new result' },
    stepNoNewFindings: { de: 'keine neuen Treffer', en: 'no new results' },
    stepNoResults: { de: 'keine Treffer', en: 'no results' },
    stepRetrievalDropped: { de: '{n} weniger belastbare Stellen aussortiert', en: '{n} less relevant passages left out' },
    stepRetrievalDroppedOne: { de: '1 weniger belastbare Stelle aussortiert', en: '1 less relevant passage left out' },
    stepRecencyListing: { de: 'Neueste Dokumente aufgelistet', en: 'Listed the newest documents' },
    stepRecencySince: { de: '{n} seit {date}', en: '{n} since {date}' },
    stepRecencyNone: { de: 'keine seit {date}', en: 'none since {date}' },
    stepFiles: { de: 'Gefunden in', en: 'Found in' },
    stepQueries: { de: 'Suchanfragen', en: 'Queries' },
    stepRationale: { de: 'Begründung', en: 'Reasoning' },

    // Retrieval decisions
    stepRewrite: { de: 'Suchanfrage wird umformuliert', en: 'Rephrasing the search' },
    stepRewriteDone: { de: 'Neue Suche', en: 'New search' },
    stepAbstainNoChunks: { de: 'Keine passenden Quellen gefunden', en: 'No matching sources found' },
    stepAbstainAfterRewrite: { de: 'Auch nach neuer Suche keine passenden Quellen', en: 'Still no matching sources after a new search' },
    stepTransformFollowup: { de: 'Vorherige Antwort umgeformt, ohne neue Suche', en: 'Reworked the previous answer, no new search' },
    stepGraph: { de: 'Wissensgraph durchsucht', en: 'Searched the knowledge graph' },
    stepGraphEntities: { de: '{n} Begriffe erkannt', en: '{n} terms recognised' },
    stepGraphEntitiesOne: { de: '1 Begriff erkannt', en: '1 term recognised' },
    stepInsufficientContext: { de: 'Quellen reichen für eine belastbare Antwort nicht aus', en: 'The sources are not enough for a reliable answer' },
    stepBudget: { de: 'Rechenbudget erreicht, Recherche beendet', en: 'Budget reached, research stopped' },
    stepToolCall: { de: 'Werkzeug genutzt', en: 'Used a tool' },
    stepToolKbSearch: { de: 'Suche in der Wissensdatenbank', en: 'Knowledge base search' },
    stepToolGraphSearch: { de: 'Suche im Wissensgraphen', en: 'Knowledge graph search' },
    stepToolWebSearch: { de: 'Websuche', en: 'Web search' },
    stepToolRecentDocuments: { de: 'Neueste Dokumente', en: 'Recent documents' },
    stepToolTable: { de: 'Tabellenabfrage', en: 'Table query' },
    stepToolKeywordSearch: { de: 'Stichwortsuche', en: 'Keyword search' },
    stepToolChunkRead: { de: 'Textstelle gelesen', en: 'Read a passage' },
    stepToolOutline: { de: 'Gliederung gelesen', en: 'Read the outline' },
    stepToolCountMentions: { de: 'Erwähnungen gezählt', en: 'Counted mentions' },
    stepToolCalculator: { de: 'Rechner', en: 'Calculator' },
    stepToolMemoryRead: { de: 'Gedächtnis gelesen', en: 'Read the memory' },
    stepToolMemoryWrite: { de: 'Gedächtnis aktualisiert', en: 'Updated the memory' },
    stepToolCodeExec: { de: 'Code ausgeführt', en: 'Ran code' },
    stepToolFailed: { de: 'fehlgeschlagen', en: 'failed' },
    stepResults: { de: '{n} Treffer', en: '{n} results' },
    stepResultsOne: { de: '1 Treffer', en: '1 result' },
    stepSpecialist: { de: 'Fachagent', en: 'Specialist' },
    stepSpecialistRetriever: { de: 'Fachagent: Recherche', en: 'Specialist: research' },

    // Teams
    stepTeamRoute: { de: 'Team-Router', en: 'Team router' },
    stepTeamNoSpecialist: { de: 'Kein Fachagent passte zur Frage', en: 'No specialist matched the question' },
    stepTeamUnavailable: { de: 'Gewähltes Team nicht verfügbar, Standardantwort', en: 'Selected team unavailable, standard answer' },
    stepTeamSynthesis: { de: 'Antworten der Fachagenten zusammengeführt', en: 'Combined the specialists\' answers' },

    // Long context, DRIFT, comparison, attachments
    stepLongContext: { de: 'Ganzen Bestand gelesen', en: 'Read the whole collection' },
    stepLongContextMap: { de: 'Abschnitt {n} gelesen', en: 'Read part {n}' },
    stepLongContextReduce: { de: '{n} Befunde zusammengeführt', en: 'Combined {n} findings' },
    stepLongContextReduceOne: { de: '1 Befund zusammengeführt', en: 'Combined 1 finding' },
    stepLongContextDropped: { de: '{n} aus Platzgründen weggelassen', en: '{n} left out for space' },
    stepPrimer: { de: 'Überblick aus Themenzusammenfassungen', en: 'Overview from topic summaries' },
    stepFollowups: { de: 'Folgefragen', en: 'Follow-up questions' },
    stepCompareSection: { de: 'Abschnitt {n} verglichen', en: 'Compared part {n}' },
    stepFindings: { de: '{n} Befunde', en: '{n} findings' },
    stepFindingsOne: { de: '1 Befund', en: '1 finding' },
    stepAttachmentsDropped: { de: 'Nicht alle angehängten Dokumente passten in den Kontext', en: 'Not every attached document fit into the context' },
    stepAttachmentsTrimmed: { de: 'Angehängte Dokumente zuerst, weniger Quellen aus der Wissensdatenbank', en: 'Attached documents first, fewer knowledge base sources' },

    // Checks after retrieval
    stepConflicts: { de: 'Quellen auf Widersprüche geprüft', en: 'Checked the sources for contradictions' },
    stepConflictsFound: { de: '{n} Widersprüche zwischen Quellen', en: '{n} contradictions between sources' },
    stepConflictsFoundOne: { de: '1 Widerspruch zwischen Quellen', en: '1 contradiction between sources' },
    stepConflictsIncomplete: { de: 'Widerspruchsprüfung nicht abgeschlossen', en: 'Contradiction check did not finish' },
    stepWebSearchSkipped: { de: 'Websuche für diese Frage nicht verfügbar', en: 'Web search not available for this question' },
    stepPolicyFallthrough: { de: 'Vorgesehener Ablauf nicht verfügbar, Standardantwort', en: 'Intended flow unavailable, standard answer' },

    // The end of the research (the orchestrator's answer stage): it comes
    // before the answer is written, so it does not claim the answer.
    stepAnswer: { de: 'Recherche abgeschlossen', en: 'Research complete' },
    stepAnswerAbstained: { de: 'Keine belastbare Antwort möglich', en: 'No reliable answer possible' },
    stepAnswerRounds: { de: 'nach {n} Runden', en: 'after {n} rounds' },
    stepAnswerHops: { de: 'nach {n} Suchschritten', en: 'after {n} search steps' },
    stepAnswerSufficient: { de: 'Treffer reichten aus', en: 'results were sufficient' },
    stepAnswerPlateau: { de: 'keine besseren Treffer mehr', en: 'no better results' },
    stepAnswerNoProgress: { de: 'keine neuen Treffer mehr', en: 'no new results' },
    stepAnswerLimit: { de: 'Höchstzahl an Schritten erreicht', en: 'step limit reached' },
    stepAnswerError: { de: 'Recherche unterbrochen', en: 'research interrupted' },

    // Fact check
    stepRefineStart: { de: 'Faktencheck: Antwort wird korrigiert', en: 'Fact check: correcting the answer' },
    stepRefineClaims: { de: '{n} Aussagen betroffen', en: '{n} statements affected' },
    stepRefineClaimsOne: { de: '1 Aussage betroffen', en: '1 statement affected' },
    stepRefineDone: { de: 'Antwort nach Faktencheck korrigiert', en: 'Answer corrected after fact check' },
    stepRefineUnchanged: { de: 'Faktencheck: keine Änderung nötig', en: 'Fact check: no change needed' },
    stepRefineVerifierError: { de: 'Faktencheck nach Korrektur nicht prüfbar', en: 'Fact check could not verify the correction' },
    stepRefineResidual: { de: 'Offene Aussagen: {before} → {after}', en: 'Open statements: {before} → {after}' },
    stepRefineAdded: { de: 'Korrigiert nach Faktencheck', en: 'Corrected after fact check' },

    // Degenerate-output guard
    stepGuard: { de: 'Antwort gekürzt (Wiederholung)', en: 'Answer cut short (repetition)' },
    stepGuardDetail: { de: 'Wiederholung: {run} Zeichen · Grenze: {limit}', en: 'Repetition: {run} characters · limit: {limit}' },

    // Unknown stage
    stepOther: { de: 'Zwischenschritt', en: 'Intermediate step' },
};

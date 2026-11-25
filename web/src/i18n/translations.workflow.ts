/**
 * Strings of the topic-settings workflow view (components/kbSettings/workflow):
 * the canvas, its lane pills, legend and save bar, the node inspector, the
 * field controls and the preset picker. Node titles, help texts, conditions,
 * field labels and preset names come from the API and are not translated here.
 * Spread into `translations`; placeholders in braces are replaced at the call
 * site. Plurals use separate One/Many keys.
 */
export const workflowTranslations = {
    // Lanes (WorkflowCanvas)
    wfLaneLookup: { de: 'Nachschlagen', en: 'Look-up' },
    wfLaneEnumeration: { de: 'Aufzählung', en: 'Enumeration' },
    wfLaneComplex: { de: 'Komplexe Frage', en: 'Complex question' },

    // Activation states: legend and orchestrator chips
    wfActivationActive: { de: 'läuft', en: 'runs' },
    wfActivationConditional: { de: 'bedingt', en: 'conditional' },
    wfActivationInactive: { de: 'inaktiv', en: 'inactive' },

    // Orchestrator names (mirror orchestratorLabels in internal/pipeline/project.go)
    wfOrchestrators: { de: 'Orchestrator:', en: 'Orchestrator:' },
    wfOrchComparison: { de: 'Dokumentenvergleich', en: 'Document comparison' },
    wfOrchCorpusTable: { de: 'Korpus-Vergleichstabelle', en: 'Corpus comparison table' },
    wfOrchDrift: { de: 'DRIFT', en: 'DRIFT' },
    wfOrchSupervisor: { de: 'Supervisor', en: 'Supervisor' },
    wfOrchPlanExecute: { de: 'Plan-and-Execute', en: 'Plan-and-Execute' },
    wfOrchAgentic: { de: 'Agentische Suche', en: 'Agentic search' },
    wfOrchStandard: { de: 'Zwei-Schritt-Recherche', en: 'Two-step research' },

    // Canvas readouts, errors and save bar
    wfCostEstimate: { de: 'geschätzt {calls} LLM-Aufrufe · ~{seconds}s', en: 'estimated {calls} LLM calls · ~{seconds}s' },
    wfLoadFailed: { de: 'Der Workflow konnte nicht geladen werden ({error}).', en: 'The workflow could not be loaded ({error}).' },
    wfPresetAppliedRefetchFailed: {
        de: 'Vorlage angewendet — die Ansicht konnte nicht aktualisiert werden. Bitte Ansicht neu laden.',
        en: 'Preset applied — the view could not be updated. Please reload the view.',
    },
    wfSavedRefetchFailed: {
        de: 'Gespeichert — die Ansicht konnte nicht aktualisiert werden. Bitte Ansicht neu laden.',
        en: 'Saved — the view could not be updated. Please reload the view.',
    },
    wfResetRefetchFailed: {
        de: 'Zurückgesetzt — die Ansicht konnte nicht aktualisiert werden. Bitte Ansicht neu laden.',
        en: 'Reset — the view could not be updated. Please reload the view.',
    },
    wfSavingReadOnly: { de: 'Wird gerade gespeichert.', en: 'Saving right now.' },
    wfChangedOne: { de: '1 Einstellung geändert', en: '1 setting changed' },
    wfChangedMany: { de: '{count} Einstellungen geändert', en: '{count} settings changed' },
    wfDiscard: { de: 'Verwerfen', en: 'Discard' },
    wfSavingProgress: { de: 'Speichert…', en: 'Saving…' },
    wfUnsavedTabWarning: {
        de: 'Nicht gespeicherte Änderungen gehen beim Tab-Wechsel verloren.',
        en: 'Unsaved changes are lost when you switch tabs.',
    },
    // Loop edge label: {label} comes from the API.
    wfLoopLabel: { de: '{label} (max. {count}×)', en: '{label} (max. {count}×)' },

    // Node badges (reasonLabel)
    wfReasonConditional: { de: 'Bedingt', en: 'Conditional' },
    wfReasonFlagOff: { de: 'Deaktiviert', en: 'Disabled' },
    wfReasonSkipped: { de: 'Übersprungen', en: 'Skipped' },
    wfReasonRequires: { de: 'Voraussetzung fehlt', en: 'Prerequisite missing' },
    wfReasonSuperseded: { de: 'Ersetzt', en: 'Replaced' },

    // Value origins and placeholders (constants)
    wfOriginKb: { de: 'dieses Thema', en: 'this topic' },
    wfOriginGlobal: { de: 'global', en: 'global' },
    wfOriginDefault: { de: 'Standard', en: 'default' },
    wfOriginUnknown: { de: 'unbekannt', en: 'unknown' },
    wfDefaultValue: { de: 'Standardwert', en: 'Default value' },

    // Field controls (NodeFieldInput)
    wfBoolOn: { de: 'Ein', en: 'On' },
    wfBoolOff: { de: 'Aus', en: 'Off' },
    wfEmptyValueRefused: {
        de: '{label}: Leerer Wert wird nicht übernommen — zum Löschen "Zurücksetzen" verwenden.',
        en: '{label}: An empty value is not accepted — use "Reset" to clear it.',
    },

    // Node inspector
    wfInspectorLabel: { de: 'Details zu {label}', en: 'Details of {label}' },
    wfInspectorSettings: { de: 'Einstellungen', en: 'Settings' },
    wfReset: { de: 'Zurücksetzen', en: 'Reset' },
    wfResetLabel: { de: '{label} zurücksetzen', en: 'Reset {label}' },
    wfResetTitle: { de: 'Auf globalen Wert zurücksetzen', en: 'Reset to the global value' },
    wfNotEditable: {
        de: 'Diese Stufe ist derzeit nicht pro Thema einstellbar — sie folgt der globalen Konfiguration.',
        en: 'This stage cannot be set per topic yet — it follows the global configuration.',
    },

    // Preset picker
    wfPresetCost: { de: '{calls} LLM-Aufrufe · ~{seconds}s', en: '{calls} LLM calls · ~{seconds}s' },
    wfPresetsLoadFailed: { de: 'Vorlagen konnten nicht geladen werden ({error}).', en: 'Presets could not be loaded ({error}).' },
    wfPresetsList: { de: 'Vorlagen', en: 'Presets' },
    wfPresetsCostNote: {
        de: 'Die Kostenangaben gelten für ein Thema ohne weitere eigene Einstellungen. Eigene Einstellungen außerhalb der Vorlage können den Wert verschieben, den die Leiste unten für dieses Thema anzeigt.',
        en: 'The costs apply to a topic without any further settings of its own. Own settings outside the preset can shift the value the bar below shows for this topic.',
    },
    wfPresetsDraftHint: {
        de: 'Speichere oder verwirf deine Änderungen, bevor du eine Vorlage anwendest.',
        en: 'Save or discard your changes before you apply a preset.',
    },
    wfPresetBaseLoading: { de: 'Basis wird geladen…', en: 'Loading base…' },
    wfPresetBaseGone: {
        de: 'Basis: „{base}“ — diese Vorlage gibt es nicht mehr, Abweichungen lassen sich nicht bestimmen.',
        en: 'Base: “{base}” — this preset no longer exists, deviations cannot be determined.',
    },
    wfPresetNone: { de: 'Noch keine Vorlage angewendet.', en: 'No preset applied yet.' },
    wfPresetBaseOne: { de: 'Basis: {base} · 1 Abweichung', en: 'Base: {base} · 1 deviation' },
    wfPresetBaseMany: { de: 'Basis: {base} · {count} Abweichungen', en: 'Base: {base} · {count} deviations' },
    wfPresetResetToBase: { de: 'Auf Vorlage zurücksetzen', en: 'Reset to preset' },
    wfPresetConfirmTitle: { de: '„{label}“ anwenden?', en: 'Apply “{label}”?' },
    wfPresetChecking: { de: 'Prüft, was sich ändert…', en: 'Checking what changes…' },
    wfPresetEffectiveNone: { de: 'Keine Einstellung ändert dadurch ihr Verhalten.', en: 'No setting changes its behavior.' },
    wfPresetEffectiveOne: { de: '1 Einstellung ändert dadurch ihr Verhalten.', en: '1 setting changes its behavior.' },
    wfPresetEffectiveMany: { de: '{count} Einstellungen ändern dadurch ihr Verhalten.', en: '{count} settings change their behavior.' },
    wfPresetOwnNone: { de: 'Keine davon hast du selbst gesetzt.', en: 'You set none of them yourself.' },
    wfPresetOwnSome: { de: 'Davon hast du {count} selbst gesetzt — unten markiert.', en: 'You set {count} of them yourself — marked below.' },
    wfPresetOwnTag: { de: 'von dir gesetzt', en: 'set by you' },
    wfPresetPinnedOne: {
        de: '1 Einstellung wird dabei für dieses Thema festgeschrieben und folgt danach nicht mehr den globalen Vorgaben.',
        en: '1 setting is fixed for this topic and no longer follows the global defaults.',
    },
    wfPresetPinnedMany: {
        de: '{count} Einstellungen werden dabei für dieses Thema festgeschrieben und folgen danach nicht mehr den globalen Vorgaben.',
        en: '{count} settings are fixed for this topic and no longer follow the global defaults.',
    },
    wfPresetApply: { de: 'Anwenden', en: 'Apply' },
    wfPresetApplying: { de: 'Wird angewendet…', en: 'Applying…' },
};

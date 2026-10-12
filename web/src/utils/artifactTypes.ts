import type { GeneratedContent } from '../types';

// Markdown-text generated-content types. These all store their payload as
// { text: markdown } and share the Studio markdown-editor render/edit/export
// path (MarkdownEditor + save + copy + DOCX/PDF). Adding a new text artifact
// (see go-backend contentgen.TextArtifacts) means adding its type here.
export const MARKDOWN_ARTIFACT_TYPES = new Set<GeneratedContent['type']>([
    'analysis',
    'abstract',
    'research',
    'briefing_doc',
    'faq',
    'study_guide',
    'timeline',
]);

// The markdown types a user can CREATE from a free-text focus: exactly the
// backend registry go-backend/internal/contentgen/registry.go `TextArtifacts`,
// each served by the generic POST /api/kb/{id}/generate/{type} handler that
// useGeneratedContent.handleGenerate calls. The other three markdown types are
// produced by different flows and are not creatable through this call:
// `analysis` (StudioWorkspace's agent/preset dialog, /generate/analysis),
// `abstract` (a file picker, /generate/abstract) and `research` (ResearchMode).
// Kept in step with the Go registry by hand — there is no generated link.
export const PROMPT_TEXT_ARTIFACT_TYPES = ['briefing_doc', 'faq', 'study_guide', 'timeline'] as const;
export type PromptTextArtifactType = typeof PROMPT_TEXT_ARTIFACT_TYPES[number];

// isMarkdownArtifact reports whether a generated-content type is rendered and
// edited as markdown text (vs. a structured type like flashcards/presentation
// that has its own renderer).
export function isMarkdownArtifact(type: GeneratedContent['type']): boolean {
    return MARKDOWN_ARTIFACT_TYPES.has(type);
}

// Translation keys for each artifact type, used to render a readable label in
// content lists. Types without an entry fall back to their raw string.
const ARTIFACT_TYPE_LABEL_KEYS: Partial<Record<GeneratedContent['type'], string>> = {
    analysis: 'analysis',
    // Not 'research': that key is the Studio's action label ("Bericht
    // erstellen"), which reads wrong as the type of an existing result.
    research: 'artifactTypeResearch',
    abstract: 'abstract',
    flashcards: 'flashcards',
    presentation: 'slides',
    podcast: 'podcast',
    briefing_doc: 'briefingDoc',
    faq: 'faq',
    study_guide: 'studyGuide',
    timeline: 'timeline',
    quiz: 'quiz',
};

// artifactTypeLabel returns a human-readable, translated label for a
// generated-content type, falling back to the raw type string.
export function artifactTypeLabel(type: GeneratedContent['type'], t: (key: string) => string): string {
    const key = ARTIFACT_TYPE_LABEL_KEYS[type];
    return key ? t(key) : type;
}

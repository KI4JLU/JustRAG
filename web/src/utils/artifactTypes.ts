import type { GeneratedContent } from '../types';

// Markdown-text generated-content types. These all store their payload as
// { text: markdown } and share the Studio markdown-editor render/edit/export
// path (MarkdownEditor + save + copy + DOCX/PDF). Adding a new text artifact
// (see go-backend contentgen.TextArtifacts) means adding its type here.
const MARKDOWN_ARTIFACT_TYPES = new Set<GeneratedContent['type']>([
    'analysis',
    'abstract',
    'research',
    'briefing_doc',
    'faq',
    'study_guide',
    'timeline',
]);

// isMarkdownArtifact reports whether a generated-content type is rendered and
// edited as markdown text (vs. a structured type like flashcards/presentation
// that has its own renderer).
export function isMarkdownArtifact(type: GeneratedContent['type']): boolean {
    return MARKDOWN_ARTIFACT_TYPES.has(type);
}

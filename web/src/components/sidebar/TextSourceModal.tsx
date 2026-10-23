import React, { memo, useId } from 'react';
import { Download, ExternalLink } from 'lucide-react';
import {
    Button, Dialog, DialogContent, DialogTitle, Input, RichTextEditor, buttonVariants, type RichTextEditorLabels,
} from '@ki4jlu/design-system';
import { fillTemplate, originUrlOf, withoutOriginLine } from '../../utils/sourceDisplay';
import { renderHtmlBlocks } from '../../utils/htmlBlocks';
import { useTheme } from '../../contexts/ThemeContext';
import { useFormValidation } from '../../hooks/useFormValidation';
import { type PreviewBack } from '../PreviewHeader';
import { PreviewDialog } from '../PreviewDialog';

/**
 * Text sources in the DS `RichTextEditor` (Tiptap, markdown in and out), in a
 * window that is the PDF preview's twin (`PdfPreviewModal`): the same dialog
 * size, the same 56px header row with the title and the close button, and
 * the editor's own PdfViewer-style toolbar and page below it.
 *
 *  - `TextSourceModal` — „Text einfügen": a new text source. The title is an
 *    inline field in the header, „Text hinzufügen" sits beside it, and the
 *    body is stored via `POST /api/kb/{id}/text`. Its own entry in the
 *    sources grid; it used to be a second mode hidden behind „Datei
 *    hochladen".
 *  - `TextSourceViewer` — an existing .md/.txt source, read-only. Markdown
 *    (.md — which „Text einfügen" appends on save) is rendered, other text
 *    literally; the caller decides (`useWebTools.handlePreviewSource`). There is no
 *    endpoint to change a stored file's content yet, so editing stays with
 *    new text (decided 2026-10-12).
 */

/* The DS labels the editor in German; English sessions get these. */
const EDITOR_LABELS_EN: RichTextEditorLabels = {
    toolbar: 'Formatting',
    heading1: 'Heading 1',
    heading2: 'Heading 2',
    heading3: 'Heading 3',
    bold: 'Bold',
    italic: 'Italic',
    strike: 'Strikethrough',
    quote: 'Quote',
    bulletList: 'Bullet list',
    orderedList: 'Numbered list',
    outdent: 'Decrease indent',
    indent: 'Increase indent',
    code: 'Code',
    codeBlock: 'Code block',
    table: 'Insert table',
    undo: 'Undo',
    redo: 'Redo',
    fullscreen: 'Fullscreen',
    exitFullscreen: 'Exit fullscreen',
    copy: 'Copy as markdown',
    copied: 'Copied',
    count: '{words} words | {characters} characters',
};
interface TextSourceModalProps {
    show: boolean;
    onClose: () => void;
    onTextSourceAdd: () => void;
    textSourceTitle: string;
    setTextSourceTitle: (v: string) => void;
    textSourceContent: string;
    setTextSourceContent: (v: string) => void;
}

/**
 * „Text einfügen"'s frame: the preview window's size (`PreviewDialog`
 * `document`) with the editor's own 56px header row (title field + action).
 * The read-only viewer below is a `PreviewDialog`.
 */
function EditorDialog({ open, onClose, header, children }: {
    open: boolean;
    onClose: () => void;
    header: React.ReactNode;
    children: React.ReactNode;
}) {
    const { t } = useTheme();
    return (
        <Dialog open={open} onOpenChange={(next) => { if (!next) onClose(); }}>
            <DialogContent
                closeLabel={t('close')}
                className="flex h-[85vh] w-[min(900px,90vw)] max-w-none flex-col gap-0 overflow-hidden p-0"
                // The editor's header has no DialogDescription, so it opts out of one.
                aria-describedby={undefined}
            >
                <div className="flex h-14 shrink-0 items-center gap-3 border-b border-outline-variant pr-14 pl-5">
                    {header}
                </div>
                {children}
            </DialogContent>
        </Dialog>
    );
}

function useEditorLabels(): RichTextEditorLabels | undefined {
    const { language } = useTheme();
    return language === 'en' ? EDITOR_LABELS_EN : undefined;
}

// A link that reads like a Confluence page gets the Confluence label.
const CONFLUENCE_URL_RE = /confluence|atlassian\.net|\/wiki\//i;

const TextSourceModalComp: React.FC<TextSourceModalProps> = ({
    show, onClose, onTextSourceAdd,
    textSourceTitle, setTextSourceTitle, textSourceContent, setTextSourceContent,
}) => {
    const { t } = useTheme();
    const labels = useEditorLabels();
    const errorId = useId();
    // Both are required: `POST /api/kb/{id}/text` answers a blank title or
    // body with a 400, which would only surface after the dialog closed.
    const { errors, validate, clearError } = useFormValidation({
        title: (v) => !v.trim() && t('textTitleRequired'),
        content: (v) => !v.trim() && t('textContentRequired'),
    });
    const submit = () => {
        if (validate({ title: textSourceTitle, content: textSourceContent })) onTextSourceAdd();
    };
    // One slot in the 56px header row; each invalid control points at it. The
    // DS turns the borderless title's and the bare editor's placeholder red.
    const errorText = [errors.title, errors.content].filter(Boolean).join(' · ');

    return (
        <EditorDialog
            open={show}
            onClose={onClose}
            header={(
                <>
                    <DialogTitle className="sr-only">{t('insertText')}</DialogTitle>
                    <div className="min-w-0 flex-1">
                        <Input
                            // `title`: the PDF preview heading's type (`text-base font-semibold`), editable.
                            variant="title"
                            aria-label={t('textTitle')}
                            placeholder={t('textTitle')}
                            value={textSourceTitle}
                            onChange={(e) => { setTextSourceTitle(e.target.value); clearError('title'); }}
                            aria-invalid={errors.title ? true : undefined}
                            aria-describedby={errors.title ? errorId : undefined}
                        />
                    </div>
                    {errorText && <span id={errorId} className="field-error shrink-0" role="alert">{errorText}</span>}
                    <Button size="sm" onClick={submit}>{t('addTextSource')}</Button>
                </>
            )}
        >
            <RichTextEditor
                bare
                className="min-h-0 flex-1"
                aria-label={t('textContent')}
                placeholder={t('textContent')}
                value={textSourceContent}
                onChange={(md: string) => { setTextSourceContent(md); clearError('content'); }}
                aria-invalid={errors.content ? true : undefined}
                aria-describedby={errors.content ? errorId : undefined}
                labels={labels}
                // eslint-disable-next-line jsx-a11y/no-autofocus -- the body is what the dialog is for; focus it on open (WAI-ARIA dialog pattern)
                autoFocus
            />
        </EditorDialog>
    );
};

export const TextSourceModal = memo(TextSourceModalComp);

interface TextSourceViewerProps {
    show: boolean;
    onClose: () => void;
    fileName: string;
    /** The file's stored text. */
    content: string;
    /** `markdown` is rendered; `text` is shown literally (a `# x` line stays text). */
    format: 'markdown' | 'text';
    /** Back to the list it was opened from (a synced source's entries). */
    back?: PreviewBack;
}

/** An existing .md/.txt source in the same window, read-only, with a download like the PDF preview's. */
const TextSourceViewerComp: React.FC<TextSourceViewerProps> = ({ show, onClose, fileName, content, format, back }) => {
    const { t } = useTheme();
    const baseLabels = useEditorLabels();
    // The word count moves into the header's meta line.
    const labels = { ...baseLabels, count: '' };
    const isMarkdown = format === 'markdown';
    // An imported page's or feed item's "Source: <url>" line is a header action, not body text.
    const originUrl = originUrlOf(content.slice(0, 4000));
    const stripped = originUrl ? withoutOriginLine(content) : content;
    // Markup left in a stored page or feed item reads as its content, not as code.
    const shown = isMarkdown ? renderHtmlBlocks(stripped) : stripped;
    const words = shown.split(/\s+/).filter(Boolean).length;
    // The object URL is made on click and revoked right after, so no URL
    // outlives the download (and none is held in state).
    const download = () => {
        const url = URL.createObjectURL(new Blob([content], { type: `${isMarkdown ? 'text/markdown' : 'text/plain'};charset=utf-8` }));
        const a = document.createElement('a');
        a.href = url;
        a.download = fileName;
        a.click();
        URL.revokeObjectURL(url);
    };

    return (
        <PreviewDialog
            open={show}
            onClose={onClose}
            kind="text"
            back={back}
            title={fileName}
            subtitle={`${t(isMarkdown ? 'previewMarkdownSubtitle' : 'previewTextSubtitle')} · ${fillTemplate(t('previewWordCount'), { count: words })}`}
            actions={originUrl && (
                <a href={originUrl} target="_blank" rel="noopener noreferrer" className={buttonVariants({ variant: 'outline', size: 'sm' })}>
                    <ExternalLink size={14} aria-hidden="true" />
                    {CONFLUENCE_URL_RE.test(originUrl) ? t('openInConfluence') : t('openOriginal')}
                </a>
            )}
        >
            <RichTextEditor
                // A different file is a different document: the editor reads `value` once.
                key={`${fileName}\0${shown.length}`}
                bare
                plain
                readOnly
                format={format}
                className="min-h-0 flex-1"
                aria-label={fileName}
                value={shown}
                labels={labels}
                toolbarEnd={(
                    <Button variant="ghost" size="icon" onClick={download} aria-label={`${t('download')} ${fileName}`} title={t('download')}>
                        <Download size={16} aria-hidden="true" />
                    </Button>
                )}
            />
        </PreviewDialog>
    );
};

export const TextSourceViewer = memo(TextSourceViewerComp);

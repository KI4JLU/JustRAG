import React, { memo, useId, useState } from 'react';
import { BookOpen, Download, ExternalLink, Globe, Rss, type LucideIcon } from 'lucide-react';
import {
    Button, DialogFooter, Input, RichTextEditor, buttonVariants, type RichTextEditorLabels,
} from '@ki4jlu/design-system';
import axios from 'axios';
import { API_BASE_URL } from '../../api';
import { SOURCE_KIND_LABEL_KEY, fillTemplate, originUrlOf, sourceKind, withoutOriginLine } from '../../utils/sourceDisplay';
import { renderHtmlBlocks } from '../../utils/htmlBlocks';
import { useTheme } from '../../contexts/ThemeContext';
import { useToast } from '../../contexts/ToastContext';
import { useFormValidation } from '../../hooks/useFormValidation';
import { type PreviewBack } from '../PreviewHeader';
import { PreviewDialog } from '../PreviewDialog';

/**
 * Text sources in the DS `RichTextEditor` (Tiptap, markdown in and out), in
 * the frame every source preview shares (`PreviewDialog`): the same dialog
 * size and header band, and the editor's own PdfViewer-style toolbar and page
 * below it.
 *
 *  - `TextSourceModal` — „Text einfügen": a new text source. The title is an
 *    inline field in the header, „Abbrechen" / „Text hinzufügen" sit in the
 *    footer, and the body is stored via `POST /api/kb/{id}/text`. Its own entry in the
 *    sources grid; it used to be a second mode hidden behind „Datei
 *    hochladen".
 *  - `TextSourceViewer` — an existing text source, read-only: Markdown
 *    (.md — which „Text einfügen" appends on save) rendered, other text
 *    (code, config, HTML as source) literally, and a Word / slides / EPUB /
 *    TeX document as the text the server extracts from it; the caller
 *    decides (`useWebTools.handlePreviewSource`). There is no
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
    // One slot in the header's subtitle line; each invalid control points at
    // it. The DS turns the borderless title's and the bare editor's placeholder red.
    const errorText = [errors.title, errors.content].filter(Boolean).join(' · ');
    // The word / character count sits in the footer, left of the actions,
    // not in the editor's toolbar (where it crowded the formatting controls).
    const [count, setCount] = useState({ words: 0, characters: 0 });

    return (
        // The same frame and header as every source preview: the Markdown
        // tile, the title as an editable field, a subtitle line that carries
        // the validation message, and the actions in the footer.
        <PreviewDialog
            open={show}
            onClose={onClose}
            kind="markdown"
            title={t('insertText')}
            titleField={(
                <Input
                    // `title`: the preview heading's type (`text-base font-semibold`), editable.
                    variant="title"
                    aria-label={t('textTitle')}
                    placeholder={t('textTitle')}
                    value={textSourceTitle}
                    onChange={(e) => { setTextSourceTitle(e.target.value); clearError('title'); }}
                    aria-invalid={errors.title ? true : undefined}
                    aria-describedby={errors.title ? errorId : undefined}
                />
            )}
            subtitle={errorText
                ? <span id={errorId} className="text-error" role="alert">{errorText}</span>
                : t('previewNewTextSubtitle')}
            footer={(
                <DialogFooter className="items-center">
                    <span className="text-sm tabular-nums text-on-surface-variant sm:mr-auto" aria-live="polite">
                        {fillTemplate(t('editorCount'), count)}
                    </span>
                    <Button variant="outline" onClick={onClose}>{t('cancel')}</Button>
                    <Button onClick={submit}>{t('addTextSource')}</Button>
                </DialogFooter>
            )}
        >
            <RichTextEditor
                bare
                // The page on the page colour, edge to edge, like the read-only viewer.
                plain
                count="none"
                onCountChange={setCount}
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
        </PreviewDialog>
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
    /** Set when `content` was extracted from a document (`GET /api/files/{id}/text`): the download is that file, not the text. */
    extractedFrom?: string;
    /** `files.origin`: a crawled / imported page, a feed item or a Confluence page is labelled as what it is, not as Markdown. */
    origin?: string;
}

/** A stored copy of something on the web: its label, glyph, and that its heading is its title. */
type WebKind = 'web' | 'rss' | 'confluence';
const WEB_KIND: Record<WebKind, { icon: LucideIcon; subtitle: string }> = {
    web: { icon: Globe, subtitle: 'previewWebSubtitle' },
    rss: { icon: Rss, subtitle: 'previewRssItemSubtitle' },
    confluence: { icon: BookOpen, subtitle: 'previewConfluencePageSubtitle' },
};

function webKindOf(origin: string | undefined, originUrl: string | undefined): WebKind | null {
    if (origin === 'rss') return 'rss';
    if (origin === 'confluence') return 'confluence';
    if (origin === 'crawl' || origin === 'url') return 'web';
    // Opened without its file entry (a citation before the list loaded): the "Source:" line tells.
    if (!origin && originUrl) return CONFLUENCE_URL_RE.test(originUrl) ? 'confluence' : 'web';
    return null;
}

/** An existing text source in the same window, read-only, with a download like the PDF preview's. */
const TextSourceViewerComp: React.FC<TextSourceViewerProps> = ({ show, onClose, fileName, content, format, back, extractedFrom, origin }) => {
    const { t } = useTheme();
    const toast = useToast();
    // The word count is in the header's meta line, not the toolbar (`count="none"`).
    const labels = useEditorLabels();
    const isMarkdown = format === 'markdown';
    // An imported page's or feed item's "Source: <url>" line is a header action, not body text.
    const originUrl = originUrlOf(content.slice(0, 4000));
    const stripped = originUrl ? withoutOriginLine(content) : content;
    // Markup left in a stored page or feed item reads as its content, not as code.
    const shown = isMarkdown ? renderHtmlBlocks(stripped) : stripped;
    const words = shown.split(/\s+/).filter(Boolean).length;
    // A page or feed item is stored as "# <title>" + "Source: <url>"; its
    // heading is the real title (the file name is a sanitised, hashed copy).
    const webKind = extractedFrom ? null : webKindOf(origin, originUrl);
    const heading = webKind ? /^#\s+(.+)$/m.exec(stripped.slice(0, 2000))?.[1]?.trim() : undefined;
    // The object URL is made on click and revoked right after, so no URL
    // outlives the download (and none is held in state).
    const download = async () => {
        const blob = extractedFrom
            ? (await axios.get(`${API_BASE_URL}/api/files/${extractedFrom}/download`, { responseType: 'blob' })).data as Blob
            : new Blob([content], { type: `${isMarkdown ? 'text/markdown' : 'text/plain'};charset=utf-8` });
        const url = URL.createObjectURL(blob);
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
            kind={extractedFrom ? 'document' : isMarkdown ? 'markdown' : 'text'}
            icon={webKind ? WEB_KIND[webKind].icon : undefined}
            back={back}
            title={heading ?? fileName}
            fileTitle={!heading}
            subtitle={`${extractedFrom
                ? fillTemplate(t('previewDocumentSubtitle'), { kind: t(SOURCE_KIND_LABEL_KEY[sourceKind(fileName)]) })
                : webKind ? t(WEB_KIND[webKind].subtitle)
                : t(isMarkdown ? 'previewMarkdownSubtitle' : 'previewTextSubtitle')} · ${fillTemplate(t('previewWordCount'), { count: words })}`}
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
                count="none"
                format={format}
                className="min-h-0 flex-1"
                aria-label={fileName}
                value={shown}
                labels={labels}
                toolbarEnd={(
                    <Button variant="ghost" size="icon" onClick={() => { void download().catch(() => toast.error(t('previewLoadError'))); }} aria-label={`${t('download')} ${fileName}`} title={t('download')}>
                        <Download size={16} aria-hidden="true" />
                    </Button>
                )}
            />
        </PreviewDialog>
    );
};

export const TextSourceViewer = memo(TextSourceViewerComp);

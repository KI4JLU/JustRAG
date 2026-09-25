import { useCallback, useEffect, useState } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import axios from 'axios';
import type { GeneratedContent } from '../types';
import { API_BASE_URL } from '../api';
import { isMarkdownArtifact } from '../utils/artifactTypes';
import { copyToClipboard } from '../utils/clipboard';
import { useTheme } from '../contexts/ThemeContext';
import { useToast } from '../contexts/ToastContext';

/* ---------------------------------------------------------------------------
 * Save / copy / DOCX / PDF for one generated-content item.
 *
 * WHY THIS IS A HOOK NOW. These four handlers lived inside
 * `Studio/StudioWorkspace` and were the whole "save/copy/DOCX/PDF path" of a
 * markdown artifact — `MarkdownEditor` only renders the buttons and calls back.
 * The „Textdokumente" tool on the Werkzeuge page (card KI-833) opens the same
 * artifacts in the same editor, so it needs the same four handlers. Moving them
 * here gives both callers ONE implementation instead of a copy of the PDF
 * template that would drift; the bodies are moved unchanged, with one
 * exception noted at `downloadPdf` (HTML escaping), and one addition
 * (`onSaved`).
 *
 * `text` is the caller's current editor content: for a markdown artifact every
 * action works on what is on screen, not on the stored payload, exactly as the
 * Studio did. For a structured item the stored JSON is used (Studio only).
 * ------------------------------------------------------------------------- */

export type ArtifactSaveStatus = 'idle' | 'saving' | 'saved' | 'error';

interface UseArtifactActionsParams {
  kbId: string;
  item: GeneratedContent | null;
  text: string;
  /**
   * Called after a successful save with the item as the server now stores it
   * (the caller's text in `content.text`). Optional: the Studio never updated
   * its list after a save; the tool does, so a re-opened document shows what
   * was saved rather than the text it was first loaded with.
   */
  onSaved?: (saved: GeneratedContent) => void;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function useArtifactActions({ kbId, item, text, onSaved }: UseArtifactActionsParams) {
  const { t } = useTheme();
  const toast = useToast();
  const [saveStatus, setSaveStatus] = useState<ArtifactSaveStatus>('idle');
  const [isCopied, setIsCopied] = useState(false);
  const [isGeneratingPdf, setIsGeneratingPdf] = useState(false);

  useEffect(() => {
    if (isCopied) {
      const timer = setTimeout(() => setIsCopied(false), 2000);
      return () => clearTimeout(timer);
    }
  }, [isCopied]);

  const handleSave = useCallback(async () => {
    if (!item || !isMarkdownArtifact(item.type)) return;

    setSaveStatus('saving');
    try {
      const content = { ...item.content, text };
      await axios.patch(`${API_BASE_URL}/api/generated-content/${item.id}`, { content });

      setSaveStatus('saved');
      onSaved?.({ ...item, content } as GeneratedContent);
      setTimeout(() => setSaveStatus('idle'), 2000);
    } catch (err: unknown) {
      console.error('Save failed:', err);
      toast.error(t('saveError'));
      setSaveStatus('error');
      setTimeout(() => setSaveStatus('idle'), 3000);
    }
  }, [item, text, onSaved, t, toast]);

  const handleCopyToClipboard = useCallback(async () => {
    if (item && isMarkdownArtifact(item.type) && text) {
      const copied = await copyToClipboard(text);
      if (copied) {
        setIsCopied(true);
      }
    } else if (item) {
      const copied = await copyToClipboard(JSON.stringify(item.content, null, 2));
      if (copied) {
        setIsCopied(true);
      }
    }
  }, [item, text]);

  const exportDocx = useCallback(async () => {
    if (!item) return;
    try {
      const contentToExport = isMarkdownArtifact(item.type) ? text : JSON.stringify(item.content, null, 2);

      // Matches ResearchMode.tsx: body: JSON.stringify({ report, goal })
      // Axios automatically stringifies the body, so we pass the object directly.
      const response = await axios.post(`${API_BASE_URL}/api/kb/${kbId}/export/docx`, {
        report: contentToExport,
        goal: item.title
      }, {
        responseType: 'blob'
      });

      const url = window.URL.createObjectURL(new Blob([response.data]));
      const a = document.createElement('a');
      a.href = url;
      a.download = `${item.title.replace(/[^a-z0-9]/gi, '_').toLowerCase()}.docx`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);
    } catch (e: unknown) {
      console.error(e);
      toast.error(t('exportFailed') || 'Export failed');
    }
  }, [item, text, kbId, t, toast]);

  const downloadPdf = useCallback(() => {
    if (!item || isGeneratingPdf) return;
    setIsGeneratingPdf(true);

    const iframe = document.createElement('iframe');
    iframe.style.position = 'fixed';
    iframe.style.right = '0';
    iframe.style.bottom = '0';
    iframe.style.width = '0';
    iframe.style.height = '0';
    iframe.style.border = 'none';
    document.body.appendChild(iframe);

    const doc = iframe.contentDocument || iframe.contentWindow?.document;
    if (!doc) {
      document.body.removeChild(iframe);
      setIsGeneratingPdf(false);
      return;
    }

    /* THE ONE CHANGE IN THE MOVE: everything interpolated into the document
       below is HTML-escaped. The Studio escaped `<` only in <title> and wrote
       the raw title into the <h1> (and the raw JSON into <pre>), so a title
       containing markup — it is "FAQ: " + whatever the user typed as the
       focus — was parsed as HTML in a same-origin iframe. */
    const title = escapeHtml(item.title);
    let contentHtml: string;

    if (isMarkdownArtifact(item.type)) {
      // Render markdown to HTML with proper structure
      contentHtml = renderToStaticMarkup(
        <div className="markdown-content">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>
            {text}
          </ReactMarkdown>
        </div>
      );
    } else {
      contentHtml = `<pre>${escapeHtml(JSON.stringify(item.content, null, 2))}</pre>`;
    }

    doc.open();
    doc.write(`<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<title>${title}</title>
<style>
    @page {
        margin: 20mm;
        size: A4;
    }
    body {
        font-family: var(--font-sans);
        color: #000;
        line-height: 1.4em;
        font-size: 11pt;
        margin: 0;
        padding: 0;
    }
    h1, h2, h3, h4, h5, h6 {
        color: #444444;
        margin-top: 1.5em;
        margin-bottom: 0.5em;
        font-weight: 600;
        page-break-after: avoid;
    }
    h1 { font-size: 18pt; }
    h2 { font-size: 15pt; }
    h3 { font-size: 13pt; }
    p { margin: 0.5em 0; }
    ul, ol { padding-left: 1.5em; margin: 0.5em 0; }
    li { margin-bottom: 0.25em; }
    code {
        background: #f2f2f2;
        padding: 0.15em 0.3em;
        border-radius: 3px;
        font-size: 0.9em;
    }
    pre {
        background: #f2f2f2;
        color: #000;
        padding: 0.8em;
        border-radius: 6px;
        overflow-x: auto;
        margin: 0.8em 0;
        page-break-inside: avoid;
    }
    /* Monospace only inside the code box (pre), never for inline code. */
    pre code { background: transparent; padding: 0; font-family: var(--font-mono, ui-monospace, SFMono-Regular, Menlo, Consolas, monospace); }
    blockquote {
        border-left: 3px solid #cccccc;
        margin: 0.8em 0;
        padding-left: 0.8em;
        color: #444444;
    }
    table {
        width: 100%;
        border-collapse: collapse;
        margin: 0.8em 0;
        font-size: 0.9em;
        page-break-inside: avoid;
    }
    th, td {
        padding: 0.5em 0.75em;
        border: 1px solid #cccccc;
        text-align: left;
    }
    th { background: #f2f2f2; font-weight: 600; }
    tr:nth-child(even) { background: #f9f9f9; }
    a { color: #165a97; }
    img { max-width: 100%; }
</style>
</head>
<body><h1>${title}</h1>${contentHtml}</body>
</html>`);
    doc.close();

    setTimeout(() => {
      iframe.contentWindow?.print();
      setTimeout(() => document.body.removeChild(iframe), 100);
      setIsGeneratingPdf(false);
    }, 500);
  }, [item, text, isGeneratingPdf]);

  return {
    saveStatus, handleSave,
    isCopied, handleCopyToClipboard,
    exportDocx,
    isGeneratingPdf, downloadPdf,
  };
}

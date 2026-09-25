import { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowLeft } from 'lucide-react';
import {
  Badge, Button, Container, PageHeader, Spinner,
  Table, TableBody, TableCaption, TableCell, TableHead, TableHeader, TableRow,
} from '@ki4jlu/design-system';
import type { FileEntry, GeneratedContent, KnowledgeBase } from '../../types';
import { useTheme } from '../../contexts/ThemeContext';
import { useGeneratedContent } from '../../hooks/useGeneratedContent';
import { useArtifactActions } from '../../hooks/useArtifactActions';
import {
  PROMPT_TEXT_ARTIFACT_TYPES, artifactTypeLabel, isMarkdownArtifact,
  type PromptTextArtifactType,
} from '../../utils/artifactTypes';
import { MarkdownEditor } from '../Studio/MarkdownEditor';
import { SelectFieldRow } from '../form/FieldRow';

/* ---------------------------------------------------------------------------
 * „Textdokumente" — the first real tool on the Werkzeuge page (card KI-833).
 *
 * A tool is a generator bound to a topic that produces a standalone result
 * (parent card KI-832). This one covers the seven markdown artifact types
 * (`MARKDOWN_ARTIFACT_TYPES`): pick a topic, see its existing text documents,
 * open one in the Studio's `MarkdownEditor` with the Studio's save/copy/DOCX/
 * PDF path, or create a new one.
 *
 * WHERE THE DATA COMES FROM. `useGeneratedContent` — the same hook, the same
 * `GET /api/kb/{id}/generated-content` and the same `handleGenerate` the Studio
 * used — but a SECOND INSTANCE, bound to the topic picked here. The app-level
 * instance in `AuthenticatedApp` is bound to the open KB (`currentKb`), and
 * pointing that at this topic would mean setting `currentKb`, which
 * `useKbLifecycle` answers by fetching files, chats, feeds and sources for a
 * KB the user never opened. Two instances share code, not state.
 *
 * NOTHING HERE LEADS INTO THE KB VIEW. The KB screen is chat-only since
 * 22.09.2026 (`KbViewType = 'chat'`); this page renders its own editor and
 * never calls `setKbView` or selects a KB.
 *
 * WHAT CAN BE CREATED. Only the four types the generic backend handler serves
 * (`PROMPT_TEXT_ARTIFACT_TYPES`). `analysis`, `abstract` and `research` are
 * LISTED and OPENED here but not created: each has its own input flow (agent
 * dialog, file picker, multi-step research) — see the card for the follow-up.
 * ------------------------------------------------------------------------- */

/** `handleGenerate` only reads files for `chart` and `abstract`, neither of
 *  which this tool offers — a stable empty list keeps the hook's callbacks
 *  stable instead of changing identity on every render. */
const NO_FILES: FileEntry[] = [];

interface TextDocumentsToolProps {
  /** Anchors the skip link; must match `AppChrome`'s `contentId`. */
  id: string;
  /** Every topic the caller can see — the picker's options. */
  topics: KnowledgeBase[];
  onBack: () => void;
}

/** Where the list for the picked topic stands. `forTopic` ties the answer to
 *  the request, so a late answer for a previous topic is never shown. */
type LoadState = { forTopic: string; ok: boolean } | null;

export function TextDocumentsTool({ id, topics, onBack }: TextDocumentsToolProps) {
  const { t, language } = useTheme();
  const [topicId, setTopicId] = useState('');
  const [newType, setNewType] = useState<PromptTextArtifactType | ''>('');
  const [loadState, setLoadState] = useState<LoadState>(null);

  const topic = useMemo(() => topics.find(k => k.id === topicId) ?? null, [topics, topicId]);
  const content = useGeneratedContent({ currentKb: topic, files: NO_FILES });
  const {
    generatedContent, setGeneratedContent,
    selectedContent, setSelectedContent,
    fetchGeneratedContent, handleGenerate, generating,
  } = content;

  useEffect(() => {
    if (!topicId) return;
    const controller = new AbortController();
    void fetchGeneratedContent(topicId, controller.signal).then(list => {
      // `null` is both "cancelled" and "failed" (the hook toasts the failure);
      // only the abort flag tells them apart.
      if (!controller.signal.aborted) setLoadState({ forTopic: topicId, ok: list !== null });
    });
    return () => controller.abort();
  }, [topicId, fetchGeneratedContent]);

  const pickTopic = (next: string) => {
    if (next === topicId) return;
    // Reset in the handler rather than in the effect: the list, the open
    // document and the load state all belong to the previous topic.
    setGeneratedContent([]);
    setSelectedContent(null);
    setLoadState(null);
    setTopicId(next);
  };

  const documents = useMemo(
    () => generatedContent
      .filter(c => isMarkdownArtifact(c.type))
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()),
    [generatedContent],
  );

  const handleSaved = useCallback((saved: GeneratedContent) => {
    setGeneratedContent(prev => prev.map(c => (c.id === saved.id ? saved : c)));
    setSelectedContent(saved);
  }, [setGeneratedContent, setSelectedContent]);

  const dateFormat = useMemo(
    () => new Intl.DateTimeFormat(language === 'de' ? 'de-DE' : 'en-GB', { dateStyle: 'medium', timeStyle: 'short' }),
    [language],
  );

  const topicOptions = useMemo(() => topics.map(k => ({ value: k.id, label: k.name })), [topics]);
  const typeOptions = useMemo(
    () => PROMPT_TEXT_ARTIFACT_TYPES.map(type => ({ value: type, label: artifactTypeLabel(type, t) })),
    [t],
  );

  const openDocument = selectedContent && isMarkdownArtifact(selectedContent.type) && topic
    ? selectedContent
    : null;

  const loading = topicId !== '' && loadState?.forTopic !== topicId;
  const loadFailed = loadState?.forTopic === topicId && !loadState.ok;

  return (
    <section id={id} aria-label={t('textDocumentsTool')} className="flex flex-col">
      <Container className="flex flex-col gap-stack-lg py-gutter md:py-margin-page">
        <PageHeader
          title={t('textDocumentsTool')}
          description={t('textDocumentsToolDescription')}
          actions={(
            <Button variant="ghost" onClick={onBack}>
              <ArrowLeft size={16} aria-hidden="true" />
              {t('backToTools')}
            </Button>
          )}
        />

        {topics.length === 0 ? (
          <p className="m-0 text-on-surface-variant">{t('toolNoTopics')}</p>
        ) : openDocument && topic ? (
          <TextDocumentView
            key={openDocument.id}
            kbId={topic.id}
            item={openDocument}
            onBack={() => setSelectedContent(null)}
            onSaved={handleSaved}
          />
        ) : (
          <>
            <div className="flex flex-col gap-stack-md md:flex-row md:items-end">
              <SelectFieldRow
                label={t('toolTopicLabel')}
                value={topicId}
                onValueChange={pickTopic}
                options={topicOptions}
                placeholder={t('toolTopicPlaceholder')}
                /* A generation in flight is bound to the topic it started on:
                   handleGenerate refetches THAT topic's list and opens its
                   result, which must not land under a different topic. */
                disabled={generating}
              />
              <SelectFieldRow
                label={t('textDocumentTypeLabel')}
                value={newType}
                onValueChange={v => setNewType(v as PromptTextArtifactType)}
                options={typeOptions}
                placeholder={t('textDocumentTypePlaceholder')}
                disabled={!topic || generating}
              />
              <Button
                onClick={() => { if (newType) void handleGenerate(newType); }}
                disabled={!topic || !newType || generating}
              >
                {generating ? <Spinner size="sm" aria-hidden="true" /> : null}
                {generating ? t('textDocumentsCreating') : t('createTextDocument')}
              </Button>
            </div>

            {!topicId ? (
              <p className="m-0 text-on-surface-variant">{t('textDocumentsPickTopic')}</p>
            ) : loading ? (
              <Spinner label={t('loading')} />
            ) : loadFailed ? (
              <p className="m-0 text-on-surface-variant">{t('textDocumentsLoadFailed')}</p>
            ) : documents.length === 0 ? (
              <p className="m-0 text-on-surface-variant">{t('textDocumentsEmpty')}</p>
            ) : (
              <Table>
                <TableCaption>{t('textDocumentsResults')}</TableCaption>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t('textDocumentsColTitle')}</TableHead>
                    <TableHead>{t('textDocumentsColType')}</TableHead>
                    <TableHead>{t('textDocumentsColCreated')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {documents.map(doc => (
                    <TableRow key={doc.id}>
                      <TableCell>
                        <Button variant="link" className="h-auto p-0" onClick={() => setSelectedContent(doc)}>
                          {doc.title}
                        </Button>
                      </TableCell>
                      <TableCell>
                        <Badge>{artifactTypeLabel(doc.type, t)}</Badge>
                      </TableCell>
                      <TableCell>
                        <time dateTime={doc.createdAt}>{formatDate(dateFormat, doc.createdAt)}</time>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </>
        )}
      </Container>
    </section>
  );
}

function formatDate(format: Intl.DateTimeFormat, iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : format.format(d);
}

/** One open document: the Studio editor plus its save/copy/DOCX/PDF path. */
function TextDocumentView({ kbId, item, onBack, onSaved }: {
  kbId: string;
  item: GeneratedContent;
  onBack: () => void;
  onSaved: (saved: GeneratedContent) => void;
}) {
  const { t } = useTheme();
  // Keyed by the item id at the call site, so switching documents remounts
  // this and re-reads the text instead of syncing it in an effect.
  const [text, setText] = useState(() => (item.content as { text?: string }).text || '');
  const actions = useArtifactActions({ kbId, item, text, onSaved });

  return (
    <div className="flex flex-col gap-stack-md">
      <div className="flex flex-wrap items-center justify-between gap-stack-sm">
        <h2 className="m-0 font-headline-sm text-headline-sm-mobile text-on-surface">{item.title}</h2>
        <Button variant="outline" onClick={onBack}>
          <ArrowLeft size={16} aria-hidden="true" />
          {t('backToDocuments')}
        </Button>
      </div>
      {/* MarkdownEditor fills its parent's height (`height: 100%`), so the
          parent has to have one. // TODO: 70vh is a reasoned choice, not yet
          visually confirmed in a browser. */}
      <div className="h-[70vh]">
        <MarkdownEditor
          value={text}
          onChange={setText}
          onSave={actions.handleSave}
          saveStatus={actions.saveStatus}
          onCopy={actions.handleCopyToClipboard}
          onExportDocx={actions.exportDocx}
          onDownloadPdf={actions.downloadPdf}
          isCopied={actions.isCopied}
          isGeneratingPdf={actions.isGeneratingPdf}
        />
      </div>
    </div>
  );
}

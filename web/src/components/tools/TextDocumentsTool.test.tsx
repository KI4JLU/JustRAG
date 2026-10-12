import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import axios from 'axios';
import type { GeneratedContent, KnowledgeBase } from '../../types';
import { translations } from '../../translations';
import { ModalProvider } from '../../contexts/ModalContext';
import { ToastProvider } from '../../contexts/ToastContext';
import { stubViewport } from '../../test/viewport';
import { TextDocumentsTool } from './TextDocumentsTool';

/* ---------------------------------------------------------------------------
 * The „Textdokumente" tool (card KI-833).
 *
 * Only the network is stubbed. The hook behind the list and the create flow
 * (`useGeneratedContent`), the save path (`useArtifactActions`), the editor
 * (`MarkdownEditor`) and the prompt dialog (`ModalProvider`) are all real —
 * they are what the card asks to be reused, so stubbing them would test the
 * stubs.
 *
 * ORACLES, all independent of the code under test:
 *  - the backend contract, read off the Go source rather than off the
 *    frontend: routes in go-backend/internal/app/routes.go
 *    (`GET /api/kb/{id}/generated-content`, `PATCH /api/generated-content/{id}`,
 *    `POST /api/kb/{id}/generate/` + spec.Type), the PATCH body
 *    `{"content": {...}}` from gencontent/handler.go, the generate body
 *    fields `topic`/`language` from contentgen/registry.go;
 *  - the four creatable types, written out here from contentgen/registry.go
 *    `TextArtifacts` — not imported from `PROMPT_TEXT_ARTIFACT_TYPES`, which
 *    is the thing being checked;
 *  - the seven markdown types, written out here from the card's scope text,
 *    not imported from `MARKDOWN_ARTIFACT_TYPES`;
 *  - translations.ts for every label, and the fixtures' own values (titles,
 *    dates) for what the list must show and in which order.
 * ------------------------------------------------------------------------- */

vi.mock('axios');
const mockedAxios = vi.mocked(axios, true);

/* ONE `t` for the whole file, like production's (`useThemeAndLanguage` wraps
   it in `useCallback`). A fresh function per `useTheme()` call would change
   `fetchGeneratedContent`'s identity on every render and refetch the list in
   a loop — overwriting, among other things, a just-saved document with the
   fixture. */
const themeMock = vi.hoisted(() => ({
  t: (key: string) => key,
}));

vi.mock('../../contexts/ThemeContext', () => ({
  useTheme: () => ({ theme: 'light', language: 'en', resolvedTheme: 'light', t: themeMock.t }),
}));

themeMock.t = (key: string) => {
  const entry = translations[key as keyof typeof translations];
  return entry ? entry.en : key;
};

const en = (key: keyof typeof translations) => translations[key].en;

function topic(id: string, name: string): KnowledgeBase {
  return {
    id, name, description: null, userId: 'user-1', createdAt: '2026-09-01T00:00:00Z',
    isPro: false, aiConfigId: null, chatModel: null, embeddingModel: null, rerankModel: null, ttsModel: null,
  };
}

const TOPICS = [topic('kb-1', 'Biology'), topic('kb-2', 'Chemistry')];

function gc(id: string, type: GeneratedContent['type'], title: string, createdAt: string, content: unknown): GeneratedContent {
  return { id, kbId: 'kb-2', userId: 'user-1', type, title, createdAt, content } as GeneratedContent;
}

/* Chemistry's server list: five markdown artifacts of five different types,
   and two structured ones (flashcards, podcast) that must NOT be listed. */
const CHEMISTRY: GeneratedContent[] = [
  gc('g-faq', 'faq', 'FAQ: Acids', '2026-09-20T10:00:00Z', { text: '# Acids FAQ' }),
  gc('g-cards', 'flashcards', 'Cards: Acids', '2026-09-24T10:00:00Z', []),
  gc('g-research', 'research', 'Report: Bases', '2026-09-22T10:00:00Z', { text: '# Bases' }),
  gc('g-pod', 'podcast', 'Podcast: Salts', '2026-09-23T10:00:00Z', {}),
  gc('g-analysis', 'analysis', 'Analysis: pH', '2026-09-18T10:00:00Z', { text: 'ph' }),
  gc('g-time', 'timeline', 'Timeline: Periodic table', '2026-09-21T10:00:00Z', { text: '1869' }),
  gc('g-abstract', 'abstract', 'Abstract: Redox', '2026-09-19T10:00:00Z', { text: 'redox' }),
];

function renderTool(topics: KnowledgeBase[] = TOPICS) {
  const onBack = vi.fn();
  render(
    <ToastProvider>
      <ModalProvider>
        <TextDocumentsTool id="tools-content" topics={topics} onBack={onBack} />
      </ModalProvider>
    </ToastProvider>,
  );
  return { onBack };
}

async function pickTopic(name: string) {
  await userEvent.click(screen.getByRole('combobox', { name: en('toolTopicLabel') }));
  await userEvent.click(await screen.findByRole('option', { name }));
}

beforeEach(() => {
  vi.clearAllMocks();
  // Radix Select measures and captures pointers; jsdom implements neither.
  Element.prototype.hasPointerCapture = vi.fn(() => false);
  Element.prototype.setPointerCapture = vi.fn();
  Element.prototype.releasePointerCapture = vi.fn();
  Element.prototype.scrollIntoView = vi.fn();
  stubViewport();
  mockedAxios.get.mockImplementation(async (url: string) => {
    if (url.endsWith('/api/kb/kb-2/generated-content')) return { data: CHEMISTRY };
    if (url.endsWith('/api/kb/kb-1/generated-content')) return { data: [] };
    throw new Error(`unexpected GET ${url}`);
  });
});

describe('TextDocumentsTool — results list', () => {
  it('asks for a topic before it fetches anything', () => {
    renderTool();
    expect(screen.getByText(en('textDocumentsPickTopic'))).toBeInTheDocument();
    expect(mockedAxios.get).not.toHaveBeenCalled();
  });

  it("lists exactly the topic's markdown artifacts, newest first", async () => {
    renderTool();
    await pickTopic('Chemistry');

    const table = await screen.findByRole('table', { name: en('textDocumentsResults') });
    expect(mockedAxios.get).toHaveBeenCalledWith(
      expect.stringMatching(/\/api\/kb\/kb-2\/generated-content$/),
      expect.anything(),
    );

    // Markdown = analysis, abstract, research, briefing_doc, faq, study_guide,
    // timeline (card scope). Flashcards and podcast are structured and absent.
    // Order by the fixtures' createdAt, descending, worked out by hand:
    // 22 research, 21 timeline, 20 faq, 19 abstract, 18 analysis.
    const titles = within(table).getAllByRole('button').map(b => b.textContent);
    expect(titles).toEqual([
      'Report: Bases', 'Timeline: Periodic table', 'FAQ: Acids', 'Abstract: Redox', 'Analysis: pH',
    ]);
    expect(within(table).queryByText('Cards: Acids')).not.toBeInTheDocument();
    expect(within(table).queryByText('Podcast: Salts')).not.toBeInTheDocument();

    // The type column reads the result's type, not the Studio action label.
    const researchRow = within(table).getByText('Report: Bases').closest('tr')!;
    expect(within(researchRow).getByText(en('artifactTypeResearch'))).toBeInTheDocument();
  });

  it('says so when a topic has no text documents', async () => {
    renderTool();
    await pickTopic('Biology');
    expect(await screen.findByText(en('textDocumentsEmpty'))).toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });

  it('reports a failed load instead of spinning forever', async () => {
    mockedAxios.get.mockRejectedValue(new Error('500'));
    renderTool();
    await pickTopic('Chemistry');
    expect(await screen.findByText(en('textDocumentsLoadFailed'))).toBeInTheDocument();
  });

  it('points to creating a topic when the caller has none', () => {
    renderTool([]);
    expect(screen.getByText(en('toolNoTopics'))).toBeInTheDocument();
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
  });

  it('goes back to the tools grid', async () => {
    const { onBack } = renderTool();
    await userEvent.click(screen.getByRole('button', { name: en('backToTools') }));
    expect(onBack).toHaveBeenCalledTimes(1);
  });
});

describe('TextDocumentsTool — open and save', () => {
  it('opens a document in the editor and saves the edited text through PATCH', async () => {
    mockedAxios.patch.mockResolvedValue({ data: {} });
    renderTool();
    await pickTopic('Chemistry');
    await userEvent.click(await screen.findByRole('button', { name: 'FAQ: Acids' }));

    // The document view: its title as a heading, the stored markdown rendered.
    expect(screen.getByRole('heading', { level: 2, name: 'FAQ: Acids' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1, name: 'Acids FAQ' })).toBeInTheDocument();

    // Switch the editor to edit mode, replace the text, save.
    await userEvent.click(screen.getByTitle(en('editContent')));
    const textarea = screen.getByRole('textbox');
    await userEvent.clear(textarea);
    await userEvent.type(textarea, 'New answer');
    await userEvent.click(screen.getByRole('button', { name: en('saveChanges') }));

    await waitFor(() => expect(mockedAxios.patch).toHaveBeenCalledTimes(1));
    expect(mockedAxios.patch).toHaveBeenCalledWith(
      expect.stringMatching(/\/api\/generated-content\/g-faq$/),
      { content: { text: 'New answer' } },
    );

    // Back to the list and in again: the saved text, not the loaded one.
    await userEvent.click(screen.getByRole('button', { name: en('backToDocuments') }));
    await userEvent.click(await screen.findByRole('button', { name: 'FAQ: Acids' }));
    expect(screen.getByText('New answer')).toBeInTheDocument();
  });
});

describe('TextDocumentsTool — create', () => {
  it('offers exactly the four types the generic backend handler serves', async () => {
    renderTool();
    await pickTopic('Chemistry');
    await userEvent.click(screen.getByRole('combobox', { name: en('textDocumentTypeLabel') }));
    const options = (await screen.findAllByRole('option')).map(o => o.textContent);
    // contentgen/registry.go TextArtifacts: briefing_doc, faq, study_guide, timeline.
    expect(options).toEqual([en('briefingDoc'), en('faq'), en('studyGuide'), en('timeline')]);
  });

  it('keeps create disabled until a topic and a type are picked', async () => {
    renderTool();
    const create = screen.getByRole('button', { name: en('createTextDocument') });
    expect(create).toBeDisabled();
    await pickTopic('Chemistry');
    expect(create).toBeDisabled();
  });

  it('generates through POST /generate/{type} with the typed focus and opens the result', async () => {
    const created = gc('g-new', 'faq', 'FAQ: Buffers', '2026-09-25T09:00:00Z', { text: '# Buffer questions' });
    mockedAxios.post.mockResolvedValue({ data: created });
    renderTool();
    await pickTopic('Chemistry');
    await userEvent.click(screen.getByRole('combobox', { name: en('textDocumentTypeLabel') }));
    await userEvent.click(await screen.findByRole('option', { name: en('faq') }));

    // After the create, the refreshed list carries the new record too.
    mockedAxios.get.mockResolvedValue({ data: [created, ...CHEMISTRY] });
    await userEvent.click(screen.getByRole('button', { name: en('createTextDocument') }));

    // handleGenerate asks for the focus through the app's prompt dialog.
    const dialog = await screen.findByRole('dialog');
    await userEvent.type(within(dialog).getByRole('textbox'), 'Buffers');
    await userEvent.click(within(dialog).getByRole('button', { name: en('confirm') }));

    await waitFor(() => expect(mockedAxios.post).toHaveBeenCalledTimes(1));
    expect(mockedAxios.post).toHaveBeenCalledWith(
      expect.stringMatching(/\/api\/kb\/kb-2\/generate\/faq$/),
      { topic: 'Buffers', language: 'en' },
    );

    // The created document is open.
    expect(await screen.findByRole('heading', { level: 2, name: 'FAQ: Buffers' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1, name: 'Buffer questions' })).toBeInTheDocument();
  });
});

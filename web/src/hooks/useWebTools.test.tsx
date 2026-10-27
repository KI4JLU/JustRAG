import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import axios from 'axios';
import { useWebTools } from './useWebTools';
import type { FileEntry } from '../types';

vi.mock('axios');
vi.mock('../contexts/ThemeContext', () => ({
  useTheme: () => ({ t: (k: string) => k, language: 'de' }),
}));
const toastInfo = vi.fn();
vi.mock('../contexts/ToastContext', () => ({
  useToast: () => ({ info: toastInfo, error: vi.fn(), success: vi.fn(), warning: vi.fn() }),
}));

const file = (name: string, type?: string): FileEntry => ({ id: `id-${name}`, name, type } as FileEntry);

// Oracle: the source-preview contract (utils/previewKind) — every kind opens
// its own viewer (PDF, spreadsheet, text, extracted document text, media),
// and only a format no browser can show gets the "not supported" toast.
describe('useWebTools.handlePreviewSource', () => {
  beforeEach(() => vi.clearAllMocks());

  const setup = () => renderHook(() => useWebTools({ currentKb: null, fetchFiles: vi.fn() }));

  it.each(['a.xlsx', 'b.XLS', 'c.ods', 'd.csv', 'e.tsv'])('opens %s in the spreadsheet preview', (name) => {
    const { result } = setup();
    act(() => result.current.handlePreviewSource(file(name)));
    expect(result.current.showTabularModal).toBe(true);
    expect(result.current.tabularFile).toEqual({ fileId: `id-${name}`, fileName: name });
    expect(toastInfo).not.toHaveBeenCalled();
  });

  it('keeps PDFs on the PDF preview', () => {
    const { result } = setup();
    act(() => result.current.handlePreviewSource(file('doc.pdf')));
    expect(result.current.showPdfPreview).toBe(true);
    expect(result.current.showTabularModal).toBe(false);
  });

  it('answers an unsupported format (.xlsm, macro workbooks) with the toast', () => {
    const { result } = setup();
    act(() => result.current.handlePreviewSource(file('a.xlsm')));
    expect(result.current.showTabularModal).toBe(false);
    expect(toastInfo).toHaveBeenCalledWith('previewNotSupported');
  });

  it.each([
    ['photo.png', 'image/png', 'image'],
    ['scan.JPG', undefined, 'image'],
    ['interview.mp3', 'audio/mpeg', 'audio'],
    ['talk.mp4', 'video/mp4', 'video'],
  ])('opens %s in the media preview', (name, type, kind) => {
    const { result } = setup();
    act(() => result.current.handlePreviewSource(file(name, type)));
    expect(result.current.mediaPreview).toEqual({ fileId: `id-${name}`, fileName: name, kind, back: undefined });
    expect(toastInfo).not.toHaveBeenCalled();
  });

  it('opens a Word document as the text the server extracts', async () => {
    vi.mocked(axios.get).mockResolvedValueOnce({ data: { text: 'Hallo', markdown: false } });
    const { result } = setup();
    act(() => result.current.handlePreviewSource(file('Bericht.docx')));
    await waitFor(() => expect(result.current.showPreviewModal).toBe(true));
    expect(axios.get).toHaveBeenCalledWith(expect.stringMatching(/\/api\/files\/id-Bericht\.docx\/text$/));
    expect(result.current.previewPage).toMatchObject({ content: 'Hallo', format: 'text', extractedFrom: 'id-Bericht.docx' });
  });

  it('opens a git code file as literal text', async () => {
    vi.mocked(axios.get).mockResolvedValueOnce({ data: 'package main' });
    const { result } = setup();
    act(() => result.current.handlePreviewSource(file('cmd/main.go', 'text/plain')));
    await waitFor(() => expect(result.current.showPreviewModal).toBe(true));
    expect(result.current.previewPage).toMatchObject({ content: 'package main', format: 'text' });
  });

  // A citation passes an id and a name; the KB's file list supplies the MIME
  // type, so a Confluence attachment titled without an extension still opens.
  it('reads the MIME type from the file list for a preview opened by id', () => {
    const attachment = { id: 'f-1', name: 'Lageplan', type: 'image/png' } as FileEntry;
    const { result } = renderHook(() => useWebTools({ currentKb: null, fetchFiles: vi.fn(), files: [attachment] }));
    act(() => result.current.handlePreviewSource('f-1', 'Lageplan'));
    expect(result.current.mediaPreview).toMatchObject({ fileId: 'f-1', kind: 'image' });
  });

  it('carries the back link to the preview it opens', () => {
    const back = { trail: ['Aktuelles (HRZ)'], onBack: vi.fn() };
    const { result } = setup();
    act(() => result.current.handlePreviewSource(file('a.pdf'), undefined, { back }));
    expect(result.current.pdfPreview).toEqual({ fileId: 'id-a.pdf', fileName: 'a.pdf', page: 1, back });
  });
});

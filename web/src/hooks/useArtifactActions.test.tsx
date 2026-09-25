import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import axios from 'axios';
import type { GeneratedContent } from '../types';
import { useArtifactActions } from './useArtifactActions';

/* ---------------------------------------------------------------------------
 * The save/copy/DOCX/PDF path moved out of `StudioWorkspace` (card KI-833).
 *
 * ORACLES, independent of the code under test:
 *  - HTML parsing: an escaped `<img …>` in the print document is TEXT, so
 *    the document has no <img> element and the heading's textContent is the
 *    title verbatim. The browser's parser decides that, not this hook.
 *  - The backend contract for save, read off go-backend: `PATCH
 *    /api/generated-content/{id}` (app/routes.go) with body
 *    `{"content": {...}}` (gencontent/handler.go UpdateGenContent).
 * ------------------------------------------------------------------------- */

vi.mock('axios');
vi.mock('../contexts/ThemeContext', () => ({ useTheme: () => ({ t: (k: string) => k, language: 'en' }) }));
const toastError = vi.fn();
vi.mock('../contexts/ToastContext', () => ({ useToast: () => ({ error: toastError, success: vi.fn() }) }));

const HOSTILE = 'FAQ: <img src=x onerror="window.__pwned=1">';

function faq(title: string, text: string): GeneratedContent {
  return {
    id: 'g-1', kbId: 'kb-1', userId: 'u-1', type: 'faq', title,
    createdAt: '2026-09-25T00:00:00Z', content: { text },
  };
}

describe('useArtifactActions — downloadPdf', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => {
    vi.useRealTimers();
    document.querySelectorAll('iframe').forEach(f => f.remove());
  });

  it('writes the title into the print document as text, never as markup', () => {
    const item = faq(HOSTILE, '# Body');
    const { result } = renderHook(() => useArtifactActions({ kbId: 'kb-1', item, text: '# Body' }));

    act(() => { result.current.downloadPdf(); });

    const doc = document.querySelector('iframe')!.contentDocument!;
    expect(doc.querySelector('img')).toBeNull();
    expect(doc.querySelector('body > h1')!.textContent).toBe(HOSTILE);
    expect(doc.title).toBe(HOSTILE);
    // The markdown body is still rendered as markdown.
    expect(doc.querySelector('.markdown-content h1')!.textContent).toBe('Body');
  });
});

describe('useArtifactActions — handleSave', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('PATCHes the on-screen text and reports the saved item', async () => {
    vi.mocked(axios.patch).mockResolvedValue({ data: {} });
    const onSaved = vi.fn();
    const item = faq('FAQ: Acids', 'old');
    const { result } = renderHook(() => useArtifactActions({ kbId: 'kb-1', item, text: 'edited', onSaved }));

    await act(async () => { await result.current.handleSave(); });

    expect(axios.patch).toHaveBeenCalledWith(
      expect.stringMatching(/\/api\/generated-content\/g-1$/),
      { content: { text: 'edited' } },
    );
    expect(onSaved).toHaveBeenCalledWith({ ...item, content: { text: 'edited' } });
    expect(result.current.saveStatus).toBe('saved');
  });

  it('does not report a save that failed', async () => {
    vi.mocked(axios.patch).mockRejectedValue(new Error('403'));
    const onSaved = vi.fn();
    const { result } = renderHook(() => useArtifactActions({ kbId: 'kb-1', item: faq('FAQ', 'x'), text: 'y', onSaved }));

    await act(async () => { await result.current.handleSave(); });

    expect(onSaved).not.toHaveBeenCalled();
    expect(toastError).toHaveBeenCalledWith('saveError');
    expect(result.current.saveStatus).toBe('error');
  });
});

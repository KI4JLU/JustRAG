import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, renderHook } from '@testing-library/react';
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

const file = (name: string): FileEntry => ({ id: `id-${name}`, name } as FileEntry);

// Oracle: the source-preview contract — every format the tabular ingest reads
// (xlsx/xls/ods/csv/tsv, any case) opens the spreadsheet preview, PDFs keep
// the PDF preview, and anything else gets the "not supported" toast.
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
});

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import axios from 'axios';
import { GlobalKbSettings } from './GlobalKbSettings';
import { UploadStorageNoticeDialog } from './UploadStorageNoticeDialog';
import type { KnowledgeBase } from '../types';

vi.mock('axios');
let userId = 'g1';
vi.mock('../contexts/AuthContext', () => ({ useAuth: () => ({ user: { id: userId, role: 'admin' }, siteConfigs: {} }) }));
vi.mock('../contexts/ThemeContext', () => ({ useTheme: () => ({ t: (k: string) => k, language: 'de' }) }));
vi.mock('../contexts/ToastContext', () => ({
  useToast: () => ({ success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() }),
}));

// jsdom's localStorage is unreliable on Node 25; the flags live in this one.
class MemoryStorage implements Storage {
  private data = new Map<string, string>();
  get length() { return this.data.size; }
  clear() { this.data.clear(); }
  getItem(k: string) { return this.data.get(k) ?? null; }
  key(i: number) { return Array.from(this.data.keys())[i] ?? null; }
  removeItem(k: string) { this.data.delete(k); }
  setItem(k: string, v: string) { this.data.set(k, v); }
}

const kb = { id: 'kb-g', name: 'Global', isGlobal: true } as KnowledgeBase;
// The shared flags are cached per key for the module's lifetime: one user per test.
let n = 0;
beforeEach(() => {
  Object.defineProperty(window, 'localStorage', { value: new MemoryStorage(), configurable: true, writable: true });
  userId = `g${++n}`;
  vi.clearAllMocks();
  vi.mocked(axios.get).mockResolvedValue({ data: [] });
  vi.mocked(axios.post).mockResolvedValue({ data: {} });
});

function renderShell() {
  const view = render(
    <>
      <GlobalKbSettings kb={kb} onBack={vi.fn()} onOpenKb={vi.fn()} onUpdate={vi.fn()} />
      <UploadStorageNoticeDialog />
    </>,
  );
  const input = view.container.querySelector('input[type="file"]') as HTMLInputElement;
  fireEvent.change(input, { target: { files: [new File(['x'], 'a.pdf', { type: 'application/pdf' })] } });
}
const notice = () => document.getElementById('upload-storage-notice');
const uploads = () => vi.mocked(axios.post).mock.calls.filter(([url]) => String(url).endsWith('/api/kb/kb-g/files'));

// Oracle: card F-17 as refined by the developer — every source upload, the
// global KB's admin screen included, waits on the source storage notice.
describe('GlobalKbSettings — the storage notice before a source upload', () => {
  it('asks before uploading, and uploads once accepted', async () => {
    renderShell();
    await waitFor(() => expect(notice()).toHaveTextContent('uploadStorageNoticeSource'));
    expect(uploads()).toHaveLength(0);
    fireEvent.click(screen.getByRole('button', { name: 'uploadStorageNoticeAccept' }));
    await waitFor(() => expect(uploads()).toHaveLength(1));
  });

  it('uploads nothing when the notice is closed', async () => {
    renderShell();
    await waitFor(() => expect(notice()).not.toBeNull());
    fireEvent.keyDown(notice() as HTMLElement, { key: 'Escape' });
    await waitFor(() => expect(notice()).toBeNull());
    expect(uploads()).toHaveLength(0);
  });
});

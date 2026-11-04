import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { Button } from '@ki4jlu/design-system';
import { UploadStorageNoticeDialog } from './UploadStorageNoticeDialog';
import { uploadStorageNoticeKey, useUploadStorageNotice } from '../hooks/useUploadStorageNotice';

let userId = 'u1';
vi.mock('../contexts/AuthContext', () => ({ useAuth: () => ({ user: { id: userId } }) }));
vi.mock('../contexts/ThemeContext', () => ({ useTheme: () => ({ t: (k: string) => k }) }));

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

// Uploads stand in as buttons that ask the notice, beside the dialog: a chat
// attachment ("upload") and a source ("source"). `answers` collects what each
// upload was told.
let answers: boolean[] = [];
function App() {
  const chat = useUploadStorageNotice(userId, 'chat');
  const source = useUploadStorageNotice(userId, 'source');
  return (
    <>
      <Button type="button" onClick={() => { void chat.confirm().then((ok) => answers.push(ok)); }}>upload</Button>
      <Button type="button" onClick={() => { void source.confirm().then((ok) => answers.push(ok)); }}>source</Button>
      <UploadStorageNoticeDialog />
    </>
  );
}
const upload = () => fireEvent.click(screen.getByRole('button', { name: 'upload' }));
const uploadSource = () => fireEvent.click(screen.getByRole('button', { name: 'source' }));
const acceptNotice = () => fireEvent.click(screen.getByRole('button', { name: 'uploadStorageNoticeAccept' }));
const dialog = () => screen.queryByRole('dialog', { name: 'uploadStorageNoticeTitle' });

// The shared flags are cached per key for the module's lifetime, so every
// test uses its own user id.
let n = 0;
beforeEach(() => {
  Object.defineProperty(window, 'localStorage', { value: new MemoryStorage(), configurable: true, writable: true });
  userId = `u${++n}`;
  answers = [];
});

// Oracle: card F-17 as refined by the developer — an upload waits on the
// notice until the user accepts it once; closing it otherwise drops that
// upload and the next one asks again; a login never shows it on its own.
describe('UploadStorageNoticeDialog', () => {
  it('stays closed before an upload', () => {
    render(<App />);
    expect(dialog()).not.toBeInTheDocument();
  });

  it('opens on a chat attachment with the attachment text', () => {
    render(<App />);
    upload();
    expect(dialog()).toHaveTextContent('uploadStorageNoticeChat');
    expect(answers).toEqual([]);
  });

  it('opens on a source upload with the source text', () => {
    render(<App />);
    uploadSource();
    expect(dialog()).toHaveTextContent('uploadStorageNoticeSource');
  });

  it('asks for sources again after the attachment notice was accepted', async () => {
    render(<App />);
    upload();
    acceptNotice();
    await waitFor(() => expect(answers).toEqual([true]));
    uploadSource();
    expect(dialog()).toHaveTextContent('uploadStorageNoticeSource');
  });

  it('shows a waiting source notice after the attachment notice is answered', async () => {
    render(<App />);
    upload();
    // A source upload already under way asks behind the open dialog (hidden by it).
    fireEvent.click(screen.getByRole('button', { name: 'source', hidden: true }));
    expect(dialog()).toHaveTextContent('uploadStorageNoticeChat');
    acceptNotice();
    await waitFor(() => expect(answers).toEqual([true]));
    await waitFor(() => expect(dialog()).toHaveTextContent('uploadStorageNoticeSource'));
  });

  it('lets the upload go on "Verstanden" and never asks again', async () => {
    const { unmount } = render(<App />);
    upload();
    acceptNotice();
    await waitFor(() => expect(answers).toEqual([true]));
    expect(dialog()).not.toBeInTheDocument();
    expect(window.localStorage.getItem(uploadStorageNoticeKey(userId, 'chat'))).toBe('1');
    unmount();
    render(<App />);
    upload();
    expect(dialog()).not.toBeInTheDocument();
    await waitFor(() => expect(answers).toEqual([true, true]));
  });

  it('drops the upload on the X, and the next upload asks again', async () => {
    render(<App />);
    upload();
    fireEvent.click(screen.getByRole('button', { name: /close|schließen/i }));
    await waitFor(() => expect(answers).toEqual([false]));
    expect(dialog()).not.toBeInTheDocument();
    expect(window.localStorage.getItem(uploadStorageNoticeKey(userId, 'chat'))).toBeNull();
    upload();
    expect(dialog()).toBeInTheDocument();
  });

  it('drops the upload on Escape', async () => {
    render(<App />);
    upload();
    fireEvent.keyDown(dialog() as HTMLElement, { key: 'Escape' });
    await waitFor(() => expect(answers).toEqual([false]));
    expect(dialog()).not.toBeInTheDocument();
  });

  it('does not open on its own at the next login when left unanswered', async () => {
    const { unmount } = render(<App />);
    upload();
    unmount();
    await waitFor(() => expect(answers).toEqual([false]));
    render(<App />);
    expect(dialog()).not.toBeInTheDocument();
    upload();
    expect(dialog()).toBeInTheDocument();
  });

  it('is per user', () => {
    const { unmount } = render(<App />);
    upload();
    acceptNotice();
    unmount();
    userId = `u${++n}`;
    render(<App />);
    upload();
    expect(dialog()).toBeInTheDocument();
  });
});

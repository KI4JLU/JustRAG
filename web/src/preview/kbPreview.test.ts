import { afterEach, describe, expect, it } from 'vitest';
import { alignKbPreviewWithChat, getKbPreview, previewHeaderFor, setKbPreview, takeKeepChat } from './kbPreview';

// Oracle: the doc comments in kbPreview.ts — the header goes only to the
// previewed topic's routes and to the source-file routes, and opening a chat
// from the history moves the preview to the chat's own (keeping that chat).
describe('kbPreview', () => {
  afterEach(() => { setKbPreview(null); takeKeepChat(); });

  it('adds the header to the previewed topic and to source-file writes only', () => {
    setKbPreview({ kbId: 'kb1', role: 'view', ownRole: 'owner' });
    expect(previewHeaderFor('/api/kb/kb1')).toBe('view');
    expect(previewHeaderFor('http://localhost:3000/api/kb/kb1/files?x=1')).toBe('view');
    expect(previewHeaderFor('/api/files/f1/preview')).toBeNull();
    expect(previewHeaderFor('/api/files/f1', 'delete')).toBe('view');
    expect(previewHeaderFor('/api/files/f1/retry', 'POST')).toBe('view');
    expect(previewHeaderFor('/api/kb/kb10')).toBeNull();
    expect(previewHeaderFor('/api/kb/kb2/chat')).toBeNull();
    expect(previewHeaderFor('/api/chats')).toBeNull();
    setKbPreview(null);
    expect(previewHeaderFor('/api/kb/kb1')).toBeNull();
  });

  it('follows a chat opened from the history', () => {
    setKbPreview({ kbId: 'kb1', role: 'view', ownRole: 'owner' });
    takeKeepChat();
    alignKbPreviewWithChat({ kbId: 'kb1', previewRole: 'view' });
    expect(getKbPreview()?.role).toBe('view');
    expect(takeKeepChat()).toBe(false);

    alignKbPreviewWithChat({ kbId: 'kb1', previewRole: 'edit' });
    expect(getKbPreview()?.role).toBe('edit');
    expect(takeKeepChat()).toBe(true);

    alignKbPreviewWithChat({ kbId: 'kb2', previewRole: null });
    expect(getKbPreview()?.role).toBe('edit');

    alignKbPreviewWithChat({ kbId: 'kb1', previewRole: null });
    expect(getKbPreview()).toBeNull();
    expect(takeKeepChat()).toBe(true);
  });
});

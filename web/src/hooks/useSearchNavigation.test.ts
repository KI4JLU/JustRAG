import { describe, it, expect, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useSearchNavigation } from './useSearchNavigation';
import type { KbCapabilities, KnowledgeBase } from '../types';

vi.mock('axios');

const kb = (capabilities?: KbCapabilities) => ({ id: 'kb-1', name: 'K', capabilities }) as KnowledgeBase;
const caps = (downloadSources: boolean): KbCapabilities => ({
  seeSources: true, addSources: false, downloadSources, seeCitations: true, manageSources: false,
});

// ORACLE: backend contract 2026-10-16 — the source preview loads the file,
// which downloadSources gates. A source hit therefore opens its topic, and
// the preview only where the opened topic grants downloadSources (a backend
// without capabilities: always, as before).
describe('useSearchNavigation.openSource', () => {
  const run = async (opened: KnowledgeBase | null) => {
    const openKbById = vi.fn().mockResolvedValue(opened);
    const previewSource = vi.fn();
    const { result } = renderHook(() => useSearchNavigation({ openKbById, previewSource, selectChat: vi.fn() }));
    await act(async () => { await result.current.openSource({ id: 'f-1', name: 'a.pdf', kbId: 'kb-1' }); });
    return { openKbById, previewSource };
  };

  it('opens the topic and previews the source with downloadSources', async () => {
    const { openKbById, previewSource } = await run(kb(caps(true)));
    expect(openKbById).toHaveBeenCalledWith('kb-1');
    expect(previewSource).toHaveBeenCalledWith('f-1', 'a.pdf');
  });

  it('opens the topic but no preview without downloadSources', async () => {
    const { openKbById, previewSource } = await run(kb(caps(false)));
    expect(openKbById).toHaveBeenCalledWith('kb-1');
    expect(previewSource).not.toHaveBeenCalled();
  });

  it('previews against a backend without capabilities', async () => {
    const { previewSource } = await run(kb());
    expect(previewSource).toHaveBeenCalledWith('f-1', 'a.pdf');
  });

  it('does nothing more when the topic could not be opened', async () => {
    const { previewSource } = await run(null);
    expect(previewSource).not.toHaveBeenCalled();
  });
});

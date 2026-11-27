import { beforeEach, describe, expect, it, vi } from 'vitest';
import axios from 'axios';
import {
  createGlossary,
  deleteGlossary,
  detectLanguage,
  fetchGlossaries,
  fetchSuggestions,
  importGlossary,
  leaveGlossary,
  rephraseText,
  setGlossaryVisibility,
  translateText,
  updateGlossary,
} from './api';
import { loadTranslatorConfig, resetTranslatorConfig, useTranslatorConfig } from './translatorConfig';
import { renderHook, waitFor } from '@testing-library/react';
import { DEFAULT_LIMITS } from './types';

vi.mock('axios');
// The routes without the dev server's origin.
vi.mock('../../api', () => ({ API_BASE_URL: '' }));

// Oracle: API.md "Translator and glossaries" — the route table: method, path and body of every
// call, written out by hand.
beforeEach(() => {
  vi.mocked(axios.get).mockReset();
  vi.mocked(axios.post).mockReset();
  vi.mocked(axios.put).mockReset();
  vi.mocked(axios.patch).mockReset();
  vi.mocked(axios.delete).mockReset();
  resetTranslatorConfig();
});

describe('translator requests', () => {
  it('posts a translation with the sentences, the languages and the settings, and passes the abort signal', async () => {
    vi.mocked(axios.post).mockResolvedValue({ data: { text: ['Hello. '], detectedSource: 'de' } });
    const signal = new AbortController().signal;
    const body = {
      text: ['Hallo. '],
      source: null,
      target: 'en-gb' as const,
      formality: 'formal' as const,
      style: null,
      tone: null,
      glossaryIds: ['g1'],
    };
    const answer = await translateText(body, signal);
    expect(axios.post).toHaveBeenCalledWith('/api/translator/translate', body, { signal });
    expect(answer.text).toEqual(['Hello. ']);
  });

  it('posts a rewrite, a suggestion request and a detection', async () => {
    vi.mocked(axios.post).mockResolvedValue({ data: { text: [], suggestions: ['a', 'b'], language: 'de' } });
    await rephraseText({ text: ['Hi'], language: 'en-gb' });
    expect(vi.mocked(axios.post).mock.calls[0][0]).toBe('/api/translator/rephrase');
    expect(await fetchSuggestions({ kind: 'alternatives', text: 'Hi' })).toEqual(['a', 'b']);
    expect(vi.mocked(axios.post).mock.calls[1][0]).toBe('/api/translator/suggest');
    expect(await detectLanguage({ text: 'Guten Tag' })).toBe('de');
    expect(vi.mocked(axios.post).mock.calls[2]).toEqual([
      '/api/translator/detect',
      { text: 'Guten Tag' },
      { signal: undefined },
    ]);
  });

  it('reads a detected language the translator does not offer as none', async () => {
    vi.mocked(axios.post).mockResolvedValue({ data: { language: 'tlh' } });
    expect(await detectLanguage({ text: 'nuqneH' })).toBeNull();
    vi.mocked(axios.post).mockResolvedValue({ data: { language: null } });
    expect(await detectLanguage({ text: '???' })).toBeNull();
  });
});

describe('glossary requests', () => {
  it('lists, creates, changes, deletes and leaves through the glossary routes', async () => {
    vi.mocked(axios.get).mockResolvedValue({ data: { glossaries: [{ id: 'g1' }], languages: ['de', 'en'] } });
    expect(await fetchGlossaries()).toEqual({ glossaries: [{ id: 'g1' }], languages: ['de', 'en'] });
    expect(vi.mocked(axios.get).mock.calls[0][0]).toBe('/api/glossaries');

    vi.mocked(axios.post).mockResolvedValue({ data: { id: 'g2' } });
    const entries = [
      {
        sourceLanguage: 'de' as const,
        sourceTerm: 'Hochschule',
        targetLanguage: 'en' as const,
        targetTerm: 'university',
      },
    ];
    await createGlossary({ name: 'Uni', description: '', category: '', visibility: 'private', entries });
    expect(vi.mocked(axios.post).mock.calls[0]).toEqual([
      '/api/glossaries',
      { name: 'Uni', description: '', category: '', visibility: 'private', entries },
    ]);

    vi.mocked(axios.put).mockResolvedValue({ data: { id: 'g2' } });
    await updateGlossary('g2', { name: 'Uni', description: 'd', category: 'c', entries });
    expect(vi.mocked(axios.put).mock.calls[0][0]).toBe('/api/glossaries/g2');

    vi.mocked(axios.patch).mockResolvedValue({ status: 204 });
    await setGlossaryVisibility('g2', 'global');
    expect(vi.mocked(axios.patch).mock.calls[0]).toEqual(['/api/glossaries/g2', { visibility: 'global' }]);

    vi.mocked(axios.delete).mockResolvedValue({ status: 204 });
    await deleteGlossary('g2');
    await leaveGlossary('g3');
    expect(vi.mocked(axios.delete).mock.calls.map((c) => c[0])).toEqual([
      '/api/glossaries/g2',
      '/api/glossaries/g3/membership',
    ]);
  });

  it('imports a CSV as multipart: file, name, description and both languages', async () => {
    vi.mocked(axios.post).mockResolvedValue({ data: { id: 'g4' } });
    const file = new File(['Hochschule;university\n'], 'terms.csv', { type: 'text/csv' });
    await importGlossary({ file, name: 'Terms', description: 'about', sourceLanguage: 'de', targetLanguage: 'en' });
    const [url, form] = vi.mocked(axios.post).mock.calls[0] as [string, FormData];
    expect(url).toBe('/api/glossaries/import');
    expect(Object.fromEntries([...form.entries()].filter(([k]) => k !== 'file'))).toEqual({
      name: 'Terms',
      description: 'about',
      sourceLanguage: 'de',
      targetLanguage: 'en',
    });
    expect((form.get('file') as File).name).toBe('terms.csv');
  });
});

describe('translator config', () => {
  const config = {
    enabled: true,
    defaultTargetLanguage: 'de',
    languages: [],
    glossaryLanguages: [],
    model: 'm',
    modelSource: 'fastTier',
    limits: { textMax: 100 },
  };

  it('is read once and shared, with the contract’s limits filled in where the server leaves them out', async () => {
    vi.mocked(axios.get).mockResolvedValue({ data: config });
    const first = renderHook(() => useTranslatorConfig());
    const second = renderHook(() => useTranslatorConfig());
    await waitFor(() => expect(first.result.current.status).toBe('ready'));
    expect(second.result.current.status).toBe('ready');
    expect(axios.get).toHaveBeenCalledTimes(1);
    expect(vi.mocked(axios.get).mock.calls[0][0]).toBe('/api/translator/config');
    expect(first.result.current.config?.limits).toEqual({ ...DEFAULT_LIMITS, textMax: 100 });
  });

  it('is unavailable when the read fails (a role without the permission gets 403)', async () => {
    vi.mocked(axios.get).mockRejectedValue(new Error('403'));
    const { result } = renderHook(() => useTranslatorConfig());
    await waitFor(() => expect(result.current.status).toBe('unavailable'));
    expect(result.current.config).toBeNull();
  });

  it('reads again on demand', async () => {
    vi.mocked(axios.get).mockResolvedValue({ data: { ...config, enabled: false } });
    await loadTranslatorConfig();
    vi.mocked(axios.get).mockResolvedValue({ data: config });
    await loadTranslatorConfig(true);
    const { result } = renderHook(() => useTranslatorConfig());
    expect(result.current.config?.enabled).toBe(true);
  });
});

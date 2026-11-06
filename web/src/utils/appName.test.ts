import { describe, expect, it } from 'vitest';
import { appNameFrom, applyAppNameToDocument, DEFAULT_APP_NAME, rememberAppName, siteConfigSeed, siteConfigSeedFromDocument } from './appName';

// Oracle: the server's contract in go-backend/internal/siteconfig and
// kbbehavior.ReadNames — the admin's institution_name / system_name, else the
// environment's app_name_prefix / app_name_product, else JLU / RAG.
describe('appNameFrom', () => {
  it('reads both parts from the site config', () => {
    expect(appNameFrom({ app_name_prefix: 'THM', app_name_product: 'Docs' })).toEqual({ prefix: 'THM', product: 'Docs' });
  });

  it('falls back per part while the site config is missing or blank', () => {
    expect(appNameFrom(undefined)).toEqual(DEFAULT_APP_NAME);
    expect(appNameFrom({})).toEqual({ prefix: 'JLU', product: 'RAG' });
    expect(appNameFrom({ app_name_prefix: '  ', app_name_product: 'Wissen' })).toEqual({ prefix: 'JLU', product: 'Wissen' });
  });

  it('takes the admin\'s names over the environment, per part', () => {
    const env = { app_name_prefix: 'JLU', app_name_product: 'RAG' };
    expect(appNameFrom({ ...env, institution_name: 'TUM', system_name: 'Wissen' })).toEqual({ prefix: 'TUM', product: 'Wissen' });
    expect(appNameFrom({ ...env, institution_name: ' ', system_name: 'Wissen' })).toEqual({ prefix: 'JLU', product: 'Wissen' });
  });

  it('ignores a leftover uploaded logo', () => {
    expect(appNameFrom({ logo_path: '/uploads/logo/logo_1.png' })).toEqual(DEFAULT_APP_NAME);
  });
});

describe('applyAppNameToDocument', () => {
  it('sets the window title and the description to the app name', () => {
    const doc = document.implementation.createHTMLDocument('JLU RAG');
    const meta = doc.createElement('meta');
    meta.setAttribute('name', 'description');
    meta.setAttribute('content', 'JLU RAG - Advanced Knowledge Retrieval System');
    doc.head.appendChild(meta);

    applyAppNameToDocument({ prefix: 'THM', product: 'Docs' }, doc);

    expect(doc.title).toBe('THM Docs');
    expect(meta.getAttribute('content')).toBe('THM Docs - Advanced Knowledge Retrieval System');
  });
});

describe('siteConfigSeedFromDocument', () => {
  const docWith = (metas: Record<string, string>) => {
    const doc = document.implementation.createHTMLDocument('JLU RAG');
    for (const [name, content] of Object.entries(metas)) {
      const meta = doc.createElement('meta');
      meta.setAttribute('name', name);
      meta.setAttribute('content', content);
      doc.head.appendChild(meta);
    }
    return doc;
  };

  it('reads the name the server wrote into the page', () => {
    const doc = docWith({ 'app-name-prefix': ' THM ', 'app-name-product': 'Docs' });
    expect(siteConfigSeedFromDocument(doc)).toEqual({ app_name_prefix: 'THM', app_name_product: 'Docs' });
  });

  it('carries nothing for a page without the name, or with blank parts', () => {
    expect(siteConfigSeedFromDocument(docWith({}))).toEqual({});
    expect(siteConfigSeedFromDocument(docWith({ 'app-name-prefix': '  ', 'app-name-product': 'Docs' })))
      .toEqual({ app_name_product: 'Docs' });
  });
});

describe('siteConfigSeed', () => {
  const memory = (): Storage => {
    const data = new Map<string, string>();
    return {
      get length() { return data.size; },
      clear: () => data.clear(),
      getItem: (k: string) => data.get(k) ?? null,
      key: (i: number) => Array.from(data.keys())[i] ?? null,
      removeItem: (k: string) => { data.delete(k); },
      setItem: (k: string, v: string) => { data.set(k, v); },
    } as Storage;
  };
  const shell = () => {
    const doc = document.implementation.createHTMLDocument('JLU RAG');
    for (const [name, content] of [['app-name-prefix', 'JLU'], ['app-name-product', 'RAG']]) {
      const meta = doc.createElement('meta');
      meta.setAttribute('name', name);
      meta.setAttribute('content', content);
      doc.head.appendChild(meta);
    }
    return doc;
  };

  it('starts a page from the network with the shell the server rendered', () => {
    const storage = memory();
    rememberAppName({ prefix: 'TUM', product: 'Wissen' }, storage);
    expect(siteConfigSeed(shell(), false, storage)).toEqual({ app_name_prefix: 'JLU', app_name_product: 'RAG' });
  });

  it('starts a precached page with the name this browser saw last', () => {
    const storage = memory();
    rememberAppName({ prefix: 'TUM', product: 'Wissen' }, storage);
    expect(siteConfigSeed(shell(), true, storage)).toEqual({ app_name_prefix: 'TUM', app_name_product: 'Wissen' });
  });

  it('falls back to the shell without a usable remembered name', () => {
    const storage = memory();
    expect(siteConfigSeed(shell(), true, storage)).toEqual({ app_name_prefix: 'JLU', app_name_product: 'RAG' });
    storage.setItem('justrag.appName', '{"prefix":"","product":"x"}');
    expect(siteConfigSeed(shell(), true, storage)).toEqual({ app_name_prefix: 'JLU', app_name_product: 'RAG' });
    storage.setItem('justrag.appName', 'not json');
    expect(siteConfigSeed(shell(), true, storage)).toEqual({ app_name_prefix: 'JLU', app_name_product: 'RAG' });
    expect(siteConfigSeed(shell(), true, null)).toEqual({ app_name_prefix: 'JLU', app_name_product: 'RAG' });
  });

  it('ignores a storage that throws', () => {
    const broken = { setItem: () => { throw new Error('quota'); }, getItem: () => { throw new Error('denied'); } } as unknown as Storage;
    expect(() => rememberAppName({ prefix: 'TUM', product: 'Wissen' }, broken)).not.toThrow();
    expect(siteConfigSeed(shell(), true, broken)).toEqual({ app_name_prefix: 'JLU', app_name_product: 'RAG' });
  });
});

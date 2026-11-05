import { describe, expect, it } from 'vitest';
import { appNameConfigsFromDocument, appNameFrom, appNameText, applyAppNameToDocument, DEFAULT_APP_NAME } from './appName';

// Oracle: the server's contract in go-backend/internal/siteconfig — the app
// name arrives as app_name_prefix / app_name_product, defaulting to JLU / RAG.
describe('appNameFrom', () => {
  it('reads both parts from the site config', () => {
    expect(appNameFrom({ app_name_prefix: 'THM', app_name_product: 'Docs' })).toEqual({ prefix: 'THM', product: 'Docs' });
  });

  it('falls back per part while the site config is missing or blank', () => {
    expect(appNameFrom(undefined)).toEqual(DEFAULT_APP_NAME);
    expect(appNameFrom({})).toEqual({ prefix: 'JLU', product: 'RAG' });
    expect(appNameFrom({ app_name_prefix: '  ', app_name_product: 'Wissen' })).toEqual({ prefix: 'JLU', product: 'Wissen' });
  });

  it('ignores a leftover uploaded logo', () => {
    expect(appNameFrom({ logo_path: '/uploads/logo/logo_1.png' })).toEqual(DEFAULT_APP_NAME);
  });
});

describe('applyAppNameToDocument', () => {
  it('sets the window title and the description to the configured name', () => {
    const doc = document.implementation.createHTMLDocument('JLU RAG');
    const meta = doc.createElement('meta');
    meta.setAttribute('name', 'description');
    meta.setAttribute('content', 'JLU RAG - Advanced Knowledge Retrieval System');
    doc.head.appendChild(meta);

    applyAppNameToDocument({ prefix: 'THM', product: 'Docs' }, doc);

    expect(doc.title).toBe('THM Docs');
    expect(meta.getAttribute('content')).toBe('THM Docs - Advanced Knowledge Retrieval System');
    expect(appNameText({ prefix: 'THM', product: 'Docs' })).toBe(doc.title);
  });
});

describe('appNameConfigsFromDocument', () => {
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
    expect(appNameConfigsFromDocument(doc)).toEqual({ app_name_prefix: 'THM', app_name_product: 'Docs' });
  });

  it('carries nothing for a page without the name, or with blank parts', () => {
    expect(appNameConfigsFromDocument(docWith({}))).toEqual({});
    expect(appNameConfigsFromDocument(docWith({ 'app-name-prefix': '  ', 'app-name-product': 'Docs' })))
      .toEqual({ app_name_product: 'Docs' });
  });
});

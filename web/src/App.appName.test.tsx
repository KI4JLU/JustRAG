import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { render, screen } from '@testing-library/react';
import axios from 'axios';
import { stubViewport } from './test/viewport';
import App from './App';

/* The first frame names the app the server wrote into the page — not the
   default — while GET /api/site-config is still in flight.
   Oracle: the meta contract of go-backend/internal/app/app_shell.go
   (app-name-prefix / app-name-product / system-name). Only the network is
   stubbed. */

vi.mock('axios', () => ({
  default: {
    get: vi.fn(),
    post: vi.fn(),
    defaults: { headers: { common: {} as Record<string, string> } },
    interceptors: { response: { use: vi.fn(() => 1), eject: vi.fn() } },
  },
}));

const mockedGet = axios.get as unknown as Mock;

function memoryStorage(): Storage {
  const data = new Map<string, string>();
  return {
    get length() { return data.size; },
    clear: () => data.clear(),
    getItem: (k: string) => data.get(k) ?? null,
    key: (i: number) => Array.from(data.keys())[i] ?? null,
    removeItem: (k: string) => { data.delete(k); },
    setItem: (k: string, v: string) => { data.set(k, v); },
  } as Storage;
}

const metas: HTMLMetaElement[] = [];
function writeAppNameIntoPage(prefix: string, product: string, system = `${prefix} ${product}`) {
  for (const [name, content] of [['app-name-prefix', prefix], ['app-name-product', product], ['system-name', system]]) {
    const meta = document.createElement('meta');
    meta.setAttribute('name', name);
    meta.setAttribute('content', content);
    document.head.appendChild(meta);
    metas.push(meta);
  }
}

beforeEach(() => {
  vi.clearAllMocks();
  stubViewport();
  vi.stubGlobal('localStorage', memoryStorage());
  window.history.replaceState(null, '', '/');
  mockedGet.mockImplementation((url: string) => {
    // The site config never answers: everything shown comes from the page.
    if (url.endsWith('/api/site-config')) return new Promise(() => {});
    if (url.endsWith('/api/auth/providers')) {
      return Promise.resolve({ data: { providers: [], localAuthEnabled: true } });
    }
    return Promise.reject(new Error(`unexpected GET ${url}`));
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  metas.splice(0).forEach(m => m.remove());
});

describe('App — app name before the site config answers', () => {
  it('shows the name the server wrote into the page', async () => {
    writeAppNameIntoPage('THM', 'Docs');

    render(<App />);

    expect(await screen.findByText('Docs')).toBeInTheDocument();
    expect(screen.getByText('THM')).toBeInTheDocument();
    expect(screen.queryByText('RAG')).not.toBeInTheDocument();
    expect(document.title).toBe('THM Docs');
  });

  it('titles the tab with the system name and keeps the wordmark', async () => {
    writeAppNameIntoPage('THM', 'Docs', 'KI-Assistent');

    render(<App />);

    expect(await screen.findByText('Docs')).toBeInTheDocument();
    expect(screen.getByText('THM')).toBeInTheDocument();
    expect(document.title).toBe('KI-Assistent');
  });

  it('shows the default name for a page without one', async () => {
    render(<App />);

    expect(await screen.findByText('RAG')).toBeInTheDocument();
    expect(screen.getByText('JLU')).toBeInTheDocument();
  });
});

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import axios from 'axios';
import { TranslatorView } from './TranslatorView';
import { resetTranslatorConfig } from '../components/translator/translatorConfig';
import { SESSION_KEY, type TranslatorApi } from '../components/translator/translatorStore';
import type { RephraseRequest, TranslateRequest } from '../components/translator/types';

vi.mock('axios');
vi.mock('../api', () => ({ API_BASE_URL: '' }));
vi.mock('../hooks/useReducedMotion', () => ({ useReducedMotion: () => false, getMotionProps: () => ({}) }));
// The shell is the subject of its own tests; here the page is.
vi.mock('../components/shell/AppChrome', () => ({
  AppChrome: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
const themeMock = { t: (k: string) => k, language: 'en' as const };
vi.mock('../contexts/ThemeContext', () => ({ useTheme: () => themeMock }));
const authMock = { token: 'tok', user: { id: 'user-1', username: 'grace', role: 'user' } };
vi.mock('../contexts/AuthContext', () => ({ useAuth: () => authMock }));
const toastMock = { success: vi.fn(), error: vi.fn(), warning: vi.fn() };
vi.mock('../contexts/ToastContext', () => ({ useToast: () => toastMock }));
vi.mock('../contexts/ModalContext', () => ({ useModalContext: () => ({ showConfirm: vi.fn() }) }));

/*
 * The translator page. ORACLE: docs/api-contracts/translator.md — the page shows while
 * `config.enabled` and says so when it is off; a text travels as its sentences, each with the
 * whitespace that follows it, and the answer has one string per sentence; the limits come from
 * `config.limits`. The request bodies are written out by hand.
 */
const CONFIG = {
  enabled: true,
  defaultTargetLanguage: 'de',
  languages: [
    { code: 'de', name: 'German' },
    { code: 'en-gb', name: 'English (UK)' },
  ],
  glossaryLanguages: ['de', 'en'],
  model: 'm',
  modelSource: 'fastTier',
  limits: {
    textMax: 50000,
    segmentsMax: 5000,
    detectSampleMax: 500,
    suggestTextMax: 2000,
    glossariesPerRequestMax: 20,
    glossaryImportMaxBytes: 5242880,
  },
};

class MemoryStorage implements Storage {
  private data = new Map<string, string>();
  get length() {
    return this.data.size;
  }
  clear() {
    this.data.clear();
  }
  getItem(k: string) {
    return this.data.get(k) ?? null;
  }
  key(i: number) {
    return Array.from(this.data.keys())[i] ?? null;
  }
  removeItem(k: string) {
    this.data.delete(k);
  }
  setItem(k: string, v: string) {
    this.data.set(k, v);
  }
}

function answer(config: Record<string, unknown> | Error, glossaries: unknown[] = []) {
  vi.mocked(axios.get).mockImplementation(async (url: string) => {
    if (url.endsWith('/api/translator/config')) {
      if (config instanceof Error) throw config;
      return { data: config };
    }
    if (url.endsWith('/api/glossaries')) return { data: { glossaries, languages: ['de', 'en'] } };
    return { data: {} };
  });
}

function makeApi() {
  const api: TranslatorApi = {
    translate: vi.fn(async (request: TranslateRequest) => ({
      text: request.text.map((sentence) => `EN:${sentence.trim()} `),
      detectedSource: 'de' as const,
    })),
    rephrase: vi.fn(async (request: RephraseRequest) => ({
      text: request.text.map((s) => s.toUpperCase()),
      detectedLanguage: 'de' as const,
    })),
    detect: vi.fn(async () => 'de' as const),
    suggest: vi.fn(async () => []),
  };
  return api;
}

beforeEach(() => {
  vi.mocked(axios.get).mockReset();
  resetTranslatorConfig();
  Object.defineProperty(window, 'sessionStorage', { value: new MemoryStorage(), configurable: true, writable: true });
  Element.prototype.scrollIntoView = vi.fn();
  Element.prototype.hasPointerCapture = vi.fn(() => false);
  Element.prototype.setPointerCapture = vi.fn();
  Element.prototype.releasePointerCapture = vi.fn();
});

/** How long a wait may take on a busy machine, and a test that clicks through several views. */
const SLOW = 10_000;
const TEST_TIMEOUT = 25_000;

describe('TranslatorView', () => {
  it('says so when the extension is off, and shows no text board', async () => {
    answer({ ...CONFIG, enabled: false });
    render(<TranslatorView api={makeApi()} />);
    expect(await screen.findByText('translatorDisabled')).toBeInTheDocument();
    expect(screen.queryByRole('textbox')).toBeNull();
  });

  it('says so when the config cannot be read (a role without the permission)', async () => {
    answer(new Error('403'));
    render(<TranslatorView api={makeApi()} />);
    expect(await screen.findByText('translatorUnavailable')).toBeInTheDocument();
  });

  it('offers both modes by their names and starts in translating, into the admin’s default language', async () => {
    answer({ ...CONFIG, defaultTargetLanguage: 'fr' });
    render(<TranslatorView api={makeApi()} />);
    const mode = await screen.findByRole('group', { name: 'translatorMode' });
    expect(mode).toHaveTextContent('translatorModeTranslate');
    expect(mode).toHaveTextContent('translatorModeRephrase');
    expect(screen.getByRole('button', { name: 'translatorModeTranslate' })).toHaveAttribute('aria-pressed', 'true');
    // The target language button names the language the admin set as the default.
    expect(await screen.findByRole('button', { name: /translatorTarget: translatorLang_fr/ })).toBeInTheDocument();
  });

  it('translates a text sentence by sentence and shows the answer', async () => {
    answer(CONFIG);
    const api = makeApi();
    render(<TranslatorView api={api} />);
    const source = await screen.findByLabelText('translatorText');
    await userEvent.type(source, 'Guten Morgen. Bis bald.');
    await userEvent.click(screen.getByRole('button', { name: 'translatorTranslate' }));

    await waitFor(() => expect(api.translate).toHaveBeenCalledTimes(1));
    const request = vi.mocked(api.translate).mock.calls[0][0];
    expect(request.text).toEqual(['Guten Morgen. ', 'Bis bald.']);
    // The text is detected as German, the admin's default target is German too: source and target
    // never match, so the target is British English.
    expect(request.source).toBe('de');
    expect(request.target).toBe('en-gb');
    expect(request.glossaryIds).toEqual([]);
    await waitFor(() =>
      expect(screen.getByRole('textbox', { name: 'translatorResult' })).toHaveTextContent(
        'EN:Guten Morgen. EN:Bis bald.',
      ),
    );
    // Nothing changed since: the button is off until the text or a setting does.
    expect(screen.getByRole('button', { name: 'translatorTranslate' })).toBeDisabled();
  });

  it('keeps the text in the tab’s session', async () => {
    answer(CONFIG);
    render(<TranslatorView api={makeApi()} />);
    await userEvent.type(await screen.findByLabelText('translatorText'), 'Hallo');
    const stored = JSON.parse(window.sessionStorage.getItem(SESSION_KEY) ?? '{}');
    expect(stored.translate.source).toBe('Hallo');
  });

  it('stores the session with its user, and takes it back for that user', async () => {
    answer(CONFIG);
    const first = render(<TranslatorView api={makeApi()} />);
    await userEvent.type(await screen.findByLabelText('translatorText'), 'Hallo');
    expect(JSON.parse(window.sessionStorage.getItem(SESSION_KEY) ?? '{}').userId).toBe('user-1');
    first.unmount();

    render(<TranslatorView api={makeApi()} />);
    expect(await screen.findByLabelText('translatorText')).toHaveValue('Hallo');
  });

  it('shows nobody the text of another user left in the tab, and deletes it', async () => {
    answer(CONFIG);
    window.sessionStorage.setItem(
      SESSION_KEY,
      JSON.stringify({ version: 2, userId: 'someone-else', mode: 'translate', translate: { source: 'Vertraulich' } }),
    );
    render(<TranslatorView api={makeApi()} />);
    expect(await screen.findByLabelText('translatorText')).toHaveValue('');
    expect(window.sessionStorage.getItem(SESSION_KEY)).toBeNull();
    expect(screen.queryByDisplayValue('Vertraulich')).toBeNull();
  });

  it('does not write the session back when an answer arrives after sign-out and the page is gone', async () => {
    answer(CONFIG);
    let release!: () => void;
    const api = makeApi();
    vi.mocked(api.translate).mockImplementation(
      (request: TranslateRequest) =>
        new Promise((resolve) => {
          release = () => resolve({ text: request.text.map((sentence) => `EN:${sentence}`), detectedSource: 'de' });
        }),
    );
    const view = render(<TranslatorView api={api} />);
    await userEvent.type(await screen.findByLabelText('translatorText'), 'Hallo Welt.');
    await userEvent.click(screen.getByRole('button', { name: 'translatorTranslate' }));
    await waitFor(() => expect(api.translate).toHaveBeenCalledTimes(1));

    // Signing out clears the tab's session, and the signed-in tree goes away with the request still open.
    window.sessionStorage.removeItem(SESSION_KEY);
    view.unmount();
    release();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(window.sessionStorage.getItem(SESSION_KEY)).toBeNull();
  });

  it('turns the swap button off while a translation is on its way', async () => {
    answer(CONFIG);
    let release!: () => void;
    const api = makeApi();
    vi.mocked(api.translate).mockImplementation(
      (request: TranslateRequest) =>
        new Promise((resolve) => {
          release = () => resolve({ text: request.text.map((sentence) => `EN:${sentence}`), detectedSource: 'de' });
        }),
    );
    render(<TranslatorView api={api} />);
    await userEvent.type(await screen.findByLabelText('translatorText'), 'Hallo Welt.');
    expect(screen.getByRole('button', { name: 'translatorSwap' })).toBeEnabled();
    await userEvent.click(screen.getByRole('button', { name: 'translatorTranslate' }));
    await waitFor(() => expect(api.translate).toHaveBeenCalledTimes(1));
    expect(screen.getByRole('button', { name: 'translatorSwap' })).toBeDisabled();
    release();
    await waitFor(() => expect(screen.getByRole('button', { name: 'translatorSwap' })).toBeEnabled());
  });

  it('shows a failed glossary list with a retry, and the dialog opens its buttons once it worked', async () => {
    let failing = true;
    vi.mocked(axios.get).mockImplementation(async (url: string) => {
      if (url.endsWith('/api/translator/config')) return { data: CONFIG };
      if (url.endsWith('/api/glossaries')) {
        if (failing) throw new Error('503');
        return { data: { glossaries: [], languages: ['de', 'en'] } };
      }
      return { data: {} };
    });
    render(<TranslatorView api={makeApi()} />);
    await userEvent.click(await screen.findByRole('button', { name: /translatorGlossariesTitle/ }, { timeout: SLOW }));
    expect(await screen.findByText('translatorGlossariesLoadFailed', undefined, { timeout: SLOW })).toBeInTheDocument();
    expect(screen.queryByRole('status')).toBeNull();

    failing = false;
    await userEvent.click(screen.getByRole('button', { name: 'translatorGlossariesRetry' }));
    await waitFor(() => expect(screen.queryByText('translatorGlossariesLoadFailed')).toBeNull(), { timeout: SLOW });
  }, TEST_TIMEOUT);

  it('switches to rewriting, which has its own text and sends a rephrase request', async () => {
    answer(CONFIG);
    const api = makeApi();
    render(<TranslatorView api={api} />);
    await userEvent.click(await screen.findByRole('button', { name: 'translatorModeRephrase' }));
    const source = await screen.findByLabelText('translatorRephraseText');
    await userEvent.type(source, 'Das ist gut.');
    await userEvent.click(screen.getByRole('button', { name: 'translatorRephrase' }));
    await waitFor(() => expect(api.rephrase).toHaveBeenCalledTimes(1));
    expect(vi.mocked(api.rephrase).mock.calls[0][0]).toMatchObject({ text: ['Das ist gut.'], style: null, tone: null });
  });

  it('shows a refused request’s message, not the server’s text', async () => {
    answer(CONFIG);
    const api = makeApi();
    vi.mocked(api.translate).mockRejectedValue(
      Object.assign(new Error('x'), {
        isAxiosError: true,
        response: { status: 502, data: { error: 'upstream blew up', code: 'translator_model_failed' } },
      }),
    );
    vi.mocked(axios.isAxiosError).mockImplementation((e: unknown) => !!(e as { isAxiosError?: boolean })?.isAxiosError);
    render(<TranslatorView api={api} />);
    await userEvent.type(await screen.findByLabelText('translatorText'), 'Hallo Welt.');
    await userEvent.click(screen.getByRole('button', { name: 'translatorTranslate' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('errorTranslatorModelFailed');
    expect(screen.queryByText('upstream blew up')).toBeNull();
  });

  it('lists the user’s glossaries in the settings and sends the chosen ones', async () => {
    answer(CONFIG, [
      {
        id: 'g1',
        name: 'Hochschule',
        description: '',
        category: 'general',
        visibility: 'private',
        entryCount: 4,
        creatorName: 'Ada',
        role: 'viewer',
        isMember: false,
        canEdit: false,
        canManage: false,
        canDelete: false,
        createdAt: '',
        updatedAt: '',
      },
    ]);
    const api = makeApi();
    render(<TranslatorView api={api} />);
    // The page and the list load one after the other, and this test clicks through four views:
    // on a busy machine (the whole suite in parallel, a compile beside it) that outlasts the
    // default 5 s of a test, so the waits and the test itself get room.
    await userEvent.click(await screen.findByRole('button', { name: /translatorGlossariesTitle/ }, { timeout: SLOW }));
    await userEvent.click(await screen.findByRole('checkbox', { name: /Hochschule/ }, { timeout: SLOW }));
    await userEvent.click(screen.getByRole('button', { name: /translatorBack/ }));
    // Back hands the focus to the button that opened the view, one frame later; typing before that
    // would lose its focus half-way through the word.
    await waitFor(() => expect(screen.getByRole('button', { name: /translatorGlossariesTitle/ })).toHaveFocus(), { timeout: SLOW });
    await userEvent.type(screen.getByLabelText('translatorText'), 'Hallo.');
    await userEvent.click(screen.getByRole('button', { name: 'translatorTranslate' }));
    await waitFor(() => expect(api.translate).toHaveBeenCalled(), { timeout: SLOW });
    expect(vi.mocked(api.translate).mock.calls[0][0].glossaryIds).toEqual(['g1']);
  }, TEST_TIMEOUT);
});

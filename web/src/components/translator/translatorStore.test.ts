import { describe, expect, it, vi } from 'vitest';
import { TextLimitError } from './languages';
import {
  parseSession,
  SESSION_KEY,
  TranslatorStore,
  type TranslatorApi,
  type TranslatorClock,
} from './translatorStore';
import {
  DEFAULT_LIMITS,
  type RephraseRequest,
  type TranslateRequest,
  type TranslateResponse,
  type TranslatorLanguage,
} from './types';

/** The signed-in user a session belongs to. */
const USER = 'user-1';

/** What the page tells the store once the config and the glossaries are known. */
const context = { glossaryIds: [] as string[], limits: DEFAULT_LIMITS };

/** Timers run by hand, so the store's pauses are instant and ordered. */
function manualClock(): TranslatorClock & { run: () => void } {
  let timers: Array<{ callback: () => void; handle: number }> = [];
  let next = 0;
  return {
    setTimeout: (callback) => {
      const handle = ++next;
      timers.push({ callback, handle });
      return handle;
    },
    clearTimeout: (handle) => {
      timers = timers.filter((timer) => timer.handle !== handle);
    },
    run: () => {
      const due = timers;
      timers = [];
      for (const timer of due) timer.callback();
    },
  };
}

function setup(overrides: Partial<TranslatorApi> = {}) {
  const api: TranslatorApi = {
    translate: vi.fn(async (request: TranslateRequest) => ({
      text: request.text.map((sentence) => `EN:${sentence.trim()}`),
      detectedSource: null,
    })),
    rephrase: vi.fn(async (request: RephraseRequest) => ({
      text: request.text.map((sentence) => sentence.toUpperCase()),
      detectedLanguage: null,
    })),
    detect: vi.fn(async () => 'de' as const),
    suggest: vi.fn(async () => ['Andere Formulierung.']),
    ...overrides,
  };
  const storage = { setItem: vi.fn() };
  const clock = manualClock();
  const store = new TranslatorStore(api, parseSession(null, 'en-gb'), storage, USER, clock);
  store.setContext(context);
  return { store, api, storage, clock };
}

const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

// Oracle: docs/api-contracts/translator.md — a text travels as its sentences, each with the
// whitespace that follows it, and the answer has one string per sentence; the request carries
// formality, at most one of style and tone, and the glossary ids. The expected bodies are written
// out by hand.
describe('TranslatorStore', () => {
  it('starts with Automatisch → the default target language and the session defaults', () => {
    const { store } = setup();
    const state = store.getState();
    expect(state.mode).toBe('translate');
    expect(state.translate.sourceLang).toBe('auto');
    expect(state.translate.targetLang).toBe('en-gb');
    expect(state.live).toBe(false);
  });

  it('detects the language of a longer text after a pause, unless the user chose one', async () => {
    const { store, api, clock } = setup();
    store.setSource('Das ist ein deutscher Text mit genug Zeichen.');
    clock.run();
    await flush();
    // The sample is the first 50 characters, as the contract allows up to 500.
    expect(api.detect).toHaveBeenCalledWith({ text: 'Das ist ein deutscher Text mit genug Zeichen.' });
    expect(store.getState().translate.sourceLang).toBe('de');

    store.setSourceLang('fr');
    store.setSource('Das ist ein anderer deutscher Text, lang genug.');
    clock.run();
    await flush();
    expect(store.getState().translate.sourceLang).toBe('fr');
  });

  it('never lets source and target match', () => {
    const { store } = setup();
    store.setSourceLang('en-gb');
    expect(store.getState().translate.targetLang).toBe('de');
    store.setTargetLang('en-gb');
    expect(store.getState().translate.sourceLang).toBe('auto');
  });

  it('sends the text sentence by sentence and then keeps the button off until something changes', async () => {
    const { store, api } = setup();
    store.setSource('Guten Morgen. Bis bald.');
    expect(store.hasChanges).toBe(true);
    await store.run();
    const request = vi.mocked(api.translate).mock.calls[0]![0];
    expect(request).toEqual({
      text: ['Guten Morgen. ', 'Bis bald.'],
      source: 'de',
      target: 'en-gb',
      formality: 'default',
      style: null,
      tone: null,
      glossaryIds: [],
    });
    expect(store.targetText).toBe('EN:Guten Morgen. EN:Bis bald.');
    expect(store.hasChanges).toBe(false);
    store.selectFormality('formal');
    expect(store.hasChanges).toBe(true);
  });

  it('sends the chosen glossaries, and at most as many as one request takes', async () => {
    const { store, api } = setup();
    const ids = Array.from({ length: 25 }, (_, i) => `g${i}`);
    store.setContext({ glossaryIds: ids, limits: DEFAULT_LIMITS });
    store.setGlossaries(ids);
    expect(store.getState().glossaryIds).toHaveLength(20);
    store.setSource('Hallo Welt.');
    await store.run();
    expect(vi.mocked(api.translate).mock.calls[0]![0].glossaryIds).toEqual(ids.slice(0, 20));
  });

  it('sends a rewrite with its language, the style and no tone', async () => {
    const { store, api } = setup();
    store.switchMode('rephrase');
    store.setSourceLang('de');
    store.selectStyle('academic');
    store.setSource('Das ist gut.');
    await store.run();
    expect(vi.mocked(api.rephrase).mock.calls[0]![0]).toEqual({
      text: ['Das ist gut.'],
      language: 'de',
      formality: 'default',
      style: 'academic',
      tone: null,
      glossaryIds: [],
    });
    expect(store.targetText).toBe('DAS IST GUT.');
  });

  it('redoes only the changed sentence and keeps the user’s edit of the others', async () => {
    const { store, api } = setup();
    store.setSource('Eins. Zwei. Drei.');
    await store.run();
    store.setTarget('Mein eins. EN:Zwei. EN:Drei.');
    store.setSource('Eins. Zwei neu. Drei.');
    await store.run();
    expect(vi.mocked(api.translate)).toHaveBeenCalledTimes(2);
    // Only the changed sentence goes out: the rest of the 60 requests a minute is not spent on it.
    expect(vi.mocked(api.translate).mock.calls[1]![0].text).toEqual(['Zwei neu. ']);
    expect(store.targetText).toBe('Mein eins. EN:Zwei neu. EN:Drei.');
  });

  it('refuses a text over the limits before sending anything', async () => {
    const { store, api } = setup();
    store.setContext({ glossaryIds: [], limits: { ...DEFAULT_LIMITS, textMax: 20, segmentsMax: 2 } });
    store.setSource('Das ist ein sehr langer Text, der nicht passt.');
    await store.run();
    expect(store.getState().error).toEqual(new TextLimitError('text'));
    store.setSource('A. B. C.');
    await store.run();
    expect((store.getState().error as TextLimitError).limit).toBe('sentences');
    expect(api.translate).not.toHaveBeenCalled();
    expect(store.getState().loading).toBe(false);
  });

  it('lets style, tone and formality exclude each other', () => {
    const { store } = setup();
    store.selectStyle('academic');
    store.selectTone('friendly');
    expect(store.getState()).toMatchObject({ style: null, tone: 'friendly', formality: 'default' });
    store.selectFormality('informal');
    expect(store.getState()).toMatchObject({ style: null, tone: null, formality: 'informal' });
    store.resetStyle();
    expect(store.getState()).toMatchObject({ style: null, tone: null, formality: 'default' });
  });

  it('swaps languages and texts and translates the new source', async () => {
    const { store, api } = setup();
    store.setSource('Hallo Welt.');
    await store.run();
    store.swap();
    await flush();
    const state = store.getState().translate;
    expect(state.sourceLang).toBe('en-gb');
    expect(state.targetLang).toBe('de');
    expect(state.source).toBe('EN:Hallo Welt.');
    expect(vi.mocked(api.translate).mock.calls[1]![0]).toMatchObject({ source: 'en-gb', target: 'de' });
  });

  it('keeps the shown result when the translation after a swap fails', async () => {
    const translate = vi.fn(async (request: TranslateRequest) => {
      if (request.source === 'en-gb') throw new Error('model failed');
      return { text: request.text.map((sentence) => `EN:${sentence.trim()}`), detectedSource: null };
    });
    const { store } = setup({ translate });
    store.setSource('Hallo Welt.');
    await store.run();
    store.swap();
    await flush();
    const state = store.getState().translate;
    expect(state.source).toBe('EN:Hallo Welt.');
    expect(store.targetText).toBe('EN:Hallo Welt.');
    expect(state.sourceSentences).toEqual(['Hallo Welt.']);
    expect(store.getState().error).toBeInstanceOf(Error);
    // The output field holds the old source meanwhile: copying takes it, until the result changes.
    expect(store.outputText).toBe('Hallo Welt.');
    store.setTarget('Eigener Text.');
    expect(store.outputText).toBe('Eigener Text.');
  });

  it('leaves detected English as "Automatisch" and lets the model tell it', async () => {
    const { store, api } = setup({ detect: vi.fn(async () => 'en-gb' as const) });
    store.setTargetLang('de');
    store.setSource('This is an English sentence.');
    await store.run();
    expect(store.getState().translate.sourceLang).toBe('auto');
    expect(vi.mocked(api.translate).mock.calls[0]![0]).toMatchObject({ source: null });
  });

  it('moves a result into the other text mode from the translation’s target language', async () => {
    const { store } = setup();
    store.setTargetLang('en-us');
    store.setSource('Hallo Welt.');
    await store.run();
    store.improveTarget();
    expect(store.getState().mode).toBe('rephrase');
    expect(store.getState().rephrase.sourceLang).toBe('en-us');
    await flush();
    store.translateTarget();
    const state = store.getState();
    expect(state.mode).toBe('translate');
    expect(state.translate).toMatchObject({ sourceLang: 'en-us', targetLang: 'de' });
    expect(state.userSetSourceLang).toBe(true);
  });

  it('sends a finished sentence right away while live editing is on', async () => {
    const { store, api } = setup();
    store.setLive(true);
    expect(store.liveActive).toBe(true);
    store.setSource('Ein fertiger Satz.');
    await flush();
    expect(vi.mocked(api.translate)).toHaveBeenCalledTimes(1);
  });

  it('clears the result and the detected language with the text', async () => {
    const { store } = setup();
    store.setSource('Hallo Welt.');
    await store.run();
    store.clearSource();
    expect(store.getState().translate).toMatchObject({ source: '', sourceLang: 'auto', targetSentences: [] });
  });

  it('undoes a changed sentence and knows which ones the user added', async () => {
    const { store } = setup();
    store.setSource('Eins. Zwei drei vier.');
    await store.run();
    store.setTarget('EN:Eins. EN:Zwei drei fünf. Ganz eigener Satz.');
    expect(store.isSentenceChanged(1)).toBe(true);
    store.undoSentence(1);
    expect(store.targetText).toBe('EN:Eins. EN:Zwei drei vier. Ganz eigener Satz.');
    expect(store.sourceIndexOf(2)).toBeNull();
  });

  it('asks for other wordings of a sentence, with what was offered already as exclusions', async () => {
    const { store, api } = setup();
    store.setSource('Hallo Welt.');
    await store.run();
    const target = { index: 0, tokenIndex: null, kind: 'sentence' as const };
    expect(await store.loadSuggestions(target)).toEqual(['Andere Formulierung.']);
    vi.mocked(api.suggest).mockResolvedValueOnce(['Noch eine.']);
    expect(await store.loadSuggestions(target, true)).toEqual(['Andere Formulierung.', 'Noch eine.']);
    expect(vi.mocked(api.suggest).mock.calls[0]![0]).toMatchObject({
      kind: 'alternatives',
      text: 'EN:Hallo Welt.',
      exclusions: [],
    });
    expect(vi.mocked(api.suggest).mock.calls[1]![0]).toMatchObject({ exclusions: ['Andere Formulierung.'] });
  });

  it('keeps the session in storage, without what only describes the moment', async () => {
    const { store, storage } = setup();
    store.setSource('Hallo');
    const [key, value] = storage.setItem.mock.calls.at(-1)!;
    expect(key).toBe(SESSION_KEY);
    const session = parseSession(value, 'en-gb');
    expect(session.translate.source).toBe('Hallo');
    expect('loading' in JSON.parse(value)).toBe(false);
  });

  it('drops the active glossaries on a reload and keeps the button off', async () => {
    const { store, storage } = setup();
    store.setContext({ glossaryIds: ['g1'], limits: DEFAULT_LIMITS });
    store.setGlossaries(['g1']);
    store.setSource('Hallo Welt.');
    await store.run();
    const [, value] = storage.setItem.mock.calls.at(-1)!;
    expect('glossaryIds' in JSON.parse(value)).toBe(false);
    const reloaded = new TranslatorStore(setup().api, parseSession(value, 'en-gb'), null, USER);
    reloaded.setContext({ glossaryIds: ['g1'], limits: DEFAULT_LIMITS });
    expect(reloaded.getState().glossaryIds).toEqual([]);
    expect(reloaded.targetText).toBe('EN:Hallo Welt.');
    expect(reloaded.hasChanges).toBe(false);
  });

  it('forgets a selected glossary the user can no longer open', () => {
    const { store } = setup();
    store.setContext({ glossaryIds: ['g1', 'g2'], limits: DEFAULT_LIMITS });
    store.setGlossaries(['g1', 'g2']);
    store.setContext({ glossaryIds: ['g2'], limits: DEFAULT_LIMITS });
    expect(store.getState().glossaryIds).toEqual(['g2']);
  });
});

describe('parseSession', () => {
  it('falls back field by field on anything unreadable', () => {
    const session = parseSession(
      JSON.stringify({
        mode: 'documents',
        translate: { source: 5, targetLang: 'klingon' },
        style: 'loud',
        live: 'yes',
      }),
      'fr',
    );
    expect(session.mode).toBe('translate');
    expect(session.translate.source).toBe('');
    expect(session.translate.targetLang).toBe('fr');
    expect(session.style).toBeNull();
    expect(session.live).toBe(false);
    expect(parseSession('not json', 'fr').translate.targetLang).toBe('fr');
    expect(parseSession(null, 'de').rephrase.targetLang).toBe('de');
  });

  it('treats a session that did not record what was processed as never processed', () => {
    const stored = JSON.stringify({
      mode: 'translate',
      translate: { source: 'Eins. Zwei.', sourceSentences: ['Eins. ', 'Zwei.'], targetSentences: ['One. ', 'Two.'] },
      processed: { translate: { text: 'Eins. Zwei.', sourceLang: 'auto', targetLang: 'en-gb' }, rephrase: null },
    });
    const session = parseSession(stored, 'en-gb');
    expect(session.processed.translate).toBeNull();
    expect(session.translate.sourceSentences).toEqual([]);
    expect(session.translate.source).toBe('Eins. Zwei.');
  });
});

/** A promise settled by the test, to hold a request on its way while something else happens. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const echo = (request: TranslateRequest): TranslateResponse => ({
  text: request.text.map((sentence) => `EN:${sentence.trim()}`),
  detectedSource: null,
});

describe('TranslatorStore: the session of a user', () => {
  it('writes the session with its owner, and nothing once the store was let go', () => {
    const { store, storage } = setup();
    store.setSource('Hallo');
    const written = JSON.parse(storage.setItem.mock.calls.at(-1)![1]);
    expect(written.userId).toBe(USER);
    store.dispose();
    storage.setItem.mockClear();
    store.setSource('Hallo Welt');
    store.setSourceLang('fr');
    expect(storage.setItem).not.toHaveBeenCalled();
    // Development runs the cleanup and the setup of an effect twice: a store taken up again saves.
    store.activate();
    store.setSource('Hallo Welt!');
    expect(storage.setItem).toHaveBeenCalled();
  });

  it('does not write back an answer that arrives after the store was let go', async () => {
    const answer = deferred<TranslateResponse>();
    const { store, storage } = setup({ translate: vi.fn(() => answer.promise) });
    store.setSource('Hallo Welt.');
    const run = store.run();
    await flush();
    store.dispose();
    storage.setItem.mockClear();
    answer.resolve({ text: ['Hello world. '], detectedSource: 'de' });
    await run;
    expect(storage.setItem).not.toHaveBeenCalled();
  });
});

describe('TranslatorStore: a restored session', () => {
  it('keeps what was processed: the button stays off after a reload, and comes back for an edit', async () => {
    const { store, storage, api } = setup();
    store.setSource('Eins. Zwei.');
    await store.run();
    const reload = (): TranslatorStore => {
      const value = storage.setItem.mock.calls.at(-1)![1];
      const restored = new TranslatorStore(api, parseSession(value, 'en-gb'), null, USER);
      restored.setContext(context);
      return restored;
    };
    expect(reload().hasChanges).toBe(false);

    // Edited after the last result: not processed, even though the text is there.
    store.setSource('Eins. Zwei. Drei.');
    const edited = reload();
    expect(edited.hasChanges).toBe(true);
    // The redo compares with the source as it was sent: only the new sentence goes out.
    await edited.run();
    expect(vi.mocked(api.translate).mock.calls.at(-1)![0].text).toEqual(['Drei.']);
    expect(edited.targetText).toBe('EN:Eins. EN:Zwei. EN:Drei.');
  });

  it('counts a text that was never run as not processed', () => {
    const { store, storage, api } = setup();
    store.setSource('Hallo Welt.');
    const value = storage.setItem.mock.calls.at(-1)![1];
    const restored = new TranslatorStore(api, parseSession(value, 'en-gb'), null, USER);
    restored.setContext(context);
    expect(restored.hasChanges).toBe(true);
  });

  it('counts a session written without the record as not processed', async () => {
    const { store, storage, api } = setup();
    store.setSource('Hallo Welt.');
    await store.run();
    const old = JSON.parse(storage.setItem.mock.calls.at(-1)![1]);
    delete old.version;
    const restored = new TranslatorStore(api, parseSession(JSON.stringify(old), 'en-gb'), null, USER);
    restored.setContext(context);
    expect(restored.hasChanges).toBe(true);
  });
});

describe('TranslatorStore: sending only what changed', () => {
  it('counts a text as processed when only the whitespace between sentences changed', async () => {
    const { store, api } = setup();
    store.setSource('Eins. Zwei.');
    await store.run();
    store.setSource('Eins.  Zwei.');
    expect(store.hasChanges).toBe(true);
    await store.run();
    expect(api.translate).toHaveBeenCalledTimes(1);
    expect(store.hasChanges).toBe(false);
    expect(store.getState().translate.sourceSentences).toEqual(['Eins.  ', 'Zwei.']);
  });

  it('sends only the changed sentences of a live edit, and keeps the others', async () => {
    const { store, api } = setup();
    store.setSource('Eins. Zwei. Drei. Vier.');
    await store.run();
    store.setSource('Eins. Zwei neu. Drei. Vier neu.');
    await store.run();
    expect(vi.mocked(api.translate).mock.calls[1]![0].text).toEqual(['Zwei neu. ', 'Vier neu.']);
    expect(store.targetText).toBe('EN:Eins. EN:Zwei neu. EN:Drei. EN:Vier neu.');
  });

  it('sends every sentence again when a setting changed', async () => {
    const { store, api } = setup();
    store.setSource('Eins. Zwei.');
    await store.run();
    store.selectFormality('formal');
    await store.run();
    expect(vi.mocked(api.translate).mock.calls[1]![0].text).toEqual(['Eins. ', 'Zwei.']);
  });

  it('lets undo go back on a sentence the user edited and the redo left alone', async () => {
    const { store } = setup();
    store.setSource('Eins. Zwei. Drei.');
    await store.run();
    store.setTarget('Mein eins. EN:Zwei. EN:Drei.');
    store.setSource('Eins. Zwei neu. Drei.');
    await store.run();
    expect(store.targetText).toBe('Mein eins. EN:Zwei neu. EN:Drei.');
    expect(store.isSentenceChanged(0)).toBe(true);
    store.undoSentence(0);
    expect(store.targetText).toBe('EN:Eins. EN:Zwei neu. EN:Drei.');
    // A redone sentence has its new result as the original.
    store.setTarget('EN:Eins. Meine zwei. EN:Drei.');
    expect(store.isSentenceChanged(1)).toBe(true);
    store.undoSentence(1);
    expect(store.targetText).toBe('EN:Eins. EN:Zwei neu. EN:Drei.');
  });
});

describe('TranslatorStore: answers that arrive late', () => {
  const LONG = 'Das ist ein deutscher Text mit mehr als genug Zeichen, es sind über fünfzig.';

  it('ignores a detection answer once the mode has changed', async () => {
    const answer = deferred<TranslatorLanguage | null>();
    const { store, clock } = setup({ detect: vi.fn(() => answer.promise) });
    store.setSource(LONG);
    clock.run();
    store.switchMode('rephrase');
    answer.resolve('fr');
    await flush();
    expect(store.getState().translate.sourceLang).toBe('auto');
    expect(store.getState().rephrase.sourceLang).toBe('auto');
  });

  it('ignores a detection answer once the text was replaced, but not one about the same start', async () => {
    const replaced = deferred<TranslatorLanguage | null>();
    const first = setup({ detect: vi.fn(() => replaced.promise) });
    first.store.setSource(LONG);
    first.clock.run();
    first.store.setSource('Ein ganz anderer Text, der etwas anderes sagt.', true);
    replaced.resolve('fr');
    await flush();
    expect(first.store.getState().translate.sourceLang).toBe('auto');

    const same = deferred<TranslatorLanguage | null>();
    const second = setup({ detect: vi.fn(() => same.promise) });
    second.store.setSource(LONG);
    second.clock.run();
    second.store.setSource(`${LONG} Und es geht weiter.`);
    same.resolve('de');
    await flush();
    expect(second.store.getState().translate.sourceLang).toBe('de');
  });

  it('puts a language detected for a rewrite into the rewrite’s buffer, even after the mode changed', async () => {
    const answer = deferred<TranslatorLanguage | null>();
    const { store, api } = setup({ detect: vi.fn(() => answer.promise) });
    store.switchMode('rephrase');
    store.setSource('Ceci est un texte.');
    const run = store.run();
    store.switchMode('translate');
    answer.resolve('fr');
    await run;
    expect(store.getState().translate.sourceLang).toBe('auto');
    expect(store.getState().rephrase.sourceLang).toBe('fr');
    expect(vi.mocked(api.rephrase).mock.calls[0]![0].language).toBe('fr');
  });

  it('does not send a text that was replaced while its language was looked up', async () => {
    const answer = deferred<TranslatorLanguage | null>();
    const { store, api } = setup({ detect: vi.fn(() => answer.promise) });
    store.setSource('Hallo Welt.');
    const run = store.run();
    expect(store.getState().loading).toBe(true);
    store.setSource('Ganz neuer Text.', true);
    expect(store.getState().loading).toBe(false);
    answer.resolve('de');
    await run;
    expect(api.translate).not.toHaveBeenCalled();
    expect(store.getState().translate.targetSentences).toEqual([]);
  });

  it('forgets the user’s language choice with the text, so the next one is detected', async () => {
    const { store, clock } = setup();
    store.setSourceLang('fr');
    expect(store.getState().userSetSourceLang).toBe(true);
    store.setSource('');
    expect(store.getState().userSetSourceLang).toBe(false);

    store.setSourceLang('fr');
    store.setSource('Bonjour');
    store.clearSource();
    expect(store.getState().userSetSourceLang).toBe(false);
    store.setSource('Das ist ein deutscher Text mit genug Zeichen.');
    clock.run();
    await flush();
    expect(store.getState().translate.sourceLang).toBe('de');
  });

  it('forgets the choice a swap made when the text is cleared', async () => {
    const { store } = setup();
    store.setSource('Hallo Welt.');
    await store.run();
    store.swap();
    await flush();
    expect(store.getState().userSetSourceLang).toBe(true);
    store.clearSource();
    expect(store.getState().userSetSourceLang).toBe(false);
  });

  it('ignores a swap while a request is on its way', async () => {
    const answer = deferred<TranslateResponse>();
    const { store } = setup({ translate: vi.fn(() => answer.promise) });
    store.setSource('Hallo Welt.');
    const run = store.run();
    await flush();
    store.swap();
    expect(store.getState().translate.source).toBe('Hallo Welt.');
    expect(store.getState().translate.targetLang).toBe('en-gb');
    answer.resolve({ text: ['Hello world.'], detectedSource: 'de' });
    await run;
  });

  it('does not bring a cleared result back when the answer arrives', async () => {
    const answer = deferred<TranslateResponse>();
    const { store } = setup({ translate: vi.fn(() => answer.promise) });
    store.setSource('Hallo Welt.');
    const run = store.run();
    await flush();
    store.clearSource();
    expect(store.getState().loading).toBe(false);
    // New text, and the old answer comes in: it belongs to neither.
    store.setSource('Ganz neu.');
    answer.resolve({ text: ['Hello world. '], detectedSource: 'de' });
    await run;
    const state = store.getState();
    expect(state.translate.targetSentences).toEqual([]);
    expect(state.translate.sourceSentences).toEqual([]);
    expect(state.processed.translate).toBeNull();
    expect(store.hasChanges).toBe(true);
  });

  it('lets a setting changed while a request is on its way leave the result outdated', async () => {
    const answer = deferred<TranslateResponse>();
    const { store, api } = setup({ translate: vi.fn(() => answer.promise) });
    store.setSource('Hallo Welt.');
    const run = store.run();
    await flush();
    store.selectFormality('formal');
    answer.resolve({ text: ['Hello world. '], detectedSource: 'de' });
    await run;
    // The request went out with the settings of the moment it was sent, and says so.
    expect(vi.mocked(api.translate).mock.calls[0]![0].formality).toBe('default');
    expect(store.getState().processed.translate?.formality).toBe('default');
    expect(store.hasChanges).toBe(true);
  });

  it('discards a word’s correction when the mode switched or the sentence was edited', async () => {
    const target = { index: 0, tokenIndex: 0, kind: 'word' as const };
    for (const interfere of [
      (store: TranslatorStore) => store.switchMode('rephrase'),
      (store: TranslatorStore) => store.setTarget('Ganz anders.'),
    ]) {
      const answer = deferred<string[]>();
      const { store } = setup({ suggest: vi.fn(() => answer.promise) });
      store.setSource('Hallo Welt.');
      await store.run();
      const apply = store.applySuggestion(target, 'Moin');
      expect(store.targetText).toBe('Moin:Hallo Welt.');
      interfere(store);
      answer.resolve(['KORRIGIERT.']);
      await apply;
      expect(store.getState().translate.targetSentences.join('')).not.toContain('KORRIGIERT');
    }
  });

  it('applies a word’s correction while nothing changed', async () => {
    const { store } = setup({ suggest: vi.fn(async () => ['Moin Welt.']) });
    store.setSource('Hallo Welt.');
    await store.run();
    await store.applySuggestion({ index: 0, tokenIndex: 0, kind: 'word' }, 'Moin');
    expect(store.targetText).toBe('Moin Welt.');
  });
});

describe('TranslatorStore: a sentence of the result into the source', () => {
  /** A store with a result whose second sentence is the user's own. */
  async function withOwnSentence(overrides: Partial<TranslatorApi> = {}, detected: TranslatorLanguage | null = 'de') {
    const made = setup({ detect: vi.fn(async () => detected), ...overrides });
    made.store.setSource('Eins. Zwei.');
    await made.store.run();
    made.store.setTarget('EN:Eins. Eigener Satz. EN:Zwei.');
    return made;
  }

  it('translates back into the language the source was detected in, not into German', async () => {
    const { store, api } = setup({ detect: vi.fn(async () => 'en-gb' as const) });
    store.setTargetLang('de');
    store.setSource('This is an English sentence.');
    await store.run();
    expect(store.getState().translate.sourceLang).toBe('auto');
    store.setTarget('EN:This is an English sentence. Ein eigener Satz.');
    await store.pushToSource(1);
    expect(vi.mocked(api.translate).mock.calls.at(-1)![0]).toEqual({
      text: ['Ein eigener Satz.'],
      source: 'de',
      target: 'en-gb',
    });
    expect(store.getState().translate.source).toBe('This is an English sentence. EN:Ein eigener Satz. ');
  });

  it('takes the language the model reported when the start of the text did not tell', async () => {
    const translate = vi.fn(async (request: TranslateRequest) => ({ ...echo(request), detectedSource: 'fr' as const }));
    const { store } = setup({ translate, detect: vi.fn(async () => null) });
    store.setSource('Bonjour le monde.');
    await store.run();
    expect(store.getState().translate.detectedSource).toBe('fr');
    store.setTarget('EN:Bonjour le monde. Ein eigener Satz.');
    await store.pushToSource(1);
    expect(vi.mocked(translate).mock.calls.at(-1)![0]).toMatchObject({ source: 'en-gb', target: 'fr' });
  });

  it('leaves the source to be detected, and picks a target other than the sentence’s language, when it is not known', async () => {
    const { store, api } = setup({ detect: vi.fn(async () => null) });
    store.setTargetLang('de');
    store.setSource('This is an English sentence.');
    await store.run();
    store.setTarget('EN:This is an English sentence. Ein eigener Satz.');
    await store.pushToSource(1);
    expect(vi.mocked(api.translate).mock.calls.at(-1)![0]).toEqual({
      text: ['Ein eigener Satz.'],
      source: null,
      target: 'en-gb',
    });
  });

  it('replaces only its own insertion with the translation', async () => {
    const hold = deferred<TranslateResponse>();
    let second = false;
    const { store } = await withOwnSentence({
      translate: vi.fn(async (request: TranslateRequest) => {
        if (request.text[0] === 'Eigener Satz. ') {
          second = true;
          return hold.promise;
        }
        return echo(request);
      }),
    });
    const push = store.pushToSource(1);
    expect(second).toBe(true);
    // The sentence is in the source as it is, until its translation arrives.
    expect(store.getState().translate.source).toBe('Eins. Eigener Satz. Zwei.');
    hold.resolve({ text: ['My own sentence.'], detectedSource: 'en-gb' });
    await push;
    expect(store.getState().translate.source).toBe('Eins. My own sentence. Zwei.');
    expect(store.getState().translate.sourceSentences).toEqual(['Eins. ', 'My own sentence. ', 'Zwei.']);
  });

  it('never overwrites what was typed meanwhile', async () => {
    const hold = deferred<TranslateResponse>();
    const { store } = await withOwnSentence({
      translate: vi.fn(async (request: TranslateRequest) =>
        request.text[0] === 'Eigener Satz. ' ? hold.promise : echo(request),
      ),
    });
    const push = store.pushToSource(1);
    store.setSource('Eins. Eigener Satz. Zwei. Neu getippt.');
    hold.resolve({ text: ['My own sentence.'], detectedSource: 'en-gb' });
    await push;
    expect(store.getState().translate.source).toBe('Eins. Eigener Satz. Zwei. Neu getippt.');
  });

  it('also leaves newer typing alone when the translation fails', async () => {
    const hold = deferred<TranslateResponse>();
    const { store } = await withOwnSentence({
      translate: vi.fn(async (request: TranslateRequest) =>
        request.text[0] === 'Eigener Satz. ' ? hold.promise : echo(request),
      ),
    });
    const push = store.pushToSource(1);
    store.setSource('Eins. Eigener Satz. Zwei. Neu getippt.');
    hold.reject(new Error('model failed'));
    await push;
    expect(store.getState().translate.source).toBe('Eins. Eigener Satz. Zwei. Neu getippt.');
  });
});

describe('TranslatorStore: a result into the other mode', () => {
  it('takes the rewritten text’s own language into translating, not the translation’s target', async () => {
    const { store, api } = setup();
    store.setTargetLang('en-gb');
    store.switchMode('rephrase');
    store.setSourceLang('fr');
    store.setSource('Bonjour le monde.');
    await store.run();
    store.translateTarget();
    expect(store.getState().mode).toBe('translate');
    expect(store.getState().translate.sourceLang).toBe('fr');
    await flush();
    expect(vi.mocked(api.translate).mock.calls.at(-1)![0]).toMatchObject({ source: 'fr', target: 'en-gb' });
  });

  it('leaves the source to be detected when the rewritten text’s language is not known', () => {
    const { store } = setup();
    store.switchMode('rephrase');
    store.setSource('Etwas.');
    store.setTarget('Etwas anderes.');
    store.translateTarget();
    expect(store.getState().translate.sourceLang).toBe('auto');
    expect(store.getState().userSetSourceLang).toBe(false);
  });
});

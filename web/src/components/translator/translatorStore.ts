import { alternativeTarget, TEXT_ERROR_MS, TextLimitError, type SourceLanguage } from './languages';
import {
  completeSentenceCount,
  sentenceMapping,
  sentenceTokens,
  splitIntoSentences,
  withTrailingWhitespace,
} from './sentences';
import {
  DEFAULT_LIMITS,
  isTranslatorLanguage,
  REPHRASE_STYLES,
  REPHRASE_TONES,
  type DetectRequest,
  type Formality,
  type RephraseRequest,
  type RephraseResponse,
  type RephraseStyle,
  type RephraseTone,
  type SuggestRequest,
  type TextMode,
  type TranslateRequest,
  type TranslateResponse,
  type TranslatorLanguage,
  type TranslatorLimits,
} from './types';
import { SESSION_KEY } from './translatorSessionStorage';

export { SESSION_KEY };

/** The two ways of working: a text is translated or rewritten. */
export const TRANSLATOR_MODES = ['translate', 'rephrase'] as const;
export type TranslatorMode = TextMode;

/** How long typing has to pause before detection, or live editing, looks at the text. */
export const TYPING_PAUSE_MS = 800;
/** Characters detection samples while typing; the detection before a request takes more. */
const DETECT_TYPING_SAMPLE = 50;
/** Below this many characters a text is too short to tell its language. */
const DETECT_MIN_LENGTH = 20;

/** One text mode's text, languages and result, kept while the other mode is used. */
export interface TextBuffer {
  source: string;
  sourceLang: SourceLanguage;
  targetLang: TranslatorLanguage;
  sourceSentences: string[];
  targetSentences: string[];
  /** The result as the model gave it, before the user edited it; undo goes back to it. */
  baselineTargetSentences: string[];
  /** The source as it was processed; "show changes" compares against it. */
  lastSourceText: string;
  /**
   * The language the source was detected to be in while its source language is `auto` (also
   * plain English, which stays `auto`): what a sentence of the result is translated back into.
   */
  detectedSource: TranslatorLanguage | null;
  /**
   * What the output field holds while it differs from the result shown: after a swap the old
   * source, until a new result replaces it. Copying and passing the result on take this text.
   */
  outputText: string | null;
}

/** What a result was made with: the button stays off until one of them changes. */
export interface Processed {
  text: string;
  sourceLang: string;
  targetLang: string | null;
  style: string | null;
  tone: string | null;
  formality: string;
  glossaries: string;
}

/**
 * The page's state, kept in `sessionStorage`: it survives a reload of the tab, and a new tab
 * starts fresh. Each field falls back on its own. `processed` and the buffers' `sourceSentences`
 * are the last successful request and the source as it was sent then; a session written without
 * them (no `version`) counts as never processed.
 */
export interface TranslatorSession {
  mode: TranslatorMode;
  translate: TextBuffer;
  rephrase: TextBuffer;
  processed: { translate: Processed | null; rephrase: Processed | null };
  style: RephraseStyle | null;
  tone: RephraseTone | null;
  formality: Formality;
  live: boolean;
  showChanges: boolean;
  userSetSourceLang: boolean;
}

/** The stored session's format; older ones have no record of what was processed. */
const SESSION_VERSION = 2;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const asString = (value: unknown, fallback = ''): string => (typeof value === 'string' ? value : fallback);
const asStrings = (value: unknown): string[] =>
  Array.isArray(value) && value.every((v) => typeof v === 'string') ? (value as string[]) : [];
const oneOf = <T extends string>(value: unknown, options: readonly T[]): T | null =>
  typeof value === 'string' && (options as readonly string[]).includes(value) ? (value as T) : null;

function emptyBuffer(targetLang: TranslatorLanguage): TextBuffer {
  return {
    source: '',
    sourceLang: 'auto',
    targetLang,
    sourceSentences: [],
    targetSentences: [],
    baselineTargetSentences: [],
    lastSourceText: '',
    detectedSource: null,
    outputText: null,
  };
}

function parseBuffer(value: unknown, defaultTarget: TranslatorLanguage): TextBuffer {
  const fresh = emptyBuffer(defaultTarget);
  if (!isRecord(value)) return fresh;
  const sourceLang = value.sourceLang === 'auto' || isTranslatorLanguage(value.sourceLang) ? value.sourceLang : 'auto';
  return {
    source: asString(value.source),
    sourceLang,
    targetLang: isTranslatorLanguage(value.targetLang) ? value.targetLang : defaultTarget,
    sourceSentences: asStrings(value.sourceSentences),
    targetSentences: asStrings(value.targetSentences),
    baselineTargetSentences: asStrings(value.baselineTargetSentences),
    lastSourceText: asString(value.lastSourceText),
    detectedSource: isTranslatorLanguage(value.detectedSource) ? value.detectedSource : null,
    outputText: typeof value.outputText === 'string' ? value.outputText : null,
  };
}

function parseProcessed(value: unknown): Processed | null {
  if (!isRecord(value) || typeof value.text !== 'string' || typeof value.sourceLang !== 'string') return null;
  return {
    text: value.text,
    sourceLang: value.sourceLang,
    targetLang: typeof value.targetLang === 'string' ? value.targetLang : null,
    style: typeof value.style === 'string' ? value.style : null,
    tone: typeof value.tone === 'string' ? value.tone : null,
    formality: asString(value.formality, 'default'),
    // The glossaries start unselected again, and a result counts as made without them.
    glossaries: '',
  };
}

/** The session stored in this tab; anything unreadable gives the defaults. */
export function parseSession(stored: string | null, defaultTarget: TranslatorLanguage): TranslatorSession {
  const fresh: TranslatorSession = {
    mode: 'translate',
    translate: emptyBuffer(defaultTarget),
    rephrase: emptyBuffer(defaultTarget),
    processed: { translate: null, rephrase: null },
    style: null,
    tone: null,
    formality: 'default',
    live: false,
    showChanges: false,
    userSetSourceLang: false,
  };
  if (!stored) return fresh;
  try {
    const raw: unknown = JSON.parse(stored);
    if (!isRecord(raw)) return fresh;
    // What was processed is only known from a session that recorded it.
    const recorded = raw.version === SESSION_VERSION;
    const processed = recorded && isRecord(raw.processed) ? raw.processed : {};
    const forget = (buffer: TextBuffer): TextBuffer => (recorded ? buffer : { ...buffer, sourceSentences: [] });
    const session: TranslatorSession = {
      mode: oneOf(raw.mode, TRANSLATOR_MODES) ?? 'translate',
      translate: forget(parseBuffer(raw.translate, defaultTarget)),
      rephrase: forget(parseBuffer(raw.rephrase, defaultTarget)),
      processed: { translate: parseProcessed(processed.translate), rephrase: parseProcessed(processed.rephrase) },
      style: oneOf(raw.style, REPHRASE_STYLES),
      tone: oneOf(raw.tone, REPHRASE_TONES),
      formality: oneOf(raw.formality, ['default', 'formal', 'informal'] as const) ?? 'default',
      live: raw.live === true,
      showChanges: raw.showChanges === true,
      userSetSourceLang: raw.userSetSourceLang === true,
    };
    return session;
  } catch {
    return fresh;
  }
}

/** The state as components see it: the session and what is going on right now. */
export interface TranslatorState extends TranslatorSession {
  /** A request of the current mode is on its way. */
  loading: boolean;
  /** The sentences being redone while loading; `null`: the whole result. */
  pendingSentences: number[] | null;
  /** The last failure, shown for a few seconds. */
  error: unknown;
  /** A shown sentence's detection is going on (live typing). */
  detecting: boolean;
  /** The active glossaries; none are active again after a reload. */
  glossaryIds: string[];
}

/** The parts of the state that describe the moment, not the session. */
const TRANSIENT_KEYS = new Set(['loading', 'pendingSentences', 'error', 'detecting', 'glossaryIds']);

/** What the store asks the server for; injected, so tests need no network. */
export interface TranslatorApi {
  translate: (request: TranslateRequest, signal?: AbortSignal) => Promise<TranslateResponse>;
  rephrase: (request: RephraseRequest, signal?: AbortSignal) => Promise<RephraseResponse>;
  detect: (request: DetectRequest, signal?: AbortSignal) => Promise<TranslatorLanguage | null>;
  suggest: (request: SuggestRequest, signal?: AbortSignal) => Promise<string[]>;
}

/** What the store needs from the page around it. */
export interface TranslatorContext {
  /** Ids of the glossaries the user can use; `null` until they are known. */
  glossaryIds: readonly string[] | null;
  limits: TranslatorLimits;
}

/** Timers, replaceable in tests. */
export interface TranslatorClock {
  setTimeout: (callback: () => void, ms: number) => unknown;
  clearTimeout: (handle: unknown) => void;
}

/** A suggestion list for one sentence or one word of the result. */
export interface SuggestionTarget {
  index: number;
  /** The clicked word's token index, for word suggestions. */
  tokenIndex: number | null;
  kind: 'sentence' | 'word';
}

type Listener = () => void;

/** Style, tone, formality and glossaries of one request, captured when it is sent. */
interface RequestSettings {
  style: RephraseStyle | null;
  tone: RephraseTone | null;
  formality: Formality;
  glossaryIds: string[];
  /** The glossaries as `Processed` compares them. */
  glossaries: string;
}

/**
 * The text modes: a text is translated or rewritten sentence by sentence, the result stays
 * editable, and a request only goes out when the text or a setting changed since the result was
 * made. The store owns the text, the languages and the settings of the style panel; components
 * render its state and call its methods.
 */
export class TranslatorStore {
  private state: TranslatorState;
  private readonly listeners = new Set<Listener>();
  private context: TranslatorContext = { glossaryIds: null, limits: DEFAULT_LIMITS };
  private detectTimer: unknown = null;
  private liveTimer: unknown = null;
  private errorTimer: unknown = null;
  private detectCache: { sample: string; language: TranslatorLanguage | null } | null = null;
  private request: AbortController | null = null;
  /** Suggestions shown per sentence (`index`) or word (`index-token`), until the mode changes. */
  private suggestionCache = new Map<string, string[]>();
  /** The mode being asked for, while a request is on its way. */
  private requestMode: TextMode | null = null;
  /**
   * Counts how often a mode's source was cleared or replaced as a whole. Whatever was asked for
   * the earlier text (a detection, a request) is stale once this moved on.
   */
  private readonly epoch: Record<TextMode, number> = { translate: 0, rephrase: 0 };
  /** A store that was let go writes nothing: its session may belong to somebody who signed out. */
  private disposed = false;

  /**
   * `userId` owns the stored session: only that user's own later visit reads it back
   * (`readStoredSession`).
   */
  constructor(
    private readonly api: TranslatorApi,
    session: TranslatorSession,
    private readonly storage: Pick<Storage, 'setItem'> | null,
    private readonly userId: string,
    private readonly clock: TranslatorClock = {
      setTimeout: (callback, ms) => setTimeout(callback, ms),
      clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
    },
  ) {
    this.state = { ...session, loading: false, pendingSentences: null, error: null, detecting: false, glossaryIds: [] };
  }

  // --- Subscription -----------------------------------------------------------------------------

  subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getState = (): TranslatorState => this.state;

  private set(patch: Partial<TranslatorState>): void {
    this.state = { ...this.state, ...patch };
    this.save();
    for (const listener of this.listeners) listener();
  }

  private save(): void {
    if (!this.storage || this.disposed) return;
    const session = Object.fromEntries(Object.entries(this.state).filter(([key]) => !TRANSIENT_KEYS.has(key)));
    try {
      this.storage.setItem(SESSION_KEY, JSON.stringify({ ...session, version: SESSION_VERSION, userId: this.userId }));
    } catch {
      /* A lost session costs nothing but the session. */
    }
  }

  /** The glossaries on offer and the limits; unknown glossaries drop out of the selection. */
  setContext(context: TranslatorContext): void {
    this.context = context;
    const known = context.glossaryIds;
    if (known && this.state.glossaryIds.some((id) => !known.includes(id))) {
      this.set({ glossaryIds: this.state.glossaryIds.filter((id) => known.includes(id)) });
    }
  }

  /** Takes up the store again after `dispose` (React runs an effect's cleanup and setup twice in development). */
  activate(): void {
    this.disposed = false;
  }

  dispose(): void {
    this.disposed = true;
    for (const timer of [this.detectTimer, this.liveTimer, this.errorTimer]) this.clock.clearTimeout(timer);
    this.request?.abort();
  }

  // --- Derived ---------------------------------------------------------------------------------

  /** The text mode shown. */
  get textMode(): TextMode {
    return this.state.mode;
  }

  get buffer(): TextBuffer {
    return this.state[this.textMode];
  }

  private glossaryKey(): string {
    return [...this.state.glossaryIds].sort().join(',');
  }

  /** The settings a request is made with, as they are now. */
  private settings(): RequestSettings {
    const { style, tone, formality, glossaryIds } = this.state;
    return { style, tone, formality, glossaryIds: [...glossaryIds], glossaries: this.glossaryKey() };
  }

  private snapshot(
    text: string,
    sourceLang: string,
    targetLang: string | null,
    settings: RequestSettings = this.settings(),
  ): Processed {
    const { style, tone, formality, glossaries } = settings;
    return { text, sourceLang, targetLang, style, tone, formality, glossaries };
  }

  private currentTarget(): string | null {
    const buffer = this.buffer;
    return this.textMode === 'rephrase' ? (buffer.sourceLang === 'auto' ? null : buffer.sourceLang) : buffer.targetLang;
  }

  /**
   * Whether the main button does anything: there is text, no request is on its way, and the
   * text or a setting changed since the shown result was made.
   */
  get hasChanges(): boolean {
    if (this.state.loading) return false;
    const buffer = this.buffer;
    const text = buffer.source.trim();
    if (!text) return false;
    const processed = this.state.processed[this.textMode];
    if (!processed) return true;
    const now = this.snapshot(text, buffer.sourceLang, this.currentTarget());
    return (Object.keys(now) as Array<keyof Processed>).some((key) => now[key] !== processed[key]);
  }

  get targetText(): string {
    return this.buffer.targetSentences.join('');
  }

  /** The text of the output as copying and passing it on see it. */
  get outputText(): string {
    return this.buffer.outputText ?? this.targetText;
  }

  /** The limits of a request, as the server reports them. */
  get limits(): TranslatorLimits {
    return this.context.limits;
  }

  /** Live editing sends a request per pause in typing. */
  get liveActive(): boolean {
    return this.state.live;
  }

  // --- Buffers ---------------------------------------------------------------------------------

  /** Any change of the result makes the output field hold it again. */
  private patchBuffer(patch: Partial<TextBuffer>, mode: TextMode = this.textMode): void {
    const output = 'targetSentences' in patch && !('outputText' in patch) ? { outputText: null } : {};
    this.set({ [mode]: { ...this.state[mode], ...output, ...patch } } as Partial<TranslatorState>);
  }

  /**
   * The source of a mode was cleared or replaced as a whole: a detection or a request still on
   * its way was asked for the old text and must neither show nor attach to what comes next.
   */
  private invalidate(mode: TextMode): void {
    this.epoch[mode]++;
    this.clock.clearTimeout(this.detectTimer);
    if (this.request && this.requestMode === mode) {
      this.request.abort();
      this.request = null;
      this.requestMode = null;
      this.set({ loading: false, pendingSentences: null });
    }
  }

  private clearResult(mode: TextMode = this.textMode): void {
    this.invalidate(mode);
    this.patchBuffer(
      {
        targetSentences: [],
        baselineTargetSentences: [],
        sourceSentences: [],
        lastSourceText: '',
        detectedSource: null,
      },
      mode,
    );
    this.set({ processed: { ...this.state.processed, [mode]: null } });
    this.suggestionCache.clear();
  }

  // --- Source text -----------------------------------------------------------------------------

  /**
   * The source text as typed. An emptied field, or one whose whole content was replaced, starts
   * over: the result goes and the source language is detected again.
   */
  setSource(value: string, replacedAll = false): void {
    this.patchBuffer({ source: value });
    if (!value.trim() || replacedAll) {
      // Starting over: the language is detected again, even after the user had chosen one.
      this.set({ userSetSourceLang: false });
      if (this.buffer.sourceLang !== 'auto') this.setSourceLang('auto', true);
      this.clearResult();
      if (!value.trim()) return;
    }
    this.scheduleDetection();
    this.scheduleLive(value);
  }

  /** The source cleared with its button: text, result and language start over. */
  clearSource(): void {
    this.patchBuffer({ source: '' });
    this.set({ userSetSourceLang: false });
    if (this.buffer.sourceLang !== 'auto') this.setSourceLang('auto', true);
    this.clearResult();
  }

  /** The result as the user edited it. */
  setTarget(value: string): void {
    this.patchBuffer({ targetSentences: value.trim() ? splitIntoSentences(value) : [] });
  }

  // --- Languages -------------------------------------------------------------------------------

  /**
   * Chooses the source language. A choice by the user (`programmatic` false) is kept while the
   * text changes; detection only fills in `auto`.
   */
  setSourceLang(language: SourceLanguage, programmatic = false): void {
    if (!programmatic) this.set({ userSetSourceLang: language !== 'auto' });
    this.patchBuffer({ sourceLang: language });
    this.preventSameLanguage('source');
    if (!programmatic) this.runLiveNow();
  }

  setTargetLang(language: TranslatorLanguage): void {
    this.patchBuffer({ targetLang: language });
    this.preventSameLanguage('target');
    this.runLiveNow();
  }

  /**
   * Source and target never match while translating: a source like the target gets another
   * target, a target like the source sets the source back to `auto`.
   */
  private preventSameLanguage(side: 'source' | 'target', mode: TextMode = this.textMode): void {
    if (mode === 'rephrase') return;
    const { sourceLang, targetLang } = this.state.translate;
    if (sourceLang === 'auto' || sourceLang !== targetLang) return;
    if (side === 'source') this.patchBuffer({ targetLang: alternativeTarget(sourceLang) }, 'translate');
    else this.patchBuffer({ sourceLang: 'auto' }, 'translate');
  }

  /**
   * Swaps the languages and the texts, then translates the new source if there is one. With the
   * source detected (`auto`) the new target is an alternative to the old one. A result that is
   * shown stays until the new one replaces it; a failed request leaves it there, while the
   * output field already holds the old source. Ignored while a request is on its way: it would
   * answer for the texts that were just exchanged.
   */
  swap(): void {
    if (this.state.loading) return;
    const buffer = this.state.translate;
    const source = buffer.targetLang;
    const target = buffer.sourceLang === 'auto' ? alternativeTarget(buffer.targetLang) : buffer.sourceLang;
    const newSource = this.outputText;
    const newTarget = buffer.source;
    const shown = this.state.processed.translate !== null && buffer.targetSentences.length > 0;
    this.set({ userSetSourceLang: true });
    this.invalidate('translate');
    this.patchBuffer(
      {
        sourceLang: source,
        targetLang: target,
        source: newSource,
        detectedSource: null,
        ...(shown ? { outputText: newTarget } : { targetSentences: newTarget ? splitIntoSentences(newTarget) : [] }),
      },
      'translate',
    );
    this.preventSameLanguage('source');
    if (newSource.trim()) void this.run();
  }

  // --- Detection -------------------------------------------------------------------------------

  private scheduleDetection(): void {
    this.clock.clearTimeout(this.detectTimer);
    this.detectTimer = this.clock.setTimeout(() => void this.detectWhileTyping(), TYPING_PAUSE_MS);
  }

  /**
   * After a pause in typing, a longer text in `auto` shows the language it is in. The answer only
   * counts while it is still about what is shown: the same mode, the same start of the text, the
   * source not cleared or replaced since.
   */
  private async detectWhileTyping(): Promise<void> {
    const mode = this.textMode;
    const epoch = this.epoch[mode];
    const text = this.buffer.source.trim();
    if (text.length <= DETECT_MIN_LENGTH || this.state.userSetSourceLang) return;
    if (this.buffer.sourceLang !== 'auto' && this.state.processed[mode]) return;
    const sample = text.slice(0, DETECT_TYPING_SAMPLE);
    const language = await this.detect(sample);
    if (!language || this.textMode !== mode || this.epoch[mode] !== epoch || this.state.userSetSourceLang) return;
    const buffer = this.state[mode];
    if (buffer.source.trim().slice(0, DETECT_TYPING_SAMPLE) !== sample) return;
    if (buffer.sourceLang !== language) this.applyDetectedLanguage(mode, language);
  }

  /** A detected language as the source language of `mode`, as if the text had come with it. */
  private applyDetectedLanguage(mode: TextMode, language: TranslatorLanguage): void {
    this.patchBuffer({ sourceLang: language }, mode);
    this.preventSameLanguage('source', mode);
  }

  /** The language of a sample, asked once per sample. */
  private async detect(sample: string): Promise<TranslatorLanguage | null> {
    if (this.detectCache?.sample === sample) return this.detectCache.language;
    try {
      this.set({ detecting: true });
      const language = await this.api.detect({ text: sample });
      this.detectCache = { sample, language };
      return language;
    } catch {
      return null;
    } finally {
      this.set({ detecting: false });
    }
  }

  // --- Requests --------------------------------------------------------------------------------

  /**
   * Translates or rewrites the source sentence by sentence. With the settings unchanged and a
   * result shown, only the sentences that changed are sent and redone (the rest keeps the
   * user's edits); nothing changed, nothing is sent. What a result was made with (the text and
   * the settings) is taken when the request goes out, so a change made while it is on its way
   * leaves the result outdated.
   */
  async run(): Promise<void> {
    const mode = this.textMode;
    const buffer = this.state[mode];
    const fullText = buffer.source.trim();
    if (!fullText || this.state.loading) return;
    const { limits } = this.context;
    const sentences = splitIntoSentences(fullText);
    if ([...fullText].length > limits.textMax) return this.showError(new TextLimitError('text'));
    if (sentences.length > limits.segmentsMax) return this.showError(new TextLimitError('sentences'));
    const processed = this.state.processed[mode];
    const settings = this.settings();
    const settingsChanged =
      !processed ||
      processed.style !== settings.style ||
      processed.tone !== settings.tone ||
      processed.formality !== settings.formality ||
      processed.targetLang !== this.currentTarget() ||
      processed.sourceLang !== buffer.sourceLang ||
      processed.glossaries !== settings.glossaries;

    let changed: number[] | null = null;
    if (!settingsChanged && buffer.sourceSentences.length > 0) {
      changed = [];
      const count = Math.max(sentences.length, buffer.sourceSentences.length);
      for (let index = 0; index < count; index++) {
        if (sentences[index]?.trim() !== buffer.sourceSentences[index]?.trim()) changed.push(index);
      }
      // Many changes at once redo everything; short texts are redone in parts more readily.
      const threshold = sentences.length < 10 ? 1 : 0.8;
      if (
        changed.length > sentences.length * threshold ||
        Math.abs(sentences.length - buffer.sourceSentences.length) > 5
      ) {
        changed = null;
      }
    }
    if (changed && changed.length === 0) {
      // Only the whitespace between the sentences changed: nothing to redo, but the text now
      // counts as processed, so the button does not offer a request that does nothing.
      this.patchBuffer({ sourceSentences: sentences, lastSourceText: fullText }, mode);
      if (processed) this.set({ processed: { ...this.state.processed, [mode]: { ...processed, text: fullText } } });
      return;
    }
    // The indexes of the sentences to send: the changed ones, and any the result has no sentence for.
    const changedSet = changed === null ? null : new Set(changed);
    const toSend =
      changedSet === null
        ? null
        : sentences
            .map((_, index) => index)
            .filter((index) => changedSet.has(index) || buffer.targetSentences[index] === undefined);

    this.request?.abort();
    const controller = new AbortController();
    this.request = controller;
    this.requestMode = mode;
    const epoch = this.epoch[mode];
    this.set({ loading: true, pendingSentences: toSend, error: null });
    try {
      let sourceLang = buffer.sourceLang;
      let targetLang = buffer.targetLang;
      let detectedSource = buffer.detectedSource;
      const sample = fullText.slice(0, limits.detectSampleMax);
      // The source still starts as it did when the language was asked for.
      const sameStart = (): boolean =>
        this.epoch[mode] === epoch && this.state[mode].source.trim().slice(0, limits.detectSampleMax) === sample;
      if (sourceLang === 'auto') {
        const detected = await this.detect(sample);
        if (controller.signal.aborted) return;
        const chosen = this.state[mode].sourceLang;
        if (chosen !== 'auto') {
          // The user chose a language while the text was looked at.
          sourceLang = chosen;
          targetLang = this.state[mode].targetLang;
        } else if (mode === 'rephrase') {
          sourceLang = detected ?? 'de';
          if (sameStart()) this.applyDetectedLanguage(mode, sourceLang);
        } else {
          detectedSource = detected ?? detectedSource;
          // Plain English is sent on as it is detected, which the language list lacks: the source
          // stays "Automatisch" and the model is told nothing more.
          if (detected && !detected.startsWith('en-')) {
            sourceLang = detected;
            if (sameStart()) this.applyDetectedLanguage(mode, detected);
            targetLang = this.state.translate.targetLang;
          }
        }
      }
      if (mode === 'translate' && sourceLang !== 'auto' && sourceLang === targetLang) {
        targetLang = alternativeTarget(sourceLang);
        this.patchBuffer({ targetLang }, 'translate');
      }

      // What the result is made with, from here on.
      const made = this.snapshot(
        fullText,
        this.state[mode].sourceLang,
        mode === 'rephrase' ? (sourceLang === 'auto' ? null : sourceLang) : targetLang,
        settings,
      );
      const redone = toSend ?? sentences.map((_, index) => index);
      const common = {
        text: redone.map((index) => sentences[index]!),
        formality: settings.formality,
        style: settings.style,
        tone: settings.tone,
        glossaryIds: settings.glossaryIds,
      };
      let results: string[] = [];
      if (common.text.length > 0) {
        if (mode === 'rephrase') {
          results = (
            await this.api.rephrase({ ...common, language: sourceLang === 'auto' ? null : sourceLang }, controller.signal)
          ).text;
        } else {
          const response = await this.api.translate(
            { ...common, source: sourceLang === 'auto' ? null : sourceLang, target: targetLang },
            controller.signal,
          );
          results = response.text;
          // The model's own report of the source language beats the guess from the start of the text.
          detectedSource = response.detectedSource ?? detectedSource;
        }
      }
      if (controller.signal.aborted) return;
      const resultOf = new Map(redone.map((index, position) => [index, results[position]]));

      const current = this.state[mode];
      let target: string[];
      let baseline: string[];
      if (toSend !== null && current.sourceSentences.length > 0) {
        // The user's own sentences after the last source sentence stay where they are.
        const extra =
          current.targetSentences.length > current.sourceSentences.length
            ? current.targetSentences.slice(current.sourceSentences.length)
            : [];
        const own = (index: number): string | undefined => current.targetSentences[index];
        target = sentences.map((sentence, index) => {
          const kept = own(index);
          const next = resultOf.has(index) || kept === undefined ? (resultOf.get(index) ?? kept ?? '') : kept;
          return withTrailingWhitespace(next, sentence);
        });
        // Undo goes back to what the model gave: only the sentences it redid have a new original.
        baseline = target.map((sentence, index) =>
          resultOf.has(index) ? sentence : (current.baselineTargetSentences[index] ?? sentence),
        );
        target = target.concat(extra);
      } else {
        target = results.map((result, index) => withTrailingWhitespace(result, sentences[index] ?? ''));
        baseline = [...target];
      }
      this.patchBuffer(
        {
          targetSentences: target,
          sourceSentences: sentences,
          baselineTargetSentences: baseline,
          lastSourceText: fullText,
          detectedSource: mode === 'translate' ? (detectedSource ?? current.detectedSource) : null,
        },
        mode,
      );
      this.set({ processed: { ...this.state.processed, [mode]: made } });
      this.suggestionCache.clear();
    } catch (error) {
      if (controller.signal.aborted) return;
      this.showError(error);
    } finally {
      if (this.request === controller) {
        this.request = null;
        this.requestMode = null;
        this.set({ loading: false, pendingSentences: null });
      }
    }
  }

  private showError(error: unknown): void {
    this.clock.clearTimeout(this.errorTimer);
    this.set({ error });
    this.errorTimer = this.clock.setTimeout(() => this.set({ error: null }), TEXT_ERROR_MS);
  }

  /** Live editing: a finished sentence goes out at once, anything else after a pause. */
  private scheduleLive(value: string): void {
    if (!this.liveActive || !value.trim()) return;
    const processedText = this.state.processed[this.textMode]?.text ?? '';
    this.clock.clearTimeout(this.liveTimer);
    if (completeSentenceCount(value) > completeSentenceCount(processedText) && !this.state.loading) {
      void this.run();
      return;
    }
    this.liveTimer = this.clock.setTimeout(() => {
      const current = this.buffer.source;
      if (!current.trim()) return;
      if (this.state.loading) this.scheduleLive(current);
      else if (current.trim() !== (this.state.processed[this.textMode]?.text ?? '')) void this.run();
    }, TYPING_PAUSE_MS);
  }

  /** A changed setting redoes the shown text at once while live editing is on. */
  private runLiveNow(): void {
    if (this.liveActive && this.buffer.source.trim()) void this.run();
  }

  // --- Settings --------------------------------------------------------------------------------

  /** Style, tone and formality exclude each other: choosing one resets the other two. */
  selectStyle(style: RephraseStyle): void {
    this.set({ style, tone: null, formality: 'default' });
    this.runLiveNow();
  }

  selectTone(tone: RephraseTone): void {
    this.set({ tone, style: null, formality: 'default' });
    this.runLiveNow();
  }

  selectFormality(formality: Exclude<Formality, 'default'>): void {
    this.set({ formality, style: null, tone: null });
    this.runLiveNow();
  }

  resetStyle(): void {
    this.set({ style: null, tone: null, formality: 'default' });
    this.runLiveNow();
  }

  setLive(live: boolean): void {
    this.set({ live });
    this.runLiveNow();
  }

  setShowChanges(showChanges: boolean): void {
    this.set({ showChanges });
  }

  setGlossaries(glossaryIds: string[]): void {
    // The request carries at most this many; the rest stay unselected.
    this.set({ glossaryIds: glossaryIds.slice(0, this.context.limits.glossariesPerRequestMax) });
  }

  // --- Modes -----------------------------------------------------------------------------------

  /**
   * Switches the mode; each text mode keeps its own text and result. `initialText` starts the
   * new mode with that text instead.
   */
  switchMode(mode: TranslatorMode, initialText: string | null = null): void {
    if (mode === this.state.mode && initialText === null) return;
    this.suggestionCache.clear();
    if (initialText !== null) {
      this.invalidate(mode);
      this.set({
        [mode]: {
          ...this.state[mode],
          source: initialText,
          sourceSentences: [],
          targetSentences: [],
          baselineTargetSentences: [],
          lastSourceText: '',
          detectedSource: null,
          outputText: null,
        },
        processed: { ...this.state.processed, [mode]: null },
      } as Partial<TranslatorState>);
    }
    this.set({ mode, error: null });
    if (initialText !== null && initialText.trim().length > DETECT_MIN_LENGTH) this.scheduleDetection();
  }

  /**
   * The result as the text of the other text mode, processed right away. The source is set to
   * the language the text is in, as if the user had chosen it: the translation's target language
   * going into rewriting, the rewritten text's own language going back into translating (left at
   * `auto` while that is not known).
   */
  private transferTarget(mode: TextMode): void {
    const text = this.outputText;
    if (!text.trim()) return;
    const language: SourceLanguage = mode === 'rephrase' ? this.state.translate.targetLang : this.state.rephrase.sourceLang;
    this.switchMode(mode, text);
    this.set({ userSetSourceLang: language !== 'auto' });
    this.patchBuffer({ sourceLang: language }, mode);
    this.preventSameLanguage('source');
    void this.run();
  }

  /** The translation as the text to rewrite. */
  improveTarget(): void {
    this.transferTarget('rephrase');
  }

  /** The rewritten text as the text to translate. */
  translateTarget(): void {
    this.transferTarget('translate');
  }

  // --- Sentences of the result -----------------------------------------------------------------

  /** Which source (rewriting) or original result (translating) sentence each shown one is. */
  mapping(): number[] {
    const buffer = this.buffer;
    return sentenceMapping(
      buffer.targetSentences,
      this.textMode === 'rephrase' ? buffer.sourceSentences : buffer.baselineTargetSentences,
    );
  }

  /** The source sentence a shown sentence belongs to; `null` for one the user added. */
  sourceIndexOf(index: number): number | null {
    const mapped = sentenceMapping(this.buffer.targetSentences, this.buffer.baselineTargetSentences)[index];
    return mapped === undefined || mapped === -1 ? null : mapped;
  }

  private originalOf(index: number): string | undefined {
    const buffer = this.buffer;
    const baseline = this.textMode === 'rephrase' ? buffer.sourceSentences : buffer.baselineTargetSentences;
    const mapped = this.mapping()[index];
    return mapped === undefined || mapped === -1 ? undefined : baseline[mapped];
  }

  /** Whether a shown sentence differs from where it came from, so undo has something to do. */
  isSentenceChanged(index: number): boolean {
    const original = this.originalOf(index);
    const current = this.buffer.targetSentences[index];
    return original !== undefined && current !== undefined && original !== current;
  }

  undoSentence(index: number): void {
    const original = this.originalOf(index);
    if (original === undefined) return;
    const targetSentences = [...this.buffer.targetSentences];
    // The whitespace after the sentence stays, so it does not run into the next one.
    const trailing = /\s*$/.exec(targetSentences[index] ?? '')?.[0] ?? '';
    targetSentences[index] = original.trimEnd() + trailing;
    this.patchBuffer({ targetSentences });
  }

  private sentenceSource(index: number): string {
    const buffer = this.buffer;
    return (
      (this.textMode === 'translate' ? buffer.targetSentences[index] : buffer.sourceSentences[index]) ??
      buffer.targetSentences[index] ??
      ''
    );
  }

  /** What the list of suggestions starts with: the sentence or the word as it is. */
  suggestionOriginal(target: SuggestionTarget): string {
    if (target.kind === 'word') {
      return sentenceTokens(this.buffer.targetSentences[target.index] ?? '')[target.tokenIndex ?? -1] ?? '';
    }
    return this.sentenceSource(target.index);
  }

  private cacheKey(target: SuggestionTarget): string {
    return target.kind === 'word' ? `${target.index}-${target.tokenIndex}` : String(target.index);
  }

  cachedSuggestions(target: SuggestionTarget): string[] | undefined {
    return this.suggestionCache.get(this.cacheKey(target));
  }

  /**
   * Suggestions for a sentence (other wordings) or a word (other words in its sentence); `more`
   * asks for further ones on top of those shown. The server takes a suggestion text of at most
   * `suggestTextMax` characters and at most 50 exclusions.
   */
  async loadSuggestions(target: SuggestionTarget, more = false, signal?: AbortSignal): Promise<string[]> {
    const key = this.cacheKey(target);
    const known = this.suggestionCache.get(key) ?? [];
    if (known.length > 0 && !more) return known;
    const original = this.suggestionOriginal(target);
    const language = this.currentTarget();
    const exclusions = known.slice(-SUGGEST_EXCLUSIONS_MAX);
    const { suggestTextMax } = this.context.limits;
    let request: SuggestRequest;
    if (target.kind === 'word') {
      const tokens = sentenceTokens(this.buffer.targetSentences[target.index] ?? '');
      if (target.tokenIndex !== null && tokens[target.tokenIndex] !== undefined) {
        tokens[target.tokenIndex] = `[[TARGET]]${tokens[target.tokenIndex]}[[TARGET]]`;
      }
      request = {
        kind: 'synonyms',
        text: original.slice(0, suggestTextMax),
        context: tokens.join('').slice(0, suggestTextMax * 2),
        language: language as TranslatorLanguage | null,
        exclusions,
      };
    } else {
      request = {
        kind: 'alternatives',
        text: original.slice(0, suggestTextMax),
        language: language as TranslatorLanguage | null,
        formality: this.state.formality,
        style: this.state.style,
        tone: this.state.tone,
        exclusions,
      };
    }
    const suggestions = await this.api.suggest(request, signal);
    const list = [...known, ...suggestions.filter((suggestion) => !known.includes(suggestion))];
    this.suggestionCache.set(key, list);
    return list;
  }

  /**
   * Puts a suggestion into the result: a sentence in place of the sentence, a word in place of
   * the word, after which the sentence is corrected to fit it.
   */
  async applySuggestion(target: SuggestionTarget, text: string): Promise<void> {
    const mode = this.textMode;
    const buffer = this.buffer;
    const targetSentences = [...buffer.targetSentences];
    if (target.kind === 'word') {
      const original = targetSentences[target.index] ?? '';
      const tokens = sentenceTokens(original);
      if (target.tokenIndex === null || tokens[target.tokenIndex] === undefined) return;
      tokens[target.tokenIndex] = text.replace(/\[\[TARGET\]\]/g, '');
      const sentence = tokens.join('');
      const trailing = /[\s\r\n]+$/.exec(sentence)?.[0] ?? '';
      targetSentences[target.index] = sentence;
      this.patchBuffer({ targetSentences });
      this.set({ pendingSentences: [target.index] });
      const language = this.currentTarget() as TranslatorLanguage | null;
      try {
        const [corrected] = await this.api.suggest({
          kind: 'correction',
          text: sentence.trim(),
          context: original,
          language,
        });
        // The correction is for this sentence in this mode: a switched mode or an edited
        // sentence (or a result that was redone) is not its business.
        if (corrected && this.textMode === mode && this.state[mode].targetSentences[target.index] === sentence) {
          const next = [...this.state[mode].targetSentences];
          next[target.index] = corrected.replace(/[\s\r\n]+$/, '') + trailing;
          this.patchBuffer({ targetSentences: next }, mode);
        }
      } catch {
        // The word is in; the correction is a nicety.
      } finally {
        this.set({ pendingSentences: null });
      }
      return;
    }
    const current = targetSentences[target.index] ?? buffer.sourceSentences[target.index] ?? '';
    const trailing = /[\s\r\n]+$/.exec(current)?.[0] ?? '';
    targetSentences[target.index] = text.replace(/[\s\r\n]+$/, '') + trailing;
    this.patchBuffer({ targetSentences });
  }

  /**
   * A sentence the user added to the result goes into the source, after the source sentence of
   * the result sentence before it; translating, it is translated back into the source language.
   */
  async pushToSource(index: number): Promise<void> {
    const mode = this.textMode;
    const buffer = this.buffer;
    const sentence = buffer.targetSentences[index];
    if (!sentence) return;
    const mapping = sentenceMapping(buffer.targetSentences, buffer.baselineTargetSentences);
    let after = -1;
    for (let pointer = index - 1; pointer >= 0; pointer--) {
      if ((mapping[pointer] ?? -1) !== -1) {
        after = mapping[pointer]!;
        break;
      }
    }
    const trailing = /[\s\n\r]+$/.exec(sentence)?.[0] ?? ' ';
    const punctuated = (text: string): string =>
      (/[.!?]+$/.test(text.trim()) ? text.trim() : `${text.trim()}.`) + trailing;
    const insertAt = after === -1 ? 0 : after + 1;
    const sources = splitIntoSentences(buffer.source);
    const leading = insertAt > 0 && sources[insertAt - 1] && !/[\s\n\r]$/.test(sources[insertAt - 1]!) ? ' ' : '';
    const insert = (text: string): string[] => {
      const next = [...sources];
      next.splice(insertAt, 0, leading + text);
      return next;
    };
    const literal = punctuated(sentence);
    const finish = (text: string): void => {
      const nextSources = insert(text);
      const source = nextSources.join('');
      const baseline = [...this.state[mode].baselineTargetSentences];
      if (mode === 'translate') baseline.splice(insertAt, 0, `${sentence.trim()}${trailing}`);
      this.patchBuffer(
        {
          source,
          sourceSentences: splitIntoSentences(source.trim()),
          baselineTargetSentences: mode === 'translate' ? baseline : this.state[mode].baselineTargetSentences,
        },
        mode,
      );
      const processed = this.state.processed[mode];
      if (processed) {
        this.set({ processed: { ...this.state.processed, [mode]: { ...processed, text: source.trim() } } });
      }
    };
    if (mode === 'rephrase') {
      finish(literal);
      return;
    }
    // The sentence goes in as it is, at once; its translation replaces it, unless the source was
    // changed meanwhile: newer typing is never overwritten.
    const provisional = insert(literal).join('');
    this.patchBuffer({ source: provisional }, mode);
    this.set({ pendingSentences: [index] });
    const unchanged = (): boolean => this.state[mode].source === provisional;
    try {
      const { sourceLang, targetLang, detectedSource } = this.state.translate;
      // Back into the language of the source: the chosen one, else the one detected. Without
      // either the sentence's language is detected and the target is the other of the two.
      const known = sourceLang !== 'auto' ? sourceLang : detectedSource;
      const response =
        known && known !== targetLang
          ? await this.api.translate({ text: [sentence], source: targetLang, target: known })
          : await this.api.translate({ text: [sentence], source: null, target: alternativeTarget(targetLang) });
      if (unchanged()) finish(punctuated(response.text[0] ?? sentence));
    } catch {
      if (unchanged()) finish(literal);
    } finally {
      this.set({ pendingSentences: null });
    }
  }
}

/** The server takes this many exclusions per suggestion request. */
const SUGGEST_EXCLUSIONS_MAX = 50;

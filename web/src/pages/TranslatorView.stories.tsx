import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn, userEvent, waitFor } from 'storybook/test';
import { TranslatorView } from './TranslatorView';
import { AuthProvider } from '../contexts/AuthContext';
import { ModalProvider } from '../contexts/ModalContext';
import { AppNavProvider } from '../contexts/AppNavContext';
import { KbSearchProvider } from '../contexts/KbSearchContext';
import { useKbSearchState } from '../hooks/useKbSearchState';
import { resetTranslatorConfig } from '../components/translator/translatorConfig';
import { SESSION_KEY, type TranslatorApi } from '../components/translator/translatorStore';
import type { TranslateRequest, RephraseRequest } from '../components/translator/types';
import type { User } from '../types';

/* ---------------------------------------------------------------------------
 * „Übersetzung": the translation extension's page. The page reads GET /api/translator/config
 * and GET /api/glossaries through axios (mocked at the network boundary, .storybook/mockApi.ts);
 * the requests of a translation go through an injected `TranslatorApi`, so a story reads what
 * was sent. The expected strings are the German ones of src/i18n/translations.ts; the request
 * bodies are the contract's (docs/api-contracts/translator.md).
 * ------------------------------------------------------------------------- */

const USER: User = { id: 'user-1', username: 'grace', role: 'user' };

const CONFIG = {
  enabled: true,
  defaultTargetLanguage: 'en-gb',
  languages: [
    { code: 'en-gb', name: 'English (UK)' },
    { code: 'de', name: 'German' },
    { code: 'fr', name: 'French' },
  ],
  glossaryLanguages: ['de', 'en'],
  model: 'gemma-3-27b',
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

const GLOSSARIES = {
  languages: ['de', 'en', 'uk', 'fr', 'es', 'it'],
  glossaries: [
    {
      id: 'g-1',
      name: 'Hochschulbegriffe',
      description: '',
      category: 'general',
      visibility: 'private',
      entryCount: 12,
      creatorName: 'Ada Lovelace',
      role: 'owner',
      isMember: true,
      canEdit: true,
      canManage: true,
      canDelete: true,
      createdAt: '2026-01-05T09:00:00Z',
      updatedAt: '2026-01-06T09:00:00Z',
    },
  ],
};

interface HarnessArgs {
  translate: (request: TranslateRequest) => void;
  rephrase: (request: RephraseRequest) => void;
  /** How long a translation takes, in ms; none while left out. */
  translateDelay?: number;
}

function StoryKbSearchProvider({ children }: { children: React.ReactNode }) {
  const kbSearch = useKbSearchState();
  return <KbSearchProvider value={kbSearch}>{children}</KbSearchProvider>;
}

function Harness({ translate, rephrase, translateDelay = 0 }: HarnessArgs) {
  const api: TranslatorApi = {
    translate: async (request) => {
      translate(request);
      if (translateDelay > 0) await new Promise((resolve) => setTimeout(resolve, translateDelay));
      return { text: request.text.map((sentence) => `EN: ${sentence.trim()} `), detectedSource: 'de' };
    },
    rephrase: async (request) => {
      rephrase(request);
      return { text: request.text.map((sentence) => sentence.toUpperCase()), detectedLanguage: 'de' };
    },
    detect: async () => 'de',
    suggest: async () => ['Eine andere Formulierung.'],
  };
  return (
    <AuthProvider user={USER} token="story-token" logout={fn()} siteConfigs={{}}>
      <ModalProvider>
        <AppNavProvider
          value={{
            onViewMyTopics: fn(),
            onViewSharedTopics: fn(),
            onViewDiscover: fn(),
            onViewTranslator: fn(),
            onViewProfile: fn(),
            onEditGlobalKb: fn(),
            onViewLegal: fn(),
            onOpenTopic: fn(),
            onOpenSource: fn(),
            onOpenChat: fn(),
            onOpenTopicSettings: fn(),
            onOpenRagSettings: fn(),
          }}
        >
          <StoryKbSearchProvider>
            <TranslatorView api={api} />
          </StoryKbSearchProvider>
        </AppNavProvider>
      </ModalProvider>
    </AuthProvider>
  );
}

const meta = {
  title: 'Views/TranslatorView',
  component: Harness,
  parameters: { layout: 'fullscreen', api: { translatorConfig: CONFIG, glossaries: GLOSSARIES } },
  // The config is read once per session and the text kept in the tab's session: both start empty.
  beforeEach: async () => {
    resetTranslatorConfig();
    sessionStorage.removeItem(SESSION_KEY);
    localStorage.setItem('language', 'de');
    return () => {
      resetTranslatorConfig();
      sessionStorage.removeItem(SESSION_KEY);
    };
  },
  args: { translate: fn(), rephrase: fn() },
} satisfies Meta<typeof Harness>;

export default meta;
type Story = StoryObj<typeof meta>;

/** The page at rest: the two modes by their names, the text board and the settings. */
export const Default: Story = {
  play: async ({ canvas }) => {
    await expect(await canvas.findByRole('heading', { level: 1, name: 'Übersetzung' })).toBeInTheDocument();
    await expect(canvas.getByRole('button', { name: 'Text übersetzen' })).toHaveAttribute('aria-pressed', 'true');
    await expect(canvas.getByRole('button', { name: 'Text überarbeiten' })).toHaveAttribute('aria-pressed', 'false');
    // The target language is the admin's default.
    await expect(canvas.getByRole('button', { name: /^Zielsprache: Englisch \(UK\)/ })).toBeInTheDocument();
    await expect(canvas.getByRole('button', { name: 'Übersetzen' })).toBeDisabled();
  },
};

/** A text goes out sentence by sentence and the answer comes back one string per sentence. */
export const Translates: Story = {
  play: async ({ canvas, args }) => {
    await userEvent.type(await canvas.findByLabelText('Text zum Übersetzen'), 'Guten Morgen. Bis bald.');
    await userEvent.click(canvas.getByRole('button', { name: 'Übersetzen' }));

    await waitFor(() => expect(args.translate).toHaveBeenCalledTimes(1));
    // ORACLE: docs/api-contracts/translator.md — a text travels as its sentences, each with the
    // whitespace that follows it, and the source is the detected German.
    await expect(args.translate).toHaveBeenCalledWith(
      expect.objectContaining({
        text: ['Guten Morgen. ', 'Bis bald.'],
        source: 'de',
        target: 'en-gb',
      }),
    );
    await waitFor(() =>
      expect(canvas.getByRole('textbox', { name: 'Übersetzung' })).toHaveTextContent('EN: Guten Morgen. EN: Bis bald.'),
    );
  },
};

/** The glossaries of the user are offered in the settings; the chosen ones go with the request. */
export const WithGlossary: Story = {
  play: async ({ canvas, args }) => {
    await userEvent.click(await canvas.findByRole('button', { name: /^Glossare/ }));
    await userEvent.click(await canvas.findByRole('checkbox', { name: /Hochschulbegriffe/ }));
    await userEvent.click(canvas.getByRole('button', { name: 'Zurück' }));
    await userEvent.type(canvas.getByLabelText('Text zum Übersetzen'), 'Die Hochschule ist offen.');
    await userEvent.click(canvas.getByRole('button', { name: 'Übersetzen' }));
    await waitFor(() => expect(args.translate).toHaveBeenCalledWith(expect.objectContaining({ glossaryIds: ['g-1'] })));
  },
};

/** The extension is switched off: the page says so and offers nothing to translate. */
export const SwitchedOff: Story = {
  parameters: { api: { translatorConfig: { ...CONFIG, enabled: false }, glossaries: GLOSSARIES } },
  play: async ({ canvas }) => {
    await expect(
      await canvas.findByText('Die Übersetzung ist nicht aktiviert. Wende dich an die Administration.'),
    ).toBeInTheDocument();
    await expect(canvas.queryByLabelText('Text zum Übersetzen')).toBeNull();
  },
};

/** The tab still holds the text of another user (signed out without the page noticing): it is not shown, and it is deleted. */
export const IgnoresAnotherUsersSession: Story = {
  beforeEach: () => {
    sessionStorage.setItem(
      SESSION_KEY,
      JSON.stringify({ version: 2, userId: 'someone-else', mode: 'translate', translate: { source: 'Vertraulicher Text' } }),
    );
  },
  play: async ({ canvas }) => {
    await expect(await canvas.findByLabelText('Text zum Übersetzen')).toHaveValue('');
    await expect(canvas.queryByDisplayValue('Vertraulicher Text')).toBeNull();
    await expect(sessionStorage.getItem(SESSION_KEY)).toBeNull();
  },
};

/** The user's own session in the tab is taken back, and the button stays off for a text that was not changed. */
export const RestoresOwnSession: Story = {
  beforeEach: () => {
    sessionStorage.setItem(
      SESSION_KEY,
      JSON.stringify({ version: 2, userId: USER.id, mode: 'translate', translate: { source: 'Guten Morgen.' } }),
    );
  },
  play: async ({ canvas }) => {
    await expect(await canvas.findByLabelText('Text zum Übersetzen')).toHaveValue('Guten Morgen.');
    // Never translated: the button is on.
    await expect(canvas.getByRole('button', { name: 'Übersetzen' })).toBeEnabled();
  },
};

/** The languages cannot be swapped while a translation is on its way: it would answer for the exchanged texts. */
export const SwapOffWhileTranslating: Story = {
  args: { translateDelay: 600 },
  play: async ({ canvas, args }) => {
    await userEvent.type(await canvas.findByLabelText('Text zum Übersetzen'), 'Guten Morgen.');
    await userEvent.click(canvas.getByRole('button', { name: 'Übersetzen' }));
    await waitFor(() => expect(args.translate).toHaveBeenCalledTimes(1));
    await expect(canvas.getByRole('button', { name: 'Sprachen tauschen' })).toBeDisabled();
    await waitFor(() => expect(canvas.getByRole('button', { name: 'Sprachen tauschen' })).toBeEnabled());
    await expect(canvas.getByRole('textbox', { name: 'Übersetzung' })).toHaveTextContent('EN: Guten Morgen.');
  },
};

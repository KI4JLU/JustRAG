import { useEffect, useId, useState, useSyncExternalStore } from 'react';
import { Alert, AlertDescription, Container, PageHeader, SegmentedControl, Spinner } from '@ki4jlu/design-system';
import { TriangleAlert } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { useTheme } from '../contexts/ThemeContext';
import { AppChrome } from '../components/shell/AppChrome';
import { detectLanguage, fetchSuggestions, rephraseText, translateText } from '../components/translator/api';
import { GlossaryDialog } from '../components/translator/GlossaryDialog';
import { defaultTarget } from '../components/translator/languages';
import { TextBoard } from '../components/translator/TextBoard';
import { useTranslatorConfig } from '../components/translator/translatorConfig';
import { TranslatorSettings } from '../components/translator/TranslatorSettings';
import { readStoredSession } from '../components/translator/translatorSessionStorage';
import {
  parseSession,
  TRANSLATOR_MODES,
  TranslatorStore,
  type TranslatorApi,
} from '../components/translator/translatorStore';
import type { TranslatorConfig } from '../components/translator/types';
import { useGlossaries } from '../components/translator/useGlossaries';
import { sessionStore } from '../utils/sessionStore';

/** Anchors the skip link; must match the `contentId` handed to `AppChrome`. */
const CONTENT_ID = 'translator-content';

const API: TranslatorApi = {
  translate: translateText,
  rephrase: rephraseText,
  detect: detectLanguage,
  suggest: fetchSuggestions,
};

export interface TranslatorViewProps {
  /** What the store talks to; the translator's routes while left out (tests, stories). */
  api?: TranslatorApi;
}

/**
 * „Übersetzung": translate a text or rewrite it. The work area is the text board (source and
 * editable result side by side); beside it sit the settings of the mode (live editing, glossaries,
 * style). The state lives in the tab's session, so a reload keeps text and settings. Shown only
 * while the extension is switched on (`config.enabled`); a direct visit while it is off says so.
 */
export function TranslatorView({ api = API }: TranslatorViewProps) {
  const { t } = useTheme();
  const { status, config } = useTranslatorConfig();

  return (
    <AppChrome active="translator" contentId={CONTENT_ID}>
      <section id={CONTENT_ID} aria-label={t('translatorTitle')} className="flex flex-col">
        <Container size="page" className="flex flex-col gap-stack-lg py-gutter md:py-margin-page">
          <PageHeader title={t('translatorTitle')} description={t('translatorDescription')} />
          {status === 'idle' || status === 'loading' ? (
            <Spinner label={t('loading')} className="self-center" />
          ) : config === null ? (
            <Alert tone="warning" icon={<TriangleAlert />}>
              <AlertDescription>{t('translatorUnavailable')}</AlertDescription>
            </Alert>
          ) : !config.enabled ? (
            <Alert tone="warning" icon={<TriangleAlert />}>
              <AlertDescription>{t('translatorDisabled')}</AlertDescription>
            </Alert>
          ) : (
            <TranslatorWorkspace config={config} api={api} />
          )}
        </Container>
      </section>
    </AppChrome>
  );
}

/** The page's work area. Mounted once the config is known: the store starts from its default target. */
function TranslatorWorkspace({ config, api }: { config: TranslatorConfig; api: TranslatorApi }) {
  const { t } = useTheme();
  const { user } = useAuth();
  const id = useId();
  const glossaries = useGlossaries();
  const [manageGlossaries, setManageGlossaries] = useState(false);

  // The stored session is the signed-in user's own: another one's is deleted, not shown.
  const [store] = useState(() => {
    const storage = sessionStore();
    const stored = readStoredSession(storage, user.id);
    return new TranslatorStore(api, parseSession(stored, defaultTarget(config)), storage, user.id);
  });
  // A store that was let go writes nothing more, so a late answer cannot put the text back after
  // sign-out; development runs the cleanup and the setup twice, hence `activate`.
  useEffect(() => {
    store.activate();
    return () => store.dispose();
  }, [store]);
  const state = useSyncExternalStore(store.subscribe, store.getState);

  const list = glossaries.data?.glossaries;
  useEffect(() => {
    store.setContext({ glossaryIds: list ? list.map((glossary) => glossary.id) : null, limits: config.limits });
  }, [store, list, config.limits]);

  return (
    <>
      <SegmentedControl
        aria-label={t('translatorMode')}
        options={TRANSLATOR_MODES.map((option) => ({
          value: option,
          label: t(option === 'translate' ? 'translatorModeTranslate' : 'translatorModeRephrase'),
        }))}
        value={state.mode}
        onValueChange={(next) => {
          const choice = TRANSLATOR_MODES.find((option) => option === next);
          if (choice) store.switchMode(choice);
        }}
        className="self-start"
      />
      <div className="grid items-start gap-stack-lg lg:grid-cols-[minmax(0,1fr)_18rem]">
        <TextBoard id={id} store={store} />
        <aside aria-label={t('translatorSettings')} className="flex flex-col gap-stack-lg">
          <TranslatorSettings
            id={`${id}-settings`}
            state={state}
            glossaries={list}
            glossariesFailed={glossaries.failed}
            onRetryGlossaries={() => void glossaries.reload()}
            onLive={(live) => store.setLive(live)}
            onShowChanges={(show) => store.setShowChanges(show)}
            onGlossaries={(ids) => store.setGlossaries(ids)}
            onManageGlossaries={() => setManageGlossaries(true)}
            onStyle={(style) => store.selectStyle(style)}
            onTone={(tone) => store.selectTone(tone)}
            onFormality={(formality) => store.selectFormality(formality)}
            onResetStyle={() => store.resetStyle()}
          />
        </aside>
      </div>
      <GlossaryDialog
        open={manageGlossaries}
        onOpenChange={setManageGlossaries}
        list={glossaries.data}
        failed={glossaries.failed}
        onChanged={glossaries.reload}
      />
    </>
  );
}

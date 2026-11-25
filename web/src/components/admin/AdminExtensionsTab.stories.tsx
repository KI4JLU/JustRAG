import { useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn, userEvent, waitFor } from 'storybook/test';
import AdminExtensionsTab from './AdminExtensionsTab';
import { resetTranslatorConfig } from '../translator/translatorConfig';

/* ---------------------------------------------------------------------------
 * „Erweiterungen" → „Übersetzung": the switch, the default target language and, read-only, the
 * model in use. ORACLE: the contract (docs/api-contracts/translator.md): the model is `config.model`
 * of GET /api/translator/config (mocked at the network boundary, .storybook/mockApi.ts) and is
 * set where `model_tier_fast` is, not here; the German strings are those of
 * src/i18n/translations.ts.
 * ------------------------------------------------------------------------- */

const CONFIG = {
  enabled: false, defaultTargetLanguage: 'de',
  languages: [{ code: 'en-gb', name: 'English (UK)' }, { code: 'de', name: 'German' }, { code: 'fr', name: 'French' }],
  glossaryLanguages: ['de', 'en'], model: 'gemma-3-27b', modelSource: 'fastTier',
  limits: { textMax: 50000, segmentsMax: 5000, detectSampleMax: 500, suggestTextMax: 2000, glossariesPerRequestMax: 20, glossaryImportMaxBytes: 5242880 },
};

function Harness({ initial, onSubmit }: { initial: Record<string, string>; onSubmit: (configs: Record<string, string>) => void }) {
  const [siteConfigs, setSiteConfigs] = useState(initial);
  return (
    <div className="p-6">
      <AdminExtensionsTab
        siteConfigs={siteConfigs}
        setSiteConfigs={setSiteConfigs}
        onSubmit={(e) => { e.preventDefault(); onSubmit(siteConfigs); }}
      />
    </div>
  );
}

const meta = {
  title: 'Admin/AdminExtensionsTab',
  component: Harness,
  parameters: { layout: 'fullscreen', api: { translatorConfig: CONFIG } },
  beforeEach: () => {
    resetTranslatorConfig();
    localStorage.setItem('language', 'de');
    return () => resetTranslatorConfig();
  },
  args: { initial: { translator_enabled: 'false', translator_default_target_lang: 'de' }, onSubmit: fn() },
} satisfies Meta<typeof Harness>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Off, German as the default language, and the Fast Tier model named as plain text. */
export const Default: Story = {
  play: async ({ canvas }) => {
    await expect(await canvas.findByRole('checkbox', { name: 'Übersetzung aktivieren' })).not.toBeChecked();
    await expect(canvas.getByRole('combobox', { name: 'Standard-Zielsprache' })).toHaveTextContent('Deutsch');
    await waitFor(() => expect(canvas.getByTestId('translator-model')).toHaveTextContent('Fast-Tier-Modell: gemma-3-27b'));
    // The model is not chosen here.
    await expect(canvas.queryByRole('combobox', { name: 'Sprachmodell' })).toBeNull();
  },
};

/** Switching on and saving hands over both global-only site_config keys. */
export const SwitchOn: Story = {
  play: async ({ canvas, args }) => {
    await userEvent.click(await canvas.findByRole('checkbox', { name: 'Übersetzung aktivieren' }));
    await userEvent.click(canvas.getByRole('button', { name: /Einstellungen speichern|Speichern/ }));
    await expect(args.onSubmit).toHaveBeenCalledWith({ translator_enabled: 'true', translator_default_target_lang: 'de' });
  },
};

/** No Fast Tier model set: the provider's default chat model answers, and the line says so. */
export const DefaultChatModel: Story = {
  parameters: { api: { translatorConfig: { ...CONFIG, model: 'qwen-chat', modelSource: 'default' } } },
  play: async ({ canvas }) => {
    await waitFor(() => expect(canvas.getByTestId('translator-model')).toHaveTextContent('Standard-Chatmodell des Anbieters: qwen-chat'));
  },
};

/** Neither a Fast Tier model nor an active provider: no model can answer, and the line says so. */
export const NoModelSet: Story = {
  parameters: { api: { translatorConfig: { ...CONFIG, model: '', modelSource: '' } } },
  play: async ({ canvas }) => {
    await waitFor(() => expect(canvas.getByTestId('translator-model')).toHaveTextContent('Kein Modell verfügbar'));
  },
};

import { describe, it, expect, beforeEach, vi, type Mock } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import axios from 'axios';
import { AdminHarness } from '../../test/AdminHarness';
import { resetTranslatorConfig } from '../translator/translatorConfig';
import { adminSectionKeywords, ADMIN_SEARCH_KEYS } from './adminSearchKeywords';
import { ADMIN_SECTIONS } from '../../hooks/adminDialog';

/* ---------------------------------------------------------------------------
 * „Erweiterungen" with „Übersetzung": on/off (`translator_enabled`), the default target
 * language (`translator_default_target_lang`) and, read-only, the model in use.
 *
 * ORACLE: the contract (docs/api-contracts/translator.md, API.md "Translator and glossaries"):
 * both keys are global-only site_config keys saved with POST /api/site-config like the other
 * site settings (a superadmin route, so the section is superadmin-only); the model is
 * `config.model` of GET /api/translator/config and is not saved here. The expected bodies are
 * written out by hand below.
 * ------------------------------------------------------------------------- */

vi.mock('axios', () => ({
    default: { get: vi.fn(), post: vi.fn() },
}));

// Stable objects: `t` and `toast` sit in AdminUI's fetch dependency lists.
const themeMock = { t: (k: string) => k, language: 'en' as const };
vi.mock('../../contexts/ThemeContext', () => ({ useTheme: () => themeMock }));
const toastMock = { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() };
vi.mock('../../contexts/ToastContext', () => ({ useToast: () => toastMock }));
const modalMock = { showConfirm: vi.fn(), showAlert: vi.fn(), showPrompt: vi.fn() };
vi.mock('../../contexts/ModalContext', () => ({ useModalContext: () => modalMock }));
vi.mock('../../hooks/useReducedMotion', () => ({ useReducedMotion: () => false, getMotionProps: () => ({}) }));

const mockedGet = axios.get as unknown as Mock;
const mockedPost = axios.post as unknown as Mock;

const TRANSLATOR_CONFIG = {
    enabled: false,
    defaultTargetLanguage: 'de',
    languages: [{ code: 'en-gb', name: 'English (UK)' }, { code: 'de', name: 'German' }, { code: 'fr', name: 'French' }],
    glossaryLanguages: ['de', 'en'],
    model: 'gemma-3-27b',
    modelSource: 'fastTier',
    limits: { textMax: 50000, segmentsMax: 5000, detectSampleMax: 500, suggestTextMax: 2000, glossariesPerRequestMax: 20, glossaryImportMaxBytes: 5242880 },
};

function answerWith(site: Record<string, string>) {
    mockedGet.mockImplementation((url: string) => {
        const u = String(url);
        if (u.includes('/api/site-config')) return Promise.resolve({ data: site });
        if (u.includes('/api/translator/config')) return Promise.resolve({ data: TRANSLATOR_CONFIG });
        return Promise.resolve({ data: [] });
    });
}

beforeEach(() => {
    vi.clearAllMocks();
    resetTranslatorConfig();
    mockedPost.mockResolvedValue({ data: {} });
    answerWith({ translator_enabled: 'false', translator_default_target_lang: 'de' });
});

describe('AdminUI — Erweiterungen', () => {
    it('is superadmin-only: an admin has no such section', () => {
        render(<AdminHarness userRole="admin" />);
        expect(screen.queryByRole('button', { name: 'adminTabExtensions' })).toBeNull();
    });

    it('lists the section in the configuration group of a superadmin', () => {
        render(<AdminHarness userRole="superadmin" />);
        expect(screen.getByRole('button', { name: 'adminTabExtensions' })).toBeTruthy();
    });

    it('shows the stored values and names the model read-only', async () => {
        render(<AdminHarness userRole="superadmin" section="extensions" />);
        const enabled = await screen.findByRole('checkbox', { name: 'translatorEnabled' });
        expect(enabled).not.toBeChecked();
        expect(screen.getByRole('combobox', { name: 'translatorDefaultTargetLanguage' })).toHaveTextContent('translatorLang_de');
        // The model is `config.model`, shown as text: nothing to type into.
        await waitFor(() => expect(screen.getByTestId('translator-model')).toHaveTextContent('translatorModelValue'));
        expect(screen.queryByRole('textbox', { name: 'translatorModel' })).toBeNull();
    });

    it('names the provider default as such when no Fast Tier model is set', async () => {
        mockedGet.mockImplementation((url: string) => Promise.resolve({
            data: String(url).includes('/api/translator/config') ? { ...TRANSLATOR_CONFIG, modelSource: 'default' }
                : String(url).includes('/api/site-config') ? {} : [],
        }));
        render(<AdminHarness userRole="superadmin" section="extensions" />);
        await waitFor(() => expect(screen.getByTestId('translator-model')).toHaveTextContent('translatorModelDefaultValue'));
    });

    it('says so when no model can be resolved', async () => {
        mockedGet.mockImplementation((url: string) => Promise.resolve({
            data: String(url).includes('/api/translator/config') ? { ...TRANSLATOR_CONFIG, model: '', modelSource: '' }
                : String(url).includes('/api/site-config') ? {} : [],
        }));
        render(<AdminHarness userRole="superadmin" section="extensions" />);
        await waitFor(() => expect(screen.getByTestId('translator-model')).toHaveTextContent('translatorModelDefault'));
    });

    it('saves the switch and the language through POST /api/site-config', async () => {
        render(<AdminHarness userRole="superadmin" section="extensions" />);
        await userEvent.click(await screen.findByRole('checkbox', { name: 'translatorEnabled' }));
        await userEvent.click(screen.getByRole('button', { name: /saveSettings/ }));

        await waitFor(() => expect(mockedPost).toHaveBeenCalledTimes(1));
        const [url, body] = mockedPost.mock.calls[0];
        expect(String(url)).toMatch(/\/api\/site-config$/);
        expect(body.configs).toMatchObject({ translator_enabled: 'true', translator_default_target_lang: 'de' });
        await waitFor(() => expect(toastMock.success).toHaveBeenCalledWith('settingsSaved'));
    });

    it('reads the translator config again after a save, so the navigation follows the switch', async () => {
        render(<AdminHarness userRole="superadmin" section="extensions" />);
        await userEvent.click(await screen.findByRole('checkbox', { name: 'translatorEnabled' }));
        const before = mockedGet.mock.calls.filter(([u]) => String(u).includes('/api/translator/config')).length;
        await userEvent.click(screen.getByRole('button', { name: /saveSettings/ }));
        await waitFor(() => expect(
            mockedGet.mock.calls.filter(([u]) => String(u).includes('/api/translator/config')).length,
        ).toBeGreaterThan(before));
    });
});

describe('admin search keywords — Erweiterungen', () => {
    it('finds the section by the labels of its settings', () => {
        const keys = ADMIN_SEARCH_KEYS.extensions;
        expect(keys).toEqual(expect.arrayContaining([
            'extensionTranslation', 'translatorEnabled', 'translatorDefaultTargetLanguage', 'translatorModel',
        ]));
        expect(adminSectionKeywords((k) => k).extensions).toEqual([...keys]);
    });

    it('has a section in the URL list, after the other configuration sections', () => {
        const order = [...ADMIN_SECTIONS];
        expect(order.indexOf('extensions')).toBeGreaterThan(order.indexOf('site'));
        expect(order.indexOf('extensions')).toBeLessThan(order.indexOf('kb-overview'));
    });
});

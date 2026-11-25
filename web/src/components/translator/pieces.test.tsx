import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AxiosError, type AxiosResponse } from 'axios';
import { CopyButton } from './CopyButton';
import { LanguageMenu } from './LanguageMenu';
import { LanguageSelect } from './LanguageSelect';
import { TranslationOutput } from './TranslationOutput';
import { copyToClipboard } from '../../utils/clipboard';

vi.mock('../../utils/clipboard', () => ({ copyToClipboard: vi.fn() }));
vi.mock('../../hooks/useReducedMotion', () => ({ useReducedMotion: () => false, getMotionProps: () => ({}) }));
const themeMock = { t: (k: string) => k, language: 'en' as const };
vi.mock('../../contexts/ThemeContext', () => ({ useTheme: () => themeMock }));
const toastMock = { success: vi.fn(), error: vi.fn(), warning: vi.fn() };
vi.mock('../../contexts/ToastContext', () => ({ useToast: () => toastMock }));

beforeEach(() => {
  vi.clearAllMocks();
  Element.prototype.scrollIntoView = vi.fn();
  Element.prototype.hasPointerCapture = vi.fn(() => false);
  Element.prototype.setPointerCapture = vi.fn();
  Element.prototype.releasePointerCapture = vi.fn();
});

describe('LanguageMenu', () => {
  it('names the chosen language in its button and lists the languages in the contract’s order', async () => {
    render(<LanguageMenu label="Zielsprache" value="de" onChange={vi.fn()} />);
    const trigger = screen.getByRole('button', { name: 'Zielsprache: translatorLang_de' });
    await userEvent.click(trigger);
    const items = await screen.findAllByRole('menuitemradio');
    expect(items.map((i) => i.textContent)).toEqual([
      'translatorLang_en_gb',
      'translatorLang_en_us',
      'translatorLang_de',
      'translatorLang_uk',
      'translatorLang_fr',
      'translatorLang_es',
      'translatorLang_it',
      'translatorLang_nl',
      'translatorLang_pl',
      'translatorLang_pt',
      'translatorLang_ru',
      'translatorLang_zh',
      'translatorLang_ja',
    ]);
    expect(items.filter((i) => i.getAttribute('aria-checked') === 'true').map((i) => i.textContent)).toEqual([
      'translatorLang_de',
    ]);
  });

  it('offers „Automatisch“ first for a source and reports the choice', async () => {
    const onChange = vi.fn();
    render(<LanguageMenu label="Ausgangssprache" allowAuto value="auto" onChange={onChange} />);
    await userEvent.click(screen.getByRole('button', { name: 'Ausgangssprache: translatorDetectLanguage' }));
    const items = await screen.findAllByRole('menuitemradio');
    expect(items[0]).toHaveTextContent('translatorDetectLanguage');
    // auto, en-gb, en-us, de, uk, fr: the sixth entry.
    await userEvent.click(items[5]);
    expect(onChange).toHaveBeenCalledWith('fr');
  });

  it('has no automatic entry for a target', async () => {
    render(<LanguageMenu label="Zielsprache" value="en-gb" onChange={vi.fn()} />);
    await userEvent.click(screen.getByRole('button', { name: /Zielsprache/ }));
    expect(await screen.findAllByRole('menuitemradio')).toHaveLength(13);
  });
});

describe('LanguageSelect', () => {
  it('reports a chosen language, and null for “detect”', async () => {
    const onChange = vi.fn();
    render(<LanguageSelect id="l" allowDetect value={null} onChange={onChange} detected="fr" />);
    const select = screen.getByRole('combobox');
    // The detected language is named in the detect entry.
    expect(select).toHaveTextContent('translatorDetected');
    select.focus();
    await userEvent.keyboard('{Enter}');
    await userEvent.click(
      within(await screen.findByRole('listbox')).getByRole('option', { name: 'translatorLang_de' }),
    );
    expect(onChange).toHaveBeenCalledWith('de');
  });
});

describe('CopyButton', () => {
  it('copies the text and says so', async () => {
    vi.mocked(copyToClipboard).mockResolvedValue(true);
    render(<CopyButton text="Hallo Welt" />);
    await userEvent.click(screen.getByRole('button', { name: 'translatorCopy' }));
    expect(copyToClipboard).toHaveBeenCalledWith('Hallo Welt');
    expect(await screen.findAllByText('translatorCopied')).not.toHaveLength(0);
  });

  it('tells a clipboard that refuses', async () => {
    vi.mocked(copyToClipboard).mockResolvedValue(false);
    render(<CopyButton text="x" />);
    await userEvent.click(screen.getByRole('button', { name: 'translatorCopy' }));
    expect(toastMock.error).toHaveBeenCalledWith('clipboardCopyFailed');
  });

  it('is off without a text, or says “copied” without touching the clipboard', async () => {
    const off = render(<CopyButton text={undefined} />);
    expect(screen.getByRole('button', { name: 'translatorCopy' })).toBeDisabled();
    off.unmount();
    render(<CopyButton text={undefined} whenEmpty="confirm" />);
    await userEvent.click(screen.getByRole('button', { name: 'translatorCopy' }));
    expect(copyToClipboard).not.toHaveBeenCalled();
    expect((await screen.findAllByText('translatorCopied')).length).toBeGreaterThan(0);
  });
});

describe('TranslationOutput', () => {
  const refused = new AxiosError('x', 'ERR_BAD_RESPONSE', undefined, undefined, {
    status: 502,
    data: { error: 'english', code: 'translator_model_failed' },
  } as AxiosResponse);

  const out = () => document.querySelector('output') as HTMLElement;

  it('shows the text, an empty note, a spinner while pending, and a failure in the shared words', () => {
    const { rerender } = render(<TranslationOutput htmlFor="x" pending={false} error={null} text="Hello" />);
    expect(out()).toHaveTextContent('Hello');
    rerender(<TranslationOutput htmlFor="x" pending={false} error={null} text={undefined} />);
    expect(out()).toHaveTextContent('translatorEmpty');
    rerender(<TranslationOutput htmlFor="x" pending error={null} text={undefined} />);
    expect(out()).toHaveAttribute('aria-busy', 'true');
    rerender(<TranslationOutput htmlFor="x" pending={false} error={refused} text="old" />);
    expect(out()).toHaveTextContent('errorTranslatorModelFailed');
    expect(out()).not.toHaveTextContent('old');
  });
});

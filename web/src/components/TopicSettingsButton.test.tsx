import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { TopicSettingsButton } from './TopicSettingsButton';
import type { TopicSettingsDiff } from '../utils/topicSettingsDiff';

/*
 * ORACLE: the card's acceptance — no dot in the default state, a dot when
 * customized, the accessible name changes with the state, the tooltip opens
 * on keyboard focus — and the owner's ruling (2026-11-11): the tooltip names
 * the areas that differ (own role, own rules, own start page), nothing more.
 */
const DE: Record<string, string> = {
  topicSettingsButton: 'Einstellungen des Themas',
  topicSettingsCustomized: 'angepasst',
};
vi.mock('../contexts/ThemeContext', () => ({ useTheme: () => ({ t: (k: string) => DE[k] ?? k }) }));

const diffOf = (labels: string[]): TopicSettingsDiff => ({
  isCustomized: labels.length > 0, changedKeys: labels.map((_, i) => `k${i}`), labels, count: labels.length,
});
const dot = () => document.querySelector('[data-slot="topic-settings-dot"]');

describe('TopicSettingsButton', () => {
  it('is the plain gear while the topic follows the template', () => {
    render(<TopicSettingsButton diff={diffOf([])} onClick={() => {}} />);
    const gear = screen.getByRole('button', { name: 'Einstellungen des Themas' });
    expect(dot()).toBeNull();
    expect(gear).not.toHaveAttribute('aria-pressed');
    expect(gear).not.toHaveAccessibleDescription();
  });

  it('shows a dot, says it is customised, and names the areas in its description', () => {
    render(<TopicSettingsButton diff={diffOf(['Eigene Rolle', 'Eigene Regeln'])} onClick={() => {}} />);
    const gear = screen.getByRole('button', { name: 'Einstellungen des Themas – angepasst' });
    expect(dot()).toHaveAttribute('aria-hidden', 'true');
    expect(gear).toHaveAccessibleDescription('Eigene Rolle, Eigene Regeln');
    expect(gear).not.toHaveAttribute('aria-pressed');
  });

  it('opens its tooltip on keyboard focus and closes it with Escape', async () => {
    render(<TopicSettingsButton diff={diffOf(['Eigene Startseite'])} onClick={() => {}} />);
    await userEvent.tab();
    expect(screen.getByRole('button')).toHaveFocus();
    const tip = await screen.findByRole('tooltip');
    expect(tip).toHaveTextContent('Einstellungen des Themas');
    expect(tip).toHaveTextContent('Eigene Startseite');
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('tooltip')).toBeNull();
  });

  it('opens the settings on click', async () => {
    const onClick = vi.fn();
    render(<TopicSettingsButton diff={diffOf([])} onClick={onClick} />);
    await userEvent.click(screen.getByRole('button'));
    expect(onClick).toHaveBeenCalledTimes(1);
  });
});

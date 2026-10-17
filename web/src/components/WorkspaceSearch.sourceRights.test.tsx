import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import axios from 'axios';
import { WorkspaceSearchField } from './WorkspaceSearch';
import type { SearchResponse } from '../types';

vi.mock('axios');
const mockedGet = vi.mocked(axios, true).get;
vi.mock('../contexts/ThemeContext', () => ({ useTheme: () => ({ t: (k: string) => k }) }));

const OWN = { id: 'f-1', name: 'Eigene.pdf', type: 'pdf', kbId: 'kb-1', kbName: 'Hier', match: 'prefix' as const };
const OTHER = { id: 'f-2', name: 'Andere.pdf', type: 'pdf', kbId: 'kb-2', kbName: 'Dort', match: 'prefix' as const };
const response = (sources: SearchResponse['sources']): { data: SearchResponse } => ({
  data: { query: 'x', kbId: null, topics: [], sources, chats: [], messages: [] },
});

beforeEach(() => {
  vi.clearAllMocks();
  Element.prototype.scrollIntoView = vi.fn();
  Element.prototype.hasPointerCapture = vi.fn(() => false);
  Element.prototype.setPointerCapture = vi.fn();
  Element.prototype.releasePointerCapture = vi.fn();
});

const renderField = (canOpenOwnSources?: boolean) => render(
  <WorkspaceSearchField kbId="kb-1" kbName="Hier" canOpenOwnSources={canOpenOwnSources}
    onOpenTopic={vi.fn()} onOpenSource={vi.fn()} onOpenChat={vi.fn()} />,
);

// ORACLE: backend contract 2026-10-16 + the UI rule — a hit of this topic
// opens its preview, which loads the file (downloadSources); without that
// right the hit would open nothing, so it is not listed. A hit of another
// topic opens that topic and stays.
describe('WorkspaceSearchField — own source hits follow downloadSources', () => {
  it('lists the topic\'s own source hits with downloadSources', async () => {
    mockedGet.mockResolvedValueOnce(response([OWN, OTHER]));
    renderField(true);
    await userEvent.type(screen.getByRole('combobox'), 'pdf');
    const listbox = await screen.findByRole('listbox');
    expect(within(listbox).getByRole('option', { name: /Eigene\.pdf/ })).toBeInTheDocument();
  });

  it('drops them without it, but keeps the hits of other topics', async () => {
    mockedGet.mockResolvedValueOnce(response([OWN, OTHER]));
    renderField(false);
    await userEvent.type(screen.getByRole('combobox'), 'pdf');
    const listbox = await screen.findByRole('listbox');
    expect(within(listbox).queryByRole('option', { name: /Eigene\.pdf/ })).toBeNull();
    expect(within(listbox).getByRole('option', { name: /Andere\.pdf/ })).toBeInTheDocument();
  });
});

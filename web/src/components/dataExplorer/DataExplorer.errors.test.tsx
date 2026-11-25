import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import DataExplorer from './DataExplorer';
import { authFetch } from '../../api';
import type { DataExplorerConfig } from '../../types';

vi.mock('../../api', async (importOriginal) => ({
  ...await importOriginal<typeof import('../../api')>(),
  authFetch: vi.fn(),
}));
const theme = vi.hoisted(() => ({ t: (k: string) => k }));
vi.mock('../../contexts/ThemeContext', () => ({ useTheme: () => theme }));
vi.mock('../ui/ChartRenderer', () => ({ default: () => null }));
// The toolbar's own controls are not under test: two buttons drive the
// callbacks DataExplorer hands it.
vi.mock('./DataExplorerToolbar', () => ({
  default: ({ config, onChange, onExportCsv }: { config: DataExplorerConfig; onChange: (c: DataExplorerConfig) => void; onExportCsv: () => void }) => (
    <>
      {/* eslint-disable-next-line design-system/no-raw-ui-elements -- test stub for the toolbar */}
      <button onClick={() => onChange({ ...config, query: { ...config.query, groupBy: 'b' } })}>query</button>
      {/* eslint-disable-next-line design-system/no-raw-ui-elements -- test stub for the toolbar */}
      <button onClick={onExportCsv}>export</button>
    </>
  ),
}));

const RAW = 'pq: relation "tab_x" does not exist';
const config: DataExplorerConfig = {
  chartType: 'bar', title: 'T', query: { groupBy: 'a', aggregations: [{ column: 'n', fn: 'SUM' }] }, display: {},
} as DataExplorerConfig;

beforeEach(() => { vi.mocked(authFetch).mockReset(); });

const renderExplorer = () => render(
  <DataExplorer initialConfig={config} initialSeries={[]} schema={{ columns: [], rowCount: 0, preview: [] }} fileId="f1" kbId="kb-1" />,
);

// Oracle: docs/user-error-messages.md A35, A36 — a refused query or export
// shows the feature's own message, never the backend's `error` text.
describe.each([400, 404])('DataExplorer on an uncoded %i', (status) => {
  it('a refused query shows dataExplorerQueryFailed', async () => {
    vi.mocked(authFetch).mockResolvedValue(new Response(JSON.stringify({ error: RAW }), { status }));
    renderExplorer();
    fireEvent.click(screen.getByText('query'));
    expect(await screen.findByText('dataExplorerQueryFailed', {}, { timeout: 2000 })).toBeInTheDocument();
    expect(screen.queryByText(RAW)).not.toBeInTheDocument();
  });

  it('a refused CSV export shows exportFailed', async () => {
    vi.mocked(authFetch).mockResolvedValue(new Response(JSON.stringify({ error: RAW }), { status }));
    renderExplorer();
    fireEvent.click(screen.getByText('export'));
    expect(await screen.findByText('exportFailed')).toBeInTheDocument();
    expect(screen.queryByText(RAW)).not.toBeInTheDocument();
  });
});

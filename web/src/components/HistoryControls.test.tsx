import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import {
  RouterProvider, createMemoryHistory, createRootRoute, createRoute, createRouter, Outlet,
} from '@tanstack/react-router';
import { HistoryControls } from './HistoryControls';

vi.mock('../contexts/ThemeContext', () => ({ useTheme: () => ({ t: (k: string) => k }) }));

/*
 * ORACLE: a browser's own back and forward buttons — back is off on the first
 * entry, forward is off unless the user went back, and a new navigation
 * discards what was ahead.
 */
async function renderWithRouter(Controls: () => React.ReactNode = () => <HistoryControls />) {
  const rootRoute = createRootRoute({ component: () => <><Controls /><Outlet /></> });
  const routes = ['/', '/shared', '/discover'].map((path) => createRoute({ getParentRoute: () => rootRoute, path, component: () => <p>{path}</p> }));
  const router = createRouter({ routeTree: rootRoute.addChildren(routes), history: createMemoryHistory({ initialEntries: ['/'] }) });
  render(<RouterProvider router={router} />);
  const back = await screen.findByRole('button', { name: 'historyBack' });
  return { router, back, forward: () => screen.getByRole('button', { name: 'historyForward' }) };
}

describe('HistoryControls', () => {
  it('has nowhere to go on the first entry', async () => {
    const { back, forward } = await renderWithRouter();
    expect(back).toBeDisabled();
    expect(forward()).toBeDisabled();
  });

  it('enables back after a navigation, and forward only after going back', async () => {
    const { router, forward } = await renderWithRouter();
    await act(() => router.navigate({ to: '/shared' }));
    expect(screen.getByRole('button', { name: 'historyBack' })).toBeEnabled();
    expect(forward()).toBeDisabled();

    await userEvent.click(screen.getByRole('button', { name: 'historyBack' }));
    await screen.findByText('/');
    expect(forward()).toBeEnabled();

    await userEvent.click(forward());
    await screen.findByText('/shared');
    expect(forward()).toBeDisabled();
  });

  it('disables forward again once a new navigation discards what was ahead', async () => {
    const { router, forward } = await renderWithRouter();
    await act(() => router.navigate({ to: '/shared' }));
    await userEvent.click(screen.getByRole('button', { name: 'historyBack' }));
    await screen.findByText('/');
    expect(forward()).toBeEnabled();
    await act(() => router.navigate({ to: '/discover' }));
    expect(forward()).toBeDisabled();
  });

  it('keeps forward available when another view mounts its own buttons', async () => {
    // The overview and the topic view each mount their own HistoryControls,
    // so going back replaces the buttons that saw the navigation.
    const rootRoute = createRootRoute({ component: () => <Outlet /> });
    const routes = ['/', '/shared'].map((path) => createRoute({
      getParentRoute: () => rootRoute, path, component: () => <><HistoryControls /><p>{path}</p></>,
    }));
    const router = createRouter({ routeTree: rootRoute.addChildren(routes), history: createMemoryHistory({ initialEntries: ['/'] }) });
    render(<RouterProvider router={router} />);
    await screen.findByText('/');
    await act(() => router.navigate({ to: '/shared' }));
    const onTopic = await screen.findByRole('button', { name: 'historyBack' });
    await userEvent.click(onTopic);
    await screen.findByText('/');
    expect(screen.getByRole('button', { name: 'historyBack' })).not.toBe(onTopic);
    expect(screen.getByRole('button', { name: 'historyForward' })).toBeEnabled();
  });
});

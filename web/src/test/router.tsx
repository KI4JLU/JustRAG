import { createContext, useContext, useState, type ReactNode } from 'react';
import { RouterProvider, createMemoryHistory } from '@tanstack/react-router';
import { createAppRouter } from '../routing/routes';

/* The element under test, handed to the root route through context rather
 * than captured when the router is created: the router is created once per
 * mount, and a re-render with new children (a story's args, a test's
 * rerender) must show them instead of the first ones. */
const Content = createContext<ReactNode>(null);

function ContentRoot() {
  return <>{useContext(Content)}</>;
}

/**
 * A router around `children`, for components that read the route (Login: the
 * legal pages, the /admin breakglass) rendered outside <App />: the app's real
 * route tree, with `children` as the root component, on a memory history
 * starting at `path`.
 */
export function RouterHarness({ path, children }: { path: string; children: ReactNode }) {
  const [router] = useState(() => createAppRouter({
    rootComponent: ContentRoot,
    history: createMemoryHistory({ initialEntries: [path] }),
  }));
  return (
    <Content.Provider value={children}>
      <RouterProvider router={router} />
    </Content.Provider>
  );
}

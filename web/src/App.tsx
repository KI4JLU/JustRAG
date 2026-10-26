import { useLayoutEffect, useState } from 'react';
import { RouterProvider } from '@tanstack/react-router';
import { captureJoinToken } from './hooks/useJoinLink';
import { createAppRouter } from './routing/routes';
import { bindUrlDialogHistory } from './routing/urlDialog';
import { AppRoot } from './AppRoot';

// Runs once at module load, before React renders anything — the token has to
// be captured whether the user lands on the login screen or straight in the
// app, and before the URL is used for anything else: the router reads the URL
// when it is created on the first render, by which point a /join/<token> path
// has already been rewritten to "/".
captureJoinToken();

export default function App() {
  // One router per mount, created from the URL at that moment. Production
  // mounts once; the route-level tests mount <App /> once per test after
  // setting the URL, and a module-level router would carry the previous
  // test's location into the next.
  const [router] = useState(() => createAppRouter({ rootComponent: AppRoot }));
  // The dialogs that live in a URL parameter (?admin=, ?settings=, ?topic=)
  // write through the router's history, so the router sees every change. An
  // effect, not the initializer above: StrictMode calls that twice and keeps
  // one result, so a binding made there could name the discarded router.
  useLayoutEffect(() => bindUrlDialogHistory(router.history), [router]);
  return <RouterProvider router={router} />;
}

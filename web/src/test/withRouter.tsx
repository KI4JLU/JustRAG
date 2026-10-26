import type { ReactElement } from 'react';
import { RouterHarness } from './router';

/**
 * `ui` inside a RouterHarness starting at `path` — the current window path by
 * default, so a test that sets the URL with `history.pushState` before
 * rendering keeps working.
 */
export function withRouter(ui: ReactElement, path?: string): ReactElement {
  return <RouterHarness path={path ?? window.location.pathname + window.location.search}>{ui}</RouterHarness>;
}

import { useTheme } from '../contexts/ThemeContext';
import { AppChrome } from './AppChrome';
import { CreateCell } from './KbCard';
import { TopicGridPage } from './TopicGridPage';

/* ---------------------------------------------------------------------------
 * „Werkzeuge" — PLACEHOLDER (developer ruling, 18.09.2026).
 *
 * WHAT IT IS FOR. This is where selected tools from the workspace area will
 * live. Nothing has moved yet; the page exists so the destination is real —
 * the nav row, the landmark, the heading and the create tile are all in place,
 * and moving a tool here later is a change to this file rather than a new
 * screen plus a new route plus a new nav entry.
 *
 * WHAT IT DOES TODAY. Renders one control, „Neues Werkzeug", and nothing else.
 *
 * THE CREATE TILE DOES NOTHING YET, AND SAYS SO RATHER THAN PRETENDING. It is
 * `disabled`, so it is announced as unavailable instead of being a button that
 * silently swallows a click — the failure mode a placeholder wired to a no-op
 * handler would have. There is no toast and no "coming soon" dialog either:
 * both are content this card was not asked to write.
 * // TODO: which workspace tools move here, and what creating one does, is not
 * // decided — this page is a placeholder until it is.
 * ------------------------------------------------------------------------- */

/** Anchors the skip link; must match the `contentId` handed to `AppChrome`. */
const CONTENT_ID = 'tools-content';

export function ToolsView() {
  const { t } = useTheme();

  return (
    <AppChrome active="tools" contentId={CONTENT_ID}>
      <TopicGridPage
        id={CONTENT_ID}
        title={t('tools')}
        description={t('toolsDescription')}
        createCell={<CreateCell disabled label={t('newTool')} text={t('newTool')} />}
        items={[]}
      />
    </AppChrome>
  );
}

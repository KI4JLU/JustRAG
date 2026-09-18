import { useTheme } from '../contexts/ThemeContext';
import { AppChrome } from './AppChrome';
import { CreateCell } from './KbCard';
import { TopicGridPage } from './TopicGridPage';
import { TopicFilterBar } from './TopicFilterBar';
import { useTopicFilters } from '../hooks/useTopicFilters';

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
  /* The row is here so the chrome matches the other three views, and it filters
     nothing — there is no list yet. It is wired to the real hook rather than
     stubbed, so the day a tool exists the filter already works. */
  const filters = useTopicFilters();

  return (
    <AppChrome active="tools" contentId={CONTENT_ID}>
      <TopicGridPage
        id={CONTENT_ID}
        title={t('tools')}
        description={t('toolsDescription')}
        createCell={
          <CreateCell
            disabled
            label={t('newTool')}
            text={t('newTool')}
            compact={filters.viewMode === 'list'}
          />
        }
        filterBar={<TopicFilterBar filters={filters} label={t('filterTopics')} />}
        viewMode={filters.viewMode}
        items={[]}
        /* Named content rather than a bare page: the create tile is disabled,
           so without this the page would be one greyed-out control and no
           explanation of why. */
        emptyState={
          <div className="flex flex-col gap-stack-sm">
            <p className="m-0 font-headline-sm text-headline-sm-mobile text-on-surface">
              {t('toolsEmptyTitle')}
            </p>
            <p className="m-0 text-on-surface-variant">{t('toolsEmptyBody')}</p>
          </div>
        }
      />
    </AppChrome>
  );
}

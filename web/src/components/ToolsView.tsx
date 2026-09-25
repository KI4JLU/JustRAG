import { useState } from 'react';
import { FileText } from 'lucide-react';
import { Button, Card, CardDescription, CardHeader, CardTitle } from '@ki4jlu/design-system';
import { useTheme } from '../contexts/ThemeContext';
import type { KnowledgeBase } from '../types';
import { AppChrome } from './AppChrome';
import { TopicGridPage } from './TopicGridPage';
import { TopicFilterBar } from './TopicFilterBar';
import { useTopicFilters } from '../hooks/useTopicFilters';
import { TextDocumentsTool } from './tools/TextDocumentsTool';

/* ---------------------------------------------------------------------------
 * „Werkzeuge" — the tools page.
 *
 * A PLACEHOLDER until 25.09.2026 (developer ruling, 18.09.2026), with one
 * disabled „Neues Werkzeug" tile. Card KI-833 gave it its first real tool,
 * „Textdokumente", and the disabled tile is gone with it: a create tile that
 * cannot create anything next to a tool that can would be the one control on
 * the page that does nothing. The destination-first reasoning of the
 * placeholder still holds — moving a further tool here is one more tile and
 * one more branch below, not a new screen or route.
 *
 * A TOOL OPENS IN PLACE. There is no router (see `useViewState`): the open
 * tool is local state of this view, so leaving the page and coming back
 * starts at the grid again — the same reset the filter chips have.
 * ------------------------------------------------------------------------- */

/** Anchors the skip link; must match the `contentId` handed to `AppChrome`. */
const CONTENT_ID = 'tools-content';

type ToolId = 'text-documents';

export interface ToolsViewProps {
  /** Every topic the caller can see: owned, shared and subscribed public ones. */
  topics: KnowledgeBase[];
}

export function ToolsView({ topics }: ToolsViewProps) {
  const { t } = useTheme();
  /* The row is here so the chrome matches the other three views. It filters
     nothing yet — the grid holds tools, not topics — and is wired to the real
     hook rather than stubbed. */
  const filters = useTopicFilters();
  const [openTool, setOpenTool] = useState<ToolId | null>(null);

  if (openTool === 'text-documents') {
    return (
      <AppChrome active="tools" contentId={CONTENT_ID}>
        <TextDocumentsTool id={CONTENT_ID} topics={topics} onBack={() => setOpenTool(null)} />
      </AppChrome>
    );
  }

  return (
    <AppChrome active="tools" contentId={CONTENT_ID}>
      <TopicGridPage
        id={CONTENT_ID}
        title={t('tools')}
        description={t('toolsDescription')}
        filterBar={<TopicFilterBar filters={filters} label={t('filterTopics')} />}
        viewMode={filters.viewMode}
        items={[
          <ToolTile
            key="text-documents"
            icon={<FileText size={24} aria-hidden="true" />}
            title={t('textDocumentsTool')}
            description={t('textDocumentsToolDescription')}
            openLabel={`${t('openTool')}: ${t('textDocumentsTool')}`}
            onOpen={() => setOpenTool('text-documents')}
          />,
        ]}
      />
    </AppChrome>
  );
}

/** A click on the tile's own button — it already opened the tool. */
const isControlClick = (e: React.MouseEvent) =>
  (e.target as HTMLElement).closest('button, a') !== null;

/**
 * One tool on the grid. The whole card is a mouse target (`role="presentation"`,
 * the pattern `PrivateKbCard` uses); the accessible control is the title
 * button, which carries the name and the keyboard path.
 */
function ToolTile({ icon, title, description, openLabel, onOpen }: {
  icon: React.ReactNode;
  title: string;
  description: string;
  openLabel: string;
  onOpen: () => void;
}) {
  return (
    <Card
      interactive
      role="presentation"
      className="cursor-pointer"
      onClick={(e) => { if (!isControlClick(e)) onOpen(); }}
    >
      <CardHeader>
        <span className="text-primary">{icon}</span>
        <CardTitle>
          <Button variant="link" className="h-auto p-0" aria-label={openLabel} onClick={onOpen}>
            {title}
          </Button>
        </CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
    </Card>
  );
}

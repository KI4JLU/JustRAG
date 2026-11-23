import { Compass, FileText, GraduationCap, Home, MessageSquare, Search, Users } from 'lucide-react';
import type { TopicSection } from '../../utils/topicSection';
import type { HistoryKind } from './historyItems';

/* The icon of a row is its kind's — except a branch chat (made by
   Verzweigen, a new answer or an edited question), which shows the branch
   glyph instead. An older chat that forks inside itself does not: the app
   shows only its newest path. */
export const KIND_ICON: Record<HistoryKind, typeof MessageSquare> = {
    chat: MessageSquare,
    artifact: FileText,
    research: Search,
    academic: GraduationCap,
};

/* Where a chat lives: the icon of the overview its topic is listed in, the
   same icon that overview has in the navigation above. */
export const OVERVIEW_ICON: Record<TopicSection, typeof Home> = {
    'my-topics': Home,
    'shared-topics': Users,
    discover: Compass,
};

export const OVERVIEW_LABEL: Record<TopicSection, 'myTopics' | 'sharedTopics' | 'discoverTopics'> = {
    'my-topics': 'myTopics',
    'shared-topics': 'sharedTopics',
    discover: 'discoverTopics',
};

import { Compass, FileText, GraduationCap, Home, MessageSquare, Search, Users } from 'lucide-react';
import type { TopicSection } from '../../utils/topicSection';
import type { HistoryKind } from './historyItems';

/* The icon of a row is its kind's — except a branched chat, which shows the
   branch glyph instead: a branch chat (each branch is its own chat) and an
   older chat that forks inside itself alike. */
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

/** The overview a topic is listed in. */
export type TopicSection = 'my-topics' | 'shared-topics' | 'discover';

/**
 * Which overview lists a topic: „Mein Wissen" for one the user owns,
 * „Entdecken" for a public one they have not subscribed to, „Geteiltes
 * Wissen" otherwise (shared with them, or a subscribed public topic).
 */
export function topicSection(topic: { isPublic: boolean; isOwner: boolean; isSubscribed: boolean }): TopicSection {
  if (topic.isPublic) return topic.isSubscribed ? 'shared-topics' : 'discover';
  return topic.isOwner ? 'my-topics' : 'shared-topics';
}

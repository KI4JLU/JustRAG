import { describe, expect, it } from 'vitest';
import { topicSection } from './topicSection';

// ORACLE: the three overviews' own lists — MyTopicsView shows owned topics,
// SharedTopicsView private topics shared with the user plus subscribed public
// ones, DiscoverView the public catalog.
describe('topicSection', () => {
  it.each([
    [{ isPublic: false, isOwner: true, isSubscribed: false }, 'my-topics'],
    [{ isPublic: false, isOwner: false, isSubscribed: false }, 'shared-topics'],
    [{ isPublic: true, isOwner: false, isSubscribed: true }, 'shared-topics'],
    [{ isPublic: true, isOwner: false, isSubscribed: false }, 'discover'],
    // A public topic has no owner; a role there never moves it to „Mein Wissen".
    [{ isPublic: true, isOwner: true, isSubscribed: false }, 'discover'],
  ] as const)('%o is listed in %s', (topic, section) => {
    expect(topicSection(topic)).toBe(section);
  });
});

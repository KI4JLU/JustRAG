import { describe, it, expect } from 'vitest';
import { routeFromMatch } from './navigation';
import { toShortId } from './shortId';

const KB = 'd0ddefd4-6ccd-49a5-a7f0-2f1eba3c8141';
const CHAT = 'bfe5f9d2-dba3-4d0f-af2d-f55fde1f33a8';

// Oracle: the route table in routes.ts, read by hand.
describe('routeFromMatch', () => {
  it('maps each page route to its view', () => {
    expect(routeFromMatch({ routeId: '/', params: {} })).toEqual({ view: 'my-topics' });
    expect(routeFromMatch({ routeId: '/shared', params: {} })).toEqual({ view: 'shared-topics' });
    expect(routeFromMatch({ routeId: '/discover', params: {} })).toEqual({ view: 'discover' });
    expect(routeFromMatch({ routeId: '/tools', params: {} })).toEqual({ view: 'tools' });
    expect(routeFromMatch({ routeId: '/profile', params: {} })).toEqual({ view: 'profile' });
    expect(routeFromMatch({ routeId: '/privacy', params: {} })).toEqual({ view: 'privacy' });
  });

  it('reads the agents page and its teams tab', () => {
    expect(routeFromMatch({ routeId: '/agents', params: {} })).toEqual({ view: 'agents', tab: 'agents' });
    expect(routeFromMatch({ routeId: '/agents/teams', params: {} })).toEqual({ view: 'agents', tab: 'teams' });
  });

  it('decodes the short ids in topic and chat paths to UUIDs', () => {
    expect(routeFromMatch({ routeId: '/kb/$kbId', params: { kbId: toShortId(KB) } })).toEqual({ view: 'kb', kbId: KB });
    expect(routeFromMatch({ routeId: '/c/$chatId', params: { chatId: toShortId(CHAT) } })).toEqual({ view: 'chat', chatId: CHAT });
    expect(routeFromMatch({ routeId: '/kb/$kbId/admin', params: { kbId: toShortId(KB) } }))
      .toEqual({ view: 'global-kb-settings', kbId: KB });
  });

  it('also takes a full UUID written into the URL by hand', () => {
    expect(routeFromMatch({ routeId: '/c/$chatId', params: { chatId: CHAT } })).toEqual({ view: 'chat', chatId: CHAT });
  });

  it('treats an id that is neither as not found', () => {
    expect(routeFromMatch({ routeId: '/kb/$kbId', params: { kbId: 'kb-1' } })).toEqual({ view: 'not-found' });
    expect(routeFromMatch({ routeId: '/c/$chatId', params: { chatId: 'x' } })).toEqual({ view: 'not-found' });
  });

  it('treats the bare root and no match as not found', () => {
    expect(routeFromMatch({ routeId: '__root__', params: {} })).toEqual({ view: 'not-found' });
    expect(routeFromMatch(null)).toEqual({ view: 'not-found' });
  });
});

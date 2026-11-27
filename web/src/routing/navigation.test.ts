import { describe, it, expect } from 'vitest';
import { createMemoryHistory } from '@tanstack/react-router';
import { createAppRouter } from './routes';
import { routeFromMatch, type AppRouteId } from './navigation';
import { toShortId } from './shortId';

const KB = 'd0ddefd4-6ccd-49a5-a7f0-2f1eba3c8141';
const CHAT = 'bfe5f9d2-dba3-4d0f-af2d-f55fde1f33a8';

// Oracle: the route table in routes.ts, read by hand.
describe('routeFromMatch', () => {
  it('maps each page route to its view', () => {
    expect(routeFromMatch({ routeId: '/', params: {} })).toEqual({ view: 'my-topics' });
    expect(routeFromMatch({ routeId: '/shared', params: {} })).toEqual({ view: 'shared-topics' });
    expect(routeFromMatch({ routeId: '/discover', params: {} })).toEqual({ view: 'discover' });
    expect(routeFromMatch({ routeId: '/privacy', params: {} })).toEqual({ view: 'privacy' });
    expect(routeFromMatch({ routeId: '/translator', params: {} })).toEqual({ view: 'translator' });
  });

  it('carries the token of a glossary invite link', () => {
    expect(routeFromMatch({ routeId: '/join-glossary/$token', params: { token: 'AbCdEf0123456789AbCdEf0123456789AbCdEf012' } }))
      .toEqual({ view: 'join-glossary', token: 'AbCdEf0123456789AbCdEf0123456789AbCdEf012' });
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

// Oracle: the URLs the extension is reached by — /translator for the page, /join-glossary/<token>
// for a glossary invite link (docs/api-contracts/translator.md "Invite links").
describe('the translation routes', () => {
  const router = createAppRouter({ rootComponent: () => null, history: createMemoryHistory({ initialEntries: ['/'] }) });
  const match = (path: string) => {
    const [, params, found] = router.getMatchedRoutes(path);
    return routeFromMatch(found ? { routeId: found.id as AppRouteId, params } : null);
  };

  it('matches the page', () => {
    expect(match('/translator')).toEqual({ view: 'translator' });
  });

  it('matches a glossary invite link and hands over its token', () => {
    expect(match('/join-glossary/AbCdEf0123456789AbCdEf0123456789AbCdEf012'))
      .toEqual({ view: 'join-glossary', token: 'AbCdEf0123456789AbCdEf0123456789AbCdEf012' });
  });

  it('keeps a topic link’s path an unknown one: that kind is captured before the router starts', () => {
    expect(match('/join/AbCdEf0123456789AbCdEf0123456789AbCdEf012')).toEqual({ view: 'not-found' });
  });
});

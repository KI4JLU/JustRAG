import { describe, it, expect } from 'vitest';
import { chatWebSearchRequestField, isChatWebSearchAvailable } from './chatWebSearch';

/* ORACLE: the contract, not the implementation. API.md documents
 * `chat_web_search_enabled` as the admin gate (off by default), and
 * go-backend/internal/siteconfig/handler.go lists it in publicConfigKeys —
 * the only way the browser sees it. The card's acceptance rule is "hidden
 * unless the public site config is 'true'"; every other value, including an
 * absent key (the default), must hide the toggle. */
describe('isChatWebSearchAvailable', () => {
  it("is on only for the string 'true'", () => {
    expect(isChatWebSearchAvailable({ chat_web_search_enabled: 'true' })).toBe(true);
  });

  it.each([
    ['absent (the server default)', {}],
    ["'false'", { chat_web_search_enabled: 'false' }],
    ['empty', { chat_web_search_enabled: '' }],
    ["'1' (not what the admin form writes)", { chat_web_search_enabled: '1' }],
    ["'TRUE'", { chat_web_search_enabled: 'TRUE' }],
  ])('is off when the key is %s', (_label, cfg) => {
    expect(isChatWebSearchAvailable(cfg)).toBe(false);
  });

  it('is off without a site config at all', () => {
    expect(isChatWebSearchAvailable(undefined)).toBe(false);
    expect(isChatWebSearchAvailable(null)).toBe(false);
  });

  it('does not follow the separate web_search_enabled key', () => {
    // web_search_enabled is the sidebar web-search tool's gate; the composer
    // toggle has its own admin flag.
    expect(isChatWebSearchAvailable({ web_search_enabled: 'true' })).toBe(false);
  });
});

/* ORACLE: API.md on `POST /kb/{id}/chat` — `webSearch` absent = upstream
 * behaviour (answer tools per chat_answer_tools_enabled), `true` = web_search
 * for this turn, `false` = web_search kept out even with answer tools on. The
 * PM's rule maps those onto the gate: open → the toggle's explicit value;
 * closed → absent. */
describe('chatWebSearchRequestField', () => {
  const open = { chat_web_search_enabled: 'true' };

  it('sends the toggle value while the gate is open', () => {
    expect(chatWebSearchRequestField(open, true)).toBe(true);
    expect(chatWebSearchRequestField(open, false)).toBe(false);
  });

  it.each([
    ['absent', {}],
    ["'false'", { chat_web_search_enabled: 'false' }],
  ])('omits the field while the gate is %s, whatever the leftover toggle state', (_label, cfg) => {
    expect(chatWebSearchRequestField(cfg, true)).toBeUndefined();
    expect(chatWebSearchRequestField(cfg, false)).toBeUndefined();
  });
});

/* ---------------------------------------------------------------------------
 * Whether the composer offers per-turn web search.
 *
 * The admin gate is the public site config `chat_web_search_enabled`. Off by
 * default and global-only: a `webSearch: true` turn on a server where it is
 * off is refused with 422 before the chat is created (API.md). So the toggle
 * is hidden unless the gate is on, and a toggle state left over from a session
 * in which the gate was on is never sent as `true`.
 *
 * Exactly the string 'true' counts, like every other boolean the UI reads off
 * the public site config (`web_search_enabled`, `confluence_enabled`, …); the
 * admin form writes 'true'/'false'. The server's own parser additionally
 * accepts '1' and other casings, so a value set by hand to '1' leaves the
 * toggle hidden although the server would allow it — the safe direction.
 *
 * One predicate, used by the composer, the request and the admin row: a
 * toggle that is shown by one rule and sent by another is how a 422 slips
 * through.
 * ------------------------------------------------------------------------- */

export function isChatWebSearchAvailable(siteConfigs: Record<string, string> | null | undefined): boolean {
  return siteConfigs?.chat_web_search_enabled === 'true';
}

/**
 * The `webSearch` field of `POST /api/kb/{id}/chat`, or `undefined` to leave
 * it out of the body. API.md gives the field three meanings: absent leaves the
 * answer LLM's tools to `chat_answer_tools_enabled` (upstream behaviour),
 * `true` opens web_search for the turn, `false` keeps it out even when answer
 * tools are on. So while the gate is closed — the toggle is hidden and the
 * user has made no choice — the field is omitted rather than sent as `false`,
 * which would quietly override the admin's answer-tools configuration. With
 * the gate open, the visible toggle is the user's explicit choice either way.
 */
export function chatWebSearchRequestField(
  siteConfigs: Record<string, string> | null | undefined,
  toggleOn: boolean,
): boolean | undefined {
  return isChatWebSearchAvailable(siteConfigs) ? toggleOn : undefined;
}

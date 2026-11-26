# Translator contract

The frontend contract of the translation extension. Routes, access and errors are in `API.md` ("Translator and glossaries"); the glossary roles are in `docs/glossary-access.md`. This file holds what a client needs beyond that.

## Switch and permission

- `translator_enabled` (global-only site_config, off by default) switches the extension. While off every route but `GET /api/translator/config` answers `403` with code `translator_disabled`; the UI reads `config.enabled` to show or hide the entry.
- `translator_default_target_lang` (global-only) is the target language users start with; the value must be one of the language codes below, else the built-in `en-gb` applies.
- The system permission is fixed in code: `user`, `admin`, `superadmin`, `api-user`. A role outside those gets `403` on every route.

## Model

Every model call (translate, rephrase, detect, suggest) uses the deployment-wide Fast Tier model (`model_tier_fast`, set in the admin Agent panel). When it is empty, or the active provider does not offer it, the provider's default chat model answers. `config.model` names the model that will actually serve (the provider is resolved first) and `config.modelSource` where it comes from: `fastTier` (`model_tier_fast`, and the active provider offers it) or `default` (it is empty or not offered, so the provider's default chat model answers); both are empty when no provider is active or it has no model. The UI shows them read-only and words the source. There is no model choice in the requests. When that model is flagged as a reasoning model in its provider entry, the calls ask it not to think first (`chat_template_kwargs.enable_thinking=false`): translation needs no reasoning, and thinking made a short text take seconds instead of a fraction of one. Only vLLM/LiteLLM-style endpoints know that field; on any other the first call is answered `400`/`422`, asked once more without the field, and the server remembers per (base URL, model) not to send it again. A model that cannot answer is told apart by its cause: `504 translator_model_timeout` when it did not answer in time (a call may take 30 seconds plus 10 ms for each character sent, at most 110 seconds, kept under the server's 120 second write timeout so the error can still be sent), `503 translator_model_unavailable` when no provider is active or the provider rejects the credentials (only an administrator can fix that), and `502 translator_model_failed` for anything else, such as an answer that is no JSON object or one without any text (no `text` field, `null`, blank) for a text that has some: that answer is asked for once more before it is a `502`, never a `200` with empty strings. The server logs a failed call by its class and the provider's status only, never the provider's error text, which may echo the submitted text. A request whose client left before the answer ends with status `499` and no body; it is no model failure and is not logged as one.

## Languages

Translator languages (menu order): `en-gb`, `en-us`, `de`, `uk`, `fr`, `es`, `it`, `nl`, `pl`, `pt`, `ru`, `zh`, `ja`. A language a model reports is normalised (case, region; plain `en` is `en-gb`); anything else is `null`.

Glossary term languages: `de`, `en`, `uk`, `fr`, `es`, `it`. Both English variants use the `en` terms.

## Text requests

A text travels as its sentences, in order, each with the whitespace that follows it; joined they give the text back. The answer has exactly one string per sentence. When a model answers with another count, the answer is joined into the first sentence and the rest stay empty.

| Limit | Value |
|---|---|
| Characters of a text (all sentences together, counted in runes after JSON decoding; the body may carry them escaped, so the wire limit is about 660 KB and a body over it is `413`) | 50,000 |
| Sentences per request | 5,000 |
| Detect sample | 500 characters |
| Suggest text | 2,000 characters (context 4,000) |
| Suggest exclusions | 50 |
| Glossaries per request | 20 |

`formality` is `default`, `formal` or `informal`; `style` is `business`, `academic`, `casual` or `simple`; `tone` is `confident`, `diplomatic`, `enthusiastic` or `friendly`. The style panel sets one of them at most.

`glossaryIds` must be glossaries the caller can open; one that is missing or unreadable is `400` before any model call. Of two glossaries the newer one (`updatedAt`) wins for the same term. An entry applies in both directions; with `source` `null` every entry into the target language counts. Terms go into the model call only, and only the ones that occur in the text: a term counts when its source term appears in the text (case-insensitive, Unicode-aware), longest first, at most 200 terms and 16 KiB of term text per request (`translator.PromptTermsMax`, `PromptTermsMaxBytes`); the rest of a glossary stays out. They travel as a delimited data block in the user message (`{"sentences":[…],"glossary":[…]}`), never in the system prompt, with an instruction that the glossary is reference data and not instructions. Translate applies them as translation rules; rephrase keeps the terms as given: with a known `language` the terms of that language, with `language` `null` the terms of every glossary language that occur, each tagged with its language, and the model applies the ones of the language it detects.

## Glossaries

- Entry: `{sourceLanguage, sourceTerm, targetLanguage, targetTerm}`. A name and a category take up to 255 characters, a description up to 65,535 bytes of UTF-8. A glossary has 1 to 5,000 entries (`limits.glossaryEntriesMax`; `400` with code `glossary_too_many_entries` above). A term is trimmed and has 1 to 200 characters (`limits.glossaryTermMaxRunes`), no control characters (newlines and tabs included) and no line or paragraph separators; otherwise `400` with code `glossary_term_invalid`. Terms are free text from every editor and, in a global glossary, read by everyone, which is why they are checked on write and only reach the model as data.
- A JSON body of a create, an update and a visibility change is at most 1 MiB (`413` above).
- A new glossary's `category` defaults to `general`, its `visibility` to `private`. `PUT /api/glossaries/{id}` is a **full replacement** of name, description, category and entries: an empty or missing description or category is stored empty (clearing it); the `general` default belongs to creating only, so a client editing a glossary sends the values it wants to keep.
- Publishing: `visibility: global` (create, or `PATCH` by an `admin`) makes the glossary readable and usable by every user. Every user with the translation permission may do that to a glossary of their own; this is by design and a product decision for the maintainers (`docs/glossary-access.md`), not an access check the backend adds.
- CSV import: two columns (source term, target term), comma, semicolon or tab separated, quotes as in RFC 4180, UTF-8 (a byte order mark is accepted), blank lines skipped. The delimiter is decided from the first record (the first line that is not blank; a quoted field may span lines): the one of comma, semicolon and tab that occurs most often outside quotes, a tie going to tab, then semicolon, then comma. A first row whose two cells are both header words (`source`, `target`, `term`, `translation`, `quelle`, `ziel`, `begriff`, `übersetzung`, case-insensitive) is a header and is skipped. A line without both terms, or a file without any pair, is `400`, and so is a file over the entry and term limits above. The file is limited to 5 MiB (`413`); the route is exempt from the server's global 1 MiB body cap for that reason.
- `GET /api/glossaries` returns, per glossary, `role` (the caller's effective role) and `canEdit` (editor or better), `canManage` (admin or better), `canDelete` (owner), and `isMember`: whether a `glossary_members` row stands behind the role. On a `global` glossary every user is a `viewer` without a row, so only a member can leave (`DELETE …/membership` is `404` for the others); the UI offers "leave" for `isMember && !canDelete`. `GET /api/glossaries/{id}` carries the same field. The UI reads these flags and does not derive them from the role.
- Visibility is changed with `PATCH` and needs `admin`; it does not change `updatedAt`.
- `POST …/transfer-owner` is `409` when a concurrent transfer by the same owner already moved the ownership.

## Invite links

The web entry route for a link is built by the frontend from the token (`/join-glossary/<token>`). It calls `GET /api/glossary-invites/{token}`, shows what joining means, and only a confirmed accept calls `POST …/redeem`. A `410 invite_revoked` means the link was revoked.

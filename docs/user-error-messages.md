# User-facing error messages

This is the single reference for every error message the web client shows: which
event leads to which message, in German and English. Errors reach users as clear,
localized status messages, never as generic or technical errors. Status:
**draft, pending sign-off by Sten and Steffen.**

## 1. How an error becomes a message

The backend answers an error with `{"error": "<English text>"}` and, where the
user can act on the cause, a stable machine-readable `code` (section 3). The web
client never shows the `error` text. One function does the mapping:
`userErrorMessage(err, t, { name, fallbackKey })` in `web/src/utils/userErrors.ts`.
It maps the `code`, else the HTTP status, to a translation key:

- a known `code` → its key (section 3)
- 403 → `errorForbidden` (S12)
- 429 → `errorRateLimited` (S13)
- no response (network), 502, 503, 504 → `errorServiceUnavailable` (S14)
- any other 5xx → `errorUnexpected` (S15)
- 413 / 415 without a code → `errorFileTooLarge` / `errorUnsupportedType`
- anything else (400, 404, 409 or 422 without a code, an error in the client) →
  the caller's `fallbackKey`, the feature's own message

German messages use the informal "du" and say "Thema" (EN "topic") for a
knowledge base. `{name}` is the file name, `{limit}` the size limit formatted for
the UI language.

Rules that apply to every message:

- **A refusal the shared list does not cover** (a 400 or 404 without a code, an
  error in the client) shows the calling feature's own message, e.g.
  `errorUploadFailed` („{name}“ konnte nicht hochgeladen werden.) or
  `chatSendError`. In the catalog this is written "*key* + S12–S15": the
  feature's key, with the shared cases on top.
- **A message that names a file is only used where the file name is known.** A
  chat send refers to its attachments by id, so a file refusal there shows
  `chatAttachmentsUnusable` („Ein angehängtes Dokument kann nicht verwendet
  werden. Entferne es und sende erneut.“). Without a name, `userErrorMessage`
  falls back to `fallbackKey`.
- **A batch upload shows one toast**: the first failed file's message, plus
  `uploadFailedMore` („{count} weitere Dateien konnten ebenfalls nicht
  hochgeladen werden.“) — `uploadFailureMessage` in the same file.
- **An SSE error frame keeps what already streamed** and appends the S11 message
  under it.
- **Identical toasts are shown once.** While a toast is on screen, the same
  message replaces it instead of stacking (`contexts/ToastContext.tsx`), so an
  unreachable server — every start-up load failing at once — shows S14 a single
  time.
- **A status that means something else on one endpoint is handled before the
  mapping.** The comparison upload's 503 means "comparison is switched off"
  (`comparisonDisabled`), not an outage; the URL fetch's 502 means "the remote
  page is unreachable" (B09).

## 2. Shared messages

The messages every feature shares. The catalog in section 4 refers to them by ID.

| ID | Case | Trigger | Key | DE | EN |
|---|---|---|---|---|---|
| S1 | File too large | 413 `file_too_large` (+ `limitBytes`) | `errorFileTooLargeLimit` / `errorFileTooLarge` | „{name}“ ist zu groß (höchstens {limit}). / „{name}“ ist zu groß zum Hochladen. | “{name}” is too large (maximum {limit}). / “{name}” is too large to upload. |
| S2 | Storage quota full | 413 `quota_exceeded` | `errorQuotaExceeded` | Dein Speicherplatz ist voll – „{name}“ wurde nicht hochgeladen. | Your storage is full – “{name}” was not uploaded. |
| S3 | Topic full | 400 `kb_full` (500 files, 1 000 in a public topic, or 500 MB) | `errorKbFull` | Dieses Thema hat die maximale Anzahl oder Größe an Quellen erreicht – „{name}“ wurde nicht hinzugefügt. | This topic has reached its maximum number or size of sources – “{name}” was not added. |
| S4 | Format not supported | 415, or 400 on upload, `unsupported_file_type` | `errorUnsupportedType` | Das Dateiformat von „{name}“ wird nicht unterstützt. | The file format of “{name}” is not supported. |
| S5 | File could not be read | 422 `file_unreadable` | `errorFileUnreadable` | „{name}“ konnte nicht gelesen werden. Die Datei ist möglicherweise beschädigt. | “{name}” could not be read. The file may be damaged. |
| S6 | No text | 422 `no_text` | `errorNoText` | In „{name}“ wurde kein Text gefunden. | No text was found in “{name}”. |
| S6a | Empty file | 400 `empty_file` | `errorEmptyFile` | „{name}“ ist leer. | “{name}” is empty. |
| S6b | File name too long | 400 `file_name_too_long` | `errorFileNameTooLong` | Der Dateiname ist zu lang. Benenne die Datei um und lade sie erneut hoch. | The file name is too long. Rename the file and upload it again. |
| S7 | Too long to read as chat context | 422 `too_large_for_context` on upload | `errorTooLongForContext` | „{name}“ ist zu lang, um im Chat als Kontext mitgelesen zu werden. Füge die Datei stattdessen als Quelle zum Thema hinzu. | “{name}” is too long to be read as context in the chat. Add the file to the topic as a source instead. |
| S7a | Attachments together too long | 422 `too_large_for_context` on send | `chatAttachmentsTooLongTogether` | Die angehängten Dateien sind zusammen zu lang, um im Chat als Kontext mitgelesen zu werden. Entferne eine Datei und sende erneut. | Together, the attached files are too long to be read as context in the chat. Remove a file and send again. |
| S8 | Reading took too long | 422 `parse_timeout` | `errorParseTimeout` | Das Lesen von „{name}“ hat zu lange gedauert. Bitte versuche es erneut. | Reading “{name}” took too long. Please try again. |
| S9 | Already in topic | 409 `already_in_kb` | `errorAlreadyInKb` | „{name}“ ist bereits in diesem Thema. | “{name}” is already in this topic. |
| S10 | Answer timeout | 120 s SSE idle watchdog (client, `SseIdleTimeoutError`) | `errorAnswerTimeout` | Die Antwort hat zu lange gedauert. Bitte versuche es erneut. | The answer took too long. Please try again. |
| S11 | Answer failed or interrupted | SSE `{"error"}` frame | `errorAnswerFailed` | Die Antwort konnte nicht vollständig erstellt werden. Bitte versuche es erneut. | The answer could not be completed. Please try again. |
| S12 | No permission | 403 | `errorForbidden` | Dafür fehlt dir die Berechtigung. | You don’t have permission to do this. |
| S13 | Too many requests | 429 | `errorRateLimited` | Zu viele Anfragen – bitte warte einen Moment. | Too many requests – please wait a moment. |
| S14 | Service not reachable | no response (network), 502/503/504 | `errorServiceUnavailable` | Der Dienst ist gerade nicht erreichbar. Bitte versuche es später erneut. | The service is currently unavailable. Please try again later. |
| S15 | Unexpected error | other 5xx | `errorUnexpected` | Ein unerwarteter Fehler ist aufgetreten. Bitte versuche es erneut. | An unexpected error occurred. Please try again. |
| S16a | Processing failed: format | file status `error`, stage `unsupported_type` | `fileErrorUnsupportedType` | Dieses Dateiformat wird nicht unterstützt. | This file format is not supported. |
| S16b | Processing failed: unreadable | stage `parse` | `fileErrorParse` | Die Datei konnte nicht gelesen werden. Sie ist möglicherweise beschädigt. | The file could not be read. It may be damaged. |
| S16c | Processing failed: indexing service down | stage `embedding` | `fileErrorEmbedding` | Die Datei konnte nicht durchsuchbar gemacht werden, weil ein Dienst nicht erreichbar war. Versuche es später erneut. | The file could not be made searchable because a service was unavailable. Please try again later. |
| S16d | Processing failed: interrupted | stage `canceled` | `fileErrorCanceled` | Die Verarbeitung wurde unterbrochen. Versuche es erneut. | Processing was interrupted. Please try again. |
| S16e | Processing failed: other | stage `processing` | `fileErrorProcessing` | Die Verarbeitung ist fehlgeschlagen. Versuche es erneut. | Processing failed. Please try again. |
| S16f | Processing failed: timeout | stage `timeout` | `fileErrorTimeout` | Die Verarbeitung hat zu lange gedauert. Versuche es erneut. | Processing took too long. Please try again. |
| S16g | Processing failed: not queued | stage `queue` | `fileErrorQueue` | Die Datei konnte nicht zur Verarbeitung eingeplant werden. Versuche es erneut. | The file could not be scheduled for processing. Please try again. |
| S16h | Processing failed: unknown stage | any other or no stage | `fileErrorUnknown` | Bei der Verarbeitung ist etwas schiefgelaufen. Versuche es erneut. | Something went wrong while processing. Please try again. |

The S16 messages appear under the failed file in the sources list, next to its
retry button, which is why each one ends with "Versuche es erneut".

**What S7 means.** The answer model reads attached documents in full, as
context for the question. It can only read a limited amount of text at once (its
context window), and attachments may use at most half of it
(`chat_attachments_context_share`). A document over that limit cannot be used
as an attachment. Added to the topic as a source, it is split into passages and
searched instead, so there is no such limit.

## 3. Error codes

`API.md` § "Error codes" holds the API contract (which route sends which code);
this table only maps each code to the message the web client shows.

| `code` | Status | Meaning | Message |
|---|---|---|---|
| `file_too_large` | 413 | The file exceeds an upload size limit; `limitBytes` names the limit | `errorFileTooLargeLimit`, without a limit `errorFileTooLarge` ([S1](#2-shared-messages)) |
| `quota_exceeded` | 413 | The user's file library quota is full | `errorQuotaExceeded` ([S2](#2-shared-messages)) |
| `kb_full` | 400 | The topic has reached its file count or total size limit | `errorKbFull` ([S3](#2-shared-messages)) |
| `unsupported_file_type` | 415, 400 on upload | No parser handles the format, or the extension is blocked | `errorUnsupportedType` ([S4](#2-shared-messages)) |
| `file_unreadable` | 422 | The format is supported but the file could not be read | `errorFileUnreadable` ([S5](#2-shared-messages)) |
| `no_text` | 422, 400 in library chat | The file contains no text | `errorNoText` ([S6](#2-shared-messages)) |
| `empty_file` | 400 | The file has zero bytes | `errorEmptyFile` ([S6a](#2-shared-messages)) |
| `file_name_too_long` | 400 | The file name exceeds 255 bytes | `errorFileNameTooLong` ([S6b](#2-shared-messages)) |
| `too_large_for_context` | 422, 400 in library chat | The documents do not fit the answer model's budget | upload: `errorTooLongForContext`; send: `chatAttachmentsTooLongTogether` ([S7](#2-shared-messages)) |
| `parse_timeout` | 422 | Reading the file took longer than the server allows | `errorParseTimeout` ([S8](#2-shared-messages)) |
| `already_in_kb` | 409 | The topic already holds this file | `errorAlreadyInKb` ([S9](#2-shared-messages)) |
| `invalid_upload` | 400 | The request is not a well-formed file upload | `errorUploadFailed` (the upload fallback, section 1) |

On a chat send, every file code other than `too_large_for_context` shows
`chatAttachmentsUnusable`, because the send knows no file name.

**"Could not be read" vs "not supported".** The two are told apart by whether a
parser exists for the file. A supported format whose parser fails, such as a
corrupt PDF or an image while the OCR binary is missing, is 422
`file_unreadable` (S5). Only a file no parser handles, such as an `.exe`, is
`unsupported_file_type` (S4).

**`error` read as a code.** The backend keeps `quota_exceeded`, `already_in_kb`
and `too_large_for_context` in `error` as well. `errorInfoFromBody`
(`utils/userErrors.ts`) uses `error` as the code when a body carries no `code`,
so a backend without codes still maps correctly. It is the only client code that
reads `error`, and the fallback can go once every deployed backend sends `code`.

## 4. Message catalog

Every place in `web/src` (tests and stories excluded) where an error message
reaches the user. **Where** is `path:line` relative to `web/src` in the current
working tree. **Shown today** is what the user sees in this working tree. A key
marked *(proposed)* does not exist yet; its text is a proposal. "+ S12–S15" after
a key means the shared cases apply on top of it (section 1). Language ternaries
that are not error surfaces are left out (`ChatView.tsx` citation labels,
`MessageContent.tsx` tooltips, `BranchTreeNav.tsx`, `AcademicMode.tsx`,
`ReloadPrompt.tsx`, `Login.tsx:236–237`, the research modes' label maps).

### A. Every user

Chat, composer, upload, sources sidebar, login, profile pages.

| ID | Where | When | Shown today | Message key | DE | EN | Status |
|---|---|---|---|---|---|---|---|
| A01 | `hooks/useFileManagement.ts:118` | Topic upload refused with a code or status of section 2 | The case's message for the first failed file | S1–S4, S6a, S6b, S9, S12–S15 | (section 2) | (section 2) | done |
| A02 | `hooks/useFileManagement.ts:118` | Topic upload refused without a code (400, 404, 409, `invalid_upload`) or a client error | „a.pdf“ konnte nicht hochgeladen werden. | `errorUploadFailed` | „{name}“ konnte nicht hochgeladen werden. | Could not upload “{name}”. | done |
| A03 | `utils/userErrors.ts:154` (via `hooks/useFileManagement.ts:118`) | More than one file of a batch failed | Appended to the first file's message | `uploadFailedMore` | {count} weitere Dateien konnten ebenfalls nicht hochgeladen werden. | {count} more files could not be uploaded either. | done |
| A04 | `utils/chatAttachments.ts:41` (chip text via `hooks/useComposerUploads.ts:66`) | Composer attachment refused with a code or status; 503 "attachments not available" is S14 | The case's message for that file | S1–S9, S12–S15 | (section 2) | (section 2) | done |
| A05 | `utils/chatAttachments.ts:41` | Composer attachment refused without a code (400, 404) | „a.pdf“ konnte nicht hochgeladen werden. | `errorUploadFailed` | „{name}“ konnte nicht hochgeladen werden. | Could not upload “{name}”. | done |
| A06 | `hooks/useComposerUploads.ts:68` | Upload failed outside the request | „a.pdf“ konnte nicht hochgeladen werden. | `errorUploadFailed` | „{name}“ konnte nicht hochgeladen werden. | Could not upload “{name}”. | done |
| A07 | `hooks/useChatAttachment.ts:51` (toast at `hooks/useChat.ts:454`) | Comparison upload refused with a code or status | The case's message for that file | S1, S4, S5, S6, S12–S15 | (section 2) | (section 2) | done |
| A08 | `hooks/useChatAttachment.ts:50` | Comparison upload 503: comparison is switched off | Dokumentenvergleich ist deaktiviert | `comparisonDisabled` | Dokumentenvergleich ist deaktiviert | Document comparison is disabled | done |
| A09 | `hooks/useChatAttachment.ts:51` | Comparison upload refused without a code (400 `invalid_upload`, 404) | „a.pdf“ konnte nicht hochgeladen werden. | `errorUploadFailed` | „{name}“ konnte nicht hochgeladen werden. | Could not upload “{name}”. | done |
| A10 | `hooks/useChat.ts:454` | Comparison upload failed without a recorded message (not reached in practice) | Upload fehlgeschlagen | `comparisonUploadFailed` | Upload fehlgeschlagen | Upload failed | done |
| A11 | `hooks/useChatStream.ts:210` | Send refused, 422 `too_large_for_context` | The S7 send message | `chatAttachmentsTooLongTogether` (S7) | Die angehängten Dateien sind zusammen zu lang für den Chat. Entferne eine Datei und sende erneut. | The attached files are too long for the chat together. Remove a file and send again. | done |
| A12 | `hooks/useChatStream.ts:215` | Send refused with another file code (415/422 `unsupported_file_type`, `file_unreadable`, `no_text`, `parse_timeout`); the body names the attachment in `fileName` | „a.pdf“ konnte nicht gelesen werden. Die Datei ist möglicherweise beschädigt. Entferne die Datei und sende erneut. | the case's key (S4, S5, S6, S8) + `chatAttachmentRemoveHint` | (case text) + Entferne die Datei und sende erneut. | (case text) + Remove the file and send again. | done |
| A12a | `hooks/useChatStream.ts:217` | Same, from a backend that does not send `fileName` yet | Ein angehängtes Dokument kann nicht verwendet werden. … | `chatAttachmentsUnusable` | Ein angehängtes Dokument kann nicht verwendet werden. Entferne es und sende erneut. | An attached document cannot be used. Remove it and send again. | done |
| A13 | `hooks/useChatStream.ts:214`, `:424` | Send refused 403, 429, 5xx, or no response | The case's message as the answer bubble | S12–S15 | (section 2) | (section 2) | done |
| A14 | `hooks/useChatStream.ts:214` | Send refused 400 or 404 without a code | Fehler beim Senden der Nachricht | `chatSendError` | Fehler beim Senden der Nachricht | Error sending message | done |
| A15 | `hooks/useChatStream.ts:423` | No SSE event for 120 s | The S10 message as the answer bubble | `errorAnswerTimeout` (S10) | Die Antwort hat zu lange gedauert. Bitte versuche es erneut. | The answer took too long. Please try again. | done |
| A16 | `hooks/useChatStream.ts:359` | SSE `{"error"}` frame | Partial answer, then the S11 message | `errorAnswerFailed` (S11) | Die Antwort konnte nicht vollständig erstellt werden. Bitte versuche es erneut. | The answer could not be completed. Please try again. | done |
| A17 | `hooks/useChatStream.ts:422` | Stream fails after the send was accepted, for another reason (no reader, read error, client error) | Entschuldigung, es ist ein Fehler aufgetreten. … | `aiGenericError` | Entschuldigung, es ist ein Fehler aufgetreten. Bitte versuche es erneut. | Sorry, an error occurred. Please try again. | done |
| A18 | `components/sidebar/SourcesSection.tsx:95` | File status `error` with a known `errorStage` | The stage's label | `fileError*` (S16) | (unchanged) | (unchanged) | done |
| A19 | `components/sidebar/SourcesSection.tsx:96`, `:116` | File status `error`; the message per stage (S16a–S16h), the raw-text tooltip is gone | Bei der Verarbeitung ist etwas schiefgelaufen. Versuche es erneut. (unknown stage) | `fileError*` (S16) | (section 2) | (section 2) | done |
| A20 | `components/sidebar/SourcesSection.tsx:199` | RSS feed in status `error` | Raw `errorMessage` (backend or remote text) | `rssFeedSyncError` *(proposed)* | Der RSS-Feed konnte nicht abgerufen werden. Prüfe die Adresse oder versuche es später erneut. | The RSS feed could not be fetched. Check the address or try again later. | open |
| A21 | `components/sidebar/SourcesSection.tsx:283` | Confluence source in status `error` | Raw `errorMessage` | `confluenceSourceSyncError` *(proposed)* | Die Confluence-Quelle konnte nicht synchronisiert werden. Prüfe deine Confluence-Verbindung. | The Confluence source could not be synced. Check your Confluence connection. | open |
| A22 | `components/sidebar/SourcesSection.tsx:349` | Git repository in status `error` | Raw `errorMessage` | `gitRepoSyncError` *(proposed)* | Das Repository konnte nicht synchronisiert werden. Prüfe die Adresse und das Zugriffstoken. | The repository could not be synced. Check the address and the access token. | open |
| A23 | `Login.tsx:130` | 401: wrong user name or password | `Invalid username or password` (backend, English) | `invalidCredentials` | Ungültiger Benutzername oder Passwort | Invalid username or password | open |
| A24 | `Login.tsx:130` | 403 or 429 | Raw backend text | S12, S13 | (section 2) | (section 2) | open |
| A25 | `Login.tsx:130` | No response or 5xx: login unavailable | Ungültiger Benutzername oder Passwort (reads as wrong credentials) | `loginUnavailable` *(proposed)* | Die Anmeldung ist gerade nicht möglich. Bitte versuche es später erneut. | Signing in is not possible right now. Please try again later. | open |
| A26 | `Login.tsx:91` | OIDC `state_missing`, `state_mismatch`, `verifier_missing`, `code_missing` | Anmeldung über Single Sign-On fehlgeschlagen (state_mismatch) | `oidcLoginExpired` *(proposed)* | Die Anmeldung ist abgelaufen. Bitte melde dich erneut an. | The sign-in has expired. Please sign in again. | open |
| A27 | `Login.tsx:91` | OIDC `provider_unavailable`, `provider_init_failed` | … fehlgeschlagen (provider_unavailable) | `oidcLoginUnavailable` *(proposed)* | Single Sign-On ist gerade nicht erreichbar. Bitte versuche es später erneut. | Single Sign-On is currently unavailable. Please try again later. | open |
| A28 | `Login.tsx:91` | OIDC `email_missing`, `email_unverified` | … fehlgeschlagen (email_unverified) | `oidcLoginNoEmail` *(proposed)* | Für dein Konto ist keine bestätigte E-Mail-Adresse hinterlegt. Wende dich an den Support. | Your account has no verified e-mail address. Please contact support. | open |
| A29 | `Login.tsx:91`, `:105` | Any other OIDC code; unreadable OIDC fragment | … fehlgeschlagen (code_exchange_failed) | `oidcLoginFailed` (without the code) | Anmeldung über Single Sign-On fehlgeschlagen | Single Sign-On login failed | open |
| A30 | `components/ErrorBoundary.tsx:46`, `:48` (buttons `:69`, `:79`) | Render error caught by the boundary | Something went wrong / An unexpected error occurred. Try reloading the page. (English only) | `errorBoundaryTitle`, `errorBoundaryText` *(proposed)* | Etwas ist schiefgelaufen. Ein unerwarteter Fehler ist aufgetreten. Lade die Seite neu. | Something went wrong. An unexpected error occurred. Reload the page. | open |
| A31 | `components/ErrorBoundary.tsx:57` | Render error caught by the boundary | Raw `error.message`, e.g. `Cannot read properties of undefined …` | none: log only | — | — | open |
| A32 | `components/ChartRenderer.tsx:35` | A chart cannot be rendered (heading) | Fehler beim Anzeigen des Diagramms (German only) | `chartRenderError` *(proposed)* | Das Diagramm kann nicht angezeigt werden. | The chart cannot be displayed. | open |
| A33 | `components/ChartRenderer.tsx:60`, `:88` | Chart JSON unparseable or missing fields (detail line) | `Unexpected token } in JSON`, `Invalid chart data: missing required fields` | `chartDataInvalid` *(proposed)* | Die Diagrammdaten sind unvollständig oder fehlerhaft. | The chart data is incomplete or invalid. | open |
| A34 | `components/ChartRenderer.tsx:94` | Chart has no data | Keine Daten zum Anzeigen verfügbar. (German only) | `noDataAvailable` | Keine Daten verfügbar | No data available | open |
| A35 | `components/DataExplorer/DataExplorer.tsx:53–54`, `:60` | Data Explorer query refused (the routes answer 501) | `Query failed`, `not implemented` | `dataExplorerQueryFailed` *(proposed)* + S12–S15 | Die Daten konnten nicht abgefragt werden. | The data could not be queried. | open |
| A36 | `components/DataExplorer/DataExplorer.tsx:82`; `DataExplorer/ExportButtons.tsx:28–29` | Data Explorer CSV export refused | `Export failed` | `exportFailed` + S12–S15 | Export fehlgeschlagen | Export failed | open |
| A37 | `components/TrajectoryPanel.tsx:212` | Verifier failed after a refine step | Verifier-Fehler nach Korrektur (language ternary) | `trajectoryVerifierError` *(proposed)* | Prüfung nach der Korrektur fehlgeschlagen | Check after the correction failed | open |
| A38 | `components/ConfluenceTokenManager.tsx:68` | Saving the Confluence token refused | Raw backend text, else „Fehler“ | `confluenceProfileSaveError` *(proposed)* + S12–S15 | Die Confluence-Verbindung konnte nicht gespeichert werden. | Could not save the Confluence connection. | open |
| A39 | `components/ConfluenceTokenManager.tsx:84`, `:88` | Verify answers `ok: false`, or the verify request is refused | Raw backend or Confluence text | `confluenceProfileVerifyFailed` + S12–S15 | Confluence-Verbindung konnte nicht verifiziert werden. | Confluence connection verification failed. | open |
| A40 | `components/ConfluenceTokenManager.tsx:107` | Removing the Confluence connection refused | Raw backend text, else „Fehler“ | `confluenceProfileDeleteError` *(proposed)* + S12–S15 | Die Confluence-Verbindung konnte nicht entfernt werden. | Could not remove the Confluence connection. | open |
| A41 | `components/ConfluenceTokenManager.tsx:194–196` | Stored connection error: token cannot be decrypted | `token could not be decrypted` | `confluenceProfileTokenUnreadable` *(proposed)* | Dein gespeichertes Token kann nicht mehr gelesen werden. Gib es erneut ein. | Your saved token can no longer be read. Enter it again. | open |
| A42 | `components/ConfluenceTokenManager.tsx:194–196` | Stored connection error, any other | Raw `errorMessage` | `confluenceProfileConnectionFailed` *(proposed)* | Die Verbindung zu Confluence funktioniert nicht. Prüfe dein Token. | The connection to Confluence is not working. Check your token. | open |
| A43 | `components/ApiKeys/ApiKeyManager.tsx:73` | Creating an API key refused | Raw backend text | `apiKeyCreateError` + S12–S15 | API-Schlüssel konnte nicht erstellt werden. | Failed to create API key. | open |
| A44 | `hooks/useKnowledgeBases.ts:83`, `:128` | Loading the topic list or opening a topic fails | Fehler beim Laden der Knowledge Bases, or the case's message | `kbFetchError` + S12–S15 | Fehler beim Laden der Knowledge Bases | Error loading knowledge bases | done |
| A45 | `hooks/useKbSettings.ts:39` | Loading the model configurations fails | Fehler beim Laden der Konfigurationen, or the case's message | `configsFetchError` + S12–S15 | Fehler beim Laden der Konfigurationen | Error loading configurations | done |

### B. Topic editors and topic admins

Ordinary users in their role on one topic (topic role `edit`, `admin` or
`owner`): source management, topic settings, agents and teams, workflow,
studio, research modes. Topic admins are users, not system administrators.

| ID | Where | When | Shown today | Message key | DE | EN | Status |
|---|---|---|---|---|---|---|---|
| B01 | `components/GlobalKbSettings.tsx:168` | Public-topic upload refused with a code or status of section 2 | The case's message for the first failed file | S1–S4, S6a, S6b, S9, S12–S15 | (section 2) | (section 2) | done |
| B02 | `components/GlobalKbSettings.tsx:168` | Public-topic upload refused without a code, or a client error | „a.pdf“ konnte nicht hochgeladen werden. | `errorUploadFailed` | „{name}“ konnte nicht hochgeladen werden. | Could not upload “{name}”. | done |
| B03 | `utils/userErrors.ts:154` (via `components/GlobalKbSettings.tsx:168`) | More than one file of a batch failed | Appended to the first file's message | `uploadFailedMore` | {count} weitere Dateien konnten ebenfalls nicht hochgeladen werden. | {count} more files could not be uploaded either. | done |
| B04 | `components/GlobalKbSettings.tsx:156` | Upload stops at the public topic's file limit | Datei-Limit pro Knowledge Base erreicht. (1000) | `fileLimitReached` | Datei-Limit pro Knowledge Base erreicht. | File limit per Knowledge Base reached. | done |
| B05 | `components/GlobalKbSettings.tsx:106` | Loading the model configurations fails | Fehler beim Laden der Konfigurationen, or the case's message | `configsFetchError` + S12–S15 | Fehler beim Laden der Konfigurationen | Error loading configurations | done |
| B06 | `hooks/useFileManagement.ts:158` | "Erneut versuchen" on one failed file refused | Die fehlgeschlagene Datei konnte nicht neu verarbeitet werden. …, or the case's message | `retryRequestFailed` + S12–S15 | Die fehlgeschlagene Datei konnte nicht neu verarbeitet werden. Bitte versuche es später erneut. | The failed file could not be processed again. Please try again later. | done |
| B06a | `hooks/useFileManagement.ts:169` | "Alle erneut versuchen" (all failed files) refused | Die fehlgeschlagenen Dateien konnten nicht neu verarbeitet werden. …, or the case's message | `retryAllRequestFailed` + S12–S15 | Die fehlgeschlagenen Dateien konnten nicht neu verarbeitet werden. Bitte versuche es später erneut. | The failed files could not be processed again. Please try again later. | done |
| B07 | `hooks/useFileManagement.ts:272` | Adding a text source refused | Text hinzufügen fehlgeschlagen, or the case's message | `addTextFailed` + S12–S15 | Text hinzufügen fehlgeschlagen | Failed to add text | done |
| B08 | `components/GlobalKbSettings.tsx:197` | URL fetch refused, 400: invalid or blocked address | Raw backend text | `urlInvalid` *(proposed)* | Die Adresse ist ungültig oder nicht erlaubt. | The address is invalid or not allowed. | open |
| B09 | `components/GlobalKbSettings.tsx:197` | URL fetch refused, 502: the remote page is unreachable (must not map to S14); other statuses S12, S13, S15 | `Failed to fetch URL` | `urlFetchFailed` *(proposed)* + S12, S13, S15 | Die Seite konnte nicht abgerufen werden. Prüfe die Adresse und versuche es erneut. | The page could not be fetched. Check the address and try again. | open |
| B10 | `components/GlobalKbSettings.tsx:252` | Crawl request refused (start or status poll) | Raw backend text, else Hinzufügen fehlgeschlagen | `addSourcesFailed` + S12–S15 | Hinzufügen fehlgeschlagen | Failed to add sources | open |
| B11 | `components/GlobalKbSettings.tsx:276`, `:340`; `hooks/useRssFeeds.ts:63`; `hooks/useGitRepoSources.ts:96`; `hooks/useConfluenceSources.ts:144` | Adding an RSS feed, Git repository or Confluence source refused | Raw backend text, else „Fehler“ (hooks) or Hinzufügen fehlgeschlagen | `addSourcesFailed` + S12–S15 | Hinzufügen fehlgeschlagen | Failed to add sources | open |
| B12 | `hooks/useRssFeeds.ts:78`; `hooks/useGitRepoSources.ts:111`; `hooks/useConfluenceSources.ts:159` | Changing a source's schedule or status refused | Raw backend text, else „Fehler“ | `settingsUpdateError` + S12–S15 | Fehler beim Aktualisieren der Einstellungen | Error updating settings | open |
| B13 | `hooks/useRssFeeds.ts:94`; `hooks/useGitRepoSources.ts:127`; `hooks/useConfluenceSources.ts:176` | Removing a source refused | Raw backend text, else „Fehler“ | `sourceDeleteFailed` *(proposed)* + S12–S15 | Die Quelle konnte nicht entfernt werden. | Could not remove the source. | open |
| B14 | `hooks/useRssFeeds.ts:108`; `hooks/useGitRepoSources.ts:138`; `hooks/useConfluenceSources.ts:189`; `components/GlobalKbSettings.tsx:363` | Poll or sync now refused | Raw backend text, else „Fehler“ or Hinzufügen fehlgeschlagen | `syncStartFailed` *(proposed)* + S12–S15 | Die Synchronisierung konnte nicht gestartet werden. | Could not start the sync. | open |
| B15 | `hooks/useConfluenceSources.ts:56` | Saving the Confluence connection refused | Raw backend text, else „Fehler“ | `confluenceProfileSaveError` *(proposed, A38)* + S12–S15 | Die Confluence-Verbindung konnte nicht gespeichert werden. | Could not save the Confluence connection. | open |
| B16 | `hooks/useConfluenceSources.ts:213`, `:223`; `components/sidebar/ConfluenceModal.tsx:120` | Loading Confluence pages fails | Raw backend text, else „Fehler“ | `confluencePagesLoadError` *(proposed)* + S12–S15 | Die Confluence-Seiten konnten nicht geladen werden. | Could not load the Confluence pages. | open |
| B17 | `components/sidebar/ConfluenceModal.tsx:109` | Loading Confluence spaces fails | Raw backend text, else „Fehler“ | `confluenceSpacesLoadError` *(proposed)* + S12–S15 | Die Confluence-Bereiche konnten nicht geladen werden. | Could not load the Confluence spaces. | open |
| B18 | `components/GlobalKbSettings.tsx:741`, `:785` | A source's status is shown | Raw value, e.g. `error · 12 pages` | `active` / `paused` / `status.error` | Aktiv / Pausiert / Fehler | Active / Paused / Error | open |
| B19 | `components/GlobalKbSettings.tsx:785` | Page count of a Confluence source | `pages` (English only) | `pages` | Seiten | pages | open |
| B20 | `components/GlobalKbSettings.tsx:793` | Sync button of a Confluence source | `Sync` (English only) | `pollNow` | Jetzt abfragen | Poll Now | open |
| B21 | `hooks/useWebTools.ts:214` | Web search or crawl request refused | Raw backend text, else Aufgabe fehlgeschlagen | `taskFailed` + S12–S15 | Aufgabe fehlgeschlagen | Task failed | open |
| B22 | `hooks/useWebTools.ts:268` | Adding selected web pages refused | Raw backend text, else Hinzufügen fehlgeschlagen | `addSourcesFailed` + S12–S15 | Hinzufügen fehlgeschlagen | Failed to add sources | open |
| B23 | `hooks/useWebTools.ts:73–74`, `:78`, `:109`, `:121–123` | Deep web research refused, no body, SSE error event, or network failure | `HTTP 502`, `No response body`, `Error`, `Failed to fetch` (status line and toast) | `webResearchFailed` *(proposed)* + S12–S15 | Die Webrecherche konnte nicht abgeschlossen werden. Bitte versuche es erneut. | The web research could not be completed. Please try again. | open |
| B24 | `components/Studio/StudioWorkspace.tsx:116` | Analysis refused | Raw backend text | `analysisError` + S12–S15 | Analyse fehlgeschlagen. Bitte prüfe die Verbindung oder versuche es erneut. | Analysis failed. Please check your network or try again. | open |
| B25 | `hooks/useGeneratedContent.ts:185` | Studio: creating a chart refused | Raw backend text | `chartGenerateFailed` *(proposed)* + S12–S15 | Das Diagramm konnte nicht erstellt werden. Bitte versuche es erneut. | The chart could not be created. Please try again. | open |
| B25a | `hooks/useGeneratedContent.ts:208` | Studio: creating a summary (abstract) of a file refused | Raw backend text | `abstractGenerateFailed` *(proposed)* + S12–S15 | Die Zusammenfassung konnte nicht erstellt werden. Bitte versuche es erneut. | The summary could not be created. Please try again. | open |
| B26 | `hooks/useGeneratedContent.ts:104` | Podcast job ends in `failed` | Worker error text | `podcastFailed` | Podcast-Generierung fehlgeschlagen | Podcast generation failed | open |
| B27 | `components/ResearchMode.tsx:248`, `:252`, `:302`, `:315`; `components/AcademicResearchMode.tsx:340`, `:344`, `:404`, `:421` | Research run refused, no reader, SSE error event, or network failure | `HTTP error! status: 500`, `No reader available`, `Failed to fetch` | `researchFailed` *(proposed)* + S12–S15 | Die Recherche konnte nicht abgeschlossen werden. Bitte versuche es erneut. | The research could not be completed. Please try again. | open |
| B28 | `components/AcademicSearchMode.tsx:149`, `:157` | Paper search refused | Raw backend text or `Search failed (HTTP 502)` | `academicSearchFailed` *(proposed)* + S12–S15 | Die Suche nach Fachartikeln ist fehlgeschlagen. Bitte versuche es erneut. | The paper search failed. Please try again. | open |
| B29 | `components/AcademicSearchMode.tsx:238`, `:243` | Some or all selected papers could not be added (`:238` lists the titles) | Fehler beim Hinzufügen: … (language ternary) | `papersAddFailed` + S12–S15 | Einige Papers konnten nicht hinzugefügt werden | Some papers could not be added | open |
| B30 | `components/AcademicSearchMode.tsx:271`, `:274` | One paper could not be added | Fehler beim Hinzufügen (language ternary) | `paperAddFailed` *(proposed)* + S12–S15 | Das Paper konnte nicht hinzugefügt werden. | Could not add the paper. | open |
| B31 | `components/AcademicSearchMode.tsx:315` | BibTeX export failed | BibTeX-Export fehlgeschlagen (language ternary) | `bibtexExportFailed` | BibTeX-Export fehlgeschlagen | BibTeX export failed | open |
| B32 | `components/kb-settings/KbSettingsPanel.tsx:92` (`kb-settings/api.ts:31`) | Loading topic settings fails (a 403 hides the panel instead) | `Error: fetch settings: 500` | `siteConfigFetchError` + S13–S15 | Fehler beim Laden der Einstellungen | Error loading settings | open |
| B33 | `components/kb-settings/KbSettingsPanel.tsx:143` (`kb-settings/api.ts:43`); `kb-settings/workflow/WorkflowCanvas.tsx:309` | Saving settings refused | `Error: save settings: 500` or raw backend text | `settingsSaveError` + S12–S15 | Fehler beim Speichern der Einstellungen | Error saving settings | open |
| B34 | `components/kb-settings/KbSettingsPanel.tsx:143`, `:167`; `kb-settings/workflow/WorkflowCanvas.tsx:309`, `:338` | Save or reset refused, 400: two settings exclude each other (needs a backend code that names the keys) | Raw backend text naming both keys | `kbSettingsConflict` *(proposed)* | Diese Einstellungen schließen sich gegenseitig aus: {keys}. Ändere eine davon und speichere erneut. | These settings exclude each other: {keys}. Change one of them and save again. | open |
| B35 | `components/kb-settings/KbSettingsPanel.tsx:167` (`kb-settings/api.ts:56`); `kb-settings/workflow/WorkflowCanvas.tsx:338` | Resetting a setting refused (other than B34) | `Error: reset setting: 500` or raw backend text | `settingsResetError` *(proposed)* + S12–S15 | Die Einstellung konnte nicht zurückgesetzt werden. | Could not reset the setting. | open |
| B36 | `components/kb-settings/KbSettingsPanel.tsx:143` (`kb-settings/api.ts:62`) | Starting the re-ingest refused | `Error: reembed: 403` | `reembedError` + S12–S15 | Fehler beim Starten der Neueinbettung | Failed to trigger re-embedding | open |
| B37 | `components/kb-settings/workflow/WorkflowCanvas.tsx:203`, `:710` (`workflow/api.ts:15`) | Loading the workflow fails | Der Workflow konnte nicht geladen werden (fetch workflow: 500). (German only) | `workflowLoadError` *(proposed)* + S12–S15 | Der Workflow konnte nicht geladen werden. | Could not load the workflow. | open |
| B38 | `components/kb-settings/workflow/WorkflowCanvas.tsx:411` | Saving the topic's default agent or team refused | Die Vorgabe konnte nicht gespeichert werden (attach agent: 403). (German only) | `workflowDefaultSaveError` *(proposed)* + S12–S15 | Der Standard-Agent bzw. das Standard-Team für neue Chats in diesem Thema konnte nicht gespeichert werden. | The default agent or team for new chats in this topic could not be saved. | open |
| B39 | `components/kb-settings/workflow/WorkflowCanvas.tsx:260` | Template applied, refreshing the view failed | Vorlage angewendet — die Ansicht konnte nicht aktualisiert werden. … (German only) | `workflowPresetAppliedStale` *(proposed)* | Vorlage angewendet – die Ansicht konnte nicht aktualisiert werden. Bitte lade die Ansicht neu. | Template applied – the view could not be refreshed. Please reload the view. | open |
| B40 | `components/kb-settings/workflow/WorkflowCanvas.tsx:323` | Saved, refreshing the view failed | Gespeichert — die Ansicht konnte nicht aktualisiert werden. … (German only) | `workflowSavedStale` *(proposed)* | Gespeichert – die Ansicht konnte nicht aktualisiert werden. Bitte lade die Ansicht neu. | Saved – the view could not be refreshed. Please reload the view. | open |
| B41 | `components/kb-settings/workflow/WorkflowCanvas.tsx:356` | Reset, refreshing the view failed | Zurückgesetzt — die Ansicht konnte nicht aktualisiert werden. … (German only) | `workflowResetStale` *(proposed)* | Zurückgesetzt – die Ansicht konnte nicht aktualisiert werden. Bitte lade die Ansicht neu. | Reset – the view could not be refreshed. Please reload the view. | open |
| B42 | `components/kb-settings/workflow/WorkflowCanvas.tsx:421` | Default saved, refreshing the view failed | Vorgabe gespeichert — die Ansicht konnte nicht aktualisiert werden. … (German only) | `workflowDefaultSavedStale` *(proposed)* | Vorgabe gespeichert – die Ansicht konnte nicht aktualisiert werden. Bitte lade die Ansicht neu. | Default saved – the view could not be refreshed. Please reload the view. | open |
| B43 | `components/kb-settings/workflow/PresetPicker.tsx:136`, `:275` (`workflow/api.ts:24`) | Loading the templates fails | Vorlagen konnten nicht geladen werden (fetch presets: 500). (German only) | `workflowPresetsLoadError` *(proposed)* + S12–S15 | Die Vorlagen konnten nicht geladen werden. | Could not load the templates. | open |
| B44 | `components/kb-settings/workflow/PresetPicker.tsx:205` (`workflow/api.ts:39`) | Template preview refused | Raw backend text or `preview preset: 500` | `workflowPresetPreviewError` *(proposed)* + S12–S15 | Die Vorschau der Vorlage konnte nicht geladen werden. | Could not load the template preview. | open |
| B45 | `components/kb-settings/workflow/PresetPicker.tsx:226` (`workflow/api.ts:58`) | Applying a template refused | Raw backend text or `apply preset: 500` | `workflowPresetApplyError` *(proposed)* + S12–S15 | Die Vorlage konnte nicht angewendet werden. | Could not apply the template. | open |
| B46 | `components/agents/AgentForm.tsx:42` (`agents/api.ts:68`) | Saving an agent refused | Raw backend text or `create agent: 500` | `agentSaveError` *(proposed)* + S12–S15 | Der Agent konnte nicht gespeichert werden. | Could not save the agent. | open |
| B47 | `components/agents/TeamForm.tsx:35` (`agents/api.ts:68`) | Saving a team refused | Raw backend text or `create team: 500` | `teamSaveError` *(proposed)* + S12–S15 | Das Team konnte nicht gespeichert werden. | Could not save the team. | open |
| B48 | `components/agents/AgentsView.tsx:78` (`agents/api.ts:88`, `:99`) | Deleting an agent or team refused | `delete agent: 403` | `deleteFailed` + S12–S15 | Löschen fehlgeschlagen. | Delete failed. | open |

### C. System administrators only

Users with the system role `admin` or `superadmin`, in the admin area: AI
providers, dashboards, evaluation, MCP servers, configurations. A topic admin
(group B) never sees these messages.

| ID | Where | When | Shown today | Message key | DE | EN | Status |
|---|---|---|---|---|---|---|---|
| C01 | `AdminUI.tsx:335`, `:365` | Saving an AI provider or auth provider refused | Raw backend text | `saveFailed` + S12–S15 | Speichern fehlgeschlagen | Save failed | open |
| C02 | `AdminUI.tsx:322` → `components/admin/AdminConfigsTab.tsx:214` | Provider connection test reports unhealthy | Provider error text | `connectionFailed` | Verbindung fehlgeschlagen | Connection failed | open |
| C03 | `components/admin/AdminConfigsTab.tsx:135` | Context-window detection refused | Raw backend text | `contextWindowDetectFailed` + S12–S15 | Kontextfenster konnten nicht ermittelt werden. | Could not detect the context windows. | open |
| C04 | `components/admin/AdminEvalTab.tsx:158`, `:225` | Loading golden sets fails | Raw backend text | `evalGoldenSetsFetchFailed` + S12–S15 | Laden der Golden-Sets fehlgeschlagen. | Failed to load golden sets. | open |
| C05 | `components/admin/AdminEvalTab.tsx:211` | Starting golden-set generation refused | Raw backend text | `evalGenFailed` + S12–S15 | Generierung fehlgeschlagen | Generation failed | open |
| C06 | `components/admin/AdminEvalTab.tsx:251` | Loading eval runs fails | Raw backend text | `evalFetchFailed` + S12–S15 | Laden der Durchläufe fehlgeschlagen. | Failed to load runs. | open |
| C07 | `components/admin/AdminEvalTab.tsx:328` | Golden-set upload refused | Raw backend text | `evalGoldenSetUploadFailed` + S12–S15 | Hochladen fehlgeschlagen. | Upload failed. | open |
| C08 | `components/admin/AdminEvalTab.tsx:339` | Saving an eval schedule refused | Raw backend text | `evalScheduleUpdateFailed` + S12–S15 | Zeitplan konnte nicht gespeichert werden | Failed to save schedule | open |
| C09 | `components/admin/AdminEvalTab.tsx:351` | Deleting a golden set refused | Raw backend text | `evalGoldenSetDeleteFailed` + S12–S15 | Löschen fehlgeschlagen. | Delete failed. | open |
| C10 | `components/admin/AdminEvalTab.tsx:377` | Starting an eval run refused | Raw backend text | `evalKickOffFailed` + S12–S15 | Starten der Evaluation fehlgeschlagen. | Failed to start eval run. | open |
| C11 | `components/admin/AdminEvalTab.tsx:394` | Deleting an eval run refused | Raw backend text | `evalDeleteFailed` + S12–S15 | Löschen fehlgeschlagen. | Failed to delete run. | open |
| C12 | `components/admin/AdminEvalTab.tsx:422` | Eval export refused | Raw backend text | `evalExportFailed` + S12–S15 | Export fehlgeschlagen. | Export failed. | open |
| C13 | `components/admin/AdminEvalTab.tsx:439` | Eval comparison refused | Raw backend text | `evalCompareFailed` + S12–S15 | Vergleich fehlgeschlagen. | Comparison failed. | open |
| C14 | `components/admin/AdminEvalTab.tsx:605` | Golden-set generation job ends in `failed` | `failed — context deadline exceeded` | `evalGenFailed` | Generierung fehlgeschlagen | Generation failed | open |
| C15 | `components/admin/AdminGlobalKbsTab.tsx:232` | Making a public topic private refused | Raw backend text | `unpublishError` + S12–S15 | Fehler beim Zurücknehmen der Wissensdatenbank | Error making the knowledge base private | open |
| C16 | `components/admin/AdminUnpublishDialog.tsx:68` | Loading the unpublish impact fails | Raw backend text | `unpublishImpactLoadError` + S12–S15 | Fehler beim Laden der Auswirkungen | Error loading the impact | open |
| C17 | `components/admin/KbTransferOwnerDialog.tsx:58` | Loading the user list fails | Raw backend text | `kbTransferUsersLoadError` + S12–S15 | Fehler beim Laden der Nutzenden | Error loading users | open |
| C18 | `KBOverviewDashboard.tsx:314` | Loading the topic overview fails | Raw backend text | `kbOverviewLoadError` + S12–S15 | Fehler beim Laden der KB-Übersicht | Error loading KB overview | open |
| C19 | `KBOverviewDashboard.tsx:330` | Deleting a topic refused | Raw backend text | `kbDeleteFailed` + S12–S15 | Löschen fehlgeschlagen | Delete failed | open |
| C20 | `KBOverviewDashboard.tsx:357` | Publishing a topic refused | Raw backend text | `kbPublishFailed` + S12–S15 | Veröffentlichen fehlgeschlagen | Publishing failed | open |
| C21 | `KBOverviewDashboard.tsx:372` | Transferring ownership refused | Raw backend text | `kbTransferFailed` + S12–S15 | Übertragung fehlgeschlagen | Transfer failed | open |
| C22 | `SystemHealthDashboard.tsx:409`, `:444` | Loading metrics fails | Raw backend text, else Fehler beim Laden der Metriken (German only) | `metricsFetchError` + S12–S15 | Fehler beim Laden der Metriken | Error loading metrics | open |
| C23 | `SystemHealthDashboard.tsx:418`, `:454` | Loading historical data fails | Raw backend text | `historicalDataError` + S12–S15 | Fehler beim Laden der historischen Daten | Error loading historical data | open |
| C24 | `SystemHealthDashboard.tsx:246` | A service health check reports an error | `dial tcp 10.0.0.5:5432: connect: connection refused` | `healthServiceUnreachable` *(proposed)* | Nicht erreichbar | Not reachable | open |
| C25 | `SystemHealthDashboard.tsx:352` (shown at `:691`) | The AI check reports unhealthy | Provider error text | `healthServiceUnreachable` *(proposed)* | Nicht erreichbar | Not reachable | open |
| C26 | `SystemHealthDashboard.tsx:355` | The AI check request fails | Prüfung fehlgeschlagen (German only) | `connectionTestFailed` | Verbindungstest fehlgeschlagen | Connection test failed | open |
| C27 | `components/admin/AdminMCPSection.tsx:142–146`, `:272` | Loading the MCP status fails | `Error: Error: HTTP 500` | `mcpStatusLoadError` *(proposed)* + S12–S15 | Der MCP-Status konnte nicht geladen werden. | Could not load the MCP status. | open |
| C28 | `components/admin/AdminMCPSection.tsx:161–168`, `:272` | Reloading the MCP registry refused | `Error: Error: HTTP 500: <body>` | `mcpReloadError` *(proposed)* + S12–S15 | Die MCP-Server konnten nicht neu geladen werden. | Could not reload the MCP servers. | open |
| C29 | `components/admin/AdminMCPSection.tsx:118` | One MCP server reports an error | Raw server error text | `mcpServerUnreachable` *(proposed)* | Server nicht erreichbar | Server not reachable | open |
| C30 | `components/admin/AdminMCPSection.tsx:50–58`, `:229` | The server list is not valid JSON or misses `name`/`url` | `Invalid JSON: each entry needs a non-empty "url"` (English only) | `mcpServersInvalid` *(proposed)* | Die Serverliste muss ein JSON-Array von Objekten mit „name“ und „url“ sein. | The server list must be a JSON array of objects with “name” and “url”. | open |
| C31 | `components/admin/AdminAgentMetricsCard.tsx:154–158`, `:205` | Loading agent metrics fails | `Error: Error: HTTP 403` | `agentMetricsLoadError` *(proposed)* + S12–S15 | Die Agent-Metriken konnten nicht geladen werden. | Could not load the agent metrics. | open |
| C32 | `components/admin/policyPreview.ts:80–270` → `AdminAgentTab.tsx:1044`, `:1080` | Orchestrator policy or tools-by-route JSON is invalid (one row for every validator message) | `rule 0: unknown field "foo"` (English only) | `policyError*` *(proposed)*, one key per message, e.g. `policyErrorUnknownField` | Regel {n}: unbekanntes Feld „{field}“. | Rule {n}: unknown field “{field}”. | open |

### D. Not user-visible

Text that is only logged or replaced before the user sees it, and failures that
show nothing.

| ID | Where | When | Shown today | Message key | DE | EN | Status |
|---|---|---|---|---|---|---|---|
| D01 | `hooks/useChatStream.ts:216` | Send refused | Nothing; logs `chat send refused: <status>` (no server text) | none; the user sees A11–A14 | — | — | done |
| D02 | `hooks/useChatStream.ts:222` | No stream reader; `noReaderError` is thrown | The A17 bubble | none; the user sees `aiGenericError` (A17) | — | — | done |
| D03 | `utils/sseParser.ts:32` | Idle timeout; the English `SseIdleTimeoutError` text is logged | The A15 bubble | none; the user sees `errorAnswerTimeout` (A15) | — | — | done |
| D04 | `hooks/useChatAttachment.ts:24` | Former English fallbacks for a missing `t` | Removed; `t` is required | none | — | — | done |
| D05 | `hooks/useWebTools.ts:199`; `components/GlobalKbSettings.tsx:236` | Crawl job ends in `failed`; the reason is thrown, then lost | Aufgabe fehlgeschlagen / Hinzufügen fehlgeschlagen | `crawlFailed` *(proposed)* | Die Website konnte nicht durchsucht werden. Prüfe die Adresse und versuche es erneut. | The website could not be crawled. Check the address and try again. | open |
| D06 | `hooks/useWebTools.ts:205`; `components/GlobalKbSettings.tsx:240` | Crawl has no result after 5 minutes | Aufgabe fehlgeschlagen / Hinzufügen fehlgeschlagen | `crawlTimedOut` *(proposed)* | Das Durchsuchen der Website hat zu lange gedauert. Versuche es mit weniger Seiten erneut. | Crawling the website took too long. Try again with fewer pages. | open |
| D07 | `hooks/useWebTools.ts:172`; `components/GlobalKbSettings.tsx:216` | Crawl start answers without a job id | Aufgabe fehlgeschlagen / Hinzufügen fehlgeschlagen | `errorUnexpected` (S15) | Ein unerwarteter Fehler ist aufgetreten. Bitte versuche es erneut. | An unexpected error occurred. Please try again. | open |
| D08 | `components/AcademicSearchMode.tsx:224`, `:264`, `:303`; `ResearchMode.tsx:359`, `:388`; `AcademicResearchMode.tsx:458`, `:486`, `:631` | Export or add refused; an English `Error` is thrown, then replaced by the feature's toast | The feature's toast, without S12–S15 | The toast's key (`docxExportFailed`, `bibtexExportFailed`, `papersAddFailed`; B29–B31) + S12–S15 | (per key) | (per key) | open |
| D09 | `components/ChatView.tsx:124` | Draft enhancement refused | Nothing (logged only) | `enhanceFailed` *(proposed)* + S12–S15 | Der Entwurf konnte nicht verbessert werden. Bitte versuche es erneut. | Could not improve the draft. Please try again. | open |
| D10 | `hooks/useKBGraphStream.ts:49` | The graph change stream cannot open | Nothing; the loop reconnects | none: stays silent while it reconnects | — | — | open |
| D11 | `Dashboard.tsx:298` | Dashboard data load fails; the component is mounted nowhere (tests and stories only) | Nothing | none: delete the component, or `metricsFetchError` if it is mounted again | — | — | open |
| D12 | `components/ConfluenceTokenManager.tsx:115` | The decrypt failure is detected by matching the backend's English text | Drives A41 | needs a machine-readable connection error code; message A41 | — | — | open |

## 5. Backend sources of free text

Where the `error` texts behind the messages above come from. Paths are relative to
`go-backend/internal`; line numbers are as of the backend change that adds the
codes. A code in parentheses is the `code` the response now carries.

- `uploadcheck/uploadcheck.go:135`, `:140`, `:144` – name checks, all **400**: `File type not allowed`, `File type not supported (.ext)` (`unsupported_file_type`), `Filename must not exceed 255 bytes` (`file_name_too_long`)
- `uploadcheck/uploadcheck.go:193`, `:196` – 413 `File too large: the upload limit is …` (`file_too_large`, `limitBytes`), 400 `Invalid multipart form` (`invalid_upload`)
- `uploadcheck/uploadcheck.go:202`, `:213` – 400 `File field is required` (`invalid_upload`), `File must not be empty` (`empty_file`)
- `uploadcheck/uploadcheck.go:243` – 413 spreadsheet limit (`file_too_large`, `limitBytes`); the text still names the config key `tabular_max_file_bytes`
- `files/http.go:575` – writes the `uploadcheck` error with its code
- `files/http.go:609`, `:613` – 400 topic limits: `Knowledge base has reached the maximum of %d files`, `… the 500 MB storage limit` (`kb_full`)
- `files/from_library.go:111` (body from `userfiles/http.go:84–92`) – 413 `quota_exceeded` (in `error` and `code`)
- `files/from_library.go:126`, `:143` – 409 `already_in_kb` (in `error` and `code`)
- `files/http_ingest.go:467`, `:487`, `:506` – URL fetch: 400 validation error, 502 `Failed to fetch URL` (no code; B08, B09)
- `chat/attachments_http.go:76`, `:91` – 503 `chat attachments are not available` (no code); the `uploadcheck` error with its code
- `chat/attachments_http.go:151–162` (used at `:121` and `:265`) – 415 `unsupported file type` (`unsupported_file_type`), 422 `the file %q could not be read` (`file_unreadable`), 422 `the file %q took too long to read` (`parse_timeout`), 422 `the file contained no extractable text` (`no_text`), 500 `failed to read the file` (no code)
- `chat/attachments_http.go:164–175` – 422 `too_large_for_context` (in `error` and `code`) with `tokens`, `limit`
- `chat/attachments_http.go:222–276` – send-time attachment refusals without a code: 503 not available, 400 `at most %d attachments per message`, 400 comparison combination, 400 regenerate, 404 `attachment not found`, 500 read failure; file refusals carry the codes above
- `chat/library_text.go:21`, `:28`, `:32` – sentinels `ErrUnsupportedType`, `ErrUnparseable`, `ErrLibraryParseTimeout`; mapped in `chat/attachments_http.go:151–162` and `chat/library_http.go:354–360`
- `chat/http_attachment.go:97–104`, `:126`, `:154`, `:165`, `:177`, `:185`, `:189`, `:192`, `:196` – comparison upload: 413 `file is too large` (`file_too_large`, `limitBytes`), 503 `document comparison is disabled` (no code), 400 multipart and field errors (`invalid_upload`), 415 `unsupported file type` (`unsupported_file_type`), 422 `the file could not be read` (`file_unreadable`), 422 `the file contained no extractable text` (`no_text`), 500 `failed to parse file` (no code)
- `chat/http_send_helpers.go:69–92` – 400 validation (`message is required`, length limit, regenerate checks)
- `chat/http_send_helpers.go:152–164`, `:625` – 403 `access denied`, 500 chat-row errors
- `chat/http_send.go:261` – web-search refusal
- `chat/http_send.go:566`, `:592` – SSE frames `failed to prepare context`, `failed to save user message` (early-open), with JSON twins at `:570`, `:596`
- `chat/http_send.go:1449`, `:1458`, `:1482`, `:1590`; `chat/http_send_helpers.go:853`, `:863`, `:887`, `:954` – SSE frames `failed to run AI stream`, `failed to start AI stream`, `AI stream interrupted`, `failed to save AI message`
- `chat/library_http.go:317–330` – library-chat error, as JSON or SSE frame, with `code` where one applies; `:378` 400 (`too_large_for_context`), `:380` 400 (`no_text`); no web UI calls library chat yet
- `processor/processor.go:898`, `:935`, `:1104`, `:1398`, `:1481`, `:1505`; `worker/handlers.go:44`; `files/http_retry.go:116` – English `files.error_message` texts; the web client no longer shows them (A19)
- RSS, Confluence and Git sources' `error_message` and the Confluence connection's `errorMessage` – free text from the remote system (A20–A22, A41, A42); no code yet

## 6. Summary

| Group | Messages | Done | Open |
|---|---|---|---|
| A. Every user | 46 | 22 | 24 |
| B. Topic editors and topic admins | 50 | 8 | 42 |
| C. System administrators only | 32 | 0 | 32 |
| D. Not user-visible | 12 | 4 | 8 |
| **Total** | **140** | **34** | **106** |

C32 stands for every message of the two policy validators (about 27), counted as
one row.

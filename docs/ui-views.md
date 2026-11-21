# UI views

Every view the web app renders and how each one is reached. Code: `web/src/`.

## Finding the current view

- The path names the routed view. The route table is `routing/routes.ts`; `useAppRoute`
  (`routing/navigation.ts`) turns the matched route into an `AppRoute`.
- The root route mounts `AppRoot.tsx`, which renders `Login.tsx` or `AuthenticatedApp.tsx`.
  `AuthenticatedApp` reads the route and picks what to render; routes carry no components.
- Ids in generated paths are 22-character short ids (`routing/shortId.ts`); a full UUID typed by
  hand resolves too.
- Dialogs sit in URL parameters: `?admin=`, `?settings=`, `?topic=` (`routing/urlDialog.ts`).
- One page has no URL of its own: the RAG settings live in the history entry's state.

## Routes

| URL | `view` | Renders | Shell |
|---|---|---|---|
| `/` | `my-topics` | `components/MyTopicsView.tsx` | `AppFrame` |
| `/shared` | `shared-topics` | `components/SharedTopicsView.tsx` | `AppFrame` |
| `/discover` | `discover` | `components/DiscoverView.tsx` | `AppFrame` |
| `/kb/<id>` | `kb` | `components/ChatView.tsx` on a new chat | `AppFrame` with a topic |
| `/c/<id>` | `chat` | `components/ChatView.tsx` on that chat; the chat names its topic | `AppFrame` with a topic |
| `/kb/<id>/admin` | `global-kb-settings` | `components/GlobalKbSettings.tsx` | Full page |
| `/terms`, `/privacy`, `/accessibility` | same as path | `components/LegalPage.tsx` | Full page |
| Anything else, or an id segment that is no id | `not-found` | See redirects | — |

**Redirects** (signed in; the URL is replaced, so back does not return to it)

| Case | Goes to |
|---|---|
| Unknown path | `/` |
| A topic that cannot be resolved | `/` |
| A chat whose topic lookup finds nothing or fails | `/` |
| A chat URL that names no chat of its topic | `/kb/<id>` |
| The open chat is deleted | `/kb/<id>` |
| The first answer in a new chat | `/c/<id>`, keeping the query string |
| `/kb/<id>/admin` for a user who is not a system admin | `/` |
| `/kb/<id>/admin` for a topic that is not public | `/kb/<id>` |

Signed out, the URL stays as requested and the login screen shows; the legal pages render, and
a join link is replaced with `/`.

## Signed out

| Screen | Component | Notes |
|---|---|---|
| Login | `Login.tsx` | Password form when local auth or LDAP is enabled (also the fallback when provider discovery fails); SSO button when OIDC is configured. Variants: session expired, pending invite. |
| Password login | `Login.tsx` on `/admin` | Forces the password form and hides SSO; the same login endpoint. Replaces the URL with `/` on success. Signed in, `/admin` is an unknown path. |
| Legal pages | `components/LegalPage.tsx` | `/terms`, `/privacy`, `/accessibility`, linked from the login footer (`components/Footer.tsx`). |
| Join link | — | `/join/<token>` is captured before the router starts, kept in `sessionStorage`, and the URL replaced with `/`. `useJoinRedeem` redeems it and opens the topic, after sign-in or at once in an existing session. |

## The shell (`AppFrame`)

`components/AppChrome.tsx`. One shell for the three overview pages and the topic view, so
the sidebar stays mounted when the main area changes. Layout comes from the design system's
`AppShellLayout`. Full pages render without it.

**Sidebar**

| Part | Content |
|---|---|
| Logo | The configured app name. Inside a topic it is a button to `/`. |
| Navigation | Search (opens the palette), „Mein Wissen" (`/`), „Geteiltes Wissen" (`/shared`), „Entdecken" (`/discover`) |
| Chat history | `components/history/HistoryPanel.tsx`: filters, empty and filtered-empty states, hover previews, rename |
| Footer | The user menu (`components/AppUserMenu.tsx`); it also hosts the `?settings=` and `?admin=` dialogs |

**User menu**

| Item | Opens |
|---|---|
| Profil | User settings, tab `profile` |
| Admin-Einstellungen | Admin console; roles `admin` and `superadmin` only |
| Einstellungen | User settings |
| Hilfe | Imprint (external link), terms, privacy, accessibility |
| Abmelden | Signs out |

**Search palette** (the nav's search row; ⌘K on Apple platforms, Ctrl+K elsewhere)

| Where | Search | Empty field offers |
|---|---|---|
| Overview page | `GlobalSearch`: topics, sources, chats, chat content; „show all in Entdecken" on topic hits | The other overview pages, account actions |
| Topic | `components/TopicSearch.tsx`: the topic's sources, chats and chat content; „search all topics" widens it | New chat, up to three recent chats of the topic, account actions |

The palette has loading, empty, error, rate-limited and unavailable states.

**Narrow screens**

| View | Tabs |
|---|---|
| Overview page | `nav` (sidebar), `page` (content) |
| Topic | `history` (sidebar), `chat`, `files` (sources; only with `seeSources`) |

Inside a topic a swipe moves between the tabs (`hooks/useViewState.ts`).

## Overview pages

| View | Shows | Cards | Filter chips |
|---|---|---|---|
| `MyTopicsView` | Topics the user owns | `PrivateKbCard` (`KbCard.tsx`); card or list layout | „Alle", „Favoriten", „Privat", „Geteilt", categories, „+" |
| `SharedTopicsView` | Private shares plus the public topics in the user's overview | `PrivateKbCard`; card or list layout | „Alle", „Favoriten", categories, „+" |
| `DiscoverView` | The catalog (`KbCatalogPanel`): published public topics, plus staged ones the user is a member of | Catalog cards and rows | „Alle", categories, „+" |

Categories are the platform's; each user chooses which chips show.

- States on „Mein Wissen" and „Geteiltes Wissen": no topics, no filter matches, load failed
  (with retry) — `TopicsEmptyState`. The catalog has loading and empty states.
- „+" in the chip row opens `CategoryManagerModal`.
- Card actions, for users with topic-settings rights: „Einstellungen" opens the topic's settings
  on `start`, „Teilen" on `members`.
- Creating and renaming a topic use a text-entry dialog.
- Access rules: `docs/kb-access.md`.

## Topic view

Rendered for `/kb/<id>` and `/c/<id>`. While the topic resolves, the main area shows a spinner.

| Area | Component | Shown |
|---|---|---|
| Top bar | Breadcrumb „section / topic" and the topic-settings gear | Gear: users with topic-settings rights |
| Main | `components/ChatView.tsx` | Always |
| Right column | `components/sources/SourcesPanel.tsx` | With `seeSources`; without it the desktop shows a locked sources control |

**Topic-settings rights** (`utils/kbAccess.ts`): the topic's owner and KB admins, superadmins, and
system admins on a public topic they hold no explicit membership in. They gate the gear, the
card actions, the first-source pencil and `?topic=`.

### Chat states

All inside `ChatView`.

| State | When |
|---|---|
| Start loading | A chat with no messages, no chosen role and no id, while the start page or the file availability is not known yet: skeleton and inert composer |
| Start page | A new chat: the topic's configured start — role entries, starter questions, an instruction card, input or upload-only; plain input when nothing is configured. Choosing a role can open an input, task or file step, or send its instruction at once; a file step sends after the upload. |
| No sources | A non-public topic whose file list is loaded, visible to the user and holds no completed file: sending is blocked. With `addSources` and an empty chat, the first-source prompt shows; its pencil opens the topic settings. |
| Conversation | A chat with messages. While a turn runs and neither text nor reasoning has arrived, a status line shows. |
| Editing a message | The user message's bubble becomes an inline editor |
| Comparison | Two answer branches side by side (`ComparisonView`), from a message with at least two branches |

The composer blocks sending while an attachment is uploading or has failed. Its web-search
action needs the site flag `chat_web_search_enabled`.

### Overlays in the chat

| Overlay | Opened from |
|---|---|
| Citation popover (pointer) or bottom sheet (touch) | A citation chip (`sources/CitationChip.tsx`); needs `seeCitations` |
| Citations and source side panel | The citations launcher opens the `citations` list; a chip's source action, an answer's source list or a list entry opens the `citation` tab |
| Table preview (`LocalTablePreviewDialog`) | „Maximize" on a Markdown table |
| Feedback comment popover | Rating an answer |
| Upload storage notice (`UploadStorageNoticeDialog`) | The first source upload and the first chat upload, each until accepted (stored per user and browser) |

### Dialogs opened from the topic view

| Dialog | Component | Opened from |
|---|---|---|
| Topic settings | `components/KbSettingsDialog.tsx` | The gear, the first-source prompt, a topic card; `?topic=` |
| Add source | `TextSourceModal`, `CrawlModal`, `RssModal`, `ConfluenceModal` (connection, space, scope, options, confirmation), `GitRepoModal` | The sources column, with `addSources`. Confluence, git and web search need their site flags. Upload opens the system file picker or takes a drop. |
| Source details | `SourceDetailsModal` | An RSS, Confluence or git source row |
| Hover preview | `sidebar/SourceHoverPreview` | A file or synced-source row |
| Text viewer | `TextSourceViewer` (`sidebar/TextSourceModal.tsx`) | See file previews; also shows a document's extracted text |
| PDF preview | `PdfPreviewModal` | See file previews |
| Media preview | `MediaPreviewModal` | See file previews |
| Table preview | `tablePreview/TablePreviewDialog` (sheet tabs, row details) | A spreadsheet source |
| Web results | `WebResultsEditor` (full screen) | Opens when a crawl or a fast source search finishes; reopened from the crawl dialog or the sources search box. On a phone, choosing a result switches from the list to the editor. Deep research shows its progress in the sources column instead. |

**File previews** open from: a file row, an entry in a synced source's details, a search hit
(global or topic), a cited source's full view, a citation in the comparison view, a finished
composer upload, and an attachment chip on a sent message. Opening a KB file needs
`downloadSources`; without it a global search hit opens the topic only, and the topic's own
search leaves such hits out. Attachments preview as PDF,
text, Markdown, image, audio or video; Word files and spreadsheets do not.

## URL dialogs

- Opening adds a history entry, switching sections replaces it, closing goes back.
- A dialog opened by a link is closed by removing the parameter (replace).
- A bare parameter or an unknown value opens the first section.
- `?settings=` and `?admin=` work where the user menu is mounted: the pages that use the shell.
  Full pages ignore them.

### `?settings=` — user settings

`components/UserSettingsModal.tsx`

| Tab | Content |
|---|---|
| `general` | Theme, contrast, accent colour, colours, language |
| `chat` | Prompt suggestions, follow-up questions, auto-scroll, chat width |
| `profile` | Username, first name, last name, e-mail, role; read-only, with the LDAP notice |
| `connectors` | API keys (roles `api-user`, `admin`, `superadmin`), Confluence token (site flag `confluence_enabled`); an unavailable connector shows disabled |

### `?topic=` — topic settings

`components/KbSettingsDialog.tsx`. Works on `/kb/<id>` and `/c/<id>` once the topic is resolved
and the user has topic-settings rights. Navigating to another topic drops the parameter.

| Section | Component | Sub-screens |
|---|---|---|
| `start` | `kbSettings/assistant/StartPageSection` | Title and chat-start editors, role-chat preview |
| `behavior` | `kbSettings/assistant/BehaviorSection` | Role editor, role preview, template details with copy |
| `roles` | `kbSettings/KbRolesRightsTab` (source permissions per role) | — |
| `members` | `kbSettings/KbMembersPanel` | „Add members" with tabs `usernames` and `links` |
| `versions` | `kbSettings/assistant/VersionHistorySection` | Expandable version details |

`start`, `behavior` and `versions` wait for the assistant settings to load and offer a retry on
failure.

### `?admin=` — admin console

`AdminUI.tsx`. Roles `admin` and `superadmin`; for anyone else the shell removes the parameter.
A section the user may not see falls back to `configs`.

| Section | Component | Visible to | Sub-screens |
|---|---|---|---|
| `configs` | `admin/AdminConfigsTab` (AI models) | Admin | Create and edit form |
| `auth` | `admin/AdminAuthTab` | Superadmin | Create and edit form |
| `search` | `admin/AdminSearchTab` | Superadmin | — |
| `agent` | `admin/AdminAgentTab` | Superadmin | — |
| `site` | `admin/AdminSiteTab` | Superadmin | — |
| `notice` | `admin/AdminSystemNoticeTab` | Admin | — |
| `kb-overview` | `KBOverviewDashboard.tsx` | Admin | Publish (non-public topics), transfer ownership and delete by typed name (both superadmin), „RAG-Settings" (deprecated) |
| `global-kbs` | `admin/AdminGlobalKbsTab` | Admin | Take-back dialog with impact and owner picker; opens the public-topic editor |
| `templates` | `admin/AdminTemplatesTab` | Admin | Tabs `roles` and `categories`; role-template editor |
| `users` | `admin/AdminUsersTab` | Admin | Read-only user details |
| `roles` | `admin/AdminRolesTab` | Admin | — |
| `health` | `SystemHealthDashboard.tsx` | Admin | `ReembedSection` (superadmin) |
| `eval` | `admin/AdminEvalTab` | Superadmin | Run comparison panel |

"Admin" includes superadmin.

## Full pages

| Page | Reached from | Content |
|---|---|---|
| Public-topic editor (`GlobalKbSettings`) | Admin console → `global-kbs`; `/kb/<id>/admin` directly | Settings of a public topic; can open `ConfluenceModal` when Confluence is enabled. Back goes to `/`. |
| RAG settings (`kb-settings/KbSettingsPanel`), deprecated | Admin console → `kb-overview` → row menu „RAG-Settings", for the admin's own, shared and public topics | Tabs `settings`, `evals`, `workflow`. Loading and error states; a 403 shows „Keine Berechtigung". Choosing a workflow preset opens a change preview first; selecting a workflow node opens its inspector. The breadcrumb goes back to the admin console's KB overview. |
| Legal (`LegalPage`) | User menu → Hilfe; the login footer; the policy notice (terms and privacy, new tab) | Terms, privacy, accessibility |

## Gates and overlays

| Element | Component | When |
|---|---|---|
| Loading screen | `LoadingFallback` in `AppRoot.tsx` and in `AuthenticatedApp.tsx` | While the sign-in split loads; during a redirect and while a lazy full page loads |
| Error screen | `components/ErrorBoundary.tsx` | A render crash: full screen, with „Try Again" and „Reload Page" |
| Usage-policy notice | `components/PolicyAcceptanceDialog.tsx` | The configured policy version is not accepted yet. Until the lookup answers, the signed-in app is inert except the legal pages; a failed lookup offers retry or sign-out. |
| System notice | `components/SystemNotice.tsx` | Enabled with a text; a dismissible one hides once dismissed. Banner above the app, pill over the main area, or toast. |
| App update | `hooks/useSystemNoticeBanner.tsx` | A new version is waiting: an alert in the shell that applies it and reloads |
| Toasts | `ToastContainer` | Mounted above the sign-in split, so they work on both sides |

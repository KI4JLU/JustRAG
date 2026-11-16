# Desktop app

The web app in a native Electron window. It is not a second app and has no UI
of its own: the window loads the deployment's web app from its address.

**Status: prototype.** It runs from source and builds unsigned installers for
one deployment. There is no signing, notarisation or auto-update yet.

## How it fits together

- **The host (this folder)** owns the window and what only the OS can do. It
  tells the page what kind of window it is in by setting attributes on
  `<html>`, and offers native functions through one bridge object,
  `window.nativeShell`.
- **The design system** ([KI4JLU/Design-System](https://github.com/KI4JLU/Design-System))
  owns every visual difference between desktop and web. It reads those
  attributes and arranges the frame.
- **The web app** (`web/`) fills the frame and calls the bridge. It never asks
  which platform it runs on.

The contract between host and page — attributes, bridge functions, title bar,
menu shortcuts, app icon — is documented in the design system's Storybook page
**"Native shell"**. Change it there and here together.

`desktop/` is not part of the root npm workspace: it has its own
`package.json` and lockfile, so the web build and the Docker image do not
install Electron.

## Run

```bash
npm ci --prefix desktop                           # once, and after a lockfile change
npm run desktop                                   # from the repo root: the web app on :5173
APP_URL=http://localhost:5175 npm run desktop     # another dev server
```

`npm run desktop` is `npm run dev` in `desktop/`. `APP_URL` is where the web
app is served; from source it defaults to the local dev server. Changes to the
page arrive through the dev server as in a browser; a change to the host
restarts the window.

One host runs at a time: a second start ends at once, without a message,
because the first holds the app's single-instance lock. Quit the open window
first.

## Package

```bash
APP_URL=https://atlas.example.org APP_NAME_PREFIX=JLU APP_NAME_PRODUCT=Atlas npm run package
```

Builds the installers for the platform it runs on into `dist/` (macOS: dmg and
zip, Windows: nsis, Linux: AppImage and deb). `npm run package:dir` stops at
the unpacked application.

For a real application to test with — its own name and icon in the Dock,
packaged behaviour — against a local dev server, from the repo root:

```bash
APP_URL=http://localhost:5173 APP_NAME_PRODUCT=Atlas npm run desktop:app
open "desktop/dist/mac-arm64/JLU Atlas.app"
```

Started from a terminal, the host prints one line per navigation it decided on
(`[navigation] external: … from …`).

| Variable | |
|---|---|
| `APP_URL` | Required. The deployment's web app. Built into the app; a packaged app cannot be pointed elsewhere. |
| `APP_NAME_PREFIX`, `APP_NAME_PRODUCT` | The app's name ("JLU Atlas") and the icon's letter. The server's variables of the same names; defaults `JLU` / `RAG`. |
| `APP_ID` | The application id, default `de.uni-giessen.justrag.desktop`. |

The version is the repository's (`package.json` in the root): the desktop app
is released with the web app and has no version of its own. Build a release
from its tag.

Without a signing identity the package is unsigned. It starts on the machine
that built it; to hand it to other people it has to be signed and notarised.

Only a packaged app carries its name: run from source, the Dock and Finder say
"Electron", because that name belongs to the Electron binary.

## What the host does

| | |
|---|---|
| Attributes on `<html>` | `data-host="desktop"` always; `data-shell="native"` where the OS has a window material (macOS, Windows 11 22H2 and later); `data-titlebar="inset"` on macOS, `"hidden"` in full screen |
| Window | macOS vibrancy with a hidden title bar and inset window controls; Windows 11 Mica with the standard title bar; opaque elsewhere |
| Bridge `window.nativeShell` | `setTheme(theme)` – the window material follows the user's colour scheme; `setAppName(name)` – redraws the icon; `onNewChat(callback)` – the menu's "Neuer Chat" |
| Menu | Ablage → Neuer Chat (`Cmd/Ctrl+N`), a shortcut a browser keeps for itself |
| Icon | The first letter of the app's name in white on the design system's default accent colour (`src/main/icon.ts`); rendered into `build/icon.png` while packaging |

## Security

- The page runs sandboxed with context isolation and without Node; it never
  gets `ipcRenderer`.
- The attributes and the bridge exist only on pages of the web app's own
  origin. Every bridge call is checked in the main process: it must come from
  that origin in the window's main frame, and its payload must be one of the
  allowed values.
- The window is for the web app. A link to another site, and anything the
  page opens in a new window, goes to the user's browser. Single sign-on stays
  in the window: it starts as a redirect from the app's server and returns by
  itself (`src/main/navigation.ts`). Addresses that are not http(s) are
  refused.
- On macOS a page that is not the web app's gets an empty 56px strip at the
  top, with the page moved below it: the title bar is hidden, and without the
  app's frame there would be nothing to drag the window by and the page would
  sit under the window controls.
- Browser permissions are refused except copying to the clipboard and full
  screen, and those only for the web app's own pages.
- One instance: a second start brings the running window forward.

## Files

- `src/main/index.ts` – window, menu, IPC handlers, session rules
- `src/main/navigation.ts` – which addresses are the app's and where a navigation may go
- `src/main/icon.ts`, `render-icon.ts`, `generate-icon.ts` – the icon's drawing, its rasteriser, the packaging step
- `src/preload/index.ts` – sets the `<html>` attributes and exposes the bridge
- `electron.vite.config.ts` – builds main and preload, with the deployment's values
- `electron-builder.config.mjs` – the installers

```bash
npm run typecheck
npm test
```

## Not done yet

- Signing and notarisation, auto-update
- Windows and Linux have not been tried on a real machine

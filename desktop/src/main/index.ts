// The desktop app: the web app in a native window. This process owns the
// window and what only the OS can do; it holds no UI. The page learns what
// kind of window it is in from attributes the preload sets on <html>, and
// reaches native functions through one bridge, window.nativeShell.
//
// The contract with the page (attributes, bridge, title bar, icon) is the
// design system's Storybook page "Native shell"; keep the two in step.
import { app, BrowserWindow, ipcMain, Menu, nativeTheme, session, shell } from "electron";
import { release } from "node:os";
import { join } from "node:path";
import { iconLetter } from "./icon";
import { isAppUrl, judgeNavigation, originOf } from "./navigation";
import { renderAppIcon } from "./render-icon";

// Where the web app is served. Built in (electron.vite.config.ts), so a
// packaged app cannot be pointed elsewhere.
const APP_URL = __APP_URL__;
const APP_ORIGIN = originOf(APP_URL) ?? "";

// The name in the menu bar. The Dock and Finder show the package's own name,
// which only a packaged app has — run from source it is "Electron".
app.setName(__APP_NAME__);

// An OS window material exists on macOS and on Windows 11 22H2 (build 22621+).
// Elsewhere the app renders opaque, exactly as on the web.
const hasMaterial =
  process.platform === "darwin" ||
  (process.platform === "win32" && Number(release().split(".")[2]) >= 22621);

let mainWindow: BrowserWindow | null = null;

/** Only the app's own page, in the window's main frame, may use the bridge. */
function trustedSender(event: Electron.IpcMainEvent): boolean {
  const frame = event.senderFrame;
  return (
    mainWindow !== null &&
    event.sender === mainWindow.webContents &&
    frame !== null &&
    frame === mainWindow.webContents.mainFrame &&
    isAppUrl(frame.url, APP_ORIGIN)
  );
}

/** An address for the log: origin and path, never the query or fragment. */
function place(url: string): string {
  try {
    const { origin, pathname, protocol } = new URL(url);
    return origin === "null" ? protocol : origin + pathname;
  } catch {
    return "(malformed)";
  }
}

function openInBrowser(url: string): void {
  if (originOf(url)) void shell.openExternal(url).catch(() => {});
}

// What the web app needs from the browser's permission system: copying to
// the clipboard and full screen. Everything else is refused, and a page that
// is not the app's (the sign-in provider) gets nothing.
const PERMISSIONS = new Set(["clipboard-sanitized-write", "fullscreen"]);
function configureSession(): void {
  session.defaultSession.setPermissionRequestHandler((contents, permission, callback, details) => {
    callback(
      contents === mainWindow?.webContents &&
        details.isMainFrame &&
        isAppUrl(details.requestingUrl, APP_ORIGIN) &&
        PERMISSIONS.has(permission),
    );
  });
  session.defaultSession.setPermissionCheckHandler(
    (contents, permission, requestingOrigin, details) =>
      contents !== null &&
      contents === mainWindow?.webContents &&
      details.isMainFrame &&
      isAppUrl(details.requestingUrl ?? requestingOrigin, APP_ORIGIN) &&
      PERMISSIONS.has(permission),
  );
}

function buildMenu(): void {
  // Shortcuts a browser keeps for itself are menu items here; the page is
  // told which one was chosen (docs: "Native shell" → Menu shortcuts).
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      { role: "appMenu" },
      {
        label: "Ablage",
        submenu: [
          {
            label: "Neuer Chat",
            accelerator: "CmdOrCtrl+N",
            click: () => {
              const contents = mainWindow?.webContents;
              // Only the app's own page listens; a sign-in page must not be told.
              if (contents && isAppUrl(contents.getURL(), APP_ORIGIN)) contents.send("native-shell:new-chat");
            },
          },
          { role: "close" },
        ],
      },
      { role: "editMenu" },
      { role: "viewMenu" },
      { role: "windowMenu" },
    ]),
  );
}

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 360,
    minHeight: 480,
    backgroundColor: "#00000000",
    // macOS
    vibrancy: "sidebar",
    visualEffectState: "followWindow",
    titleBarStyle: "hiddenInset",
    // Centres the window controls in the frame's 56px top row.
    trafficLightPosition: { x: 19, y: 22 },
    // Windows 11
    backgroundMaterial: "mica",
    webPreferences: {
      preload: join(__dirname, "../preload/index.js"),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      additionalArguments: [`--app-origin=${APP_ORIGIN}`, ...(hasMaterial ? ["--native-shell"] : [])],
    },
  });
  mainWindow = win;
  win.on("closed", () => {
    mainWindow = null;
  });
  win.on("enter-full-screen", () => win.webContents.send("native-shell:fullscreen", true));
  win.on("leave-full-screen", () => win.webContents.send("native-shell:fullscreen", false));

  // A new window is never opened: what the page wants there goes to the browser.
  win.webContents.setWindowOpenHandler(({ url }) => {
    console.log(`[navigation] new window to the browser: ${place(url)}`);
    openInBrowser(url);
    return { action: "deny" };
  });
  const guard = (isRedirect: boolean) => (event: Electron.Event<{ url: string; isMainFrame: boolean }>) => {
    if (!event.isMainFrame) return;
    const verdict = judgeNavigation({
      target: event.url,
      current: win.webContents.getURL(),
      isRedirect,
      appOrigin: APP_ORIGIN,
    });
    // One line per decision that is not the app's own page, without the
    // query (sign-in addresses carry codes): shows why a link stayed or left.
    if (originOf(event.url) !== APP_ORIGIN) {
      console.log(`[navigation] ${verdict}: ${place(event.url)} from ${place(win.webContents.getURL())}${isRedirect ? " (redirect)" : ""}`);
    }
    if (verdict === "allow") return;
    event.preventDefault();
    if (verdict === "external") openInBrowser(event.url);
  };
  win.webContents.on("will-navigate", guard(false));
  win.webContents.on("will-redirect", guard(true));

  void win.loadURL(APP_URL);
}

// The app icon: the first letter of the app's name on the accent colour
// (icon.ts). The package carries the deployment's; the page then reports the
// configured name and the icon follows. Only the letter is taken from the
// page, and only when it changes.
let wantedLetter = iconLetter(__APP_NAME_PRODUCT__);
async function showAppIcon(name: string): Promise<void> {
  const letter = iconLetter(name);
  if (letter === wantedLetter) return;
  wantedLetter = letter;
  const image = await renderAppIcon(letter, 1024);
  // Rendering takes a moment, and a newer name may have arrived meanwhile:
  // only the latest wins.
  if (letter !== wantedLetter) return;
  if (process.platform === "darwin") app.dock?.setIcon(image);
  else mainWindow?.setIcon(image);
}

ipcMain.on("native-shell:app-name", (event, name: unknown) => {
  if (!trustedSender(event)) return;
  if (typeof name !== "string" || name.length > 80) return;
  showAppIcon(name).catch(() => {});
});

ipcMain.on("native-shell:theme", (event, theme: unknown) => {
  if (!trustedSender(event)) return;
  if (theme === "system" || theme === "light" || theme === "dark") nativeTheme.themeSource = theme;
});

// Asked synchronously by the preload before the page exists, so the sender's
// address is not the app's yet; the answer is one boolean about the window.
ipcMain.on("native-shell:is-fullscreen", (event) => {
  event.returnValue = BrowserWindow.fromWebContents(event.sender)?.isFullScreen() ?? false;
});

// One window: a second start brings the running one forward.
if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on("second-instance", () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  });
  void app.whenReady().then(() => {
    configureSession();
    buildMenu();
    createWindow();
    // A run from source has no packaged icon: draw it once.
    if (!app.isPackaged) {
      wantedLetter = "";
      showAppIcon(__APP_NAME_PRODUCT__).catch(() => {});
    }
  });
  app.on("window-all-closed", () => app.quit());
}

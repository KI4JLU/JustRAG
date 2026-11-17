// Runs before the page's own scripts. It marks <html> so the design system
// arranges the frame for this window, and exposes the bridge — both only on
// the web app's own pages: a sign-in provider's page the window passes
// through gets neither.
import { contextBridge, ipcRenderer } from "electron";

type Theme = "light" | "dark" | "system";

const appOrigin = process.argv.find((arg) => arg.startsWith("--app-origin="))?.slice("--app-origin=".length);
const isMac = process.platform === "darwin";

function mark(): void {
  const root = document.documentElement;
  root.dataset.host = "desktop";
  if (process.argv.includes("--native-shell")) root.dataset.shell = "native";
  if (isMac) {
    // Ask, do not assume: a page loaded or reloaded while the window is in
    // full screen has no window controls to keep clear of.
    const isFullScreen: boolean = ipcRenderer.sendSync("native-shell:is-fullscreen");
    root.dataset.titlebar = isFullScreen ? "hidden" : "inset";
  }
}

/**
 * macOS hides the title bar, and only the web app's frame offers a row to
 * drag the window by and keeps clear of the window controls. A page that is
 * not the app's (the sign-in provider) gets that row from the host: an empty
 * strip as high as the frame's top row, with the page moved below it.
 */
function addTitleStrip(): void {
  const root = document.documentElement;
  root.style.setProperty("padding-top", "56px", "important");
  const strip = document.createElement("div");
  strip.style.cssText =
    "position:fixed;top:0;left:0;right:0;height:56px;z-index:2147483647;app-region:drag;-webkit-app-region:drag";
  root.append(strip);
}

/** The preload can run before <html> exists. */
function whenRootExists(run: () => void): void {
  if (document.documentElement) return run();
  new MutationObserver((_, observer) => {
    if (!document.documentElement) return;
    observer.disconnect();
    run();
  }).observe(document, { childList: true });
}

const isAppPage = Boolean(appOrigin) && location.origin === appOrigin;
if (!isAppPage && isMac && /^https?:$/.test(location.protocol)) whenRootExists(addTitleStrip);

if (isAppPage) {
  whenRootExists(mark);

  contextBridge.exposeInMainWorld("nativeShell", {
    /** Mirrors the colour scheme to the window, so its material matches. */
    setTheme: (theme: Theme) => ipcRenderer.send("native-shell:theme", theme),
    /** The system's name: the host draws its app icon from the first letter. */
    setAppName: (name: string) => ipcRenderer.send("native-shell:app-name", name),
    /** The menu's "Neuer Chat" was chosen. Returns the unsubscribe. */
    onNewChat: (callback: () => void) => {
      const listener = (): void => callback();
      ipcRenderer.on("native-shell:new-chat", listener);
      return () => ipcRenderer.removeListener("native-shell:new-chat", listener);
    },
  });

  // macOS only, like `mark()`: elsewhere the window keeps its standard title bar.
  if (isMac) {
    ipcRenderer.on("native-shell:fullscreen", (_event, isFullScreen: boolean) => {
      document.documentElement.dataset.titlebar = isFullScreen ? "hidden" : "inset";
    });
  }
}

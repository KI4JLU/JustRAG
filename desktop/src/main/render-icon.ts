import { BrowserWindow, type NativeImage } from "electron";
import { appIconSvg } from "./icon";

/** Rasterises the icon in a hidden window: `size` px square. */
export async function renderAppIcon(name: unknown, size = 1024): Promise<NativeImage> {
  const win = new BrowserWindow({
    width: size,
    height: size,
    show: false,
    frame: false,
    transparent: true,
    webPreferences: { offscreen: true, sandbox: true, javascript: false },
  });
  try {
    const svg = appIconSvg(name, { mac: process.platform === "darwin", size });
    const html = `<!doctype html><html><body style="margin:0;background:transparent;overflow:hidden">${svg}</body></html>`;
    // An offscreen window hands out its frames through `paint`; take the
    // first one drawn after the page has loaded.
    const frame = new Promise<NativeImage>((resolve) => {
      let loaded = false;
      win.webContents.on("did-finish-load", () => {
        loaded = true;
        win.webContents.invalidate();
      });
      win.webContents.on("paint", (_event, _dirty, image) => {
        if (loaded && !image.isEmpty()) resolve(image);
      });
    });
    await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
    return (await frame).resize({ width: size, height: size });
  } finally {
    win.destroy();
  }
}

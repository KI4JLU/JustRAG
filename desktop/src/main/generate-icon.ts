// Writes build/icon.png, the icon electron-builder puts into the package
// (it derives the .icns and .ico itself). Run by `npm run icon` while
// packaging; the name is the deployment's APP_NAME_PRODUCT.
import { app } from "electron";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { renderAppIcon } from "./render-icon";

app.dock?.hide();
void app.whenReady().then(async () => {
  try {
    const out = join(process.cwd(), "build");
    mkdirSync(out, { recursive: true });
    const image = await renderAppIcon(__APP_NAME_PRODUCT__, 1024);
    writeFileSync(join(out, "icon.png"), image.toPNG());
    console.log(`icon for "${__APP_NAME_PRODUCT__}" written to ${out}`);
    app.exit(0);
  } catch (error) {
    console.error(error);
    app.exit(1);
  }
});

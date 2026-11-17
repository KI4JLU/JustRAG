// Builds the installers for one deployment. The application carries the
// deployment's name and icon; its address is already in the main bundle
// (electron.vite.config.ts). Run through `npm run package`.
import { readFileSync } from "node:fs";

const prefix = (process.env.APP_NAME_PREFIX ?? "JLU").trim();
const product = (process.env.APP_NAME_PRODUCT ?? "RAG").trim() || "RAG";
const productName = [prefix, product].filter(Boolean).join(" ");

// The desktop app has no version of its own: it is released with the web app,
// under the repository's version (docs/runbooks/release.md).
const { version } = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));

/** @type {import("electron-builder").Configuration} */
export default {
  appId: process.env.APP_ID ?? "de.uni-giessen.justrag.desktop",
  productName,
  extraMetadata: { version },
  directories: { buildResources: "build", output: "dist" },
  // Only what the app runs. `generate-icon.js` is a packaging step.
  files: ["out/**", "!out/main/generate-icon.js", "package.json"],
  // build/icon.png is rendered by `npm run icon`; .icns and .ico derive from it.
  icon: "build/icon.png",
  mac: { target: ["dmg", "zip"], category: "public.app-category.productivity" },
  win: { target: ["nsis"] },
  linux: { target: ["AppImage", "deb"], category: "Office" },
};

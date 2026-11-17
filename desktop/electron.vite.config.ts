import { resolve } from "node:path";
import { defineConfig } from "electron-vite";

// The deployment's values are built into the main process: a packaged app
// starts without an environment, and its address must not be changeable
// afterwards. APP_NAME_* are the server's variables of the same names.
//
//   APP_URL=https://atlas.example.org APP_NAME_PREFIX=JLU APP_NAME_PRODUCT=Atlas npm run package
export default defineConfig(({ command }) => {
  const prefix = (process.env.APP_NAME_PREFIX ?? "JLU").trim();
  const product = (process.env.APP_NAME_PRODUCT ?? "RAG").trim() || "RAG";
  const appUrl = process.env.APP_URL || (command === "serve" ? "http://localhost:5173" : "");
  if (!appUrl) throw new Error("APP_URL is required: the address the desktop app loads.");
  const { protocol } = new URL(appUrl); // throws on a malformed address
  if (protocol !== "https:" && protocol !== "http:") throw new Error("APP_URL must be an http(s) address.");

  return {
    main: {
      define: {
        __APP_URL__: JSON.stringify(appUrl),
        __APP_NAME__: JSON.stringify([prefix, product].filter(Boolean).join(" ")),
        __APP_NAME_PRODUCT__: JSON.stringify(product),
      },
      build: {
        rolldownOptions: {
          input: {
            index: resolve(import.meta.dirname, "src/main/index.ts"),
            // Run on its own while packaging (npm run icon), never by the app.
            "generate-icon": resolve(import.meta.dirname, "src/main/generate-icon.ts"),
          },
        },
      },
    },
    preload: {},
  };
});

/**
 * Names the app in the app shell (index.html) the way the Go server does when
 * it serves it (go-backend/internal/app/app_shell.go): <title> and the
 * description get the configured name in place of the default, and two meta
 * tags hand both parts to the frontend at startup (appName.ts reads them), so
 * the first frame already shows the configured name. The Vite dev server runs
 * this (vite.config.ts), so a local preview behaves like production.
 *
 * No DOM types here: vite.config.ts compiles this file under the node tsconfig.
 */

export const APP_NAME_META_PREFIX = 'app-name-prefix';
export const APP_NAME_META_PRODUCT = 'app-name-product';

/** How the static index.html names the app. */
const SHELL_DEFAULT_NAME = 'JLU RAG';

const TITLE_RE = /<title>[^<]*<\/title>/;
const DESCRIPTION_RE = /<meta name="description" content="[^"]*"/;

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&#34;').replace(/'/g, '&#39;');
}

/**
 * html with every mention of the default name replaced by the configured one
 * — for the static legal pages (public/legal), which name the service.
 */
export function renameDefaultAppName(html: string, prefix: string, product: string): string {
  const name = escapeHtml(`${prefix} ${product}`);
  return html.replaceAll(SHELL_DEFAULT_NAME, () => name);
}

export function renderAppShell(html: string, prefix: string, product: string): string {
  const name = escapeHtml(`${prefix} ${product}`);
  // Function replacements throughout: a `$&` in the name stays literal.
  const rename = (tag: string) => tag.replace(SHELL_DEFAULT_NAME, () => name);
  const metas =
    `  <meta name="${APP_NAME_META_PREFIX}" content="${escapeHtml(prefix)}" />\n` +
    `  <meta name="${APP_NAME_META_PRODUCT}" content="${escapeHtml(product)}" />\n`;
  return html
    .replace(TITLE_RE, rename)
    .replace(DESCRIPTION_RE, rename)
    .replace('</head>', () => `${metas}</head>`);
}

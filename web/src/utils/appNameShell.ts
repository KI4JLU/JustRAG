/**
 * Names the app in the app shell (index.html) the way the Go server does when
 * it serves it (go-backend/internal/app/app_shell.go): <title> and the
 * description get the system name in place of the default, and three meta
 * tags hand the names to the frontend at startup (appName.ts reads them) —
 * the app name's two parts for the wordmark, the system name for the title —
 * so the first frame already shows them. The Vite dev server runs this
 * (vite.config.ts), so a local preview behaves like production.
 *
 * No DOM types here: vite.config.ts compiles this file under the node tsconfig.
 */

export const APP_NAME_META_PREFIX = 'app-name-prefix';
export const APP_NAME_META_PRODUCT = 'app-name-product';
export const SYSTEM_NAME_META = 'system-name';

/** How the static index.html names the app. */
const SHELL_DEFAULT_NAME = 'JLU RAG';

const TITLE_RE = /<title>[^<]*<\/title>/;
const DESCRIPTION_RE = /<meta name="description" content="[^"]*"/;

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&#34;').replace(/'/g, '&#39;');
}

/**
 * html with every mention of the default name replaced by `name` (the system
 * name) — for the static legal pages (public/legal), which name the service.
 */
export function renameDefaultAppName(html: string, name: string): string {
  const escaped = escapeHtml(name);
  return html.replaceAll(SHELL_DEFAULT_NAME, () => escaped);
}

/** The shell named `system`, carrying the three name metas before </head>. */
export function renderAppShell(html: string, prefix: string, product: string, system: string): string {
  const name = escapeHtml(system);
  // Function replacements throughout: a `$&` in the name stays literal.
  const rename = (tag: string) => tag.replace(SHELL_DEFAULT_NAME, () => name);
  const metas =
    `  <meta name="${APP_NAME_META_PREFIX}" content="${escapeHtml(prefix)}" />\n` +
    `  <meta name="${APP_NAME_META_PRODUCT}" content="${escapeHtml(product)}" />\n` +
    `  <meta name="${SYSTEM_NAME_META}" content="${name}" />\n`;
  return html
    .replace(TITLE_RE, rename)
    .replace(DESCRIPTION_RE, rename)
    .replace('</head>', () => `${metas}</head>`);
}

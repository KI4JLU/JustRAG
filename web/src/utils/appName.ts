/**
 * The app name. The design system's `Logo` renders `prefix` as plain text and
 * `product` in the brand badge („JLU [RAG]"); joined, it is the default of the
 * system name (systemNames.ts), which the window title shows. The server sets
 * both parts from APP_NAME_PREFIX / APP_NAME_PRODUCT and hands them out as
 * `app_name_prefix` / `app_name_product` in `GET /api/site-config`, to every
 * caller. It also writes them, and the system name, into the app shell it
 * serves (appNameShell.ts), so the names are known before that answer is in.
 * A part neither of them carries falls back to the default.
 *
 * There is no uploaded logo: the app never shows an operator's image, only
 * this wordmark.
 */
import { APP_NAME_META_PREFIX, APP_NAME_META_PRODUCT, SYSTEM_NAME_META } from './appNameShell';

export interface AppName {
  prefix: string;
  product: string;
}

export const DEFAULT_APP_NAME: AppName = { prefix: 'JLU', product: 'RAG' };

export function appNameFrom(siteConfigs: Record<string, string> | null | undefined): AppName {
  return {
    prefix: siteConfigs?.app_name_prefix?.trim() || DEFAULT_APP_NAME.prefix,
    product: siteConfigs?.app_name_product?.trim() || DEFAULT_APP_NAME.product,
  };
}

/**
 * The names the server wrote into the page, as site-config entries — the
 * starting site config, so the first frame shows them. Empty when the page
 * carries none (a dev server without its backend, an older server).
 */
export function siteConfigSeedFromDocument(doc: Document = document): Record<string, string> {
  const read = (name: string) => doc.querySelector(`meta[name="${name}"]`)?.getAttribute('content')?.trim() ?? '';
  const configs: Record<string, string> = {};
  const entries: [string, string][] = [
    ['app_name_prefix', APP_NAME_META_PREFIX],
    ['app_name_product', APP_NAME_META_PRODUCT],
    ['system_name', SYSTEM_NAME_META],
  ];
  for (const [key, meta] of entries) {
    const value = read(meta);
    if (value) configs[key] = value;
  }
  return configs;
}

/** The name as one string: "JLU RAG". */
export function appNameText({ prefix, product }: AppName): string {
  return `${prefix} ${product}`;
}

/* The server already names title and description in the shell it serves;
   this covers a shell it did not rename and keeps both in step with the site
   config. The description's tail repeats index.html's. */
const DESCRIPTION_SUFFIX = ' - Advanced Knowledge Retrieval System';

/** Sets the window title and the description to the system name. */
export function applySystemNameToDocument(systemName: string, doc: Document = document): void {
  doc.title = systemName;
  doc.querySelector('meta[name="description"]')?.setAttribute('content', systemName + DESCRIPTION_SUFFIX);
}

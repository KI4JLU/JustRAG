/**
 * The app name, in two parts: the institution („JLU", „TUM") and the system
 * („RAG", „Wissen"). The design system's `Logo` renders the institution as
 * plain text and the system in the brand badge („JLU [RAG]"); joined, they are
 * the window title. Admins set them in the settings (site_config
 * `institution_name`, `system_name`); unset, they are the server's
 * APP_NAME_PREFIX / APP_NAME_PRODUCT, which `GET /api/site-config` hands every
 * caller as `app_name_prefix` / `app_name_product`. The server also writes
 * the resulting name into the app shell it serves (appNameShell.ts), so it is
 * known before that answer is in. A part none of them carries falls back to
 * the default.
 *
 * There is no uploaded logo: the app never shows an operator's image, only
 * this wordmark.
 */
import { APP_NAME_META_PREFIX, APP_NAME_META_PRODUCT } from './appNameShell';

export interface AppName {
  prefix: string;
  product: string;
}

export const DEFAULT_APP_NAME: AppName = { prefix: 'JLU', product: 'RAG' };

/** The app name a site config gives: the admin's names, else the server's environment, else the default. */
export function appNameFrom(siteConfigs: Record<string, string> | null | undefined): AppName {
  return {
    prefix: siteConfigs?.institution_name?.trim() || siteConfigs?.app_name_prefix?.trim() || DEFAULT_APP_NAME.prefix,
    product: siteConfigs?.system_name?.trim() || siteConfigs?.app_name_product?.trim() || DEFAULT_APP_NAME.product,
  };
}

/**
 * The app name the server wrote into the page, as site-config entries — the
 * starting site config, so the first frame shows it. Empty when the page
 * carries none (a dev server without its backend, an older server).
 */
export function siteConfigSeedFromDocument(doc: Document = document): Record<string, string> {
  const read = (name: string) => doc.querySelector(`meta[name="${name}"]`)?.getAttribute('content')?.trim() ?? '';
  const configs: Record<string, string> = {};
  const prefix = read(APP_NAME_META_PREFIX);
  const product = read(APP_NAME_META_PRODUCT);
  if (prefix) configs.app_name_prefix = prefix;
  if (product) configs.app_name_product = product;
  return configs;
}

/*
 * A page the service worker serves comes from its precache: the shell as the
 * server rendered it when that worker was installed, i.e. at the last deploy.
 * The precache is deliberate (ReloadPrompt, updatePolicy.ts), so such a page
 * starts from the app name this browser last got from the site config
 * instead, which is at least that fresh; the site config corrects it either
 * way. A page from the network starts from the shell the server just rendered.
 */
const REMEMBERED_KEY = 'justrag.appName';

/** Stores the app name the site config gave, for the next precached page. Storage errors are ignored. */
export function rememberAppName({ prefix, product }: AppName, storage: Storage | null = localStorageOrNull()): void {
  try {
    storage?.setItem(REMEMBERED_KEY, JSON.stringify({ prefix, product }));
  } catch {
    /* private mode, quota: the next page starts from its shell */
  }
}

function rememberedAppName(storage: Storage | null): AppName | null {
  try {
    const v: unknown = JSON.parse(storage?.getItem(REMEMBERED_KEY) ?? 'null');
    if (v && typeof v === 'object') {
      const { prefix, product } = v as Record<string, unknown>;
      if (typeof prefix === 'string' && typeof product === 'string' && prefix.trim() && product.trim()) {
        return { prefix, product };
      }
    }
  } catch {
    /* unreadable: start from the shell */
  }
  return null;
}

function localStorageOrNull(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

/**
 * The starting site config: the remembered app name on a page the service
 * worker serves (`fromServiceWorker`), else the one the server wrote into the
 * page (siteConfigSeedFromDocument).
 */
export function siteConfigSeed(
  doc: Document = document,
  fromServiceWorker: boolean = typeof navigator !== 'undefined' && !!navigator.serviceWorker?.controller,
  storage: Storage | null = localStorageOrNull(),
): Record<string, string> {
  const remembered = fromServiceWorker ? rememberedAppName(storage) : null;
  return remembered
    ? { app_name_prefix: remembered.prefix, app_name_product: remembered.product }
    : siteConfigSeedFromDocument(doc);
}

/** The name as one string, e.g. for the window title: "JLU RAG". */
export function appNameText({ prefix, product }: AppName): string {
  return `${prefix} ${product}`;
}

/* The server already names title and description in the shell it serves;
   this covers a shell it did not rename and keeps both in step with the site
   config. The description's tail repeats index.html's. */
const DESCRIPTION_SUFFIX = ' - Advanced Knowledge Retrieval System';

/** Sets the window title and the description to the app name. */
export function applyAppNameToDocument(name: AppName, doc: Document = document): void {
  const text = appNameText(name);
  doc.title = text;
  doc.querySelector('meta[name="description"]')?.setAttribute('content', text + DESCRIPTION_SUFFIX);
}

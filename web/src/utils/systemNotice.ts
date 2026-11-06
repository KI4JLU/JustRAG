/*
 * The admin-set system notice (site_config `system_notice_*`, global-only and
 * public). The server validates the values at save time; this module turns
 * the flat site-config map into the one message the shell renders, or null.
 */

export const SYSTEM_NOTICE_TONES = ['neutral', 'info', 'warning', 'error'] as const;
export type SystemNoticeTone = (typeof SYSTEM_NOTICE_TONES)[number];

/**
 * Where the shell shows a notice (site_config `system_notice_placement`):
 * `banner` — the full-width bar above the whole app; `inline` — the small
 * message floating at the top of the content area; `toast` — a card in the
 * content area's bottom-right corner that stays until it is closed.
 */
export const SYSTEM_NOTICE_PLACEMENTS = ['banner', 'inline', 'toast'] as const;
export type SystemNoticePlacement = (typeof SYSTEM_NOTICE_PLACEMENTS)[number];

export function isSystemNoticePlacement(value: unknown): value is SystemNoticePlacement {
  return (SYSTEM_NOTICE_PLACEMENTS as readonly unknown[]).includes(value);
}

/**
 * The placement to use: the stored one, or — none stored, as before the
 * admin could choose — by severity: an outage (`error`) is the banner,
 * every other tone the small message in the content area.
 */
export function systemNoticePlacement(tone: SystemNoticeTone, stored?: string): SystemNoticePlacement {
  if (isSystemNoticePlacement(stored)) return stored;
  return tone === 'error' ? 'banner' : 'inline';
}

export interface SystemNotice {
  /** Optional bold headline before the text („**Titel** · Text"); empty for none. */
  title: string;
  text: string;
  tone: SystemNoticeTone;
  placement: SystemNoticePlacement;
  dismissible: boolean;
  /** Null without a usable URL. `label` may be empty: the caller supplies a default. */
  link: { href: string; label: string } | null;
  /**
   * Identity of this exact message. A dismissal is remembered against it, so
   * an edited message (title, text, tone, placement, link or dismissibility)
   * shows again — moving a closed notice up into the banner is a reason to
   * show it once more.
   */
  version: string;
}

const MAILTO = /^mailto:(?:\/\/)?([^?]*)(\?.*)?$/i;
const EMAIL = /^[^\s@<>(),;:"]+@[^\s@<>(),;:"]+\.[^\s@<>(),;:"]+$/;

/**
 * An absolute http(s) URL with a host, a mailto: link to one address, or a
 * root-relative path in this app — the same rule the server applies at save
 * time (siteconfig/system_notice.go). Checked again here because the value
 * lands in an href shown to every user.
 */
export function isSafeNoticeHref(value: string): boolean {
  if (value === '' || /[\s\p{Cc}]/u.test(value)) return false;
  if (value.startsWith('/')) return !value.startsWith('//') && !value.startsWith('/\\');
  const mailto = MAILTO.exec(value);
  if (mailto) return EMAIL.test(mailto[1]);
  try {
    const url = new URL(value);
    return (url.protocol === 'https:' || url.protocol === 'http:') && url.host !== '';
  } catch {
    return false;
  }
}

/** True for a web page outside the app (opened in a new tab); a path or a mailto: link is not. */
export function isExternalNoticeHref(href: string): boolean {
  return /^https?:/i.test(href);
}

/** `mailto://a@b` (a common way to type it) as the `mailto:a@b` mail clients expect. */
function normalizeNoticeHref(href: string): string {
  const mailto = MAILTO.exec(href);
  return mailto ? `mailto:${mailto[1]}${mailto[2] ?? ''}` : href;
}

/** 32-bit FNV-1a, hex. A version stamp, not a security measure. */
function fnv1a(input: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

/** The notice to show, or null when it is off or has no text. */
export function readSystemNotice(configs: Record<string, string | undefined>): SystemNotice | null {
  if (configs.system_notice_enabled !== 'true') return null;
  const text = (configs.system_notice_text ?? '').trim();
  if (!text) return null;
  const rawTone = configs.system_notice_tone ?? '';
  const tone: SystemNoticeTone = (SYSTEM_NOTICE_TONES as readonly string[]).includes(rawTone)
    ? (rawTone as SystemNoticeTone)
    : 'info';
  const placement = systemNoticePlacement(tone, configs.system_notice_placement);
  const dismissible = configs.system_notice_dismissible === 'true';
  const href = (configs.system_notice_link_url ?? '').trim();
  const link = isSafeNoticeHref(href)
    ? { href: normalizeNoticeHref(href), label: (configs.system_notice_link_label ?? '').trim() }
    : null;
  const title = (configs.system_notice_title ?? '').trim();
  const parts: unknown[] = [title, text, tone, dismissible, link?.href ?? '', link?.label ?? ''];
  // Only a placement other than the tone's own joins the stamp: storing the
  // one the tone implied anyway changes nothing a user sees, and notices from
  // before the setting keep the stamp their dismissals were saved under.
  if (placement !== systemNoticePlacement(tone)) parts.push(placement);
  const version = fnv1a(JSON.stringify(parts));
  return { title, text, tone, placement, dismissible, link, version };
}

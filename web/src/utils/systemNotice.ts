/*
 * The admin-set system notice (site_config `system_notice_*`, global-only and
 * public). The server validates the values at save time; this module turns
 * the flat site-config map into the one message the shell renders, or null.
 */

export const SYSTEM_NOTICE_TONES = ['neutral', 'info', 'warning', 'error'] as const;
export type SystemNoticeTone = (typeof SYSTEM_NOTICE_TONES)[number];

/**
 * Where the shell shows a notice, by severity: an outage or maintenance
 * (`error`) is the full-width banner above the whole app; reduced operation
 * (every other tone) is the small pill floating over the main area.
 */
export type SystemNoticePlacement = 'banner' | 'pill';

export function systemNoticePlacement(tone: SystemNoticeTone): SystemNoticePlacement {
  return tone === 'error' ? 'banner' : 'pill';
}

export interface SystemNotice {
  /** Optional bold headline before the text („**Titel** · Text"); empty for none. */
  title: string;
  text: string;
  tone: SystemNoticeTone;
  dismissible: boolean;
  /** Null without a usable URL. `label` may be empty: the caller supplies a default. */
  link: { href: string; label: string } | null;
  /**
   * Identity of this exact message. A dismissal is remembered against it, so
   * an edited message (title, text, tone, link or dismissibility) shows again.
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
  const dismissible = configs.system_notice_dismissible === 'true';
  const href = (configs.system_notice_link_url ?? '').trim();
  const link = isSafeNoticeHref(href)
    ? { href: normalizeNoticeHref(href), label: (configs.system_notice_link_label ?? '').trim() }
    : null;
  const title = (configs.system_notice_title ?? '').trim();
  const version = fnv1a(JSON.stringify([title, text, tone, dismissible, link?.href ?? '', link?.label ?? '']));
  return { title, text, tone, dismissible, link, version };
}

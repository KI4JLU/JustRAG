import {
  SYSTEM_NOTICE_TONES, isSystemNoticePlacement, type SystemNoticePlacement, type SystemNoticeTone,
} from './systemNotice';

/*
 * Saved system-notice templates (site_config `system_notice_templates`, a JSON
 * array the server validates at save time). A template fills the form; it is
 * never shown to users by itself.
 */

export interface SystemNoticeTemplate {
  name: string;
  /** The notice's bold headline; empty for none. */
  title: string;
  text: string;
  tone: SystemNoticeTone;
  /**
   * Empty: none chosen, the notice is placed by its tone (as are templates
   * stored before the setting). Kept empty rather than resolved, so applying
   * the template leaves the placement following the tone.
   */
  placement: SystemNoticePlacement | '';
  dismissible: boolean;
  linkUrl: string;
  linkLabel: string;
}

/** The server's cap (siteconfig/system_notice.go). */
export const SYSTEM_NOTICE_TEMPLATES_MAX = 20;
export const SYSTEM_NOTICE_TEMPLATE_NAME_MAX = 60;

/**
 * What the section offers before an admin has saved any template. German, like
 * the notices themselves at JLU; the bracketed parts are meant to be filled in.
 */
export const DEFAULT_SYSTEM_NOTICE_TEMPLATES: readonly SystemNoticeTemplate[] = [
  {
    name: 'Wartung angekündigt',
    title: 'Wartung angekündigt',
    text: 'Am [Datum] zwischen [Uhrzeit] und [Uhrzeit] Uhr ist der Dienst nicht erreichbar. Bitte sichere vorher wichtige Ergebnisse.',
    tone: 'warning',
    placement: 'banner',
    dismissible: true,
    linkUrl: '',
    linkLabel: '',
  },
  {
    name: 'Dienst nicht verfügbar',
    title: 'Dienst nicht verfügbar',
    text: 'Wir arbeiten an der Behebung.',
    tone: 'error',
    placement: 'banner',
    dismissible: false,
    linkUrl: '',
    linkLabel: '',
  },
  {
    name: 'Testbetrieb',
    title: 'Testbetrieb',
    text: 'Antworten können Fehler enthalten – prüfe wichtige Angaben bitte in den Quellen.',
    tone: 'info',
    placement: 'inline',
    dismissible: true,
    linkUrl: '',
    linkLabel: '',
  },
  {
    name: 'Hohe Auslastung',
    title: 'Hohe Auslastung',
    text: 'Antworten können länger dauern.',
    tone: 'warning',
    placement: 'inline',
    dismissible: true,
    linkUrl: '',
    linkLabel: '',
  },
  {
    name: 'Datenschutzhinweis',
    title: 'Datenschutz',
    text: 'Bitte gib keine personenbezogenen oder vertraulichen Daten ein, die nicht für diesen Dienst freigegeben sind.',
    tone: 'neutral',
    placement: 'inline',
    dismissible: true,
    linkUrl: '',
    linkLabel: '',
  },
];

function isTemplate(value: unknown): value is SystemNoticeTemplate {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  return typeof v.name === 'string' && typeof v.text === 'string'
    && (SYSTEM_NOTICE_TONES as readonly unknown[]).includes(v.tone)
    && typeof v.dismissible === 'boolean'
    && (v.placement === undefined || v.placement === '' || isSystemNoticePlacement(v.placement))
    && (v.title === undefined || typeof v.title === 'string')
    && (v.linkUrl === undefined || typeof v.linkUrl === 'string')
    && (v.linkLabel === undefined || typeof v.linkLabel === 'string');
}

/**
 * The stored list. Unset (or blank) → the built-in examples; `[]` → none, the
 * admin deleted them. An unreadable value also falls back to the examples
 * rather than hiding the feature — the server refuses such a value on save.
 */
export function readSystemNoticeTemplates(raw: string | undefined): SystemNoticeTemplate[] {
  if (!raw || !raw.trim()) return [...DEFAULT_SYSTEM_NOTICE_TEMPLATES];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [...DEFAULT_SYSTEM_NOTICE_TEMPLATES];
    return parsed.filter(isTemplate).map(tpl => ({
      ...tpl,
      title: tpl.title ?? '',
      placement: tpl.placement ?? '',
      linkUrl: tpl.linkUrl ?? '',
      linkLabel: tpl.linkLabel ?? '',
    }));
  } catch {
    return [...DEFAULT_SYSTEM_NOTICE_TEMPLATES];
  }
}

/** Adds `template`, replacing one of the same name (names compared trimmed, case-insensitive). */
export function upsertSystemNoticeTemplate(list: readonly SystemNoticeTemplate[], template: SystemNoticeTemplate): SystemNoticeTemplate[] {
  const key = template.name.trim().toLocaleLowerCase();
  const index = list.findIndex(tpl => tpl.name.trim().toLocaleLowerCase() === key);
  if (index === -1) return [...list, template];
  return list.map((tpl, i) => (i === index ? template : tpl));
}

export function hasSystemNoticeTemplateNamed(list: readonly SystemNoticeTemplate[], name: string): boolean {
  const key = name.trim().toLocaleLowerCase();
  return key !== '' && list.some(tpl => tpl.name.trim().toLocaleLowerCase() === key);
}

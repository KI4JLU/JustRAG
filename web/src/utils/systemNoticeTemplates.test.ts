import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SYSTEM_NOTICE_TEMPLATES, hasSystemNoticeTemplateNamed, readSystemNoticeTemplates, upsertSystemNoticeTemplate,
} from './systemNoticeTemplates';
import { isSafeNoticeHref } from './systemNotice';

const tpl = (name: string, text = 't') => ({ name, title: '', text, tone: 'info' as const, placement: 'inline' as const, dismissible: true, linkUrl: '', linkLabel: '' });

describe('readSystemNoticeTemplates', () => {
  it('offers the five examples while nothing is stored', () => {
    expect(readSystemNoticeTemplates(undefined)).toHaveLength(5);
    expect(readSystemNoticeTemplates('  ')).toHaveLength(5);
  });

  it('keeps an empty stored list empty — the admin deleted them', () => {
    expect(readSystemNoticeTemplates('[]')).toEqual([]);
  });

  it('falls back to the examples on an unreadable value and drops malformed entries', () => {
    expect(readSystemNoticeTemplates('not json')).toHaveLength(5);
    expect(readSystemNoticeTemplates(JSON.stringify([tpl('A'), { name: 'B', tone: 'success' }]))).toEqual([tpl('A')]);
  });

  // Templates stored before the placement setting have none. They stay
  // without one — placed by tone — so a later save of the list does not pin
  // a placement nobody chose.
  it('keeps a missing placement empty and drops an unknown one', () => {
    const old: Partial<ReturnType<typeof tpl>> = tpl('Alt');
    delete old.placement;
    const outage = { ...old, name: 'Störung', tone: 'error' };
    expect(readSystemNoticeTemplates(JSON.stringify([old, outage])).map(x => x.placement)).toEqual(['', '']);
    expect(readSystemNoticeTemplates(JSON.stringify([{ ...tpl('X'), placement: 'toast' }]))[0].placement).toBe('toast');
    expect(readSystemNoticeTemplates(JSON.stringify([{ ...tpl('Y'), placement: 'corner' }]))).toEqual([]);
  });
});

// The examples must pass the server's own rules (siteconfig/system_notice.go),
// or the first save of the list would be refused.
describe('the built-in examples', () => {
  it('are within the server limits', () => {
    for (const ex of DEFAULT_SYSTEM_NOTICE_TEMPLATES) {
      expect(ex.name.trim().length).toBeGreaterThan(0);
      expect([...ex.name].length).toBeLessThanOrEqual(60);
      expect([...ex.text].length).toBeLessThanOrEqual(1000);
      if (ex.linkUrl) expect(isSafeNoticeHref(ex.linkUrl)).toBe(true);
    }
  });
});

describe('upsertSystemNoticeTemplate', () => {
  it('appends a new name and replaces an existing one, ignoring case and spaces', () => {
    const list = [tpl('Wartung'), tpl('Testbetrieb')];
    expect(upsertSystemNoticeTemplate(list, tpl('Neu')).map(x => x.name)).toEqual(['Wartung', 'Testbetrieb', 'Neu']);
    const replaced = upsertSystemNoticeTemplate(list, tpl('wartung ', 'neuer Text'));
    expect(replaced).toHaveLength(2);
    expect(replaced[0].text).toBe('neuer Text');
    expect(hasSystemNoticeTemplateNamed(list, ' TESTBETRIEB')).toBe(true);
    expect(hasSystemNoticeTemplateNamed(list, '')).toBe(false);
  });
});

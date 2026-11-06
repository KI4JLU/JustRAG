import { describe, expect, it } from 'vitest';
import { isExternalNoticeHref, isSafeNoticeHref, readSystemNotice } from './systemNotice';

const ON = { system_notice_enabled: 'true', system_notice_text: 'Wartung am Freitag' };

describe('readSystemNotice', () => {
  it('is null while switched off or without text', () => {
    expect(readSystemNotice({})).toBeNull();
    expect(readSystemNotice({ ...ON, system_notice_enabled: 'false' })).toBeNull();
    expect(readSystemNotice({ ...ON, system_notice_text: '   ' })).toBeNull();
  });

  it('reads tone, dismissibility and link', () => {
    const notice = readSystemNotice({
      ...ON,
      system_notice_tone: 'warning',
      system_notice_dismissible: 'true',
      system_notice_link_url: 'https://www.uni-giessen.de/wartung',
      system_notice_link_label: 'Details',
    });
    expect(notice).toMatchObject({
      text: 'Wartung am Freitag',
      tone: 'warning',
      dismissible: true,
      link: { href: 'https://www.uni-giessen.de/wartung', label: 'Details' },
    });
  });

  it('falls back to info for an unknown tone and drops an unsafe link', () => {
    const notice = readSystemNotice({ ...ON, system_notice_tone: 'success', system_notice_link_url: 'javascript:alert(1)' });
    expect(notice?.tone).toBe('info');
    expect(notice?.link).toBeNull();
  });

  // The oracle for the version: an admin's edit must bring a dismissed notice
  // back, and an unchanged notice must not.
  it('changes its version with every edit that users would see', () => {
    const base = readSystemNotice(ON)!.version;
    expect(readSystemNotice({ ...ON })!.version).toBe(base);
    for (const change of [
      { system_notice_text: 'Wartung am Samstag' },
      { system_notice_tone: 'error' },
      { system_notice_dismissible: 'true' },
      { system_notice_link_url: '/kb/x' },
      { system_notice_placement: 'toast' },
      { system_notice_placement: 'banner' },
    ]) {
      expect(readSystemNotice({ ...ON, ...change })!.version, JSON.stringify(change)).not.toBe(base);
    }
  });

  // Oracle: the stamp a dismissal from before the setting was saved under. A
  // stored placement that the tone implied anyway must not bring it back.
  it('keeps its version when the stored placement is the tone\'s own', () => {
    const before = readSystemNotice({ ...ON, system_notice_tone: 'error' })!.version;
    expect(readSystemNotice({ ...ON, system_notice_tone: 'error', system_notice_placement: 'banner' })!.version).toBe(before);
    expect(readSystemNotice({ ...ON, system_notice_tone: 'error', system_notice_placement: 'inline' })!.version).not.toBe(before);
  });
});

describe('placement', () => {
  // Without a stored placement the tone decides, as before the setting existed.
  it('follows the tone while none is stored, or an unknown one is', () => {
    expect(readSystemNotice({ ...ON, system_notice_tone: 'error' })!.placement).toBe('banner');
    expect(readSystemNotice({ ...ON, system_notice_tone: 'warning' })!.placement).toBe('inline');
    expect(readSystemNotice({ ...ON, system_notice_tone: 'error', system_notice_placement: 'Banner' })!.placement).toBe('banner');
    expect(readSystemNotice({ ...ON, system_notice_tone: 'info', system_notice_placement: 'corner' })!.placement).toBe('inline');
  });

  it('takes the stored placement over the tone, for every tone', () => {
    for (const tone of ['neutral', 'info', 'warning', 'error']) {
      for (const placement of ['banner', 'inline', 'toast']) {
        expect(readSystemNotice({ ...ON, system_notice_tone: tone, system_notice_placement: placement })!.placement).toBe(placement);
      }
    }
  });
});

describe('mailto links', () => {
  it('writes mailto:// as mailto: and does not open it in a new tab', () => {
    const notice = readSystemNotice({ ...ON, system_notice_link_url: 'mailto://ki@uni-giessen.de' });
    expect(notice?.link?.href).toBe('mailto:ki@uni-giessen.de');
    expect(isExternalNoticeHref(notice!.link!.href)).toBe(false);
  });
});

describe('isSafeNoticeHref', () => {
  it.each([
    ['https://www.uni-giessen.de', true],
    ['http://intranet.example/x', true],
    ['/kb/abc', true],
    ['mailto:ki@uni-giessen.de', true],
    ['mailto://ki@uni-giessen.de', true],
    ['MAILTO:ki@uni-giessen.de?subject=Wartung', true],
    ['mailto:', false],
    ['mailto:not-an-address', false],
    ['', false],
    ['javascript:alert(1)', false],
    ['data:text/html,x', false],
    ['//evil.example', false],
    ['/\\evil.example', false],
    ['www.uni-giessen.de', false],
    ['https://a.example/a b', false],
  ])('%s → %s', (href, safe) => {
    expect(isSafeNoticeHref(href)).toBe(safe);
  });
});

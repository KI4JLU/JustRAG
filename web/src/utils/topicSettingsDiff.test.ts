import { describe, expect, it } from 'vitest';
import type { Behavior, BehaviorCatalog } from '../components/kbSettings/assistant/api';
import { topicSettingsDiff } from './topicSettingsDiff';

/*
 * ORACLE: the card's acceptance — identical to the template → not customized;
 * one area changed → count 1 with that area's label — and the owner's ruling
 * (2026-11-11) that the marker names areas, not single settings; applied to the
 * settings model (API.md „Behavior: roles and rules"): a template role's
 * rules are the system preset; only an own role carries a rule set.
 */
const catalog: BehaviorCatalog = {
  language: 'de',
  roles: [
    { id: 'chat', name: 'Chat', description: '', prompt: '', icon: 'chat', isDefault: true },
    { id: 'summary', name: 'Zusammenfassung', description: '', prompt: '', icon: 'sum', isDefault: false },
  ],
  ruleGroups: [
    {
      id: 'form',
      title: 'Form',
      rules: [
        { id: 'short', label: 'Antwortlänge', description: '', text: 'Kurz.', defaultOn: true },
        { id: 'sources', label: 'Anzahl Quellen', description: '', text: 'Drei.', defaultOn: false },
      ],
    },
  ],
  rulesHeading: 'Regeln:',
  limits: { promptMax: 1, roleNameMax: 1, ruleMax: 1, customRolesMax: 1, customRulesMax: 1 },
};
const t = (key: string) => key;

const behavior = (over: Partial<Behavior> = {}): Behavior => ({
  version: 1, activeRoleId: 'chat', customRoles: [], roleRules: {}, ...over,
});
const ownRole = { id: 'own', name: 'Eigene', prompt: 'p' };

describe('topicSettingsDiff', () => {
  it('reports nothing for a template role with the default start page', () => {
    expect(topicSettingsDiff(catalog, behavior(), false, t)).toEqual({
      isCustomized: false, changedKeys: [], labels: [], count: 0,
    });
  });

  it('does not count another template as a change', () => {
    expect(topicSettingsDiff(catalog, behavior({ activeRoleId: 'summary' }), false, t).isCustomized).toBe(false);
  });

  it('does not count an own role the topic keeps but does not answer in', () => {
    const b = behavior({ customRoles: [ownRole], roleRules: { own: { rules: { short: false }, customRules: [] } } });
    expect(topicSettingsDiff(catalog, b, false, t).isCustomized).toBe(false);
  });

  it('names one area with its label: an own start page', () => {
    expect(topicSettingsDiff(catalog, behavior(), true, t)).toEqual({
      isCustomized: true, changedKeys: ['startPage'], labels: ['topicDiffOwnStartPage'], count: 1,
    });
  });

  it('names an own role alone while its rules are the defaults', () => {
    const b = behavior({ activeRoleId: 'own', customRoles: [ownRole] });
    expect(topicSettingsDiff(catalog, b, false, t)).toEqual({
      isCustomized: true, changedKeys: ['role'], labels: ['topicDiffOwnRole'], count: 1,
    });
  });

  it('names the rules once, however many an own role switches away from their defaults', () => {
    const b = behavior({
      activeRoleId: 'own',
      customRoles: [ownRole],
      roleRules: { own: { rules: { short: false, sources: true }, customRules: [] } },
    });
    const diff = topicSettingsDiff(catalog, b, true, t);
    expect(diff.changedKeys).toEqual(['role', 'rules', 'startPage']);
    expect(diff.labels).toEqual(['topicDiffOwnRole', 'topicDiffOwnRules', 'topicDiffOwnStartPage']);
    expect(diff.count).toBe(3);
  });

  it('counts own rules only while one is switched on', () => {
    const withRule = (on: boolean) => behavior({
      activeRoleId: 'own',
      customRoles: [ownRole],
      roleRules: { own: { rules: { short: true, sources: false }, customRules: [{ id: 'r1', text: 'x', on }] } },
    });
    expect(topicSettingsDiff(catalog, withRule(false), false, t).changedKeys).toEqual(['role']);
    expect(topicSettingsDiff(catalog, withRule(true), false, t).changedKeys).toEqual(['role', 'rules']);
  });
});

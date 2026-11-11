import type { Behavior, BehaviorCatalog } from '../components/kbSettings/assistant/api';
import { rulesFor } from '../components/kbSettings/assistant/roleModel';

/** One area of a topic's settings that differs from the template. */
export interface TopicSettingsChange {
  /** Stable id: `role`, `rules`, `startPage`. */
  key: string;
  /** What the tooltip calls it. */
  label: string;
}

export interface TopicSettingsDiff {
  isCustomized: boolean;
  changedKeys: string[];
  /** The labels of `changedKeys`, in the same order. */
  labels: string[];
  count: number;
}

export const NO_TOPIC_SETTINGS_DIFF: TopicSettingsDiff = {
  isCustomized: false, changedKeys: [], labels: [], count: 0,
};

/**
 * Where a topic's assistant settings differ from the template — a template
 * role with its preset rules and its own chat start. By area, not by single
 * setting: the gear's marker says where to look, the settings window shows
 * what exactly.
 *
 *  - `role`: the topic answers in an own role instead of a template.
 *  - `rules`: that own role's rules are not the catalog's defaults — a rule
 *    switched the other way, or a rule of its own switched on. (A template
 *    role's rules are the preset and cannot differ.)
 *  - `startPage`: the topic set up its own start page.
 *
 * Only what a topic admin sets in „Thema-Einstellungen" counts; ids, versions
 * and timestamps do not.
 */
export function topicSettingsDiff(
  catalog: BehaviorCatalog,
  behavior: Behavior,
  startPageConfigured: boolean,
  t: (key: string) => string,
): TopicSettingsDiff {
  const changes: TopicSettingsChange[] = [];
  const ownRole = !catalog.roles.some(r => r.id === behavior.activeRoleId);
  if (ownRole) {
    changes.push({ key: 'role', label: t('topicDiffOwnRole') });
    const set = rulesFor(catalog, behavior, behavior.activeRoleId);
    const rulesDiffer = catalog.ruleGroups.flatMap(g => g.rules).some(r => (set.rules[r.id] ?? false) !== r.defaultOn)
      || set.customRules.some(r => r.on);
    if (rulesDiffer) changes.push({ key: 'rules', label: t('topicDiffOwnRules') });
  }
  if (startPageConfigured) changes.push({ key: 'startPage', label: t('topicDiffOwnStartPage') });
  return {
    isCustomized: changes.length > 0,
    changedKeys: changes.map(c => c.key),
    labels: changes.map(c => c.label),
    count: changes.length,
  };
}

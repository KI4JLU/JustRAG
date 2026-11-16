import { useEffect, useState } from 'react';
import { fetchBehavior, fetchBehaviorCatalog, fetchStartPage } from '../components/kbSettings/assistant/api';
import { useTheme } from '../contexts/ThemeContext';
import { NO_TOPIC_SETTINGS_DIFF, topicSettingsDiff, type TopicSettingsDiff } from '../utils/topicSettingsDiff';

/**
 * How the topic's settings differ from the template (`topicSettingsDiff`).
 * Read when the topic opens and again whenever `revision` changes — pass the
 * settings dialog's open state, so a save or a reset shows without a reload.
 * „Not customized" while loading and on failure: the marker is a hint, and a
 * wrong one is worse than none.
 */
export function useTopicSettingsDiff(topicId: string | undefined, revision?: unknown): TopicSettingsDiff {
  const { language, t } = useTheme();
  const [state, setState] = useState<{ topicId: string; diff: TopicSettingsDiff } | null>(null);
  useEffect(() => {
    if (!topicId) return;
    let cancelled = false;
    (async () => {
      try {
        const [behavior, start] = await Promise.all([fetchBehavior(topicId), fetchStartPage(topicId)]);
        const catalog = await fetchBehaviorCatalog(language);
        if (cancelled) return;
        setState({ topicId, diff: topicSettingsDiff(catalog, behavior.behavior, start.configured, t) });
      } catch {
        if (!cancelled) setState(null);
      }
    })();
    return () => { cancelled = true; };
  }, [topicId, revision, language, t]);
  return state && state.topicId === topicId ? state.diff : NO_TOPIC_SETTINGS_DIFF;
}

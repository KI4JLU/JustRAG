import { useId } from 'react';
import { fieldVariants } from '@ki4jlu/design-system';
import '../panel-section.css';
import { useTheme } from '../../contexts/ThemeContext';
import { useKbAgents } from '../../hooks/useKbAgents';
import type { KbAgents } from './api';
import type { AgentSelection } from '../../hooks/useKbSettings';

interface Props {
  kbId: string | undefined;
  selection: AgentSelection;
  onSelect: (value: AgentSelection) => void;
  /** Pre-loaded options. Pass this when the parent already holds them, so the
   * same KB-agents request is not issued twice per mount. Omit it and the
   * picker fetches on its own, which is what standalone callers want. */
  options?: KbAgents;
}

/**
 * Per-chat agent/team selection for the current KB.
 *
 * Distinct from KbAgentsSection: that one attaches agents to the KB (a KB-level
 * setting), this one picks which attached agent answers the current chat (sticky
 * on chats.team_id/agent_id). Renders nothing when the KB has none attached.
 *
 * Lived inside ChatView's `isPro && showSettings` drawer until 2026-08-12 —
 * a block no code path could open, so the picker was unreachable and agents
 * could be attached but never selected.
 */
export function AgentPicker({ kbId, selection, onSelect, options: provided }: Props) {
  const { t } = useTheme();
  // Unique per mount: a hardcoded id would collide the moment two pickers
  // are on screen at once, and a colliding id silently breaks the label's
  // htmlFor association for both.
  const selectId = useId();
  // The hook is called unconditionally — hooks cannot be skipped — but its
  // result is ignored when the parent supplied options. Passing `undefined`
  // as the kbId keeps it from firing a request in that case.
  const fetched = useKbAgents(provided ? undefined : kbId);
  const options = provided ?? fetched;

  if (options.agents.length === 0 && options.teams.length === 0) return null;

  const value = selection.teamId
    ? `team:${selection.teamId}`
    : selection.agentId ? `agent:${selection.agentId}` : '';

  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={selectId} className="panel-section__subtitle">
        {t('agentPicker')}
      </label>
      {/* Native select on the DS field skin: callers and tests read its value
          directly (WorkspacePromptDialog), which a Radix Select would not offer. */}
      <select
        id={selectId}
        value={value}
        onChange={(e) => {
          const v = e.target.value;
          if (v.startsWith('team:')) onSelect({ teamId: v.slice(5) });
          else if (v.startsWith('agent:')) onSelect({ agentId: v.slice(6) });
          else onSelect({});
        }}
        className={fieldVariants()}
      >
        <option value="">{t('agentPickerStandard')}</option>
        {options.teams.length > 0 && (
          <optgroup label={t('agentPickerTeamsGroup')}>
            {options.teams.map(tm => (
              <option key={tm.id} value={`team:${tm.id}`}>{tm.name}</option>
            ))}
          </optgroup>
        )}
        {options.agents.length > 0 && (
          <optgroup label={t('agentPickerAgentsGroup')}>
            {options.agents.map(a => (
              <option key={a.id} value={`agent:${a.id}`}>{a.name}</option>
            ))}
          </optgroup>
        )}
      </select>
    </div>
  );
}

export default AgentPicker;

import { useCallback, useEffect, useState } from 'react';
import { Bot, Plus, Users } from 'lucide-react';
import { Button, SegmentedControl } from '@ki4jlu/design-system';
import { useTheme } from '../../contexts/ThemeContext';
import { useToast } from '../../contexts/ToastContext';
import '../panel-section.css';
import {
  attachAgentToKb, attachTeamToKb, detachAgentFromKb, detachTeamFromKb,
  fetchKbAgents, listAgents, listTeams,
  type AgentRecord, type KbAgentOption, type KbAgents, type TeamRecord,
} from './api';

interface Props {
  /**
   * The KB to attach to, or null when no KB is current (SettingsModal is
   * reachable from HomeView, where currentKb can be null). With null the
   * section still explains itself and links to agent creation — it just
   * cannot offer attach controls.
   */
  kbId: string | null;
  /** Navigate to the My Agents screen. */
  onCreateAgent?: () => void;
}

/**
 * One row in the section: an agent or team that is either the caller's own, or
 * attached to this KB, or both.
 *
 * `owned` is what separates the two sources. It is not a permission — attach,
 * detach and "make default" all work on a foreign entry, because the backend
 * gates those on the KB role plus the link, not on who created the agent — it
 * is what the row SAYS, so an admin is not left wondering why an entry has no
 * edit affordance.
 */
interface Entry {
  id: string;
  name: string;
  owned: boolean;
  attached: boolean;
  isDefault: boolean;
}

/**
 * Merge "my agents/teams" with "what is attached to this KB" into one list.
 *
 * The section used to render `myAgents`/`myTeams` alone, which meant an agent
 * attached to this KB but created by a co-admin had NO ROW: the tab showed no
 * default selected and offered no detach, while the Workflow tab — one click
 * away in the same panel — named it. Foreign-owned attachments are the expected
 * case now that binding is a KB-admin decision rather than an owner one, so the
 * attached set has to be a source here, not just a lookup.
 *
 * Attached wins on name/default (it is the KB's own view of the entry); `owned`
 * survives from the caller's list. Re-sorted by name because both inputs are
 * sorted individually and a concatenation of two sorted lists is not sorted.
 *
 * Note the attached list is the chat picker's read, which filters disabled
 * agents away — so a bound-but-disabled entry still has no row here. That state
 * is surfaced on the Workflow tab, which reads a query that keeps them.
 */
function mergeEntries(
  mine: { id: string; name: string }[],
  attached: KbAgentOption[],
): Entry[] {
  const byId = new Map<string, Entry>();
  for (const m of mine) {
    byId.set(m.id, { id: m.id, name: m.name, owned: true, attached: false, isDefault: false });
  }
  for (const a of attached) {
    const prev = byId.get(a.id);
    byId.set(a.id, {
      id: a.id,
      name: a.name,
      owned: prev?.owned ?? false,
      attached: true,
      isDefault: a.isDefault,
    });
  }
  return [...byId.values()].sort((x, y) => x.name.localeCompare(y.name, 'de'));
}

// Per-KB attach/detach UI for every agent and team the caller can act on here —
// their own, plus everything already attached to this KB — with a single
// "default" radio across both kinds (backend enforces one default per KB).
export default function KbAgentsSection({ kbId, onCreateAgent }: Props) {
  const { t } = useTheme();
  const toast = useToast();
  const [attached, setAttached] = useState<KbAgents>({ agents: [], teams: [] });
  const [myAgents, setMyAgents] = useState<AgentRecord[]>([]);
  const [myTeams, setMyTeams] = useState<TeamRecord[]>([]);
  const [tab, setTab] = useState<'agents' | 'teams'>('agents');

  const reload = useCallback(() => {
    if (kbId) fetchKbAgents(kbId).then(setAttached).catch(() => {});
    listAgents().then(setMyAgents).catch(() => setMyAgents([]));
    listTeams().then(setMyTeams).catch(() => setMyTeams([]));
  }, [kbId]);

  useEffect(reload, [reload]);

  const agentEntries = mergeEntries(myAgents, attached.agents);
  const teamEntries = mergeEntries(myTeams, attached.teams);

  const toggleAttach = async (kind: 'agent' | 'team', e: Entry) => {
    if (!kbId) return;
    try {
      if (kind === 'agent') {
        if (e.attached) await detachAgentFromKb(kbId, e.id);
        else await attachAgentToKb(kbId, e.id);
      } else {
        if (e.attached) await detachTeamFromKb(kbId, e.id);
        else await attachTeamToKb(kbId, e.id);
      }
      reload();
    } catch {
      toast.error(t('settingsUpdateError'));
    }
  };

  const makeDefault = async (kind: 'agent' | 'team', e: Entry) => {
    if (!kbId) return;
    try {
      if (kind === 'agent') await attachAgentToKb(kbId, e.id, true);
      else await attachTeamToKb(kbId, e.id, true);
      reload();
    } catch {
      toast.error(t('settingsUpdateError'));
    }
  };

  const row = (kind: 'agent' | 'team', e: Entry) => (
    <div key={`${kind}-${e.id}`} className="panel-row">
      <div className="panel-row__icon" aria-hidden="true">
        {kind === 'agent' ? <Bot size={18} /> : <Users size={18} />}
      </div>
      <div className="panel-row__main">
        <span className="panel-row__name">{e.name}</span>
        {/* Said once, quietly, on the row it applies to. A foreign entry is fully
            operable here; what it is not is editable. */}
        {!e.owned && <div className="panel-row__secondary">{t('kbAgentsForeign')}</div>}
      </div>
      {kbId && (
        <div className="panel-row__actions">
          {e.attached && (
            <label className="panel-row__default">
              {/* One default across agents AND teams (backend enforces one per KB),
                  so a native radio group keyed by KB is the honest control. */}
              <input
                type="radio"
                name={`kb-default-${kbId}`}
                checked={e.isDefault}
                onChange={() => makeDefault(kind, e)}
              />
              {t('kbAgentsDefault')}
            </label>
          )}
          <Button variant={e.attached ? 'outline' : 'default'} size="sm" onClick={() => toggleAttach(kind, e)}>
            {e.attached ? t('kbAgentsDetach') : t('kbAgentsAttach')}
          </Button>
        </div>
      )}
    </div>
  );

  // Always rendered. This section used to `return null` when the user owned no
  // agents, which meant someone who had never created one saw no trace of the
  // feature in KB settings — the exact place they'd be deciding how the KB
  // should behave. The empty state is the entry point instead.
  //
  // Counted over the MERGED lists: an admin who owns nothing but whose KB has a
  // co-admin's agent attached used to fall into the empty state and see no
  // rows at all — the same defect one level up from the missing row itself.
  const isEmpty = agentEntries.length === 0 && teamEntries.length === 0;

  return (
    <section className="panel-section" aria-labelledby="kb-agents-section-title">
      {/* The create action lives in the head so it is present in every state —
          it used to vanish as soon as you owned one agent. */}
      <div className="panel-section__head">
        <h3 id="kb-agents-section-title" className="panel-section__title">{t('kbAgentsSection')}</h3>
        <Button variant="ghost" size="sm" onClick={onCreateAgent}>
          <Plus size={16} aria-hidden="true" /> {t('kbAgentsCreateFirst')}
        </Button>
      </div>
      <p className="panel-section__hint">{t('kbAgentsSectionHelp')}</p>

      {isEmpty ? null : (
        <>
          {/* Agents and teams are different things; a single flat list read as one pile. */}
          <SegmentedControl
            aria-label={t('kbAgentsSection')}
            className="self-start"
            value={tab}
            onValueChange={(v) => setTab(v as 'agents' | 'teams')}
            options={[
              { value: 'agents', label: t('agentsTabAgents') },
              { value: 'teams', label: t('agentsTabTeams') },
            ]}
          />

          <div className="panel-rows">
            {tab === 'agents' && (agentEntries.length === 0
              ? <p className="panel-section__hint">{t('noAgentsYet')}</p>
              : agentEntries.map(e => row('agent', e)))}

            {tab === 'teams' && (teamEntries.length === 0
              ? <p className="panel-section__hint">{t('noTeamsYet')}</p>
              : teamEntries.map(e => row('team', e)))}
          </div>

          {!kbId && <p className="panel-section__hint">{t('kbAgentsNoKbNote')}</p>}
        </>
      )}
    </section>
  );
}

import { Edit3, Eye, Shield } from 'lucide-react';
import type { SharingConfig, SharingRole } from '../people/sharing';
import type { GlossaryRole } from './types';

/**
 * A glossary's people, described to the shared sharing panel (`components/people/SharingPanel`).
 * The roles are the glossary's own (`viewer < editor < admin < owner`, docs/glossary-access.md);
 * the owner moves only through the transfer.
 */
export const GLOSSARY_SHARING_ROLES: readonly SharingRole[] = [
  { value: 'viewer', labelKey: 'viewPermission', icon: Eye, tone: 'neutral' },
  { value: 'editor', labelKey: 'editPermission', icon: Edit3, tone: 'primary' },
  { value: 'admin', labelKey: 'adminPermission', icon: Shield, tone: 'secondary' },
];

/** Translation key of a glossary role's name, as the list and the roles table show it. */
export const GLOSSARY_ROLE_LABEL_KEY: Record<GlossaryRole, string> = {
  viewer: 'kbRoleView',
  editor: 'kbRoleEdit',
  admin: 'kbRoleAdmin',
  owner: 'kbRoleOwner',
};

export function glossarySharingConfig(glossaryId: string): SharingConfig {
  return {
    basePath: `/api/glossaries/${glossaryId}`,
    roles: GLOSSARY_SHARING_ROLES,
    ownerRole: 'owner',
    // The target of a transfer only has to be a member already.
    canTransferTo: () => true,
    joinPath: '/join-glossary/',
    labels: {
      intro: 'glossaryMembersIntro',
      removeShare: 'glossaryRemoveShare',
      removeMessage: 'glossaryRemoveMemberMessage',
      makeOwnerMessage: 'glossaryMakeOwnerMessage',
    },
  };
}

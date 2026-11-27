import { describe, it, expect } from 'vitest';
import {
    GLOSSARY_RIGHT_GROUPS, GLOSSARY_RIGHT_LABEL_KEY, GLOSSARY_RIGHTS, GLOSSARY_ROLE_COLUMNS, glossaryRoleHas,
    type GlossaryRight,
} from './glossaryRoleRights';
import type { GlossaryRole } from '../components/translator/types';

// Oracle: docs/glossary-access.md, "Roles", transcribed by hand (not read back from the module):
//   viewer  use in translations, read entries
//   editor  + change entries, import CSV, change name, description and category
//   admin   + change the visibility, see and manage members, pending invites and invite links
//   owner   + delete the glossary, transfer ownership
const GRANTED: Record<GlossaryRole, GlossaryRight[]> = {
    viewer: ['use', 'read'],
    editor: ['use', 'read', 'editEntries', 'editDetails'],
    admin: ['use', 'read', 'editEntries', 'editDetails', 'visibility', 'manageMembers'],
    owner: ['use', 'read', 'editEntries', 'editDetails', 'visibility', 'manageMembers', 'delete', 'transferOwner'],
};

describe('glossary role rights', () => {
    it('lists the roles strongest first', () => {
        expect(GLOSSARY_ROLE_COLUMNS).toEqual(['owner', 'admin', 'editor', 'viewer']);
    });

    for (const role of GLOSSARY_ROLE_COLUMNS) {
        for (const right of GLOSSARY_RIGHTS) {
            it(`${role} × ${right} follows the documented ladder`, () => {
                expect(glossaryRoleHas(role, right)).toBe(GRANTED[role].includes(right));
            });
        }
    }

    it('covers exactly the nine documented rights, each in one group with a label', () => {
        expect([...GLOSSARY_RIGHTS].sort()).toEqual([...GRANTED.owner].sort());
        expect(GLOSSARY_RIGHT_GROUPS.flatMap(g => g.rights)).toHaveLength(8);
        for (const right of GLOSSARY_RIGHTS) expect(GLOSSARY_RIGHT_LABEL_KEY[right]).toMatch(/^arGlossaryRight/);
    });

    it('gives every role the rights of the roles below it', () => {
        for (const [higher, lower] of [['owner', 'admin'], ['admin', 'editor'], ['editor', 'viewer']] as const) {
            for (const right of GLOSSARY_RIGHTS) {
                if (glossaryRoleHas(lower, right)) expect(glossaryRoleHas(higher, right)).toBe(true);
            }
        }
    });
});

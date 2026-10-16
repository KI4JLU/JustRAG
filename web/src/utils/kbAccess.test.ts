import { describe, it, expect } from 'vitest';
import type { KnowledgeBase } from '../types';
import { canEditKbSources, chatSourceSelection, canOpenKbAdvancedSettings, canRenameKb, hasAdvancedSystemRole, hasKbAdminRole, splitKbsByOwnership } from './kbAccess';

type KbShape = Pick<KnowledgeBase, 'myRole' | 'isGlobal' | 'visibility'>;

const privateKb: KbShape = { visibility: 'private', isGlobal: false };
const publicKb: KbShape = { visibility: 'public', isGlobal: true };

describe('hasAdvancedSystemRole', () => {
  it.each(['api-user', 'admin', 'superadmin'])('accepts %s', (role) => {
    expect(hasAdvancedSystemRole(role)).toBe(true);
  });

  it.each(['user', '', 'Admin', 'apiuser'])('rejects %j', (role) => {
    expect(hasAdvancedSystemRole(role)).toBe(false);
  });

  it('rejects an absent role', () => {
    expect(hasAdvancedSystemRole(undefined)).toBe(false);
  });
});

describe('hasKbAdminRole', () => {
  it('grants a superadmin without any kb_members row (ladder rule 1)', () => {
    expect(hasKbAdminRole({ ...privateKb }, 'superadmin')).toBe(true);
  });

  it.each(['admin', 'owner'] as const)('grants an explicit %s row (rule 2)', (role) => {
    expect(hasKbAdminRole({ ...privateKb, myRole: role }, 'user')).toBe(true);
  });

  it.each(['edit', 'view'] as const)('refuses an explicit %s row (rule 2)', (role) => {
    expect(hasKbAdminRole({ ...privateKb, myRole: role }, 'admin')).toBe(false);
  });

  it('grants a system admin on a PUBLIC KB with no row (rule 3)', () => {
    expect(hasKbAdminRole({ ...publicKb }, 'admin')).toBe(true);
  });

  it('refuses a system admin on a PRIVATE KB with no row — rule 3 needs a public KB', () => {
    expect(hasKbAdminRole({ ...privateKb }, 'admin')).toBe(false);
  });

  it('lets an explicit edit row BEAT the public-KB admin rule, as rule 2 does server-side', () => {
    expect(hasKbAdminRole({ ...publicKb, myRole: 'edit' }, 'admin')).toBe(false);
  });

  it('refuses a plain user on a published public KB (rule 4 yields view, not admin)', () => {
    expect(hasKbAdminRole({ ...publicKb }, 'user')).toBe(false);
  });
});

// The predicate behind both entry points to KbSettingsPanel. Its whole job is
// that BOTH terms are required — the pairs below are the cases where exactly
// one holds, which is what the two hand-written gates used to get wrong in
// opposite directions.
describe('canOpenKbAdvancedSettings', () => {
  it('refuses a plain user who OWNS the KB — the restored system-role gate', () => {
    expect(canOpenKbAdvancedSettings({ ...privateKb, myRole: 'owner' }, 'user')).toBe(false);
  });

  it('refuses an api-user with no KB role — the KB-role term is still load-bearing', () => {
    expect(canOpenKbAdvancedSettings({ ...privateKb }, 'api-user')).toBe(false);
  });

  it.each(['api-user', 'admin', 'superadmin'])('allows %s who owns the KB', (role) => {
    expect(canOpenKbAdvancedSettings({ ...privateKb, myRole: 'owner' }, role)).toBe(true);
  });

  it('allows a system admin curating a public KB they never joined', () => {
    expect(canOpenKbAdvancedSettings({ ...publicKb }, 'admin')).toBe(true);
  });

  it('refuses when there is no KB at all', () => {
    expect(canOpenKbAdvancedSettings(null, 'superadmin')).toBe(false);
    expect(canOpenKbAdvancedSettings(undefined, 'superadmin')).toBe(false);
  });
});

describe('canRenameKb', () => {
  it('grants the owner of a private KB', () => {
    expect(canRenameKb({ ...privateKb, myRole: 'owner' }, 'user')).toBe(true);
  });

  it('grants a superadmin without any kb_members row', () => {
    expect(canRenameKb({ ...privateKb }, 'superadmin')).toBe(true);
  });

  it.each(['admin', 'edit', 'view'] as const)('denies a private-KB %s member', (role) => {
    expect(canRenameKb({ ...privateKb, myRole: role }, 'user')).toBe(false);
  });

  it('denies a private-KB admin member even with system role admin', () => {
    expect(canRenameKb({ ...privateKb, myRole: 'admin' }, 'admin')).toBe(false);
  });

  it('grants a system admin on a public KB', () => {
    expect(canRenameKb({ ...publicKb }, 'admin')).toBe(true);
  });

  it('grants a system admin on a public KB even when they hold an admin member row', () => {
    expect(canRenameKb({ ...publicKb, myRole: 'admin' }, 'admin')).toBe(true);
  });

  it('denies a public-KB admin member without a system admin role', () => {
    expect(canRenameKb({ ...publicKb, myRole: 'admin' }, 'user')).toBe(false);
  });

  it('denies a public-KB viewer', () => {
    expect(canRenameKb({ ...publicKb }, 'user')).toBe(false);
  });

  it('denies when the KB is absent', () => {
    expect(canRenameKb(null, 'superadmin')).toBe(false);
    expect(canRenameKb(undefined, 'superadmin')).toBe(false);
  });
});

/* ---------------------------------------------------------------------------
 * `splitKbsByOwnership` — the predicate the three-view visibility model rests
 * on, and until now the only exported function in this module with no test.
 *
 * ORACLE: the model as the developer stated it (18.09.2026), written out on the
 * function's own doc block:
 *   „Mein Wissen"      = mine, INCLUDING the ones I own and have shared out
 *   „Geteiltes Wissen" = what others shared with me, and nothing of mine
 *   „Entdecken"        = global topics, owned by the system
 * These assert the first two. The third is not this function's to enforce — a
 * published topic is filtered out server-side by `WHERE kb.visibility =
 * 'private'` — so the case below pins the CONSEQUENCE of that split instead:
 * given a row that should never arrive, the ex-owner lands in the shared list.
 * That is the failure the server-side filter exists to prevent, recorded here
 * so a future change that drops the filter has a test explaining what breaks.
 * ------------------------------------------------------------------------- */
describe('splitKbsByOwnership', () => {
  it('keeps a topic I own but have shared in the owned list', () => {
    // memberCount > 1 is what "shared out" looks like; `myRole` is untouched
    // by sharing, and `myRole` is the only thing the split reads.
    const sharedOut = { myRole: 'owner' as const, memberCount: 5 };
    const { ownedKbs, sharedKbs } = splitKbsByOwnership([sharedOut]);

    expect(ownedKbs).toEqual([sharedOut]);
    // The half that a "more than one member means shared" rule gets wrong.
    expect(sharedKbs).toEqual([]);
  });

  it.each(['admin', 'edit', 'view'] as const)(
    'puts a topic shared with me at %s in the shared list',
    (role) => {
      const shared = { myRole: role };
      const { ownedKbs, sharedKbs } = splitKbsByOwnership([shared]);

      expect(sharedKbs).toEqual([shared]);
      expect(ownedKbs).toEqual([]);
    },
  );

  it('treats a row with no membership as shared, never as owned', () => {
    // A system admin curating a public KB they never joined arrives with no
    // `myRole` at all (see `hasKbAdminRole`). Whatever else that row is, it is
    // not something this user owns — so the default must not be `ownedKbs`.
    const { ownedKbs, sharedKbs } = splitKbsByOwnership([{ myRole: undefined }]);

    expect(ownedKbs).toEqual([]);
    expect(sharedKbs).toHaveLength(1);
  });

  it('partitions — every row lands in exactly one list, in server order', () => {
    const a = { myRole: 'owner' as const };
    const b = { myRole: 'view' as const };
    const c = { myRole: 'owner' as const };
    const { ownedKbs, sharedKbs } = splitKbsByOwnership([a, b, c]);

    expect(ownedKbs).toEqual([a, c]);
    expect(sharedKbs).toEqual([b]);
    expect(ownedKbs.length + sharedKbs.length).toBe(3);
  });

  it('returns two empty lists for an empty input', () => {
    expect(splitKbsByOwnership([])).toEqual({ ownedKbs: [], sharedKbs: [] });
  });
});

// Oracle: the backend ladder kbaccess.EffectiveRole (internal/kbaccess/
// middleware.go) followed by the edit chain's RequireKBRole("edit") threshold
// (internal/app/routes.go). Each expected value below is read off those two by
// hand — not produced by the helper — so a drift in either direction fails.
describe('canEditKbSources', () => {
  const priv = { visibility: 'private' as const, isGlobal: false, userId: null };
  const pub = { visibility: 'public' as const, isGlobal: true, userId: null };
  const cases: Array<[string, Parameters<typeof canEditKbSources>[0], string | undefined, string | undefined, boolean]> = [
    // [name, kb, systemRole, userId, expected]
    ['view row on a private KB (rule 2 -> view)', { ...priv, myRole: 'view' }, 'user', 'u1', false],
    ['edit row (rule 2 -> edit)', { ...priv, myRole: 'edit' }, 'user', 'u1', true],
    ['admin row (rule 2 -> admin)', { ...priv, myRole: 'admin' }, 'user', 'u1', true],
    ['owner row (rule 2 -> owner)', { ...priv, myRole: 'owner' }, 'user', 'u1', true],
    ['owner via the legacy kb.userId mirror, no row', { ...priv, userId: 'u1' }, 'user', 'u1', true],
    ['superadmin with no row (rule 1 -> owner)', { ...priv }, 'superadmin', 'u9', true],
    ['superadmin with a view row (rule 1 beats rule 2)', { ...priv, myRole: 'view' }, 'superadmin', 'u9', true],
    ['implicit viewer of a published public KB (rule 4 -> view)', { ...pub }, 'user', 'u1', false],
    ['system admin on a public KB, no row (rule 3 -> admin)', { ...pub }, 'admin', 'u1', true],
    ['system admin with a view row on a public KB (rule 2 beats rule 3)', { ...pub, myRole: 'view' }, 'admin', 'u1', false],
    ['system admin on a private KB with no row (no rule matches)', { ...priv }, 'admin', 'u1', false],
    ['api-user with no row (not an admin of anything)', { ...priv }, 'api-user', 'u1', false],
    ['api-user with a view row', { ...pub, myRole: 'view' }, 'api-user', 'u1', false],
    ['no user at all', { ...pub }, undefined, undefined, false],
  ];
  it.each(cases)('%s', (_name, kb, systemRole, userId, expected) => {
    expect(canEditKbSources(kb, systemRole, userId)).toBe(expected);
  });

  it('refuses when there is no KB', () => {
    expect(canEditKbSources(null, 'superadmin', 'u1')).toBe(false);
  });
});

describe('canEditKbSources with backend capabilities', () => {
  const caps = (manageSources: boolean) => ({ seeSources: true, selectSources: true, downloadSources: true, seeCitations: true, manageSources });
  it('follows manageSources over the ladder (editorManageSources off for an editor)', () => {
    expect(canEditKbSources({ visibility: 'private', isGlobal: false, userId: null, myRole: 'edit', capabilities: caps(false) }, 'user', 'u1')).toBe(false);
    expect(canEditKbSources({ visibility: 'private', isGlobal: false, userId: null, myRole: 'view', capabilities: caps(true) }, 'user', 'u1')).toBe(true);
  });
});

// Oracle: API.md "Source permissions" — selectedFileIds without selectSources is a 403.
describe('chatSourceSelection', () => {
  const files = [{ id: 'a', selected: true }, { id: 'b', selected: false }, { id: 'c' }];
  const caps = (selectSources: boolean) => ({ seeSources: true, selectSources, downloadSources: true, seeCitations: true, manageSources: false });
  it('sends the selected ids (selected !== false) when the caller may select', () => {
    expect(chatSourceSelection({ capabilities: caps(true) }, files)).toEqual({ canSend: true, selectedFileIds: ['a', 'c'] });
  });
  it('keeps the old rule against a backend without capabilities', () => {
    expect(chatSourceSelection({}, files).selectedFileIds).toEqual(['a', 'c']);
    expect(chatSourceSelection({}, []).canSend).toBe(false);
  });
  it('sends no ids, but can send, without the select right — even with no list at all', () => {
    expect(chatSourceSelection({ capabilities: caps(false) }, files)).toEqual({ canSend: true });
    expect(chatSourceSelection({ capabilities: caps(false) }, [])).toEqual({ canSend: true });
  });
});

-- +goose Up
-- Every KB gets an explicit behavior (internal/kbbehavior), and no KB answers
-- with an empty role any more. Until now a KB never customized kept behavior
-- NULL and was shown its pre-roles system prompt as the role „legacy" — named
-- after the KB and with no prompt at all when it had none, answering with the
-- fixed instructions alone.
--
-- A pre-roles system prompt stays where it is (system_prompt, the storage of
-- the role „legacy"'s prompt) and becomes the KB's own role „Eigene Rolle",
-- with no rule on: such a KB answers exactly as before. kb_settings_versions
-- are left as written; restoring a version from before this migration gives
-- it the same form (kbassistant.Store.Restore).
--
-- Data only; knowledge_bases has no updated_at trigger, so list order is
-- untouched.

-- 1. Never customized: with a system prompt, the own role holding it; without
-- one, the default template role, as a new KB starts (kbbehavior.Default).
UPDATE knowledge_bases SET behavior = CASE
    WHEN COALESCE(system_prompt, '') <> ''
        THEN '{"version": 1, "activeRoleId": "legacy", "customRoles": [{"id": "legacy"}], "roleRules": {}}'::jsonb
    ELSE jsonb_build_object(
        'version', 1,
        'activeRoleId', COALESCE((SELECT id FROM role_templates WHERE is_default), 'chat'),
        'customRoles', '[]'::jsonb,
        'roleRules', '{}'::jsonb)
    END
WHERE behavior IS NULL;

-- 2. Customized, but the role „legacy" is empty: no system prompt, no name or
-- description of its author's, no rules and no start page card. It goes, and
-- where it was the active role the default template role takes over. A legacy
-- role its author named or gave rules to stays as their own role.
UPDATE knowledge_bases kb SET behavior = jsonb_set(
    jsonb_set(kb.behavior, '{customRoles}', COALESCE(
        (SELECT jsonb_agg(e.r ORDER BY e.o)
           FROM jsonb_array_elements(kb.behavior->'customRoles') WITH ORDINALITY e(r, o)
          WHERE e.r->>'id' <> 'legacy'),
        '[]'::jsonb)),
    '{activeRoleId}', CASE
        WHEN kb.behavior->>'activeRoleId' = 'legacy'
            THEN to_jsonb(COALESCE((SELECT id FROM role_templates WHERE is_default), 'chat'))
        ELSE kb.behavior->'activeRoleId'
        END)
WHERE COALESCE(kb.system_prompt, '') = ''
  AND jsonb_typeof(kb.behavior->'customRoles') = 'array'
  AND EXISTS (
      SELECT 1 FROM jsonb_array_elements(kb.behavior->'customRoles') r
       WHERE r->>'id' = 'legacy'
         AND COALESCE(r->>'name', '') = ''
         AND COALESCE(r->>'description', '') = '')
  AND NOT (COALESCE(kb.behavior->'roleRules', '{}'::jsonb) ? 'legacy')
  AND NOT EXISTS (
      SELECT 1 FROM jsonb_array_elements(CASE
          WHEN jsonb_typeof(kb.start_page->'roleEntries') = 'array' THEN kb.start_page->'roleEntries'
          ELSE '[]'::jsonb END) e
       WHERE e->>'roleId' = 'legacy');

-- +goose Down
-- Deliberately a no-op: a build from before this migration reads an explicit
-- behavior as well as a NULL one, and the system prompts were not moved.
SELECT 1;

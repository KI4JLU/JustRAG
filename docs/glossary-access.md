# Glossary access

Who may do what with a translator glossary. The model is the one of knowledge bases (`docs/kb-access.md`), built per glossary; the code is `internal/glossaryaccess` (resolution and the route gate), `internal/glossarymembers` (members, adding people, invite links) and `internal/translator` (content).

## Roles

Four roles, strictly ordered `viewer < editor < admin < owner`.

| Role | May |
|---|---|
| `viewer` | use the glossary in translations, read its entries |
| `editor` | change entries, change name, description and category |
| `admin` | change the visibility (publish to everyone or take it back), see and manage members, pending invites and invite links |
| `owner` | everything, plus delete the glossary and transfer ownership. Exactly one per glossary (partial unique index); moves only through the transfer route, never through the member routes |

CSV import is not a glossary right. `POST /api/glossaries/import` creates a **new** private glossary owned by the caller, so it needs only the translation permission (every system role has it), like creating a glossary by hand. A glossary that exists changes its entries only through the editor's `PUT /api/glossaries/{id}`; a CSV cannot be added to it.

The member list sits behind `admin`, not `viewer`: on a `global` glossary every user is a viewer and the roster is not theirs to read. This deviates from the Campus template, where editors also changed visibility and sharing.

## Storage

`glossary_members(glossary_id, user_id, role, created_at, created_by)` is the **sole authority** for roles (migration 0109). The creator's `owner` row is written in the same transaction as the glossary. There is no mirror column on `glossaries`.

`glossaries.visibility` is `private` or `global`. There is no `organization` level: JLU RAG has no groups, a glossary's members are its group.

## Resolution

`glossaryaccess.EffectiveRole` is the only ladder. First match wins:

1. a `glossary_members` row with a valid role → that role
2. the glossary is `global` → `viewer`
3. otherwise → no access

An explicit row beats the implicit viewer of rule 2, so an editor on a global glossary is not demoted. There is **no rung for system roles**: a superadmin or system admin is a stranger to somebody else's private glossary. A system role matters only for the translation permission, which every translator and glossary route checks first (fixed in code: `user`, `admin`, `superadmin`, `api-user`).

`glossaryaccess.RequireGlossaryRole(min)` is the only route gate: `404` for a missing glossary (or a malformed id), `403` for one the caller may not open or whose role is too low. Owner-only and self checks sit in the handlers (`transfer-owner` needs an actual owner row, leaving is for the member themself).

`glossaryaccess.VisibleGlossariesCTE` is the one SQL rendering of the ladder, used by the list and by the reader of a request's glossaries. It must change in the same commit as `EffectiveRole`; `TestVisibleGlossariesAgreesWithEffectiveRole` (integration) runs both over a fixture covering every rung.

## Adding people

As for knowledge bases (`internal/kbmembers`, `internal/kbinvites`):

- **By username, one or several** (`POST …/members/bulk`): a known account gets a membership row with the role (`shared`); someone who already is a member is reported (`alreadyHadAccess`) and left unchanged; an unknown username is parked in `glossary_pending_invites` (`pending`) and applied at their next login, by whatever method they sign in (local password, LDAP or OIDC; `authhandler.ApplyPendingInvites`, best-effort: a failure is logged and never blocks the login). Roles: `viewer`, `editor`, `admin`; at most 500 names per request.
- **Invite links**: a permanent, revocable link that grants the role it was created with. Revoking sets `revoked_at` (the token keeps resolving, existing members stay, the link leaves the admin list). `GET /glossary-invites/{token}` changes nothing and reports `invite`, `member` or `revoked`; `POST …/redeem` joins. A link never changes an existing membership, up or down. A revoked link is `410 invite_revoked`. `glossary_invite_redemptions` holds one row per link and person, so the count is the number of distinct people who joined.
- **Ownership transfer**: the target must already be a member; the old owner becomes `admin`; one transaction that locks the glossary row and demotes only the acting user's own owner row. Of two concurrent transfers by the same owner the second one finds the row already demoted and is a `409`; it never demotes the new owner.
- **Leaving**: the member removes their own row. The owner cannot leave.

## Deleting

Deleting a glossary removes its members, pending invites, invite links and redemptions. Deleting a user (`internal/cascade`) removes the glossaries they own with all of that, and their memberships and redemptions in other people's glossaries.

## Publishing a global glossary

Setting `visibility` to `global` makes a glossary readable (as `viewer`) and usable in translations by every user with the translation permission. The right to do that is the glossary's `admin`, which the creator has as `owner`, and creating a glossary needs only the translation permission, which every system role holds. So **every user may publish a glossary to everybody**; there is no extra approval step and no system role gates it. This is by design and a product decision for the maintainers (the Campus template let editors do it too); this implementation does not change it. Consequences worth knowing: the terms of a global glossary are free text from any user, which is why they reach the model only as a delimited data block with an instruction to treat it as data, and why terms are validated on write (`docs/api-contracts/translator.md`).

# Runbook: branches, staging and releases

This is the operator side: what CI builds, how staging and prod get a build,
and how a release is cut, deployed and rolled back. The day-to-day developer
side (where to commit, when to open a PR) is in
[`CONTRIBUTING.md`](../../CONTRIBUTING.md#branches-staging-and-releases).

## Versions: CalVer `vYY.M.N`

| Part | Meaning |
|---|---|
| `YY` | two-digit year of the release (`26` = 2026) |
| `M` | month of the release, **no leading zero** (`1`–`12`). npm and strict semver reject `26.01.0`. |
| `N` | counter within the month, starting at `0`, reset every month |

So the releases of November 2026 are `v26.11.0`, `v26.11.1`, …, and the first
one in December is `v26.12.0`. Release candidates append `-rc.K`:
`v26.11.0-rc.1`, `v26.11.0-rc.2`. `scripts/next-version.sh` prints the next
version (current month in Europe/Berlin; only promoted releases count, so an
abandoned candidate does not burn a number).

The **annotated git tag is the only source of truth** — there is no version
constant in the Go code. `package.json` carries the version only so the
release workflows can check that the prep commit is in the candidate.

**A version number says nothing about risk.** Under the old `0.x` SemVer a
patch meant "fixes only, no migration"; CalVer has no such promise. Whether a
release needs migrations, flips a `site_config` default or needs a re-ingest
is in its **⚠ Upgrade notes** in `CHANGELOG.md` and nowhere else — read them
before every deploy.

The scheme started after `v0.11.2`, the last `0.x` release (`v0.12.0-rc.1`
was never promoted). `v26.x` sorts after `v0.x` everywhere (`sort -V`, the
promote and rollback workflows), so the switch is a normal forward step.

The app version is independent of the **API** version — `/api/v1/*`, the
OpenAI-compat layer, MCP `ask_kb`, and the ILIAS shim are path-versioned as
`v1` and stay that way.

## Branches and image tags

```
 development ──●──●──●──●──●──●──●──●──●──►   direct pushes allowed
                      \          \       \
 main ─────────────────●──────────●───────●──►  pull requests only
                                  │
                         Cut Release Candidate → v26.11.0-rc.1
                                  │  Deploy to Staging → test → Promote
                               v26.11.0  (:stable)
```

| Branch | Rules | Purpose |
|---|---|---|
| `development` | direct pushes allowed; no force push, no deletion | integration branch, day-to-day work |
| `main` | **pull requests only**, CI green, **merge commits only**; no force push, no deletion | what the next release is cut from; collects several PRs between releases |

| Image tag | Comes from | Moves |
|---|---|---|
| `:development`, `:<sha>` | every push to `development` | automatically |
| `:edge`, `:<sha>` | every push to `main` | automatically |
| `:vYY.M.N-rc.K` | **Cut Release Candidate** workflow (tag on `main`) | never — one build per candidate |
| `:staging` | **Deploy to Staging** workflow — a pointer, nothing is built | manually; the staging server follows it |
| `:vYY.M.N`, `:vYY.M`, `:stable` | **Promote Release Candidate** workflow — added to the RC's image, nothing is built | only through a promotion (or Roll Back Stable) |
| `vYY.M.N` pushed by hand | — | **builds nothing**, use the promote workflow |

**Build once, promote by digest.** A release is never rebuilt: the image
staging tested is the image prod runs. A rebuild from the same commit would
not be the same bits (base-image layers, OS packages and build time all
drift), so a rebuilt release would make the staging round meaningless. That
is why `:staging` and `:stable` are pointers and why only a candidate cut on
`main` can be promoted (the promote workflow checks that the RC's commit is
on `main`).

**Why `main` takes merge commits only.** `development` is merged into `main`
again and again. A squash or rebase merge rewrites the commits, so the next
`development → main` PR shows the same changes again or conflicts with
itself. A merge commit keeps both histories joined.

**Prod runs `:stable`** (workers and `go-server`, with `imagePullPolicy:
Always`). That is safe only because `:stable` moves exclusively through a
promotion — after staging, and after the release's migrations have run (see
"Deploying a release"). The flip side: **promoting is deploying.** From that
moment any prod pod that restarts, for whatever reason, comes up on the new
release, so never promote before the migrations are in. `:stable` only moves
forward; going back is the **Roll Back Stable** workflow (see "Rolling
back"). It is also the default of every unpinned compose deployment
(`${JUSTRAG_VERSION:-stable}`).

`:latest` is not published. It was the mechanism by which production drifted
forward on unrelated pod restarts. What suppresses it is the `flavor:
latest=false` input on the workflow's metadata step — `docker/metadata-action`
defaults to `latest=auto`, which generates `:latest` for tag-based rules all
on its own, so simply not listing `latest` under `tags:` is **not** enough. Do
not remove that input.

`GET /version` reports `git describe --tags --always` of the build:
`v26.11.0-rc.2` on a release candidate, `v26.11.0-12-gabc1234` on a
`main`/`development` build. **A promoted release keeps reporting the RC it
came from** — prod on `v26.11.0` answers `{"version":"v26.11.0-rc.2"}`,
because it is that binary. The frontend's update check only compares for
inequality, so it is unaffected. A `development` build describes itself from
the newest tag reachable from `development`, which is why `main` is merged
back after every release (step 9 below).

Release and release-candidate images are retained indefinitely: the GHCR
prune step excludes `stable,edge,development,staging,v*`, so `keep-n-tagged:
20` only ages out the `main`/`development` SHA images.

## Repository settings (once)

Set in GitHub → Settings → Rules → Rulesets. The workflows assume them.

- **`main`** (branch ruleset, target `main`): restrict deletions; block force
  pushes; require a pull request before merging with **0 required
  approvals** (two people: a mandatory approval blocks every release while one
  of them is away — review is a habit, not a gate) and allowed merge methods
  = **merge** only; require status checks `go` and `web` (the `ci.yml` jobs).
- **`development`** (branch ruleset): restrict deletions, block force pushes.
  Nothing else — direct pushes are the point.
- **Release tags** (tag ruleset, target `v*`): restrict creations, updates
  and deletions, with **GitHub Actions** (and repository admins, for
  emergencies) as bypass actors. Cut Release Candidate and Promote push tags
  with `GITHUB_TOKEN`; without the bypass they fail at the push.
- Settings → General → Pull Requests: untick "Allow squash merging" and
  "Allow rebase merging" as well, so the button cannot offer them.

## Prerequisites

- **git-cliff** is not installed by anything in this repo and is not a
  `package.json` dependency. `npx --yes git-cliff@2.13.1 …` runs it without
  installing; substitute that for `git cliff` below if you have no binary.
- **`docker login ghcr.io`** on your machine and on the staging server — the
  package is private. A GitHub PAT with `read:packages` as the password works.
- **`kubectl`** context pointing at the cluster, for the prod deploy.

## Cutting a release

`main` collects merged PRs until you decide to release. Then:

1. **Prepare the release on `development`** (`main` takes no direct pushes,
   so the prep commit travels through the next PR):

   ```bash
   git checkout development && git pull --rebase && git fetch --tags
   scripts/next-version.sh            # e.g. v26.11.0 — use it as vYY.M.N below
   ```

   Make sure `development` holds exactly what should ship: everything on it
   goes into `main` with this PR.

2. **Generate the new release's changelog section incrementally.** Use
   `--unreleased --prepend`, never `-o` / `--output`: `-o` fully regenerates
   `CHANGELOG.md` from git history and overwrites the file, which would wipe
   every earlier release's hand-written `### ⚠ Upgrade notes` block — the
   only record of that release's migrations, flipped `site_config` defaults,
   and re-ingest requirements. `--prepend` inserts only the new commits
   (everything since the last tag) as a new section at the top and leaves
   the rest of the file — all prior releases' upgrade notes included —
   untouched.

   ```bash
   git cliff --unreleased --tag vYY.M.N --prepend CHANGELOG.md
   ```

   Use the **release** version here, not the RC: the section is what ships.
   Fold the hand-written `## Unreleased` block (upgrade notes collected
   since the last release) into the new section and delete it.

   > **Do not reword the preamble at the top of `CHANGELOG.md` on its own.**
   > `--prepend` keeps the file to a single preamble by stripping
   > `[changelog].header` from `cliff.toml` off both the generated output and
   > the existing file, then writing it back once. That strip is an exact
   > string match, so the two must stay **byte-for-byte identical**. Edit the
   > preamble in `cliff.toml` and copy the result into `CHANGELOG.md` (or the
   > reverse) in the same commit — otherwise every future release prepends
   > another copy of the "# Changelog / All notable changes…" block.
   > Verified against git-cliff 2.13.1.

3. **Hand-write the `### ⚠ Upgrade notes` block** under the new heading.
   This is the part no generator can produce. Record every item that
   applies:

   - **Migrations** — the highest number this release requires:
     `ls go-backend/migrations/main/ | grep -oE '^[0-9]+' | sort -n | tail -1`
   - **Changed `site_config` defaults** — especially any flag flipping ON.
   - **Re-ingest requirements** — parser or chunking changes that make
     existing rows stale.
   - **New required env vars or operator grants.**

   If none apply, write "No upgrade actions required." — do not omit the block.

4. **Bump `package.json`** to the release version (nothing reads it at
   runtime, but Cut Release Candidate reads the version from it and Promote
   checks it): `npm version YY.M.N --no-git-tag-version --workspaces-update=false`
   (without the `v`).

5. **Commit on `development`, push, open the release PR.**

   ```bash
   git add CHANGELOG.md package.json package-lock.json
   git commit -m "chore(release): vYY.M.N"
   git push
   ```

   Open a PR `development → main`, wait for CI, merge it **with a merge
   commit**.

6. **Cut the candidate.** Actions → **Cut Release Candidate** → *Run
   workflow* from `main`. It reads the version from `package.json`, refuses
   if that release exists, is not newer than the last one or has no
   changelog section, tags `main`'s tip as `vYY.M.N-rc.K` (K counts up per
   version) and starts the image build. Wait for *Build and Push Docker
   Image* to go green.

7. **Test it on staging.** Actions → **Deploy to Staging**, image =
   `vYY.M.N-rc.K`. The server picks it up within a few minutes (see
   "Staging"); confirm with `curl -s https://<staging-host>/version`.

   If staging finds a problem: fix it on `development`, PR into `main`
   (amend the changelog section in the same PR if the fix belongs in it),
   and run Cut Release Candidate again — it tags `-rc.K+1` on the new tip.
   An RC tag is never moved, so it is always clear which build staging
   tested.

8. **Deploy to prod:** run the release's migrations with the RC image,
   promote, restart — "Deploying a release" below. Promote = Actions →
   **Promote Release Candidate**, `rc_tag` = the RC that passed. It adds
   `:vYY.M.N`, `:vYY.M` and (if newest) `:stable` to that exact image and
   pushes the git tag `vYY.M.N` on the RC's commit.

9. **Merge `main` back into `development`**, so `development` contains the
   release's merge commit and tags (and any fix that went straight to
   `main`):

   ```bash
   git checkout development && git pull --rebase
   git fetch --tags && git merge origin/main && git push
   ```

   A release's own changes all came from `development`, so this merge is
   normally conflict-free.

### Hotfixes

There are no maintenance branches: a hotfix is simply the next release.
Commit the fix on `development` (or, if `development` already holds work
that must not ship yet, on a branch off `main` with a PR into `main`), then
run steps 1–9 with the next version — `scripts/next-version.sh` gives
`v26.11.3` mid-month or `v26.12.0` after the turn of the month. With a
branch off `main`, step 9's back-merge is what brings the fix into
`development`.

## Staging

Staging is a compose server for testing builds before they reach prod. It
does not need the worker split of prod. It runs **whatever `:staging` points
at**, and `:staging` only moves through Actions → **Deploy to Staging**:

| Deploy to Staging with | to test |
|---|---|
| `development` | the current state of `development` (day-to-day, FE + BE together) |
| `edge` | the current state of `main` |
| `vYY.M.N-rc.K` | a release candidate — the only thing that can be promoted |
| a commit SHA | one specific `main`/`development` build |

The server follows the tag on its own: a systemd timer pulls every few
minutes and restarts what changed. Setup and day-to-day commands are in
[`deploy/staging/README.md`](../../deploy/staging/README.md). The staging
`.env` carries `JUSTRAG_VERSION=staging`; `GET /version` tells you which
build it is. Only the image follows `:staging` — the compose files on the
server are a git checkout that is updated by hand when they change.

Compose applies migrations automatically, so staging is where a migration
runs first. Consequences:

- **A migration is final once it has been on staging.** `cmd/migrate` is
  up-only: if migration 0089 ran on staging and is then changed on
  `development`, staging's schema no longer matches the code. Change a
  migration that has been deployed by writing a new one. Pull right before
  creating a migration and push right after, so two people do not take the
  same number.
- **Staging's schema moves ahead of prod**, and deploying an older image
  after a newer one with a migration runs old code on a newer schema. To go
  back for real (an abandoned candidate, or re-testing an upgrade from the
  current prod version), restore staging's database from a snapshot rather
  than migrating down. Take a snapshot before deploying a build that adds a
  migration.
- How long a migration takes depends on the data. If staging's database is
  much smaller than prod's, a `CREATE INDEX CONCURRENTLY` or a backfill that
  is instant on staging can still hit `/app/migrate`'s 5-minute cap on prod —
  read the release's upgrade notes for those.

## Deploying a release

### Compose

Migrations run automatically: the `migrate` one-shot service applies them and
`go-server` / `go-worker` gate on `service_completed_successfully`, so they
cannot start against an old schema.

```bash
JUSTRAG_VERSION=vYY.M.N            # in .env
docker compose -f docker-compose.yml -f docker-compose.production.yml up -d
docker compose logs migrate       # confirm the goose run finished cleanly
```

### Kubernetes

**Step 1 — apply migrations. This is mandatory and there is nothing in the
cluster that does it for you.** `k8s/` has no migrate Job, and neither binary
self-migrates: `cmd/server` never invokes goose, and the worker only calls
`migrate.EnsureVectorTables` (the dim-keyed vector tables), not the main
migration set. Applying the Deployments first runs new binaries against the
old schema.

**Do this before promoting.** Run `/app/migrate` out of the **RC image** you
are about to promote (`:vYY.M.N-rc.K` — the same digest the release will be)
as a one-shot pod, reusing the
workers' existing config and secrets — `worker-config` carries `DB_*` /
`VECTOR_DB_*` and `worker-secrets` carries the passwords plus `JWT_SECRET`.
That covers what the migrate pod itself touches, but `config.Load()` also
hard-fails startup without `ALLOWED_ORIGINS` once `NODE_ENV=production`
(set in `k8s/configmap.yml`) — neither `worker-config` nor `worker-secrets`
sets that var here, so if the cluster's real `worker-config` doesn't carry it
either, this pod dies with a CORS-shaped error, not an obviously
migration-related one. Substitute the real RC in the
pod name using dashes (`migrate-v26-11-0-rc-1`); dots are not valid there. If your
GHCR package is private, add
`"imagePullSecrets":[{"name":"ghcr-secret"}]` inside `spec` in the override,
the same way the worker manifests do.

```bash
kubectl -n justrag run migrate-vYY-M-N-rc-K \
  --image=ghcr.io/ki4jlu/justrag:vYY.M.N-rc.K \
  --restart=Never --attach --rm \
  --overrides='{"spec":{"containers":[{"name":"migrate","image":"ghcr.io/ki4jlu/justrag:vYY.M.N-rc.K","command":["/app/migrate"],"envFrom":[{"configMapRef":{"name":"worker-config"}},{"secretRef":{"name":"worker-secrets"}}]}]}}'
```

Then confirm the schema is where the release expects it:

```bash
kubectl -n justrag run migrate-status-vYY-M-N-rc-K \
  --image=ghcr.io/ki4jlu/justrag:vYY.M.N-rc.K \
  --restart=Never --attach --rm \
  --overrides='{"spec":{"containers":[{"name":"migrate","image":"ghcr.io/ki4jlu/justrag:vYY.M.N-rc.K","command":["/app/migrate","--status"],"envFrom":[{"configMapRef":{"name":"worker-config"}},{"secretRef":{"name":"worker-secrets"}}]}]}}'
```

`--status` prints one `migration status db=main version=NNNN` line per database
and exits. It does **not** list pending migrations — compare the printed
`version` against the highest file in the tagged tree
(`ls go-backend/migrations/main/ | grep -oE '^[0-9]+' | sort -n | tail -1`,
which is also the number recorded in this release's Upgrade notes). Compare
them **numerically** — goose prints `version=63` where the filename is
`0063_…`. They must match before you continue.

Two things worth knowing about `/app/migrate`:

- It serializes on a Postgres advisory lock
  (`internal/migrate/migrate.go`), so a concurrent second run waits rather
  than corrupting anything — safe, just pointless.
- Its context is capped at **5 minutes** (`cmd/migrate/main.go`). A slow
  migration — a large backfill, a non-concurrent index build — can hit that
  wall. If it does, the pod exits non-zero; re-run it, and check the runbook
  in [`migration-rollback.md`](./migration-rollback.md) before assuming the
  schema is intact.

**Step 2 — promote** the RC (Actions → **Promote Release Candidate**). This
moves `:stable`; from here on any restarting pod comes up on the release.

**Step 3 — restart everything that pulls `:stable`**, so all pods move now
and together instead of one by one as they happen to restart:

```bash
kubectl -n justrag rollout restart deploy/worker-quick deploy/worker-heavy deploy/worker-batch deploy/<go-server>
for d in worker-quick worker-heavy worker-batch <go-server>; do
  kubectl -n justrag rollout status deploy/$d --timeout=5m
done
```

The worker manifests in `k8s/` do not change between releases (they pull
`:stable`), so there is nothing to `kubectl apply` unless the manifests
themselves changed in this release — then apply them first.

> **The `go-server` / nginx Deployment is not in this repository.** `k8s/`
> contains only the three workers plus docling. Its manifest, wherever it
> lives, must use `:stable` **with `imagePullPolicy: Always`** like the
> workers. Kubernetes only defaults to `Always` for `:latest` or an untagged
> image, so `:stable` without the explicit policy means `IfNotPresent`: a
> node with an older `:stable` cached keeps running it, and server pods end
> up on different releases. Bringing that manifest in-repo is a known
> follow-up.

Confirm what is actually running:

```bash
curl -s https://<host>/version   # expect {"version":"vYY.M.N-rc.K"} — the promoted RC
```

## Rolling back

> **Rolling back the image does not roll back the database.**
>
> `cmd/migrate` is up-only by design. If the release's upgrade notes list a
> migration, re-pointing the image tag is **not sufficient** — the old binary
> may not tolerate the new schema. Reverting the schema requires the goose
> sequence in [`migration-rollback.md`](./migration-rollback.md).
>
> **A release whose upgrade notes list a migration has no one-step rollback.**
> Check `CHANGELOG.md` before assuming otherwise.

For a release with **no** migration:

- **Compose:** set `JUSTRAG_VERSION` to the previous version, `up -d`.
- **k8s (prod on `:stable`):** run Actions → **Roll Back Stable** with
  `release` = the version to go back to (e.g. `v26.11.0`), then restart as in
  "Deploying a release", step 3. Nothing is built and no git tag changes;
  `:stable` is pointed at that release's existing image. The workflow refuses
  if any later release added a migration, unless `accept_newer_schema` is
  ticked — read the box above first. A later promotion moves `:stable`
  forward again as usual.

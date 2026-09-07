# Contributing to JustRAG

This guide reflects the current Go-first repository layout and local development workflow.

## Prerequisites

- Node.js 20+
- npm
- Docker Compose v2
- Go 1.26+

Optional, depending on what you touch:

- Rust toolchain for `native/`
- Chromium if you want to exercise browser-backed fetch paths locally

## Local Development

### 1. Clone and install

```bash
git clone https://github.com/Lutzi92/JustRAG.git
cd JustRAG
npm install
```

### 2. Start infrastructure

```bash
docker compose up -d db vectordb redis minio
```

### 3. Configure environment

```bash
cp .env.example .env
```

`.env.example` is the best local reference. AI provider configuration is managed in the admin UI.

### 4. Run the Go backend

```bash
cd go-backend
go run ./cmd/migrate
go run ./cmd/server
go run ./cmd/worker
```

This starts:

- API server on `http://localhost:3000`
- worker probe on `http://localhost:8081/healthz`

### 5. Run the frontend

From the repository root:

```bash
npm run web
```

That starts Vite on `http://localhost:5173`.

## Build and Test

### Go backend

```bash
cd go-backend
go test ./...
go test -bench . -run ^$ ./internal/splitter ./internal/vector
```

### Retrieval evaluation

The retrieval/judge harness lives under `cmd/eval` and reads JSONL golden sets from `eval/golden/`:

```bash
cd go-backend
go build ./cmd/eval
./cmd/eval/eval --golden ../eval/golden/<set>.jsonl --top-k 10 --output ../eval-report.json
./cmd/eval/eval --golden ../eval/golden/<set>.jsonl --production-context
./cmd/eval/eval --golden ../eval/golden/<set>.jsonl --judge --judge-model <small-model>
```

See [`eval/golden/README.md`](eval/golden/README.md) for the golden-set schema, route taxonomy, and ablation flags.

### Frontend and legacy root tests

From the repository root:

```bash
npm test
```

Other useful commands:

| Command | Purpose |
|---|---|
| `npm run build` | build root TypeScript, native addon, and frontend assets |
| `npm run test:env:up` | start dedicated test services |
| `npm run test:env:down` | stop dedicated test services |
| `npm run test:setup` | start test infra and run root migrations |

### Frontend lint and the design-system suppressions catalogue

```bash
npm run lint --prefix web          # the gate
npm run lint:prune --prefix web    # repair the catalogue after fixing hits
```

> **Note:** the `lint` step in `.github/workflows/ci.yml` is still
> `continue-on-error: true`, so these rules currently block only locally. Making
> that step blocking is what turns the catalogue below into a real gate — it is
> left as a separate, deliberate decision rather than bundled into this change.

`web/eslint.config.js` runs `@ki4jlu/design-system/eslint-plugin` with all three
rules at `error`: `no-raw-ui-elements`, `no-hardcoded-colors`,
`layout-only-classname`. Controls come from `@ki4jlu/design-system`; colours go
through semantic tokens (`bg-scrim/50`, `bg-primary`, …), never a Tailwind
palette class or a hex.

`no-raw-ui-elements` has 544 pre-existing hits across 100 files (it started at
690 across 101; `AdminAgentTab.tsx` and its 146 hits were the first file
migrated). They are not downgraded to a warning — every one is counted, per
file, in the committed `web/eslint-suppressions.json`. That file is the
project's only exception mechanism; do **not** scatter `eslint-disable`
comments instead. Three consequences worth knowing before you hit them:

- Adding a **new** raw `<button>`/`<input>` fails lint, including in a file that
  already has suppressed hits.
- Suppression is counted per file and rule, and it is all-or-nothing: exceed the
  recorded count by one and ESLint reports *every* hit in that file. One new
  button in `AdminEvalTab.tsx` (29 hits, currently the largest entry) produces
  30 errors, not 1. The new one is the last in the list — that is the one to
  remove.
- **Fixing** a hit without updating the catalogue also fails, with `There are
  suppressions left that do not occur anymore` (exit 2). Plain `eslint .` is the
  whole gate; run `npm run lint:prune --prefix web` and commit the shrunken
  catalogue in the same change. Never add `--prune-suppressions` to the `lint`
  script or to CI — it repairs in place and exits 0, which is exactly the
  failure the gate exists for. `--pass-on-unpruned-suppressions` is set nowhere.

The count in `web/eslint-suppressions.json` is a one-way burn-down counter: it
may shrink, never grow.

### Migrating a file off the catalogue

A settings/admin screen's rows do **not** get a prop-for-prop swap of
`<input>` → `<Input>`. They are rebuilt on the design system's `Form*`
composition, which lives in `web/src/components/form/FieldRow.tsx` —
`FieldRow`, `CheckboxFieldRow`, `SelectFieldRow`. Import those; do not
re-derive the composition per screen, and do not pass an `id` (the types
forbid it: `FormControl` injects the id, which is what makes the
label/control pairing correct by construction). `AdminAgentTab.tsx` is the
worked example.

Two rules that come out of that migration:

- **A staged boolean is a `Checkbox`, never a `Switch`.** The deciding question
  is when the change takes effect: these forms have a Save button, so the value
  is staged until submit. A `Switch` reads as "this applies now".
- **`className` on a design-system control is layout only**, enforced by
  `design-system/layout-only-classname`. If a control does not fit or does not
  look right, the fix belongs in the design system, not at the call site.

## Database and Migration Workflow

### Primary runtime migrations

The Go backend uses embedded goose migrations from:

- `go-backend/migrations/main/`
- `go-backend/migrations/vector/`

Apply them with:

```bash
cd go-backend
go run ./cmd/migrate
```

Useful variants:

```bash
go run ./cmd/migrate --status
go run ./cmd/migrate --seed-only
```

### Legacy schema tooling

The Node/Drizzle assets are still present in:

- `drizzle/main/`
- `drizzle/vector/`
- `src/db/`

They remain useful for legacy flows and schema generation, but they are not the primary migration runtime anymore.

## Codebase Orientation

### Primary runtime

- `go-backend/cmd/`: thin entrypoints for server, worker, and migrate
- `go-backend/internal/app/`: startup wiring, routes, worker setup
- `go-backend/internal/*`: feature packages and infrastructure
- `go-backend/migrations/`: embedded SQL migrations

### Frontend

- `web/src/components/`
- `web/src/contexts/`
- `web/src/hooks/`
- `web/src/routes/`
- `web/src/utils/`

### Legacy code

- `src/`: legacy Node.js backend and tooling
- `src/scripts/`: TypeScript operational scripts
- `native/`: Rust addon used by the legacy Node path

## Conventions

- Keep Go handler, store, and service boundaries explicit.
- Preserve KB permission checks and auth middleware ordering.
- Use the existing queue names and job patterns instead of ad hoc background execution.
- Keep docs in sync when routes, setup, or deployment shape change.
- When changing public APIs, update the embedded OpenAPI asset and related docs.

## Current Runtime Caveats

The default Go runtime still has known gaps:

- Data Explorer routes return `501`
- Chart generation returns `501`
- `POST /api/describe-image` returns `501`

Be careful not to document those as production-ready unless you are also implementing them.

## Submitting Changes

1. Make a focused change.
2. Run the relevant tests.
3. Update docs when behavior or setup changed.
4. Open a PR with scope, risk, and any operational notes.

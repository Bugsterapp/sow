# Changelog

All notable changes to sow are documented here. The format is loosely based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project follows
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.1.16] — 2026-04-06

### Fixed (security/safety)

- **Supabase branch provider no longer destroys unrelated projects.**
  Previously, `sow sandbox` from any directory would activate the
  Supabase provider whenever a local Supabase instance was reachable
  anywhere on the machine, and then `loadIntoSupabase()` would
  `DROP SCHEMA public CASCADE` against that Supabase Postgres. If the
  user had `supabase start` running for project A and then ran
  `sow sandbox` in unrelated project B, project A's public schema was
  silently destroyed. This is exactly the class of accident the tool
  is meant to prevent.

  The fix gates the Supabase provider behind three independent hard
  checks — ALL must pass for the provider to activate:
  1. **Project-local signal.** The current working directory must
     contain `supabase/config.toml` (i.e. it is itself a Supabase-CLI
     project). A bare `supabase/` directory is not enough.
  2. **Explicit destructive consent.** The caller must pass
     `destructiveConsent: true` via the new CLI flag
     `--yes-destructive-supabase`, OR via `.sow.yml` field
     `providers.supabase.destructive_consent: true`. No implicit
     activation.
  3. **Infrastructure reachability.** Local Supabase Postgres must
     actually be running.

  If any gate fails, sow falls back to the Docker provider which spins
  up a fresh, isolated container at `postgresql://sow:sow@localhost:54320/sow_sandbox`
  with zero blast radius.

  Before the destructive `DROP SCHEMA`, `loadIntoSupabase()` now also
  prints a prominent stderr warning naming the target URL
  (credential-redacted) as a final audit trail for opted-in users.

  Added: new `--yes-destructive-supabase` CLI flag.
  Added: new `.sow.yml` field `providers.supabase.destructive_consent`.
  Added: `isSupabaseProject(cwd)` helper.
  Added: 13 new unit tests covering all three gates and the
  historical regression path (a test that fails if detect() fires
  network I/O when cwd is not a Supabase project).

### Overview

The launch release. New positioning: "Stop letting Claude touch your prod database."
New flagship command, new safety gate, sub-second resets, sharper sampler, and
a fully repositioned README + cookbook.

### Added

- **`sow_sandbox` MCP tool** — the flagship zero-config flow is now directly
  callable from MCP-enabled agents (Claude Code, Cursor, Windsurf, Codex).
  Detects the project's Postgres source, creates or reuses a connector, and
  spins up a sandbox branch in one call. Never patches env files (agents
  should not modify the host project without explicit consent).
- **`sow sandbox`** — flagship zero-config command. Auto-detects your project's
  Postgres source, samples + sanitizes, spins up a local sandbox, and patches
  `.env.local` with the new `DATABASE_URL`. One command from clone to working
  sandbox.
- **`sow env revert`** — restores `.env.local` from the `.env.local.sow.bak`
  backup that `sow sandbox` writes.
- **JSONB sanitization.** sow now walks JSONB columns recursively and replaces
  values whose key matches a PII pattern. Closes the biggest PII leak vector in
  modern Postgres schemas.
- **Postgres type coverage.** Built-in transformers for `inet`, `cidr`,
  `macaddr`, `macaddr8`, plus passthrough handling for `bytea`, `xml`, `money`,
  `interval`, range types, array types, and custom enums.
- **`--allow-unsafe` flag.** sow's sanitizer is now fail-closed: it aborts
  `sow connect` if it sees a Postgres type it can't verify. Pass `--allow-unsafe`
  to NULL out unhandled columns instead.
- **`sow doctor <connector>`** — drill into a single connector's referential
  integrity warnings. Surfaces orphaned FKs, transient read errors, and
  sanitization warnings.
- **Tag-driven release workflow.** New `version-bump.yml` workflow lets you cut
  a major/minor/patch/prerelease via the GitHub Actions UI; `release.yml` is
  now triggered only by tag pushes (not every merge to main). Prevents
  accidental releases on README typos.
- **`docs/sandbox.md`, `docs/sanitization.md`, `docs/cookbook.md`** — full docs
  for the flagship command, the sanitization gate and JSONB handling, and three
  end-to-end agent workflows.

### Changed

- **`sow branch reset` is now sub-second** on a 10k-row schema. Refactored the
  Docker provider to use Postgres template databases (one long-lived container
  per connector, N branch databases inside). Old reset path was 5-15s; new path
  is ~200-800ms. Enables tight agent reset loops (50 iterations in a minute).
- **Sampler integrity warnings** — the referential-integrity pass now collects
  structured warnings (`parent_fetch_failed`, `parent_not_found`,
  `child_fetch_failed`, `implicit_ref_fetch_failed`) instead of silently
  swallowing them in `catch {}` blocks. Surfaced via `sow doctor <connector>`.
- **Implicit reference resolution is now batched.** The sampler used to fire
  one query per `(source_table, source_column)` pair when resolving implicit
  FKs; it now collects missing ids by target table across all sources and fires
  one `IN (...)` query per target. ~10x reduction in `sow connect` round-trips
  on a 50-table schema.
- **Skip-list for implicit references is now dynamic.** The old hardcoded
  English-only `["id", "user_id", "owner_id", "created_by"]` set is replaced
  with a dynamic check against the actual formal Relationships from the
  schema. Works for non-English column names and unusual FK layouts.
- **MCP server description corrected** from "15 tools" to the accurate count of
  22 tools. The MCP README now lists every tool with its description.
- **Top-level `README.md` repositioned** around "Stop letting Claude touch your
  prod database" with new sections on the agent reset loop, the cookbook of
  three workflows, and a docs index.
- **`packages/cli/README.md` (the npm landing page) rewritten** to match the
  new positioning and use `sow sandbox` as the first-run command instead of the
  old `sow connect` / `sow branch create` flow.
- **`sow --help` output** — fixed indentation for `--no-sanitize`, `branch
  start`, `branch env`, `branch users`, `branch tables`, `branch sample`,
  `branch run`, `connector list`.

## [0.1.15] — 2026-04-06

Version cut as part of the in-progress launch sprint. Published to npm but
never released on GitHub. Superseded by 0.1.16.

## [0.1.14] — 2026-04-06

### Fixed

- **SQL injection across the sampler and branching layer (security).** A class
  of bugs where dynamic SQL was built by string-interpolating values from
  sampled source data has been closed. Seven call sites parameterized:
  - `packages/core/src/sampler/referential.ts` — three formal-FK and
    implicit-reference call sites (regression: a text PK like `O'Brien` used
    to crash silently and drop the parent row)
  - `packages/core/src/branching/manager.ts:getBranchSample` — the `table`
    argument from user/agent input is now `quoteIdent`-quoted, the `limit` is
    bound via `$1`
  - `packages/core/src/branching/providers/supabase.ts:fetchAuthUserMappings`
    — the `IN (...)` clause now uses `$1, $2, ...` placeholders, batched at
    1000 ids per query, with UUID-shape pre-filter
  - `packages/core/src/branching/supabase.ts` — eight RLS DDL and auth-user
    INSERT/DELETE sites now use parameterized values and `quoteIdent`
    identifiers
- **`packages/core/src/adapters/postgres.ts`** — the `query()` method's
  `params` argument was previously declared in the interface but silently
  dropped at runtime (`_params?: unknown[]`). Now actually passes through to
  `postgres@3`'s `sql.unsafe(query, parameters)` for real bind-parameter
  safety.
- **Fail-safe RLS setup in the Supabase provider.** A previous structure
  could DISABLE row-level security on a table when a transient introspection
  error occurred during sandbox setup. RLS introspection now lives in its own
  per-table try block that `continue`s on error rather than falling into the
  policy-disable fallback path.
- **Identifier quoting helper** — new `packages/core/src/sql/identifiers.ts`
  exports `quoteIdent()`, the SQL-standard double-quote escape used wherever
  table or column names are interpolated into dynamic SQL. Throws on empty
  identifiers and embedded NUL bytes.
- **`sow branch sample` limit clamping** — accepts `LIMIT 0` (a valid request
  for an empty result set), falls back to the documented default of 5 for
  non-finite inputs, and clamps the upper bound at 100.

### Tests

- 89 unit tests passing. 10 new regression tests in
  `packages/core/src/sampler/referential.test.ts` covering `quoteIdent`
  edge cases, the `O'Brien` single-quote regression, composite FK
  parameterization, and hostile-payload defense.
- Cross-model adversarial review (Claude + Codex) — both passes clean,
  Codex structured P1 gate passed.

## [0.1.13] — earlier

Initial public release. Functional CLI, MCP server, Docker-backed branches,
deterministic PII sanitization, schema introspection, edge-case sampling,
checkpoint save/load, branch diff. Auto-detection from env files and the
common ORMs (Prisma, Drizzle, Knex, TypeORM, Sequelize, Docker Compose).
Provider hints for Supabase, Neon, Vercel Postgres, and Railway.
</content>

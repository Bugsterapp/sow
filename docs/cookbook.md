# Cookbook

Three end-to-end workflows that show what sow actually unlocks. Every workflow assumes you've installed sow and have a project with a Postgres database.

```bash
npm install -g @sowdb/cli
cd your-project
sow sandbox
```

After that, your `.env.local` has `DATABASE_URL` pointing at the local sandbox. Your coding agent reads it like any other env var.

---

## 1. Let Claude refactor your schema without fear

**The scenario.** You want Claude Code to add a column, drop an unused index, rename a poorly-named table. The kind of work you'd never let an agent do against prod, but the kind that's safe and useful in a sandbox.

**The setup.**

```bash
cd your-project
sow sandbox
```

`.env.local` now has `DATABASE_URL=postgresql://sow:sow@localhost:54320/sow_sandbox`. Your existing migration tooling (Prisma, Drizzle, Knex, raw SQL — doesn't matter) reads from there.

**The prompt.** Open Claude Code in the project. Ask it:

> Look at the current schema in our Prisma file. The `user_profiles.bio_text` column is going unused. Add a migration to drop it, then run the migration against the sandbox to verify it works. If it breaks something, tell me what.

**What happens.**

1. Claude reads `prisma/schema.prisma`, identifies the `bio_text` column.
2. Claude runs `npx prisma migrate dev --name drop_user_profiles_bio_text` against your sandbox.
3. The migration executes against the local sandbox Postgres. Prod is untouched.
4. Claude reports back: "Migration ran cleanly. Verified by running `prisma migrate status`. All existing tests still pass."

**If it breaks something:**

```bash
sow branch reset sandbox    # back to seed state in <1s
```

Now Claude can try a different approach with a clean slate. Five iterations in a minute. Without sow, every "let me try a different migration" round-trip would either be against a stale local copy (data drift) or against staging (pollution).

---

## 2. Let Cursor generate seed data for a new feature

**The scenario.** You're shipping a new "team workspaces" feature. You need realistic test data: 100 users, ~30 teams, each user belonging to 1-3 teams, with realistic email distributions and signup dates spread over 6 months.

Writing this seed script by hand is tedious. Letting an agent do it against the *real* user table in staging is unsafe (it pollutes the table for everyone else, and the real users have constraints you don't want to violate).

**The setup.**

```bash
sow sandbox
```

**The prompt.** Open Cursor in the project. Ask it:

> Look at the `users`, `teams`, and `team_memberships` tables in our schema. Write a SQL script that inserts 100 realistic users, 30 teams, and team memberships such that each user belongs to 1-3 teams. Use realistic email distributions and spread signup dates over the last 6 months. Run it against the sandbox using `sow branch exec`.

**What happens.**

1. Cursor reads the schema, understands the foreign key relationships.
2. Cursor writes `seeds/team_workspaces.sql` with the inserts.
3. Cursor runs `sow branch exec sandbox --file seeds/team_workspaces.sql`.
4. Sandbox now has 100 users + 30 teams + ~200 memberships. Real users in staging are untouched.

**Inspect what got created:**

```bash
sow branch sample sandbox users
sow branch sample sandbox teams
sow branch tables sandbox    # row counts for every table
```

**Don't like the distribution?**

```bash
sow branch reset sandbox
```

And ask Cursor to try a different approach.

---

## 3. Let your coding agent debug a failing migration

**The scenario.** Your last migration broke something in CI. You don't know exactly what — it ran fine locally, fails on staging. You want to replay it against a sandbox built from the actual prod schema (not your stale local copy) and have the agent figure out what's wrong.

**The setup.**

```bash
cd your-project
sow sandbox    # samples from prod, gives you a fresh sandbox
```

The sandbox now has the *current* prod schema, not the schema you had locally last week.

**The prompt.** Open Claude Code:

> Our migration `2026_04_06_add_team_workspaces.sql` is failing in CI but I can't reproduce it locally. Run it against the sandbox using `sow branch exec` and tell me the exact error. Then fix the migration so it works.

**What happens.**

1. Claude runs `sow branch exec sandbox --file db/migrations/2026_04_06_add_team_workspaces.sql`.
2. Postgres returns the actual error (e.g. `ERROR: column "user_id" referenced in foreign key constraint does not exist`).
3. Claude reads the migration, sees the bug (maybe a typo, maybe a missing prerequisite column).
4. Claude proposes a fix and runs it: `sow branch reset sandbox && sow branch exec sandbox --file db/migrations/2026_04_06_add_team_workspaces.sql`.
5. Iterates until the migration runs cleanly.

**Verify what changed:**

```bash
sow branch diff sandbox
```

Shows you exactly which tables, columns, indexes, and rows the migration touched. You see the same diff Claude saw.

---

## Pattern: the agent reset loop

Every workflow above follows the same loop:

```
┌──────────────────────────────────────────┐
│ 1. Agent does something destructive     │
│    sow branch exec sandbox ...           │
│                                          │
│ 2. Agent verifies the result             │
│    sow branch diff sandbox               │
│    sow branch sample sandbox <table>     │
│                                          │
│ 3. Wrong? Reset and try again            │
│    sow branch reset sandbox  (~200ms)    │
│                                          │
│ 4. Right? Move on, prod still untouched  │
└──────────────────────────────────────────┘
```

The reset is the magic. Without it, "let me try a different approach" means "let me clobber my stale local copy and hope I remember to refresh it." With it, every attempt starts from a clean, sanitized, prod-shaped database.

## MCP tools your agent can call directly

If your agent supports MCP (Claude Code, Cursor, Windsurf, Codex), `sow mcp --agent <name>` configures it to call sow's tools directly without any shell-out. The 22 tools cover the full loop:

- `sow_sandbox` — the flagship zero-config flow
- `sow_detect`, `sow_connect`, `sow_connector_list/refresh/delete`
- `sow_branch_create/list/info/delete/reset/diff/exec/sample/tables/users/env`
- `sow_branch_save/load` (named checkpoints — like git commits for your sandbox)

Every tool returns structured JSON. Every tool is idempotent where it can be. Every tool is documented so the agent picks the right one without prompting.

## Tips

**Keep one long-running sandbox per project.** Don't `sow branch delete sandbox` between sessions — the reset is fast, the recreate is fast, but reusing keeps the connector and Docker container warm.

**Use checkpoints for "known good states."** Mid-debug, run `sow branch save sandbox before-fix`. After a few attempts, `sow branch load sandbox before-fix` brings you back. Like `git stash` for databases.

**Use `sow doctor sandbox` if something feels off.** It surfaces sanitization warnings, integrity warnings, and snapshot stats so you can tell whether the sandbox shape matches prod.

**Don't `sow connect` with a wide-permission user.** Even though sow is read-only, the principle of least privilege applies. Create a read-only Postgres user just for sow.
</content>

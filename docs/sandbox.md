# `sow sandbox` — the flagship command

`sow sandbox` is the one-command zero-config flow. Run it inside any project that has a Postgres database, and you get a local sanitized sandbox with `DATABASE_URL` already wired up.

```bash
cd your-project
sow sandbox
```

That's it. Your coding agent (Claude Code, Cursor, Codex, anything that reads `DATABASE_URL` from the environment or `.env.local`) now talks to a local Postgres copy with PII scrubbed. Prod is untouched.

## What it does, in order

1. **Detects your source database.** Scans `.env`, `.env.local`, Prisma `schema.prisma`, Drizzle config, Knex config, TypeORM config, Sequelize config, `docker-compose.yml`, and `package.json` for a `DATABASE_URL` or equivalent. Identifies Supabase, Neon, Vercel Postgres, and Railway projects via the env vars they use.
2. **Reuses an existing connector if one is set up,** or runs `sow connect` against the detected URL. The connect step samples representative rows (default 200 per table, with edge cases), scrubs every PII column with deterministic Faker output, and saves a snapshot to `~/.sow/snapshots/<name>/init.sql`.
3. **Creates a branch** named `sandbox` (override with `--name`). On first run for this connector, this spins up a long-lived Docker Postgres container holding a frozen seed database plus your branch database. On subsequent runs, branches are cloned from the seed in under 1 second.
4. **Patches `.env.local`** with the new `DATABASE_URL` and `SOW_BRANCH=sandbox`. Other variables in the file are preserved. A backup is written to `.env.local.sow.bak` so you can revert.
5. **Prints the connection string** and a one-line confirmation:
   ```
   ✓ Sandbox ready at :54320/sow_sandbox
     DATABASE_URL=postgresql://sow:sow@localhost:54320/sow_sandbox
     Patched .env.local (backup: .env.local.sow.bak)
   ```

Run your dev server normally — `npm run dev`, `bun dev`, whatever you already use — and your app reads from the sandbox.

## Flags

| Flag | Default | Purpose |
|---|---|---|
| `[url]` (positional) | auto-detected | Override the source connection string |
| `--name <name>` | `sandbox` | Branch name |
| `--env-file <path>` | `.env.local` | Which env file to patch |
| `--no-env-file` | off | Skip the env patch — just print the URL |
| `--yes` / `-y` | off | Skip the interactive confirmation prompt |
| `--max-rows <n>` | 200 | Rows per table during sampling |
| `--seed <n>` | 42 | Reproducibility seed |
| `--full` | off | Copy all rows instead of sampling |
| `--no-sanitize` | off | Skip PII sanitization (NOT recommended) |
| `--allow-unsafe` | off | Allow Postgres types sow doesn't recognize (see [`sanitization.md`](sanitization.md)) |
| `--yes-destructive-supabase` | off | Opt into the Supabase branch provider. Only takes effect in projects with `supabase/config.toml`. See "Branch providers" below. |
| `--json` | off | JSON output for agent consumption |
| `--quiet` / `-q` | off | Minimal output |

## Reverting

If you want to undo the `.env.local` patch and restore the original file:

```bash
sow env revert
```

This reads `.env.local.sow.bak` and writes it back to `.env.local`, then deletes the backup.

## Re-running

Running `sow sandbox` again when a sandbox already exists:

- Reuses the existing connector (no re-sampling)
- Reuses the existing branch (no re-creation)
- Re-patches `.env.local` if needed (skipped if already correct)
- Exits in under a second

If you want a fresh sandbox with new sampled data, run `sow connector refresh sandbox` first.

## Branch providers: Docker (default) and Supabase (opt-in)

By default, `sow sandbox` uses the **Docker provider**: it spins up a fresh, isolated Postgres container at `postgresql://sow:sow@localhost:54320/sow_sandbox` and loads sanitized sample data into it. Your source database, your dev environment, and any other Postgres instances on your machine are never touched. This is the zero-blast-radius path and it's what you get automatically.

If you are actively developing against Supabase locally (you have a `supabase/config.toml` in your project and you run `supabase start`), you can opt into the **Supabase provider**, which writes the sanitized data directly into your local Supabase's Postgres. This gives you the Supabase Auth/RLS/Realtime/Storage integration in the sandbox — your app keeps using the Supabase client SDKs, and the sandbox appears as "my app's database" from Supabase Studio.

**The Supabase provider is destructive.** When it activates, it runs:

```sql
DROP SCHEMA public CASCADE;
CREATE SCHEMA public;
-- ...then loads sanitized data
```

Every table in your local Supabase's `public` schema is replaced with sandbox data. This is the correct behavior when you want "sandbox = my Supabase" but it is DESTRUCTIVE if triggered by accident. sow therefore gates activation behind three independent hard checks. ALL three must pass:

1. **Your project must be a Supabase-CLI project.** Specifically, `supabase/config.toml` must exist in the directory you run `sow sandbox` from. A bare `supabase/` directory is not enough. A Supabase instance running elsewhere on your machine (for an unrelated project) will not trigger activation from your current directory.

2. **You must explicitly opt in.** Either pass `--yes-destructive-supabase` on the command line OR add this to your project's `.sow.yml`:
   ```yaml
   providers:
     supabase:
       destructive_consent: true
   ```
   Without either, sow falls back to the Docker provider even if gates 1 and 3 pass.

3. **Local Supabase must be running.** `supabase status` must return a DB URL, or port 54322 must be reachable.

If any gate fails, sow uses Docker. If all three pass, sow prints a prominent stderr warning naming the target URL before the destructive operation runs, as a final audit trail:

```
⚠ Supabase branch provider: about to DROP schema public of postgresql://localhost:54322/postgres
  All tables in that schema will be replaced with sanitized sample data.
  (This is the opted-in Supabase branch flow. If you did not expect
   this, abort now with Ctrl+C and see docs/sandbox.md.)
```

**Historical note.** sow 0.1.14 and earlier had a bug where the Supabase provider activated whenever port 54322 was reachable, regardless of whether the current project was itself a Supabase project. Running `sow sandbox` in an unrelated directory with a local Supabase running elsewhere would silently destroy that Supabase's public schema. The three-gate fix landed in 0.1.16. If you are upgrading from 0.1.14 or earlier, this is the one behavior change you should be aware of: the Supabase provider no longer activates implicitly.

## When NOT to use `sow sandbox`

- You want to create *multiple* differently-named branches (use `sow branch create <name>` directly)
- You want to point at a specific non-detected source URL once and don't want it stored as a connector (use `sow connect <url>` then `sow branch create`)
- You're running in CI and don't want the `.env.local` patch (use `sow connect && sow branch create dev --env-file ci.env --yes`)

## What's actually in the sandbox

Run `sow doctor sandbox` to see snapshot stats and any sanitization warnings. Run `sow branch tables sandbox` to list tables with row counts. Run `sow branch sample sandbox <table>` to peek at a table's first few rows (the values are sanitized — emails are Faker emails, names are Faker names, etc., but the *shape* matches your real data).
</content>

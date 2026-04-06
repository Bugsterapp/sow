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

## When NOT to use `sow sandbox`

- You want to create *multiple* differently-named branches (use `sow branch create <name>` directly)
- You want to point at a specific non-detected source URL once and don't want it stored as a connector (use `sow connect <url>` then `sow branch create`)
- You're running in CI and don't want the `.env.local` patch (use `sow connect && sow branch create dev --env-file ci.env --yes`)

## What's actually in the sandbox

Run `sow doctor sandbox` to see snapshot stats and any sanitization warnings. Run `sow branch tables sandbox` to list tables with row counts. Run `sow branch sample sandbox <table>` to peek at a table's first few rows (the values are sanitized — emails are Faker emails, names are Faker names, etc., but the *shape* matches your real data).
</content>

---
name: sow
description: Generate safe test databases from production Postgres. Create isolated database branches with sanitized data for testing migrations, running test suites, and letting coding agents work with production-like data without PII exposure. Requires Docker.
---

# Database Testing with sow

## Core Workflow

Every database testing task follows this pattern:

1. **Connect**: `sow connect <postgres-url>` (one-time, creates sanitized snapshot)
2. **Branch**: `sow branch create <n>` (isolated Postgres in ~5s)
3. **Use**: Connect your app/tests to the branch URL
4. **Inspect**: `sow branch diff <n>` (see what changed)
5. **Clean up**: `sow branch delete <n>`

## Quick Start

### Setup (one time per database)
```bash
# Auto-detect from Prisma, Drizzle, .env, Docker Compose, etc.
sow connect                    # samples ~200 rows/table (fast)
sow connect --full             # copies ALL rows (slower, complete data)

# Or pass explicitly
sow connect postgresql://user:pass@host:5432/mydb
sow connect postgresql://user:pass@host:5432/mydb --full
```

Use `--full` when tests fail due to missing data or broken relationships. Default sampling is faster but may miss some rows.

### Create a branch to test on
```bash
sow branch create my-feature
# Branch created in ~5s
# URL: postgresql://sow:sow@localhost:54320/sow
```

### Work with it
```bash
# sow branch run injects DATABASE_URL, SUPABASE_URL, etc. automatically.
# Pass the project's own dev/start command after --
sow branch run my-feature -- <project's dev command>
```

To find the right command, check the project's `package.json` scripts, `Makefile`, `docker-compose.yml`, or README.

### See what changed
```bash
sow branch diff my-feature
# Tables modified: 2
#   users    +3 rows, ~1 modified
#   orders   -1 rows
# Schema changes: 1
#   + ALTER TABLE users ADD COLUMN preferences JSONB
```

### Clean up
```bash
sow branch delete my-feature
```

## Running an App with a Branch

`sow branch run` injects DATABASE_URL, SUPABASE_URL, and all other branch env vars into whatever command you pass after `--`.

```bash
sow branch create dev
sow branch run dev -- <project's dev command>
sow branch run dev -- <project's test command>
sow branch run dev -- <project's migration command>
```

**Important**: The command after `--` is project-specific. Check `package.json` scripts, `Makefile`, or the project's README to find the correct command. Don't assume any particular package manager or framework.

## Discover What's in the Branch

After creating a branch, use these commands to discover what's available:

```bash
# Get env vars (for manual .env configuration if needed)
sow branch env dev
#   DATABASE_URL=postgresql://sow:sow@localhost:54320/sow
#   SUPABASE_URL=http://127.0.0.1:54321         (if Supabase)
#   SUPABASE_PUBLISHABLE_KEY=sb_publishable_... (if Supabase)

# Find test accounts to log in with
sow branch users dev
#   password for all: password123
#   lilliana_emmerich@yahoo.com
#   john_doe@gmail.com

# See what tables exist
sow branch tables dev
#   TABLE          ROWS
#   users            18
#   organizations     5
#   orders           11

# Preview data in a table
sow branch sample dev users --limit 3
```

All discovery commands support `--json` for structured agent consumption:
```bash
sow branch env dev --json       # { "DATABASE_URL": "...", ... }
sow branch users dev --json     # { "password": "password123", "accounts": [...] }
sow branch tables dev --json    # [{ "table": "users", "rows": 18 }, ...]
sow branch sample dev users --json --limit 5  # [{ "id": "...", "email": "..." }, ...]
```

## Common Patterns

### Migration Testing
```bash
sow branch create migration-test
sow branch run migration-test -- npx prisma migrate dev
sow branch diff migration-test
sow branch delete migration-test
```

### Iterative Development with Save/Load
```bash
sow branch create dev
# Make change A...
sow branch save dev after-change-a
# Make change B (breaks something)...
sow branch load dev after-change-a
# Back to good state
sow branch delete dev
```

### Test Suite with Clean State
```bash
sow branch create tests
sow branch run tests -- <your-test-command>    # e.g. bun test, npm test, pytest
sow branch reset tests
sow branch run tests -- <your-test-command>
sow branch delete tests
```

### E2E Testing with Browser Agent
```bash
sow branch create e2e
sow branch run e2e -- <your-dev-command> &     # e.g. bun run dev, npm run dev
sow branch users e2e                           # get test credentials to log in
# Use Playwright / browser agent to navigate and test
sow branch diff e2e
sow branch delete e2e
```

### Specific Test Scenarios via Exec
```bash
sow branch create scenario
sow branch exec scenario --sql "UPDATE users SET plan = 'expired' WHERE id = 1"
# Test the expired plan flow...
sow branch reset scenario
sow branch exec scenario --sql "INSERT INTO carts (user_id, items) VALUES (1, 3)"
# Test the cart flow...
sow branch delete scenario
```

### CI/CD Pipeline
```bash
sow connect $DATABASE_URL --quiet
BRANCH_URL=$(sow branch create ci-$CI_COMMIT_SHA --quiet)
DATABASE_URL=$BRANCH_URL npm test
sow branch delete ci-$CI_COMMIT_SHA
```

### Write Env Vars to a File
```bash
sow branch env dev --env-file .env.local
# Writes DATABASE_URL=... and all other vars to .env.local
```

## Key Behaviors

- **Branches are fully isolated** -- changes don't affect other branches or production
- **Data looks like production** but all PII is automatically replaced with realistic fakes
- **`sow branch run` injects env vars** -- always use it instead of manually setting DATABASE_URL, SUPABASE_URL, etc.
- **`sow branch users` gives test credentials** -- all test accounts use password `password123`
- **Check the project's own docs** (package.json, Makefile, README) to find the right dev/start/test commands
- **Deterministic** -- same seed (default: 42) produces identical output every time
- **Docker or Supabase** -- auto-detects if `supabase start` is running, otherwise uses Docker
- **Ports 54320-54399** -- sow auto-assigns free ports in this range
- **Credentials are always `sow/sow`** -- test data doesn't need security
- **`sow branch reset` takes ~1s** -- the sampled DB is small (MBs, not GBs)
- **Read-only access to production** -- sow never writes to your source database

## Troubleshooting

### `psycopg2` / `asyncpg` / SQLAlchemy dialect errors
`sow branch run` sets `DATABASE_URL=postgresql://...` (standard format). If the project uses SQLAlchemy with `create_async_engine`, it needs `postgresql+asyncpg://` instead. sow also sets `DATABASE_URL_ASYNC` with this format. Fix: update the project's database config to use `DATABASE_URL_ASYNC`, or add URL normalization:
```python
url = os.environ["DATABASE_URL"].replace("postgresql://", "postgresql+asyncpg://")
```

### Connection refused
The branch may not be running. Check with `sow branch list` and start it with `sow branch start <name>`.

### Missing data / broken foreign keys / tests failing
The default mode samples ~200 rows per table. If tests fail because of missing related data, re-connect with full copy:
```bash
sow connect --full
sow branch delete <name>
sow branch create <name>
```

### No tables found / 0 rows
The source database may have no tables in the `public` schema, or the snapshot was taken before migrations ran. Re-run `sow connect` after running migrations on the source DB.

### Auth / login not working
Use `sow branch users <name>` to get the exact test emails. Password is always `password123`. Make sure the app's auth is pointing at the branch's Supabase URL (check `sow branch env <name>`).

### Docker not running
sow needs Docker for standalone branches. Start Docker Desktop, or use `supabase start` for Supabase-based branches (auto-detected).

## When NOT to Use sow

- Load testing (sampled DB is too small for realistic load)
- When you need real PII (sow replaces everything it detects)
- Performance benchmarks (Docker adds overhead vs native Postgres)
- When you need the complete dataset (sow samples ~50 rows/table by default)

## Deep-Dive References

| Reference | When to Use |
| --- | --- |
| [references/commands.md](references/commands.md) | Full command reference with all flags |
| [references/branching.md](references/branching.md) | Branch lifecycle, checkpoints, reset, diff |
| [references/sanitization.md](references/sanitization.md) | PII rules, custom rules, what gets masked |
| [references/mcp-tools.md](references/mcp-tools.md) | All MCP tools with params and examples |
| [references/ci-cd.md](references/ci-cd.md) | GitHub Actions, GitLab CI examples |

## Ready-to-Use Templates

| Template | Description |
| --- | --- |
| [templates/migration-test.sh](templates/migration-test.sh) | Test a migration safely |
| [templates/e2e-test-setup.sh](templates/e2e-test-setup.sh) | Set up branch for E2E testing |
| [templates/ci-pipeline.sh](templates/ci-pipeline.sh) | CI/CD create/test/cleanup |
| [templates/scenario-testing.sh](templates/scenario-testing.sh) | Checkpoint + seed for scenarios |

# sow Command Reference

## Global Options

These flags work with every command:

| Flag | Short | Default | Description |
|------|-------|---------|-------------|
| `--json` | | `false` | Output JSON events on stdout (for agents) |
| `--quiet` | `-q` | `false` | Minimal output (for scripts) |
| `--config` | `-c` | `.sow.yml` | Path to config file |
| `--help` | `-h` | | Show help |
| `--version` | `-v` | | Show version |

## Connection

### `sow connect <connection-string>`

Connect to a production Postgres database, analyze it, sample representative rows, sanitize PII, and save a local snapshot.

| Flag | Short | Default | Description |
|------|-------|---------|-------------|
| `--name` | | DB name | Name for the connector |
| `--full` | | `false` | Copy ALL rows (no sampling, slower but complete) |
| `--max-rows` | `-m` | `200` | Max rows to sample per table (ignored if --full) |
| `--seed` | `-s` | `42` | Random seed for reproducibility |
| `--exclude` | | | Comma-separated tables to skip |
| `--no-sanitize` | | `false` | Skip PII sanitization |

```bash
# Sample mode (default, fast)
sow connect postgresql://user:pass@host:5432/mydb

# Full copy mode (all rows, slower)
sow connect postgresql://user:pass@host:5432/mydb --full

# Agent usage (JSON events)
sow connect postgresql://user:pass@host:5432/mydb --json

# Script usage (prints connector name only)
sow connect postgresql://user:pass@host:5432/mydb --quiet
```

### `sow connector list`

List all saved connectors (snapshots).

```bash
sow connector list
sow connector list --json    # JSON array
sow connector list --quiet   # TSV: name, tables, rows
```

### `sow connector delete <name>`

Delete a connector and its snapshot. Fails if active branches exist.

### `sow connector refresh <name>`

Re-create the snapshot with fresh data from the original connection string.

## Branching

### `sow branch create <name>`

Create an isolated database branch from a connector snapshot. Returns the connection string.

| Flag | Short | Default | Description |
|------|-------|---------|-------------|
| `--connector` | | auto | Connector to branch from |
| `--port` | | auto | Specific port (54320-54399) |
| `--pg-version` | | `16` | Postgres version for container |
| `--export` | | `false` | Print `export SOW_URL=...` |
| `--env-file` | | | Write DATABASE_URL to this file |
| `--append` | | `false` | Append to env file |

```bash
# Human usage
sow branch create my-feature

# Script usage (returns connection string only)
URL=$(sow branch create my-feature --quiet)

# Export for eval
eval $(sow branch create my-feature --export)

# Write to .env file
sow branch create my-feature --env-file .env.test
```

### `sow branch list`

List all branches with status and connection info.

### `sow branch info <name>`

Show details about a specific branch.

### `sow branch delete <name>`

Delete a branch and remove its Docker container.

### `sow branch diff <name>`

Show changes made to the branch since creation: rows added/deleted/modified and schema changes.

### `sow branch reset <name>`

Reset a branch to its original snapshot state. Destroys all changes.

### `sow branch stop <name>`

Stop a branch's Docker container (saves resources). Data is preserved.

### `sow branch start <name>`

Restart a stopped branch.

### `sow branch save <name> <checkpoint-name>`

Save the current branch state as a named checkpoint.

### `sow branch load <name> <checkpoint-name>`

Load a previously saved checkpoint into a branch.

### `sow branch exec <name>`

Run SQL against a branch to set up test scenarios.

| Flag | Description |
|------|-------------|
| `--sql` | SQL string to execute |
| `--file` | Path to SQL file |

```bash
sow branch exec my-feature --sql "UPDATE users SET plan = 'expired' WHERE id = 1"
sow branch exec my-feature --file ./test-data.sql
```

## Discovery

### `sow branch env <name>`

Get environment variables for a branch. Includes `DATABASE_URL` and (for Supabase) `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, etc.

```bash
sow branch env dev                      # human-friendly
sow branch env dev --json               # { "DATABASE_URL": "...", ... }
sow branch env dev --env-file .env.local # write to file
```

### `sow branch users <name>`

List test accounts available in the branch. All share the same password.

```bash
sow branch users dev                    # human-friendly list
sow branch users dev --json             # { "password": "password123", "accounts": [...] }
```

### `sow branch tables <name>`

List all tables in the branch's public schema with row counts.

```bash
sow branch tables dev                   # human-friendly table
sow branch tables dev --json            # [{ "table": "users", "rows": 18 }, ...]
```

### `sow branch sample <name> <table>`

Preview rows from a specific table.

| Flag | Default | Description |
|------|---------|-------------|
| `--limit` | `5` | Max rows to return (max 100) |

```bash
sow branch sample dev users --limit 3
sow branch sample dev users --json --limit 5   # array of row objects
```

### `sow branch run <name> -- <command...>`

Run any command with the branch's env vars automatically injected. The `--` separator marks where the command starts.

```bash
sow branch run dev -- npm run dev
sow branch run dev -- uvicorn app.main:app --reload
sow branch run dev -- npx prisma migrate dev
sow branch run dev -- npm test
```

This is the recommended way for agents to start app processes with test data. No manual env var wiring needed.

## Analysis

### `sow analyze <connection-string>`

Analyze a database: schema, stats, PII detection.

| Flag | Short | Default | Description |
|------|-------|---------|-------------|
| `--tables` | `-t` | all | Comma-separated tables to analyze |

## Utilities

### `sow doctor`

Run diagnostic checks on your sow setup (Docker, ports, snapshots, MCP config).

### `sow mcp`

Configure MCP server for coding agents.

| Flag | Description |
|------|-------------|
| `--agent` | Target agent: claude-code, cursor, windsurf, codex |
| `--setup` | Interactive detection and configuration |
| `--local` | Use local binary path (for development) |

```bash
sow mcp --agent claude-code          # Print config snippet
sow mcp --agent cursor --local       # Local dev config
sow mcp --setup                      # Interactive setup
```

## Configuration Priority

When both CLI flags and `.sow.yml` are present:

1. CLI flags (highest priority)
2. `.sow.yml` values
3. Environment variables (`DATABASE_URL`)
4. Built-in defaults (lowest priority)

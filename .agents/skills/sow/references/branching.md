# Branch Lifecycle

## Overview

A sow branch is a fully isolated Postgres database running in a Docker container. Each branch is created from a connector snapshot and can be independently modified, saved, diffed, and destroyed.

## State Machine

```
                    create
  (no branch) ──────────────► creating
                                 │
                                 ▼
                              running ◄───── start
                               │ │ │            ▲
                          save │ │ │ stop        │
                               │ │ └──────► stopped
                               │ │
                         diff  │ │ reset (destroys + recreates)
                               │ └──────► creating ──► running
                               │
                         delete│
                               ▼
                           (removed)
```

### States

| State | Description |
|-------|-------------|
| `creating` | Container being provisioned and initialized |
| `running` | Container healthy and accepting connections |
| `stopped` | Container paused, data preserved |
| `error` | Container not found or unhealthy |

## Creating Branches

```bash
sow branch create <name> [--connector <c>] [--port <p>] [--pg-version <v>]
```

What happens:
1. Resolve the connector (auto-selects if only one exists)
2. Find a free port in the 54320-54399 range
3. Start a Docker container with `postgres:<version>-alpine`
4. Load the connector's `init.sql` snapshot into the container
5. Wait for Postgres to be ready (~3-5 seconds)
6. Return the connection string

## Port Assignment

sow uses ports **54320-54399** (80 ports total). Ports are auto-assigned by probing for the first free port in the range. You can override with `--port`.

Port allocation is per-machine. Multiple users on the same machine share the port range.

## Docker Container Naming

Containers follow the pattern: `sow-<connector>-<branch>`

Example: `sow-mydb-my-feature`

This naming convention allows:
- Easy identification in `docker ps`
- Cleanup via `docker rm` pattern matching
- No conflicts between connectors

## Credentials

All branches use the same credentials:
- **User**: `sow`
- **Password**: `sow`
- **Database**: `sow`

This is intentional: test data doesn't need security.

## Connection String Format

```
postgresql://sow:sow@localhost:<port>/sow
```

## Save / Load

Save and load are named snapshots of the branch's current state, stored as SQL dumps.

```bash
# Save current state
sow branch save my-feature after-migration

# Make changes...

# Go back to saved state
sow branch load my-feature after-migration
```

### How They Work

1. `save` runs `pg_dump` against the branch container
2. The SQL dump is saved to `~/.sow/snapshots/<connector>/checkpoints/<branch>-<name>.sql`
3. `load` drops all tables and replays the saved SQL

### Storage

Checkpoint files are typically small (same order as the snapshot). They are deleted when the branch is deleted.

## Reset

`sow branch reset <name>` destroys the container and recreates it from the original snapshot. It's equivalent to delete + create with the same port and version.

Reset takes ~1 second because the snapshot is small (typically < 5MB).

## Diff

`sow branch diff <name>` compares the current branch state against the connector's metadata:

- **Row counts**: Added, deleted, modified rows per table
- **Schema changes**: New tables, removed tables, column modifications

The diff is computed by querying the branch database and comparing against the stored metadata from when the connector was created.

## Concurrent Branches

Multiple branches can run simultaneously from the same connector. Each gets its own Docker container and port. They are fully isolated from each other.

```bash
sow branch create feature-a    # port 54320
sow branch create feature-b    # port 54321
sow branch create tests        # port 54322
```

All three can be used concurrently by different processes, agents, or test suites.

## Exec (SQL Execution)

`sow branch exec` runs arbitrary SQL against a branch to set up specific test scenarios:

```bash
sow branch exec my-feature --sql "UPDATE users SET plan = 'expired' WHERE id = 1"
sow branch exec my-feature --file ./test-scenario.sql
```

Combine with save/load for iterative testing:
1. Exec the scenario SQL
2. Run tests
3. Reset or load saved state
4. Exec a different scenario

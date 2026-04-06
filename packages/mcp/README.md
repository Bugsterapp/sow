# @sowdb/mcp

MCP (Model Context Protocol) server for [sow](https://github.com/Bugsterapp/sow). Gives AI coding agents 22 tools to manage sanitized Postgres sandboxes built from your production database.

Pair this with [@sowdb/cli](https://www.npmjs.com/package/@sowdb/cli) for the full safe-sandbox workflow.

## Install

```bash
npm install -g @sowdb/mcp
```

## Configure for your agent

```bash
# Auto-configure for your agent
sow mcp --agent cursor
sow mcp --agent claude-code
sow mcp --agent windsurf
sow mcp --agent codex
```

Or add manually to your agent's MCP config:

```json
{
  "mcpServers": {
    "sow": {
      "command": "sow-mcp"
    }
  }
}
```

## Available tools (22)

### Flagship

| Tool | Description |
|------|-------------|
| `sow_sandbox` | Zero-config flow: detect the source database, create a sanitized snapshot (or reuse one), and spin up a local sandbox branch. One call, full sandbox. |

### Detection & connection

| Tool | Description |
|------|-------------|
| `sow_detect` | Scan a project for Postgres connections in `.env`, Prisma, Drizzle, Knex, TypeORM, Sequelize, Docker Compose |
| `sow_connect` | Create a sanitized snapshot from a source database (analyze + sample + scrub PII) |
| `sow_analyze` | Analyze a Postgres database schema, stats, and PII without creating a snapshot |

### Connectors (named snapshots)

| Tool | Description |
|------|-------------|
| `sow_connector_list` | List saved connectors |
| `sow_connector_delete` | Delete a connector and its snapshot |
| `sow_connector_refresh` | Re-sample the source to refresh a connector's snapshot |

### Branches (isolated sandbox databases)

| Tool | Description |
|------|-------------|
| `sow_branch_create` | Create an isolated Postgres branch from a connector snapshot |
| `sow_branch_list` | List all branches |
| `sow_branch_info` | Get a branch's connection string, port, status |
| `sow_branch_delete` | Delete a branch |
| `sow_branch_reset` | Reset a branch to its seed state in under 1s |
| `sow_branch_diff` | Show what changed since branch creation |
| `sow_branch_exec` | Run SQL against a branch |
| `sow_branch_sample` | Show sample rows from a table in a branch |
| `sow_branch_tables` | List tables with row counts in a branch |
| `sow_branch_users` | List test accounts (auth users) in a branch |
| `sow_branch_env` | Get environment variables (`DATABASE_URL`, etc.) for a branch |
| `sow_branch_stop` | Stop a branch container (keep the data) |
| `sow_branch_start` | Start a stopped branch |
| `sow_branch_save` | Save a named checkpoint of a branch's current state |
| `sow_branch_load` | Restore a branch to a saved checkpoint |

Every tool returns structured JSON. Agents drive the full sample → branch → exec → diff → reset loop without a human in the middle.

## License

[MIT](https://github.com/Bugsterapp/sow/blob/main/LICENSE)

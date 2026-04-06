# @sowdb/cli

**Safe test databases from production Postgres.**

sow connects to your production Postgres, samples representative data with edge cases, replaces all PII with realistic fakes, and gives you isolated database branches that start in seconds. 100% local, zero API calls, zero cost.

## Install

```bash
npm install -g @sowdb/cli
```

## Quick Start

```bash
# Auto-detect your database connection
sow connect

# Or pass a URL directly
sow connect postgresql://user:pass@host:5432/mydb

# Create an isolated branch
sow branch create my-feature
# -> DATABASE_URL=postgresql://sow:sow@localhost:54320/sow

# Use it
DATABASE_URL=postgresql://sow:sow@localhost:54320/sow npm run dev

# See what changed
sow branch diff my-feature

# Clean up
sow branch delete my-feature
```

## Features

- **Auto-detect** -- Scans .env files, Prisma, Drizzle, Knex, TypeORM, Sequelize, Docker Compose
- **PII safe** -- Detects and replaces emails, phones, names, addresses, SSNs, credit cards, IPs
- **Provider-based** -- Docker (standalone Postgres) or local Supabase (auto-detected)
- **Checkpoints** -- Save/load branch state instantly
- **Diff** -- See exactly what changed: rows added, deleted, modified, schema changes
- **Deterministic** -- Same seed = identical output every time

## For AI Agents

Install the MCP server for direct agent integration:

```bash
npm install -g @sowdb/cli-mcp
sow mcp --agent cursor
```

## Documentation

Run `sow --help` for full command reference.

## License

[MIT](https://github.com/Bugsterapp/sow/blob/main/LICENSE)

<div align="center">

```
  ███████╗ ██████╗ ██╗    ██╗
  ██╔════╝██╔═══██╗██║    ██║
  ███████╗██║   ██║██║ █╗ ██║
  ╚════██║██║   ██║██║███╗██║
  ███████║╚██████╔╝╚███╔███╔╝
  ╚══════╝ ╚═════╝  ╚══╝╚══╝
```

**Safe test databases from production Postgres.**

[![GitHub stars](https://img.shields.io/github/stars/Bugsterapp/sow)](https://github.com/Bugsterapp/sow)
[![npm version](https://img.shields.io/npm/v/@sowdb/cli)](https://www.npmjs.com/package/@sowdb/cli)
[![CI](https://img.shields.io/github/actions/workflow/status/Bugsterapp/sow/ci.yml)](https://github.com/Bugsterapp/sow/actions)
[![License: MIT](https://img.shields.io/github/license/Bugsterapp/sow)](LICENSE)

[Join the sow Cloud waitlist →](https://tally.so/r/0QvzZN)

</div>

sow connects to your production Postgres, samples representative data with edge cases, replaces all PII with realistic fakes, and gives you isolated database branches that start in seconds. 100% local, zero API calls, zero cost.

## Install & First Use

```bash
npm install -g @sowdb/cli
sow connect postgresql://user:pass@host:5432/mydb
sow branch create my-feature
# -> postgresql://sow:sow@localhost:54320/sow
```

## Why sow?

- **PII Safe** — All personal data is detected and replaced with realistic fakes.
- **Agent-First** — MCP server, `--json` mode, SKILL.md for agent context.
- **Fast** — First snapshot in 30-60s. Branches in ~5s. Resets in ~1s.
- **Checkpoints** — Save and restore branch state instantly.
- **Diff** — See exactly what changed: rows added, deleted, modified, schema changes.
- **Deterministic** — Same seed produces identical output every time.
- **Read-Only** — sow never writes to your source database.
- **Auto-Detect** — Scans .env files, Prisma, Drizzle, Knex, TypeORM, Sequelize, Docker Compose.

## Quick Start

```bash
sow connect postgresql://user:pass@host:5432/mydb   # analyze, sample, sanitize
sow branch create my-feature                         # isolated Postgres in ~5s
DATABASE_URL=postgresql://sow:sow@localhost:54320/sow npm run dev
sow branch diff my-feature                           # see what changed
sow branch delete my-feature                         # clean up
```

## For AI Agents

```bash
npm install -g @sowdb/mcp
sow mcp --agent cursor          # or claude-code, windsurf, codex
```

Or add manually to your MCP config:

```json
{
  "mcpServers": {
    "sow": { "command": "sow-mcp" }
  }
}
```

Install the agent skill for context:

```bash
npx skills add Bugsterapp/sow
```

## How It Works

```
Production DB          sow Pipeline              Local Branches

 ┌──────────┐     ┌──────────────────────┐     ┌──────────────┐
 │ Schema   │     │  1. Analyze          │     │ Branch A     │
 │ Stats    │────>│  2. Sample (N rows)  │────>│  :54320      │
 │ Data     │     │  3. Sanitize PII     │     │              │
 │ (read    │     │  4. Save snapshot    │     │ Branch B     │
 │  only)   │     │     (~2 MB)          │     │  :54321      │
 └──────────┘     └──────────────────────┘     └──────────────┘
                                                Provider-managed
```

## sow Cloud — coming soon

sow CLI is free, open source, and works 100% locally. Always will be.

sow Cloud is for teams: shared connectors, CI/CD without Docker-in-Docker, compliance (data never touches dev laptops), and a team dashboard.

[Join the waitlist →](https://tally.so/r/0QvzZN)

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). Run `sow --help` for the full command reference.

## License

[MIT](LICENSE)

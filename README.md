<div align="center">

```
  ███████╗ ██████╗ ██╗    ██╗
  ██╔════╝██╔═══██╗██║    ██║
  ███████╗██║   ██║██║ █╗ ██║
  ╚════██║██║   ██║██║███╗██║
  ███████║╚██████╔╝╚███╔███╔╝
  ╚══════╝ ╚═════╝  ╚══╝╚══╝
```

**Stop letting Claude touch your prod database.**

[![GitHub stars](https://img.shields.io/github/stars/Bugsterapp/sow)](https://github.com/Bugsterapp/sow)
[![npm version](https://img.shields.io/npm/v/@sowdb/cli)](https://www.npmjs.com/package/@sowdb/cli)
[![CI](https://img.shields.io/github/actions/workflow/status/Bugsterapp/sow/ci.yml)](https://github.com/Bugsterapp/sow/actions)
[![License: MIT](https://img.shields.io/github/license/Bugsterapp/sow)](LICENSE)

[Join the sow Cloud waitlist →](https://tally.so/r/0QvzZN)

</div>

You're using Claude Code or Cursor against a real codebase with a real database. Every time the agent is about to do something database-adjacent, you feel that quiet pang of "wait, should I let it do that?"

sow is the safety layer. One command points it at your prod Postgres, samples the data, scrubs every PII column with realistic fakes, and gives your coding agent a sandboxed local copy to hammer. Prod never gets touched. The sandbox runs in seconds, resets in under one. 100% local. Zero API calls. Zero cost. Never writes to your source database.

## Install & First Use

```bash
npm install -g @sowdb/cli
cd your-project
sow sandbox
```

`sow sandbox` auto-detects your database from your project's env files, samples it, sanitizes PII, and patches `.env.local` with a safe `DATABASE_URL`. Now any coding agent on your laptop talks to the sandbox instead of prod.

## Why sow

- **Built for coding agents.** MCP server with 22 tools, `--json` mode for every command, `SKILL.md` for agent context, deterministic seeds so bugs reproduce across sessions.
- **PII-safe by default.** Detects emails, phones, names, addresses, SSNs, JSONB-embedded fields. Fail-closed: aborts if it sees a Postgres type it can't verify, with `--allow-unsafe` to override explicitly.
- **Reset in under 1 second.** Postgres template-database backed. Your agent can try a destructive change, verify the result, reset, try again — 50 iterations in a minute.
- **Zero config.** Auto-detects env files, Prisma, Drizzle, Knex, TypeORM, Sequelize, Docker Compose. Identifies Supabase, Neon, Vercel Postgres, and Railway projects.
- **Read-only on the source.** sow never writes to your production database. Parameterized queries, identifier escaping, and a security-audited code path verified by both Claude and Codex adversarial review.
- **100% local.** No cloud round-trip, no third party holding your sanitized data, no account, no API key. The sandbox lives on your laptop.

## Quick Start

```bash
# Zero-config: detect your DB, sample, sanitize, patch .env.local
sow sandbox

# Or do it explicitly
sow connect postgresql://user:pass@host:5432/mydb   # analyze, sample, sanitize
sow branch create my-feature                         # isolated Postgres in ~5s
DATABASE_URL=postgresql://sow:sow@localhost:54320/sow npm run dev
sow branch reset my-feature                          # back to seed state in <1s
sow branch diff my-feature                           # see what your agent changed
sow branch delete my-feature                         # clean up
```

## For AI Agents

```bash
npm install -g @sowdb/mcp
sow mcp --agent claude-code          # or cursor, windsurf, codex
```

Or add to your MCP config manually:

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

The MCP server exposes 22 tools: `sow_sandbox`, `sow_connect`, `sow_detect`, `sow_branch_create`, `sow_branch_reset`, `sow_branch_diff`, `sow_branch_save`, `sow_branch_load`, `sow_branch_exec`, `sow_branch_users`, `sow_branch_tables`, `sow_branch_sample`, and more. Every tool returns structured JSON. Agents drive the full sample → branch → exec → diff → reset loop without a human in the middle.

## How It Works

```
Production DB          sow Pipeline              Local Sandbox

 ┌──────────┐     ┌──────────────────────┐     ┌──────────────┐
 │ Schema   │     │  1. Analyze          │     │ Branch A     │
 │ Stats    │────>│  2. Sample (N rows)  │────>│  :54320/A    │
 │ Data     │     │  3. Sanitize PII     │     │              │
 │ (read    │     │  4. Save snapshot    │     │ Branch B     │
 │  only)   │     │     (~2 MB)          │     │  :54320/B    │
 └──────────┘     └──────────────────────┘     │              │
                                                │ Branch C     │
                                                │  :54320/C    │
                                                └──────────────┘
                                                 One container
                                                 per connector,
                                                 N branch DBs,
                                                 reset in <1s.
```

## Cookbook

Three workflows that show the full agent loop. See [`docs/cookbook.md`](docs/cookbook.md) for the prompts and full walkthrough.

1. **Let Claude refactor your schema without fear** — `sow sandbox`, then ask Claude to add a column, drop an index, rename a table. Verify, reset, try a different approach.
2. **Let Cursor generate seed data for a new feature** — point your agent at the sandbox and ask for "100 realistic users with orders." Inspect with `sow branch sample`. Reset and ask for a different distribution.
3. **Let your coding agent debug a failing migration** — replay your last migration on the sandbox. If it fails, reset and try a fix. No prod risk.

## Documentation

- [`docs/sandbox.md`](docs/sandbox.md) — the `sow sandbox` flagship command, flags, and `.env.local` patching with backup/revert
- [`docs/sanitization.md`](docs/sanitization.md) — what sow sanitizes, the fail-closed gate, JSONB handling, and the `--allow-unsafe` flag
- [`docs/cookbook.md`](docs/cookbook.md) — three end-to-end workflows for coding agents
- [`CHANGELOG.md`](CHANGELOG.md) — release history
- [`CONTRIBUTING.md`](CONTRIBUTING.md) — building from source, running tests, the lane structure

## sow Cloud — coming soon

sow CLI is free, open source, and works 100% locally. Always will be.

sow Cloud is for teams: shared connectors, CI/CD without Docker-in-Docker, compliance (sanitized data never touches dev laptops), and a team dashboard.

[Join the waitlist →](https://tally.so/r/0QvzZN)

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). Run `sow --help` for the full command reference.

## License

[MIT](LICENSE)

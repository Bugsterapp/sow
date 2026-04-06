# @sowdb/cli

**Stop letting Claude touch your prod database.**

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

- **Built for coding agents.** MCP server with 22 tools, `--json` mode for every command, deterministic seeds so bugs reproduce across sessions.
- **PII-safe by default.** Detects emails, phones, names, addresses, SSNs, JSONB-embedded fields. Fail-closed: aborts if it sees a Postgres type it can't verify, with `--allow-unsafe` to override explicitly.
- **Reset in under 1 second.** Postgres template-database backed. Your agent can try a destructive change, verify the result, reset, try again — 50 iterations in a minute.
- **Zero config.** Auto-detects env files, Prisma, Drizzle, Knex, TypeORM, Sequelize, Docker Compose. Identifies Supabase, Neon, Vercel Postgres, and Railway projects.
- **Read-only on the source.** sow never writes to your production database. Parameterized queries, identifier escaping, and a security-audited code path.
- **100% local.** No cloud round-trip, no third party holding your sanitized data, no account, no API key.

## Quick Start

```bash
# Zero-config: detect your DB, sample, sanitize, patch .env.local
sow sandbox

# Or do it explicitly
sow connect postgresql://user:pass@host:5432/mydb   # analyze, sample, sanitize
sow branch create my-feature                         # isolated Postgres in ~5s
DATABASE_URL=postgresql://sow:sow@localhost:54320/sow_my_feature npm run dev
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

The MCP server exposes 22 tools covering the full sample → branch → exec → diff → reset loop. See [@sowdb/mcp](https://www.npmjs.com/package/@sowdb/mcp) for the tool list.

## Documentation

Full docs, cookbook, and sanitization details: [github.com/Bugsterapp/sow](https://github.com/Bugsterapp/sow)

Run `sow --help` for the full command reference.

## License

[MIT](https://github.com/Bugsterapp/sow/blob/main/LICENSE)

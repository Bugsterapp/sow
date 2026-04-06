import meow from "meow";

const LOGO = `
  ███████╗ ██████╗ ██╗    ██╗
  ██╔════╝██╔═══██╗██║    ██║
  ███████╗██║   ██║██║ █╗ ██║
  ╚════██║██║   ██║██║███╗██║
  ███████║╚██████╔╝╚███╔███╔╝
  ╚══════╝ ╚═════╝  ╚══╝╚══╝ 
`;

const cli = meow(
  `
Usage: sow [options] [command]

sow — safe test databases for developers and agents

Options:
  -v, --version                 Output the current version
  -m, --max-rows <n>            Max rows per table (default: 200)
  -s, --seed <n>                Reproducibility seed (default: 42)
  --exclude <tables>            Comma-separated tables to exclude
  --full                        Copy all rows (no sampling, slower but complete)
    --no-sanitize                 Skip PII sanitization
  --allow-unsafe                NULL out columns with unknown Postgres types
                                instead of aborting (default: abort)
  -c, --config <path>           Path to .sow.yml config file
  --json                        Output as JSON events (for agents)
  -q, --quiet                   Minimal output, no spinners
  -t, --tables <tables>         Specific tables to analyze
  --name <name>                 Name for connector (default: database name)
  --connector <name>            Connector to use when creating a branch
  --port <n>                    Specific port for branch (default: auto)
  --pg-version <ver>            Postgres version for branch (default: 16)
  --sql <sql>                   SQL to execute (for branch exec)
  --file <path>                 Path to SQL file (for branch exec)
  --export                      Output 'export SOW_URL=...' (branch create)
  --env-file <path>             Write DATABASE_URL to this file
  --no-env-file                 Skip env file patching (sandbox)
  -y, --yes                     Skip interactive confirmation prompts
  --append                      Deprecated; --env-file now always merges
  --agent <name>                Agent to configure MCP for
  --setup                       Interactive MCP setup
  --local                       Use local binary path for MCP config
  -h, --help                    Show help

Commands:
  sandbox [url]                 Zero-config: detect DB, sample, branch, patch .env.local
  connect [url]                 Connect to production DB and create a snapshot
  branch create <name>          Create an isolated database branch
  branch list                   List all branches
  branch info <name>            Show branch details
  branch delete <name>          Delete a branch
  branch diff <name>            Show changes since branch creation
  branch reset <name>           Reset branch to original snapshot
  branch save <name> <cp>       Save state as a named checkpoint
  branch load <name> <cp>       Restore branch to a saved checkpoint
  branch exec <name>            Run SQL against a branch (--sql or --file)
  branch stop <name>            Stop a branch (keep container)
    branch start <name>           Start a stopped branch
    branch env <name>             Show env vars for a branch
    branch users <name>           List test accounts in a branch
    branch tables <name>          List tables with row counts
    branch sample <name> <table>  Show sample rows from a table
    branch run <name> -- <cmd>    Run a command with branch env vars
    connector list                List saved connectors
  connector delete <name>       Delete a connector and its snapshot
  connector refresh <name>      Re-create snapshot with fresh data
  analyze <url>                 Analyze database schema, stats, and PII
  doctor                        Check setup and diagnose issues
  mcp                           Configure MCP server for coding agents
  env revert [path]             Restore .env.local from a sow backup

Examples:

- Zero-config sandbox (detects your DB, patches .env.local)

  $ sow sandbox

- Auto-detect and connect (reads .env, Prisma, Docker Compose, etc.)

  $ sow connect

- Connect with an explicit URL

  $ sow connect postgresql://user:pass@localhost:5432/mydb

- Create a branch for development

  $ sow branch create my-feature

- List all branches

  $ sow branch list

- Check your setup

  $ sow doctor
`,
  {
    importMeta: import.meta,
    autoVersion: false,
    flags: {
      version: { type: "boolean", shortFlag: "v", default: false },
      maxRows: { type: "number", shortFlag: "m", default: 200 },
      seed: { type: "number", shortFlag: "s", default: 42 },
      exclude: { type: "string" },
      full: { type: "boolean", default: false },
      noSanitize: { type: "boolean", default: false },
      allowUnsafe: { type: "boolean", default: false },
      config: { type: "string", shortFlag: "c" },
      json: { type: "boolean", default: false },
      quiet: { type: "boolean", shortFlag: "q", default: false },
      tables: { type: "string", shortFlag: "t" },
      name: { type: "string" },
      connector: { type: "string" },
      port: { type: "number" },
      pgVersion: { type: "string" },
      sql: { type: "string" },
      file: { type: "string" },
      export: { type: "boolean", default: false },
      envFile: { type: "string" },
      noEnvFile: { type: "boolean", default: false },
      yes: { type: "boolean", shortFlag: "y", default: false },
      append: { type: "boolean", default: false },
      agent: { type: "string" },
      setup: { type: "boolean", default: false },
      local: { type: "boolean", default: false },
      limit: { type: "number" },
    },
  },
);

// Handle `--` separator for `sow branch run <name> -- <command...>`
const rawArgs = process.argv.slice(2);
const doubleDashIdx = rawArgs.indexOf("--");
let runArgs: string[] | undefined;
if (doubleDashIdx >= 0) {
  runArgs = rawArgs.slice(doubleDashIdx + 1);
}

const [command, ...rest] = cli.input;
const flags = cli.flags as Record<string, unknown>;

if (flags.version) {
  console.log(cli.pkg.version);
  process.exit(0);
}

if (!command) {
  console.log(LOGO);
  cli.showHelp(0);
} else {
  let subcommand: string | undefined;
  let connectionString: string | undefined;
  let branchName: string | undefined;

  if (command === "branch" || command === "connector" || command === "env") {
    subcommand = rest[0];
    branchName = rest[1];
    if (rest[2]) {
      flags._extraArg = rest[2];
    }
    if (runArgs) {
      flags._runArgs = runArgs;
    }
    if (!subcommand) {
      cli.showHelp(0);
    }
  } else {
    connectionString = rest[0];
  }

  const { runCommand } = await import("./commands/runner.js");
  await runCommand(command, connectionString, flags, subcommand, branchName);
}

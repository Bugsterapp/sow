import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import {
  PostgresAdapter,
  analyze,
  createConnector,
  listConnectors,
  deleteConnector,
  refreshConnector,
  createBranch,
  listBranches,
  getBranchInfo,
  deleteBranch,
  stopBranch,
  startBranch,
  getDiff,
  resetBranch,
  saveBranch,
  loadBranch,
  execBranch,
  getBranchEnv,
  getBranchUsers,
  getBranchTables,
  getBranchSample,
  detectConnection,
} from "@sowdb/core";

const server = new McpServer({
  name: "sow",
  version: "0.1.0",
});

type ZodShape = Record<string, z.ZodTypeAny>;

function defineTool<S extends ZodShape>(
  name: string,
  description: string,
  schema: S,
  handler: (args: z.objectOutputType<S, z.ZodTypeAny>) => Promise<unknown>,
) {
  const wrappedHandler = async (args: z.objectOutputType<S, z.ZodTypeAny>) => {
    try {
      const result = await handler(args);
      return {
        content: [
          { type: "text" as const, text: JSON.stringify(result, null, 2) },
        ],
      };
    } catch (err) {
      return {
        content: [
          {
            type: "text" as const,
            text: `Error: ${err instanceof Error ? err.message : String(err)}`,
          },
        ],
        isError: true,
      };
    }
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  server.tool(name, description, schema, wrappedHandler as any);
}

defineTool(
  "sow_analyze",
  "Analyze a Postgres database schema, data patterns, and PII. Returns table info, row counts, detected PII columns, and edge cases.",
  {
    connectionString: z
      .string()
      .describe("Postgres connection string (postgresql://user:pass@host:port/db)"),
    tables: z
      .array(z.string())
      .optional()
      .describe("Optional: specific tables to analyze"),
  },
  async ({ connectionString, tables }) => {
    const adapter = new PostgresAdapter();
    try {
      await adapter.connect(connectionString);
      return await analyze(adapter, { tables });
    } finally {
      await adapter.disconnect();
    }
  },
);

defineTool(
  "sow_detect",
  "Scan the current project to find PostgreSQL connection strings. Checks environment variables, .env files, Prisma schema, Drizzle config, Knex config, Docker Compose, and package.json dependencies. Returns all found connections with confidence levels. Use this before sow_connect to discover the connection string.",
  {
    projectRoot: z
      .string()
      .optional()
      .describe("Path to the project root. Defaults to current working directory."),
  },
  async ({ projectRoot }) => {
    return detectConnection(projectRoot || process.cwd());
  },
);

defineTool(
  "sow_connect",
  "Connect to a production Postgres database, analyze it, sample representative data, sanitize PII, and save a local snapshot. This is required before creating branches. Only reads from production, never writes. Use full=true to copy ALL rows instead of sampling.",
  {
    connectionString: z
      .string()
      .describe("Postgres connection string (postgresql://user:pass@host:port/db)"),
    name: z
      .string()
      .optional()
      .describe("Name for this connector (default: database name)"),
    maxRowsPerTable: z
      .number()
      .optional()
      .describe("Max rows to sample per table (default: 200, ignored if full=true)"),
    full: z
      .boolean()
      .optional()
      .describe("Copy all rows instead of sampling (slower but no missing data)"),
  },
  async ({ connectionString, name, maxRowsPerTable, full }) => {
    const result = await createConnector(connectionString, {
      name,
      maxRowsPerTable,
      full,
    });
    return {
      success: true,
      connector: result.name,
      tables: result.tables,
      rows: result.rows,
      piiColumnsDetected: result.piiColumnsDetected,
      sizeBytes: result.sizeBytes,
      message: `Snapshot saved. Create branches with: sow_branch_create`,
    };
  },
);

defineTool(
  "sow_connector_list",
  "List all saved database connectors (production DB snapshots). Each connector can be used to create branches.",
  {},
  async () => listConnectors(),
);

defineTool(
  "sow_branch_create",
  "Create an isolated test database branch with sanitized production-like data. Returns a connection string you can use immediately to read/write/test without affecting production. The branch runs as a local Docker container.",
  {
    name: z
      .string()
      .describe("Branch name (e.g., 'my-feature', 'migration-test')"),
    connector: z
      .string()
      .optional()
      .describe(
        "Connector name (the production DB snapshot to branch from). Use sow_connector_list to see available connectors.",
      ),
  },
  async ({ name, connector }) => {
    const branch = await createBranch(name, connector);
    return {
      name: branch.name,
      url: branch.connectionString,
      port: branch.port,
      status: branch.status,
      connector: branch.connector,
    };
  },
);

defineTool(
  "sow_branch_list",
  "List all active database branches with their connection strings and status.",
  {},
  async () => {
    const branches = await listBranches();
    return branches.map((b) => ({
      name: b.name,
      connector: b.connector,
      url: b.connectionString,
      port: b.port,
      status: b.status,
      createdAt: b.createdAt,
    }));
  },
);

defineTool(
  "sow_branch_delete",
  "Delete a database branch. This stops and removes the Docker container.",
  {
    name: z.string().describe("Branch name to delete"),
  },
  async ({ name }) => {
    await deleteBranch(name);
    return { deleted: name, success: true };
  },
);

defineTool(
  "sow_branch_diff",
  "Show what changed in a branch since it was created. Useful to verify what a coding agent modified.",
  {
    name: z.string().describe("Branch name to diff"),
  },
  async ({ name }) => getDiff(name),
);

defineTool(
  "sow_branch_reset",
  "Reset a branch to its original state, discarding all changes. Like git reset --hard.",
  {
    name: z.string().describe("Branch name to reset"),
  },
  async ({ name }) => {
    const branch = await resetBranch(name);
    return {
      name: branch.name,
      url: branch.connectionString,
      status: branch.status,
      message: "Branch reset to original snapshot",
    };
  },
);

defineTool(
  "sow_branch_info",
  "Get details about a database branch including its connection string, status, port, and connector.",
  {
    name: z.string().describe("Branch name"),
  },
  async ({ name }) => {
    const branch = await getBranchInfo(name);
    return {
      name: branch.name,
      url: branch.connectionString,
      port: branch.port,
      status: branch.status,
      connector: branch.connector,
      provider: branch.provider,
      createdAt: branch.createdAt,
    };
  },
);

defineTool(
  "sow_branch_stop",
  "Stop a running database branch to save resources. The container is preserved and can be restarted later.",
  {
    name: z.string().describe("Branch name to stop"),
  },
  async ({ name }) => {
    await stopBranch(name);
    return { stopped: name, success: true };
  },
);

defineTool(
  "sow_branch_start",
  "Start a previously stopped database branch. Returns the connection string.",
  {
    name: z.string().describe("Branch name to start"),
  },
  async ({ name }) => {
    const branch = await startBranch(name);
    return {
      name: branch.name,
      url: branch.connectionString,
      status: branch.status,
    };
  },
);

defineTool(
  "sow_branch_save",
  "Save the current state of a branch as a named checkpoint. You can load this checkpoint later if changes break things. Like git commit for databases.",
  {
    branch: z.string().describe("Branch name"),
    name: z
      .string()
      .describe("Checkpoint name (e.g., 'after-migration', 'before-test')"),
  },
  async ({ branch, name }) => {
    const cp = await saveBranch(branch, name);
    return {
      success: true,
      checkpoint: cp.name,
      sizeBytes: cp.sizeBytes,
      message: `Checkpoint '${name}' saved. Load with sow_branch_load.`,
    };
  },
);

defineTool(
  "sow_branch_load",
  "Load a previously saved checkpoint into a branch, discarding all changes made after that checkpoint.",
  {
    branch: z.string().describe("Branch name"),
    checkpoint: z.string().describe("Checkpoint name to load"),
  },
  async ({ branch, checkpoint }) => {
    await loadBranch(branch, checkpoint);
    return {
      success: true,
      branch,
      loaded: checkpoint,
      message: `Loaded checkpoint '${checkpoint}'`,
    };
  },
);

defineTool(
  "sow_branch_exec",
  "Run SQL against a branch to set up specific test scenarios. Use this to create the exact data state needed for your test.",
  {
    branch: z.string().describe("Branch name"),
    sql: z
      .string()
      .describe("SQL to execute (INSERT, UPDATE, CREATE TABLE, etc.)"),
  },
  async ({ branch, sql }) => {
    const output = await execBranch(branch, sql);
    return { success: true, branch, output: output.trim() };
  },
);

defineTool(
  "sow_connector_delete",
  "Delete a saved connector and its snapshot. Fails if any branches still reference this connector.",
  {
    name: z.string().describe("Connector name to delete"),
  },
  async ({ name }) => {
    await deleteConnector(name);
    return { deleted: name, success: true };
  },
);

defineTool(
  "sow_connector_refresh",
  "Re-create a connector's snapshot with fresh data from the original production database.",
  {
    name: z.string().describe("Connector name to refresh"),
  },
  async ({ name }) => {
    const result = await refreshConnector(name);
    return {
      success: true,
      connector: result.name,
      tables: result.tables,
      rows: result.rows,
      piiColumnsDetected: result.piiColumnsDetected,
    };
  },
);

defineTool(
  "sow_branch_env",
  "Get environment variables for a branch. Returns DATABASE_URL and (for Supabase branches) SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, etc. Use these to configure an app to run against the branch.",
  {
    branch: z.string().describe("Branch name"),
  },
  async ({ branch }) => getBranchEnv(branch),
);

defineTool(
  "sow_branch_users",
  "List test accounts available in a branch. All accounts share the same password. Use these to log into the app during testing.",
  {
    branch: z.string().describe("Branch name"),
  },
  async ({ branch }) => getBranchUsers(branch),
);

defineTool(
  "sow_branch_tables",
  "List all tables in a branch with row counts. Useful to understand what data is available before querying.",
  {
    branch: z.string().describe("Branch name"),
  },
  async ({ branch }) => getBranchTables(branch),
);

defineTool(
  "sow_branch_sample",
  "Get sample rows from a table in a branch. Returns actual row data as JSON. Use to understand the schema and data shape.",
  {
    branch: z.string().describe("Branch name"),
    table: z.string().describe("Table name to sample"),
    limit: z
      .number()
      .optional()
      .describe("Max rows to return (default: 5, max: 100)"),
  },
  async ({ branch, table, limit }) => getBranchSample(branch, table, limit ?? 5),
);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  console.error("MCP server error:", err);
  process.exit(1);
});

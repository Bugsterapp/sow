import { existsSync, readFileSync, writeFileSync, mkdirSync, statSync } from "node:fs";
import { resolveProvider, getProvider } from "./provider-registry.js";
import {
  addBranch,
  getBranch,
  readBranches,
  removeBranch,
  updateBranch,
  getInitSqlPath,
  readConnectorMetadata,
  listConnectorNames,
  getCheckpointsDir,
  getCheckpointPath,
  listCheckpointFiles,
  deleteCheckpoints,
} from "./storage.js";
import { diffBranch } from "./diff.js";
import { loadProjectState } from "../config/loader.js";
import { quoteIdent } from "../sql/identifiers.js";
import type { Branch, BranchOptions, CheckpointInfo, DiffResult } from "./types.js";

function resolveConnector(connectorName?: string): string {
  if (connectorName) {
    if (!readConnectorMetadata(connectorName)) {
      throw new Error(
        `Connector '${connectorName}' not found. Run 'sow connector list' to see available connectors.`,
      );
    }
    return connectorName;
  }

  const projectState = loadProjectState();
  if (projectState.defaultConnector && readConnectorMetadata(projectState.defaultConnector)) {
    return projectState.defaultConnector;
  }

  const connectors = listConnectorNames();
  if (connectors.length === 0) {
    throw new Error(
      "No connectors found. Run 'sow connect <connection-string>' first.",
    );
  }
  if (connectors.length === 1) {
    return connectors[0];
  }
  throw new Error(
    `Multiple connectors found: ${connectors.join(", ")}. Specify one with --connector.`,
  );
}

export async function createBranch(
  name: string,
  connectorName?: string,
  opts: BranchOptions = {},
): Promise<Branch> {
  const connector = resolveConnector(connectorName);
  const initSqlPath = getInitSqlPath(connector);

  if (!existsSync(initSqlPath)) {
    throw new Error(
      `Snapshot not found for connector '${connector}'. Run 'sow connect' first.`,
    );
  }

  const existing = getBranch(name);
  if (existing) {
    throw new Error(
      `Branch '${name}' already exists. Delete it first or choose a different name.`,
    );
  }

  const { provider, detection } = await resolveProvider();

  const meta = readConnectorMetadata(connector);
  const authMappings = meta?.authUsers?.map((u) => ({
    id: u.id,
    email: u.sanitizedEmail,
  }));

  const branch: Branch = {
    name,
    connector,
    provider: provider.name,
    providerMeta: {},
    port: 0,
    status: "creating",
    createdAt: new Date().toISOString(),
    connectionString: "",
  };

  addBranch(branch);

  try {
    const result = await provider.createBranch({
      name,
      connector,
      initSqlPath,
      port: opts.port,
      pgVersion: opts.pgVersion,
      authMappings,
      detection,
    });

    branch.connectionString = result.connectionString;
    branch.port = result.port;
    branch.providerMeta = result.providerMeta;
    branch.status = "running";
    branch.testEmails = result.testEmails;

    updateBranch(name, {
      connectionString: result.connectionString,
      port: result.port,
      providerMeta: result.providerMeta,
      status: "running",
      testEmails: result.testEmails,
    });

    return branch;
  } catch (err) {
    updateBranch(name, { status: "error" });
    removeBranch(name);
    throw err;
  }
}

export async function listBranches(): Promise<Branch[]> {
  const branches = readBranches();

  for (const branch of branches) {
    try {
      const provider = getProvider(branch.provider);
      const actual = await provider.getBranchStatus(branch);
      if (actual !== branch.status) {
        updateBranch(branch.name, { status: actual });
        branch.status = actual;
      }
    } catch {
      // Provider not available (e.g. Docker not running)
    }
  }

  return branches;
}

export async function getBranchInfo(name: string): Promise<Branch> {
  const branch = getBranch(name);
  if (!branch) {
    throw new Error(`Branch '${name}' not found`);
  }

  try {
    const provider = getProvider(branch.provider);
    const actual = await provider.getBranchStatus(branch);
    if (actual !== branch.status) {
      updateBranch(name, { status: actual });
      branch.status = actual;
    }
  } catch {
    // Provider not available
  }

  return branch;
}

export async function deleteBranch(name: string): Promise<void> {
  const branch = getBranch(name);
  if (!branch) {
    throw new Error(`Branch '${name}' not found`);
  }

  const provider = getProvider(branch.provider);
  await provider.deleteBranch(branch);
  deleteCheckpoints(branch.connector, name);
  removeBranch(name);
}

export async function stopBranch(name: string): Promise<void> {
  const branch = getBranch(name);
  if (!branch) {
    throw new Error(`Branch '${name}' not found`);
  }
  if (branch.status === "stopped") {
    throw new Error(`Branch '${name}' is already stopped`);
  }

  const provider = getProvider(branch.provider);
  if (!provider.stopBranch) {
    throw new Error(`Provider '${branch.provider}' does not support stopping branches`);
  }
  await provider.stopBranch(branch);
  updateBranch(name, { status: "stopped" });
}

export async function startBranch(name: string): Promise<Branch> {
  const branch = getBranch(name);
  if (!branch) {
    throw new Error(`Branch '${name}' not found`);
  }
  if (branch.status === "running") {
    throw new Error(`Branch '${name}' is already running`);
  }

  const provider = getProvider(branch.provider);
  if (!provider.startBranch) {
    throw new Error(`Provider '${branch.provider}' does not support starting branches`);
  }
  await provider.startBranch(branch);
  updateBranch(name, { status: "running" });
  branch.status = "running";

  return branch;
}

export async function resetBranch(name: string): Promise<Branch> {
  const branch = getBranch(name);
  if (!branch) {
    throw new Error(`Branch '${name}' not found`);
  }

  const provider = getProvider(branch.provider);
  const initSqlPath = getInitSqlPath(branch.connector);

  await provider.resetBranch(branch, initSqlPath);

  if (provider.name === "docker") {
    // Docker reset = recreate container, so re-run full createBranch
    removeBranch(name);
    return createBranch(name, branch.connector, {
      port: branch.port,
      pgVersion: (branch.providerMeta as any).pgVersion,
    });
  }

  return branch;
}

export async function getDiff(name: string): Promise<DiffResult> {
  const branch = getBranch(name);
  if (!branch) {
    throw new Error(`Branch '${name}' not found`);
  }
  if (branch.status !== "running") {
    throw new Error(`Branch '${name}' is not running. Start it first.`);
  }

  return diffBranch(branch);
}

// ---------------------------------------------------------------------------
// Save / Load
// ---------------------------------------------------------------------------

export async function saveBranch(
  name: string,
  checkpointName: string,
): Promise<CheckpointInfo> {
  const branch = getBranch(name);
  if (!branch) {
    throw new Error(`Branch '${name}' not found`);
  }
  if (branch.status !== "running") {
    throw new Error(`Branch '${name}' is not running. Start it first.`);
  }

  const provider = getProvider(branch.provider);
  if (!provider.dumpBranch) {
    throw new Error(`Provider '${branch.provider}' does not support checkpoints`);
  }

  const sql = await provider.dumpBranch(branch);
  const checkpointPath = getCheckpointPath(branch.connector, name, checkpointName);
  mkdirSync(getCheckpointsDir(branch.connector), { recursive: true });
  writeFileSync(checkpointPath, sql, "utf-8");

  const stat = statSync(checkpointPath);
  return {
    name: checkpointName,
    createdAt: new Date().toISOString(),
    sizeBytes: stat.size,
  };
}

export async function loadBranch(
  name: string,
  checkpointName: string,
): Promise<void> {
  const branch = getBranch(name);
  if (!branch) {
    throw new Error(`Branch '${name}' not found`);
  }
  if (branch.status !== "running") {
    throw new Error(`Branch '${name}' is not running. Start it first.`);
  }

  const provider = getProvider(branch.provider);
  if (!provider.restoreDump) {
    throw new Error(`Provider '${branch.provider}' does not support checkpoint loading`);
  }

  const checkpointPath = getCheckpointPath(branch.connector, name, checkpointName);
  if (!existsSync(checkpointPath)) {
    const available = listCheckpointFiles(branch.connector, name);
    const hint = available.length > 0
      ? ` Available checkpoints: ${available.join(", ")}`
      : " No checkpoints exist for this branch.";
    throw new Error(`Checkpoint '${checkpointName}' not found for branch '${name}'.${hint}`);
  }

  const sql = readFileSync(checkpointPath, "utf-8");
  await provider.restoreDump(branch, sql);
}

export function listCheckpoints(name: string): CheckpointInfo[] {
  const branch = getBranch(name);
  if (!branch) {
    throw new Error(`Branch '${name}' not found`);
  }

  const names = listCheckpointFiles(branch.connector, name);
  return names.map((cpName) => {
    const cpPath = getCheckpointPath(branch.connector, name, cpName);
    const stat = statSync(cpPath);
    return {
      name: cpName,
      createdAt: stat.mtime.toISOString(),
      sizeBytes: stat.size,
    };
  });
}

// ---------------------------------------------------------------------------
// Exec — run arbitrary SQL against a branch
// ---------------------------------------------------------------------------

export async function execBranch(
  name: string,
  sqlStr: string,
): Promise<string> {
  const branch = getBranch(name);
  if (!branch) {
    throw new Error(`Branch '${name}' not found`);
  }
  if (branch.status !== "running") {
    throw new Error(`Branch '${name}' is not running. Start it first.`);
  }

  const provider = getProvider(branch.provider);
  return provider.execSQL(branch, sqlStr);
}

// ---------------------------------------------------------------------------
// Discovery — structured access to branch details for agents
// ---------------------------------------------------------------------------

export function getBranchEnv(name: string): Record<string, string> {
  const branch = getBranch(name);
  if (!branch) {
    throw new Error(`Branch '${name}' not found`);
  }

  const connStr = branch.connectionString;
  const asyncConnStr = connStr.replace(/^postgresql:\/\//, "postgresql+asyncpg://");

  const env: Record<string, string> = {
    DATABASE_URL: connStr,
    DATABASE_URL_ASYNC: asyncConnStr,
  };

  if (branch.provider === "supabase") {
    const meta = branch.providerMeta as {
      supabaseUrl?: string;
      publishableKey?: string;
    };
    if (meta.supabaseUrl) {
      env.SUPABASE_URL = meta.supabaseUrl;
      env.NEXT_PUBLIC_SUPABASE_URL = meta.supabaseUrl;
    }
    if (meta.publishableKey) {
      env.SUPABASE_PUBLISHABLE_KEY = meta.publishableKey;
      env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = meta.publishableKey;
    }
  }

  return env;
}

export interface BranchUsersResult {
  password: string;
  accounts: string[];
}

export async function getBranchUsers(name: string): Promise<BranchUsersResult> {
  const branch = getBranch(name);
  if (!branch) {
    throw new Error(`Branch '${name}' not found`);
  }

  if (branch.testEmails && branch.testEmails.length > 0) {
    return { password: "password123", accounts: branch.testEmails };
  }

  if (branch.status !== "running") {
    return { password: "password123", accounts: [] };
  }

  try {
    const provider = getProvider(branch.provider);
    const output = await provider.execSQL(
      branch,
      "SELECT DISTINCT email FROM (SELECT email FROM public.users WHERE email IS NOT NULL UNION ALL SELECT email FROM auth.users WHERE email IS NOT NULL) sub LIMIT 20",
    );
    const accounts = output
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l.includes("@") && !l.startsWith("-"));
    return { password: "password123", accounts };
  } catch {
    return { password: "password123", accounts: [] };
  }
}

export interface BranchTableInfo {
  table: string;
  rows: number;
}

export async function getBranchTables(name: string): Promise<BranchTableInfo[]> {
  const branch = getBranch(name);
  if (!branch) {
    throw new Error(`Branch '${name}' not found`);
  }
  if (branch.status !== "running") {
    throw new Error(`Branch '${name}' is not running. Start it first.`);
  }

  const provider = getProvider(branch.provider);
  const output = await provider.execSQL(
    branch,
    "SELECT schemaname || '.' || relname AS table_name, n_live_tup::int AS row_count FROM pg_stat_user_tables WHERE schemaname = 'public' ORDER BY relname",
  );

  const results: BranchTableInfo[] = [];
  for (const line of output.split("\n")) {
    const match = line.match(/^\s*public\.(\S+)\s*\|\s*(\d+)/);
    if (match) {
      results.push({ table: match[1], rows: parseInt(match[2], 10) });
    }
  }

  return results;
}

export async function getBranchSample(
  name: string,
  table: string,
  limit = 5,
): Promise<Record<string, unknown>[]> {
  const branch = getBranch(name);
  if (!branch) {
    throw new Error(`Branch '${name}' not found`);
  }
  if (branch.status !== "running") {
    throw new Error(`Branch '${name}' is not running. Start it first.`);
  }

  const pg = (await import("postgres")).default;
  const sql = pg(branch.connectionString, {
    max: 1,
    connect_timeout: 10,
    onnotice: () => {},
  });

  try {
    // `table` comes from user/agent input via `sow branch sample <branch> <table>`
    // or the `sow_branch_sample` MCP tool — we cannot trust it. Identifiers
    // cannot be parameterized so we quote via the SQL-standard escape. The
    // limit is numeric-clamped to [0, 100] then passed as $1.
    const safeLimit = Math.min(Math.max(0, limit | 0), 100);
    const rows = await sql.unsafe(
      `SELECT * FROM ${quoteIdent(table)} LIMIT $1`,
      [safeLimit] as unknown as Parameters<typeof sql.unsafe>[1],
    );
    return rows.map((r: Record<string, unknown>) => ({ ...r }));
  } finally {
    await sql.end();
  }
}

export async function runWithBranchEnv(
  name: string,
  command: string[],
): Promise<void> {
  const env = getBranchEnv(name);
  const { spawn } = await import("node:child_process");

  return new Promise((resolve, reject) => {
    const child = spawn(command[0], command.slice(1), {
      env: { ...process.env, ...env },
      stdio: "inherit",
      shell: true,
    });
    child.on("close", (code) => {
      if (code === 0) resolve();
      else process.exit(code ?? 1);
    });
    child.on("error", reject);
  });
}

import type { BranchProvider, ProviderDetection, ProviderBranchOpts, ProviderBranchResult } from "../provider.js";
import type { Branch, BranchStatus } from "../types.js";
import {
  ensureDocker,
  createConnectorContainer,
  waitForConnectorReady,
  removeContainer,
  getContainerStatus,
  execSqlInDb,
  loadInitSqlIntoDb,
  dumpDatabase,
  restoreDumpToDatabase,
  listDatabases,
  POSTGRES_USER,
  POSTGRES_PASSWORD,
  POSTGRES_BOOTSTRAP_DB,
} from "../docker.js";
import { findFreePort } from "../ports.js";
import {
  readConnectorContainer,
  writeConnectorContainer,
  deleteConnectorContainer,
  type ConnectorContainerInfo,
} from "../storage.js";
import { quoteIdent } from "../../sql/identifiers.js";

const SAFE_NAME_RE = /^[a-zA-Z0-9_-]{1,40}$/;

export const PROVIDER_META_VERSION = 2;

/** Docker provider metadata stored in Branch.providerMeta. */
export interface DockerProviderMeta {
  providerMetaVersion: number;
  containerId: string;
  containerName: string;
  pgVersion: string;
  connector: string;
  databaseName: string;
}

function assertSafeName(kind: string, value: string): void {
  if (!SAFE_NAME_RE.test(value)) {
    throw new Error(
      `Invalid ${kind} name '${value}': must match ${SAFE_NAME_RE.source}`,
    );
  }
}

function buildContainerName(connector: string): string {
  return `sow-${connector}`;
}

function buildSeedDatabaseName(connector: string): string {
  return `sow_seed_${connector.replace(/-/g, "_")}`;
}

function buildBranchDatabaseName(branchName: string): string {
  return `sow_${branchName.replace(/-/g, "_")}`;
}

function buildConnectionString(port: number, databaseName: string): string {
  return `postgresql://${POSTGRES_USER}:${POSTGRES_PASSWORD}@localhost:${port}/${databaseName}`;
}

function isV2Meta(raw: unknown): raw is DockerProviderMeta {
  if (!raw || typeof raw !== "object") return false;
  const m = raw as Record<string, unknown>;
  return (
    m.providerMetaVersion === PROVIDER_META_VERSION &&
    typeof m.containerName === "string" &&
    typeof m.databaseName === "string" &&
    typeof m.connector === "string"
  );
}

function readMeta(branch: Branch): DockerProviderMeta {
  const raw = branch.providerMeta;
  if (!isV2Meta(raw)) {
    throw new Error(
      `Branch '${branch.name}' was created by an older sow version and is not ` +
        `compatible with the template-database provider. Run \`sow branch delete ${branch.name}\` ` +
        `and recreate the branch.`,
    );
  }
  return raw;
}

export class DockerBranchProvider implements BranchProvider {
  readonly name = "docker";

  async detect(): Promise<ProviderDetection | null> {
    try {
      await ensureDocker();
      return { meta: {} };
    } catch {
      return null;
    }
  }

  async createBranch(opts: ProviderBranchOpts): Promise<ProviderBranchResult> {
    assertSafeName("connector", opts.connector);
    assertSafeName("branch", opts.name);

    const pgVersion = opts.pgVersion ?? "16";
    const containerName = buildContainerName(opts.connector);
    const seedDb = buildSeedDatabaseName(opts.connector);
    const branchDb = buildBranchDatabaseName(opts.name);

    let container = readConnectorContainer(opts.connector);

    // First branch for this connector — bring up the long-lived container
    // and seed the template database from init.sql.
    if (!container) {
      const port = await findFreePort(opts.port);
      const containerId = await createConnectorContainer({
        containerName,
        port,
        pgVersion,
      });
      try {
        await waitForConnectorReady(containerName);
        // Create the seed database, restore init.sql into it, then mark
        // it as a template (and disallow direct connections).
        await execSqlInDb(
          containerName,
          POSTGRES_BOOTSTRAP_DB,
          `CREATE DATABASE ${quoteIdent(seedDb)} OWNER ${quoteIdent(POSTGRES_USER)}`,
        );
        await loadInitSqlIntoDb(containerName, seedDb, opts.initSqlPath);
        // ALTER DATABASE ... IS_TEMPLATE / ALLOW_CONNECTIONS is supported on
        // PG12+. The repo defaults to postgres:16-alpine.
        await execSqlInDb(
          containerName,
          POSTGRES_BOOTSTRAP_DB,
          `ALTER DATABASE ${quoteIdent(seedDb)} IS_TEMPLATE true`,
        );
        await execSqlInDb(
          containerName,
          POSTGRES_BOOTSTRAP_DB,
          `ALTER DATABASE ${quoteIdent(seedDb)} ALLOW_CONNECTIONS false`,
        );
      } catch (err) {
        // Roll back: leaving a half-initialized container would poison the
        // next createBranch call.
        await removeContainer(containerName);
        throw err;
      }

      container = {
        containerId,
        containerName,
        port,
        pgVersion,
        seedDatabase: seedDb,
        createdAt: new Date().toISOString(),
      };
      writeConnectorContainer(opts.connector, container);
    }

    // Clone the seed into a fresh per-branch database.
    await execSqlInDb(
      containerName,
      POSTGRES_BOOTSTRAP_DB,
      `CREATE DATABASE ${quoteIdent(branchDb)} WITH TEMPLATE ${quoteIdent(container.seedDatabase)} OWNER ${quoteIdent(POSTGRES_USER)}`,
    );

    return {
      connectionString: buildConnectionString(container.port, branchDb),
      port: container.port,
      providerMeta: {
        providerMetaVersion: PROVIDER_META_VERSION,
        containerId: container.containerId,
        containerName: container.containerName,
        pgVersion: container.pgVersion,
        connector: opts.connector,
        databaseName: branchDb,
      } satisfies DockerProviderMeta,
    };
  }

  async deleteBranch(branch: Branch): Promise<void> {
    const meta = readMeta(branch);
    // DROP DATABASE cannot be wrapped in a transaction; pass straight through.
    try {
      await execSqlInDb(
        meta.containerName,
        POSTGRES_BOOTSTRAP_DB,
        `DROP DATABASE IF EXISTS ${quoteIdent(meta.databaseName)} WITH (FORCE)`,
      );
    } catch (err) {
      // If the container is gone there's nothing to clean.
      const status = await getContainerStatus(meta.containerName);
      if (status === "not_found") {
        deleteConnectorContainer(meta.connector);
        return;
      }
      throw err;
    }

    // If this was the last branch for the connector, tear the whole
    // container down so we don't leak idle Postgres processes.
    const remaining = await listDatabases(meta.containerName, "sow_%");
    const seed = buildSeedDatabaseName(meta.connector);
    const nonSeed = remaining.filter((d) => d !== seed);
    if (nonSeed.length === 0) {
      await removeContainer(meta.containerName);
      deleteConnectorContainer(meta.connector);
    }
  }

  async resetBranch(branch: Branch, _initSqlPath: string): Promise<void> {
    const meta = readMeta(branch);
    const seed = buildSeedDatabaseName(meta.connector);
    // DROP + CREATE FROM TEMPLATE: ~200-800ms on a 10k-row schema, vs the
    // 5-15s of the previous "tear down the container and re-run init.sql"
    // approach. WITH (FORCE) terminates lingering connections (PG13+).
    await execSqlInDb(
      meta.containerName,
      POSTGRES_BOOTSTRAP_DB,
      `DROP DATABASE IF EXISTS ${quoteIdent(meta.databaseName)} WITH (FORCE)`,
    );
    await execSqlInDb(
      meta.containerName,
      POSTGRES_BOOTSTRAP_DB,
      `CREATE DATABASE ${quoteIdent(meta.databaseName)} WITH TEMPLATE ${quoteIdent(seed)} OWNER ${quoteIdent(POSTGRES_USER)}`,
    );
  }

  async execSQL(branch: Branch, sql: string): Promise<string> {
    const meta = readMeta(branch);
    return execSqlInDb(meta.containerName, meta.databaseName, sql);
  }

  async getBranchStatus(branch: Branch): Promise<BranchStatus> {
    const meta = readMeta(branch);
    const actual = await getContainerStatus(meta.containerName);
    if (actual === "not_found") return "error";
    return actual === "running" ? "running" : "stopped";
  }

  async stopBranch(branch: Branch): Promise<void> {
    // In the template-database model the container is shared by every
    // branch for a connector, so "stop one branch" has no analog at the
    // container level. Instead, terminate any open connections to this
    // branch's database — the container keeps running and other branches
    // are unaffected.
    const meta = readMeta(branch);
    await execSqlInDb(
      meta.containerName,
      POSTGRES_BOOTSTRAP_DB,
      `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = ${pgString(meta.databaseName)}`,
    );
  }

  async startBranch(branch: Branch): Promise<void> {
    // The container is always running while any branch exists, so start
    // is effectively a no-op. We just verify the container is up.
    const meta = readMeta(branch);
    await ensureDocker();
    const status = await getContainerStatus(meta.containerName);
    if (status === "not_found") {
      throw new Error(
        `Connector container '${meta.containerName}' is gone. Recreate the branch.`,
      );
    }
    if (status === "stopped") {
      // Reuse the existing low-level startContainer
      const { startContainer } = await import("../docker.js");
      await startContainer(meta.containerName);
      await waitForConnectorReady(meta.containerName);
    }
  }

  async dumpBranch(branch: Branch): Promise<string> {
    const meta = readMeta(branch);
    return dumpDatabase(meta.containerName, meta.databaseName);
  }

  async restoreDump(branch: Branch, sql: string): Promise<void> {
    const meta = readMeta(branch);
    await restoreDumpToDatabase(meta.containerName, meta.databaseName, sql);
  }
}

/** SQL string literal escape (single-quote doubling). For LITERALS only. */
function pgString(s: string): string {
  return "'" + s.replace(/'/g, "''") + "'";
}

// Re-exported helpers for tests.
export const __test__ = {
  buildContainerName,
  buildSeedDatabaseName,
  buildBranchDatabaseName,
  buildConnectionString,
  isV2Meta,
  pgString,
};
export type { ConnectorContainerInfo };

import { statSync } from "node:fs";
import { PostgresAdapter } from "../adapters/postgres.js";
import { analyze } from "../analyzer/index.js";
import { createSampler } from "../sampler/index.js";
import { createSanitizer } from "../sanitizer/index.js";
import { exportSQL } from "../exporter/sql.js";
import { DEFAULT_SAMPLING_CONFIG } from "../types.js";
import type { ProgressCallback } from "../types.js";
import {
  getSnapshotDir,
  getInitSqlPath,
  readConnectorMetadata,
  writeConnectorMetadata,
  listConnectorNames,
  deleteConnectorSnapshot,
  readBranches,
} from "./storage.js";
import { resolveProvider } from "./provider-registry.js";
import type {
  ConnectorMetadata,
  ConnectorInfo,
  ConnectorCreateOptions,
  ConnectorCreateResult,
} from "./types.js";

function extractDbName(connectionString: string): string {
  try {
    const url = new URL(connectionString);
    return url.pathname.replace(/^\//, "") || "default";
  } catch {
    const match = connectionString.match(/\/([^/?]+)(\?|$)/);
    return match?.[1] ?? "default";
  }
}

export async function createConnector(
  connectionString: string,
  opts: ConnectorCreateOptions = {},
  onProgress?: ProgressCallback,
): Promise<ConnectorCreateResult> {
  const name = opts.name || extractDbName(connectionString);
  const isFullCopy = !!opts.full;
  const maxRows = isFullCopy ? Infinity : (opts.maxRowsPerTable ?? 200);
  const seed = opts.seed ?? 42;

  const adapter = new PostgresAdapter();

  try {
    onProgress?.({ type: "connecting", message: `Connecting to ${name}...` });
    await adapter.connect(connectionString);

    onProgress?.({ type: "analyzing_schema", message: "Analyzing schema..." });
    const analysis = await analyze(adapter, { onProgress });

    const samplingConfig = {
      ...DEFAULT_SAMPLING_CONFIG,
      maxRowsPerTable: maxRows,
      seed,
      excludeTables: opts.excludeTables ?? [],
    };

    onProgress?.({ type: "selecting_samples", message: isFullCopy ? "Copying all rows..." : "Sampling rows..." });
    const sampler = createSampler({ config: samplingConfig, analysis, onProgress });
    const sampled = await sampler.sample(adapter);

    const sanitizationConfig = {
      enabled: !opts.noSanitize,
      rules: [] as { table: string; column: string; type: any }[],
      skipColumns: [] as string[],
      allowUnsafe: !!opts.allowUnsafe,
    };

    if (!opts.noSanitize) {
      onProgress?.({ type: "sanitizing", message: "Sanitizing PII..." });
    }
    const sanitizer = createSanitizer({
      config: sanitizationConfig,
      tables: analysis.schema.tables,
      enumTypes: analysis.schema.enums,
      onProgress,
    });
    const sanitized = sanitizer.sanitize(sampled.tables);

    // Let the active provider extract any extra snapshot data (e.g. auth users)
    let providerAuthUsers: ConnectorMetadata["authUsers"];
    try {
      const { provider } = await resolveProvider();
      if (provider.postSnapshot) {
        const extra = await provider.postSnapshot(adapter, sanitized.tables);
        if (extra.authUsers && extra.authUsers.length > 0) {
          providerAuthUsers = extra.authUsers;
        }
      }
    } catch {
      // No provider available during connect — that's fine
    }

    onProgress?.({ type: "exporting", message: "Saving snapshot..." });
    const snapshotDir = getSnapshotDir(name);
    const result = exportSQL(
      analysis.schema,
      sanitized.tables,
      analysis.dependencyOrder,
      snapshotDir,
    );

    const { renameSync, existsSync } = await import("node:fs");
    const { join } = await import("node:path");
    const sowSqlPath = join(snapshotDir, "sow.sql");
    const initSqlPath = getInitSqlPath(name);
    if (existsSync(sowSqlPath) && sowSqlPath !== initSqlPath) {
      renameSync(sowSqlPath, initSqlPath);
    }

    let totalRows = 0;
    for (const t of sanitized.tables) totalRows += t.rows.length;

    const metadata: ConnectorMetadata = {
      name,
      connectionString,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      tables: analysis.schema.tables.length,
      rows: totalRows,
      sizeBytes: result.totalSize,
      piiColumnsDetected: analysis.patterns.piiColumns.length,
      samplingConfig,
      sanitizationConfig,
      analysis,
      authUsers: providerAuthUsers,
      integrityWarnings:
        sampled.integrityWarnings && sampled.integrityWarnings.length > 0
          ? sampled.integrityWarnings
          : undefined,
    };

    writeConnectorMetadata(name, metadata);

    onProgress?.({
      type: "done",
      message: "Snapshot saved",
      detail: { name, tables: metadata.tables, rows: totalRows },
    });

    return {
      name,
      tables: metadata.tables,
      rows: totalRows,
      piiColumnsDetected: metadata.piiColumnsDetected,
      sizeBytes: result.totalSize,
      snapshotPath: snapshotDir,
      integrityWarningsCount: sampled.integrityWarnings?.length ?? 0,
    };
  } finally {
    await adapter.disconnect();
  }
}

export function listConnectors(): ConnectorInfo[] {
  return listConnectorNames().map((name) => {
    const meta = readConnectorMetadata(name);
    if (!meta) {
      return { name, tables: 0, rows: 0, sizeBytes: 0, createdAt: "" };
    }
    return {
      name: meta.name,
      tables: meta.tables,
      rows: meta.rows,
      sizeBytes: meta.sizeBytes,
      createdAt: meta.createdAt,
    };
  });
}

export async function deleteConnector(name: string): Promise<void> {
  const branches = readBranches().filter((b) => b.connector === name);
  if (branches.length > 0) {
    const names = branches.map((b) => b.name).join(", ");
    throw new Error(
      `Connector '${name}' has active branches: ${names}. Delete them first.`,
    );
  }
  deleteConnectorSnapshot(name);
}

export async function refreshConnector(
  name: string,
  onProgress?: ProgressCallback,
): Promise<ConnectorCreateResult> {
  const meta = readConnectorMetadata(name);
  if (!meta) {
    throw new Error(`Connector '${name}' not found`);
  }

  return createConnector(meta.connectionString, {
    name,
    maxRowsPerTable: meta.samplingConfig.maxRowsPerTable,
    excludeTables: meta.samplingConfig.excludeTables,
    noSanitize: !meta.sanitizationConfig.enabled,
    seed: meta.samplingConfig.seed,
  }, onProgress);
}

export function getConnectorMetadata(name: string): ConnectorMetadata | null {
  return readConnectorMetadata(name);
}

import type {
  DatabaseAdapter,
  AnalysisResult,
  SamplingConfig,
  SamplingResult,
  SampledTable,
  ProgressCallback,
} from "../types.js";
import { randomSample } from "./selector.js";
import { findEdgeCases, injectEdgeCases } from "./edge-cases.js";
import { ensureReferentialIntegrity } from "./referential.js";

async function runWithConcurrency<T>(
  tasks: (() => Promise<T>)[],
  limit: number,
): Promise<T[]> {
  const results: T[] = new Array(tasks.length);
  let nextIndex = 0;

  async function worker(): Promise<void> {
    while (nextIndex < tasks.length) {
      const i = nextIndex++;
      results[i] = await tasks[i]();
    }
  }

  const workers = Array.from(
    { length: Math.min(limit, tasks.length) },
    () => worker(),
  );
  await Promise.all(workers);
  return results;
}

const CONCURRENCY_LIMIT = 5;

export interface SamplerOptions {
  config: SamplingConfig;
  analysis: AnalysisResult;
  onProgress?: ProgressCallback;
}

export function createSampler(options: SamplerOptions) {
  const { config, analysis, onProgress } = options;

  async function sample(adapter: DatabaseAdapter): Promise<SamplingResult> {
    const { dependencyOrder } = analysis;
    const tables = analysis.schema.tables;

    const excludeSet = new Set(config.excludeTables);
    const includeSet =
      config.includeTables.length > 0
        ? new Set(config.includeTables)
        : null;

    const tablesToSample = dependencyOrder.filter((name) => {
      if (excludeSet.has(name)) return false;
      if (includeSet && !includeSet.has(name)) return false;
      return true;
    });

    const isFullCopy = !isFinite(config.maxRowsPerTable);
    const verb = isFullCopy ? "Copying" : "Sampling";

    onProgress?.({
      type: "selecting_samples",
      message: `${verb} ${tablesToSample.length} tables...`,
      total: tablesToSample.length,
    });

    const sampledMap = new Map<string, Record<string, unknown>[]>();
    let completed = 0;

    const tasks = tablesToSample.map((tableName, i) => async () => {
      const tableInfo = tables.find((t) => t.name === tableName);
      if (!tableInfo) return { tableName, rows: null };

      const stats = analysis.stats.tables.find((s) => s.table === tableName);
      const rowCount = stats?.rowCount ?? 0;

      let sampledRows: Record<string, unknown>[];
      // Auto-include all rows for small tables (< 1000 rows) to preserve
      // referential integrity. maxRowsPerTable only limits truly large tables.
      const fullScanThreshold = Math.max(config.maxRowsPerTable, 1000);
      const needsFullScan = rowCount <= fullScanThreshold;

      if (needsFullScan) {
        const allRows = await adapter.getAllRows(tableName);
        sampledRows = [...allRows];

        if (config.includeEdgeCases) {
          const edgeCases = findEdgeCases(tableName, tableInfo.columns, allRows);
          sampledRows = injectEdgeCases(
            sampledRows,
            allRows,
            edgeCases,
            tableInfo.primaryKey,
          );
        }
      } else if (config.includeEdgeCases) {
        const allRows = await adapter.getAllRows(tableName);
        sampledRows = randomSample(
          allRows,
          config.maxRowsPerTable,
          config.seed + i,
        );
        const edgeCases = findEdgeCases(tableName, tableInfo.columns, allRows);
        sampledRows = injectEdgeCases(
          sampledRows,
          allRows,
          edgeCases,
          tableInfo.primaryKey,
        );
      } else {
        sampledRows = await adapter.getRandomSample(
          tableName,
          config.maxRowsPerTable,
          config.seed + i,
        );
      }

      completed++;
      const progressMsg = isFullCopy
        ? `${verb} ${tableName}... (${rowCount.toLocaleString()} rows)`
        : rowCount > config.maxRowsPerTable
          ? `${verb} ${tableName}... (${config.maxRowsPerTable} of ${rowCount.toLocaleString()})`
          : `${verb} ${tableName}... (${rowCount.toLocaleString()} rows)`;

      onProgress?.({
        type: "selecting_samples",
        message: progressMsg,
        progress: completed,
        total: tablesToSample.length,
        detail: {
          tableName,
          maxRows: config.maxRowsPerTable,
          sourceRows: rowCount,
          mode: isFullCopy ? "full" : "sampled",
        },
      });

      return { tableName, rows: sampledRows };
    });

    const results = await runWithConcurrency(tasks, CONCURRENCY_LIMIT);

    for (const { tableName, rows } of results) {
      if (rows) sampledMap.set(tableName, rows);
    }

    const integrityResult = isFullCopy
      ? { tables: sampledMap, warnings: [] }
      : await ensureReferentialIntegrity(
          adapter,
          sampledMap,
          analysis.schema.relationships,
        );
    const integrityFixed = integrityResult.tables;

    const sampledTables: SampledTable[] = [];
    for (const tableName of tablesToSample) {
      const tableInfo = tables.find((t) => t.name === tableName);
      const rows = integrityFixed.get(tableName) || [];
      const stats = analysis.stats.tables.find((s) => s.table === tableName);
      const edgeCases = config.includeEdgeCases && tableInfo
        ? findEdgeCases(tableName, tableInfo.columns, rows)
        : [];

      sampledTables.push({
        table: tableName,
        rows,
        totalRowsInSource: stats?.rowCount ?? 0,
        edgeCasesIncluded: edgeCases,
      });
    }

    return {
      tables: sampledTables,
      config,
      integrityWarnings: integrityResult.warnings,
    };
  }

  return { sample };
}
